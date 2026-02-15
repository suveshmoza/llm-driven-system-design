import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../services/logger.js';
import { sfuService } from '../services/sfuService.js';
import * as meetingService from '../services/meetingService.js';
import * as chatService from '../services/chatService.js';
import { wsConnections, activeParticipants } from '../services/metrics.js';

interface WsClient {
  ws: WebSocket;
  userId: string;
  username: string;
  displayName: string;
  meetingId: string | null;
  meetingCode: string | null;
}

// Meeting code -> set of client user IDs in that meeting
const meetingClients: Map<string, Map<string, WsClient>> = new Map();

function broadcastToMeeting(meetingId: string, message: object, excludeUserId?: string) {
  const clients = meetingClients.get(meetingId);
  if (!clients) return;

  const data = JSON.stringify(message);
  for (const [userId, client] of clients) {
    if (userId !== excludeUserId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function sendToUser(meetingId: string, userId: string, message: object) {
  const clients = meetingClients.get(meetingId);
  if (!clients) return;

  const client = clients.get(userId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

function send(ws: WebSocket, message: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Parse session info from query params (simplified auth for WebSocket)
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId');
    const username = url.searchParams.get('username');

    if (!userId || !username) {
      ws.close(4001, 'Authentication required');
      return;
    }

    const client: WsClient = {
      ws,
      userId,
      username,
      displayName: username,
      meetingId: null,
      meetingCode: null,
    };

    wsConnections.inc();
    logger.info({ userId, username }, 'WebSocket client connected');

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(client, message);
      } catch (err) {
        logger.error({ err, userId }, 'WebSocket message error');
        send(ws, { type: 'error', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      wsConnections.dec();
      logger.info({ userId, username }, 'WebSocket client disconnected');
      handleDisconnect(client);
    });

    ws.on('error', (err) => {
      logger.error({ err, userId }, 'WebSocket error');
    });
  });
}

async function handleMessage(client: WsClient, message: { type: string; [key: string]: unknown }) {
  const { type } = message;

  switch (type) {
    case 'join-meeting':
      await handleJoinMeeting(client, message as { type: string; meetingCode: string; displayName: string });
      break;
    case 'leave-meeting':
      await handleLeaveMeeting(client);
      break;
    case 'produce':
      handleProduce(client, message as { type: string; kind: 'audio' | 'video' | 'screen'; rtpParameters: unknown });
      break;
    case 'consume':
      handleConsume(client, message as { type: string; producerId: string });
      break;
    case 'producer-close':
      handleProducerClose(client, message as { type: string; producerId: string });
      break;
    case 'toggle-mute':
      await handleToggleMute(client, message as { type: string; muted: boolean });
      break;
    case 'toggle-video':
      await handleToggleVideo(client, message as { type: string; videoOn: boolean });
      break;
    case 'start-screen-share':
      await handleStartScreenShare(client);
      break;
    case 'stop-screen-share':
      await handleStopScreenShare(client);
      break;
    case 'raise-hand':
      await handleRaiseHand(client, message as { type: string; raised: boolean });
      break;
    case 'chat-message':
      await handleChatMessage(client, message as { type: string; content: string; recipientId?: string });
      break;
    default:
      send(client.ws, { type: 'error', message: `Unknown message type: ${type}` });
  }
}

async function handleJoinMeeting(
  client: WsClient,
  message: { meetingCode: string; displayName: string }
) {
  const { meetingCode, displayName } = message;
  client.displayName = displayName || client.username;

  // Look up meeting by code
  const meeting = await meetingService.getMeetingByCode(meetingCode);
  if (!meeting) {
    send(client.ws, { type: 'error', message: 'Meeting not found' });
    return;
  }

  const meetingId = meeting.id;
  client.meetingId = meetingId;
  client.meetingCode = meetingCode;

  // Auto-start if scheduled
  if (meeting.status === 'scheduled') {
    try {
      await meetingService.startMeeting(meetingId, meeting.host_id);
    } catch {
      // Not the host, that's fine — meeting may already be active
    }
  }

  // Join in DB
  await meetingService.joinMeeting(meetingId, client.userId, client.displayName);

  // Set host role if applicable
  if (meeting.host_id === client.userId) {
    await meetingService.setParticipantRole(meetingId, client.userId, 'host');
  }

  // Add to meeting clients map
  if (!meetingClients.has(meetingId)) {
    meetingClients.set(meetingId, new Map());
  }
  meetingClients.get(meetingId)!.set(client.userId, client);
  activeParticipants.inc();

  // Set up SFU room + transports
  const { sendTransportOptions, recvTransportOptions, routerRtpCapabilities } =
    sfuService.joinRoom(meetingId, client.userId);

  // Get existing participants
  const participants = await meetingService.getParticipants(meetingId);

  // Get existing producers in the room (to consume)
  const existingProducers = sfuService.getProducersForRoom(meetingId, client.userId);

  // Send joined response to the new participant
  send(client.ws, {
    type: 'joined',
    meetingId,
    meetingCode,
    hostId: meeting.host_id,
    participants: participants.map((p: { user_id: string; display_name: string; role: string; is_muted: boolean; is_video_on: boolean; is_screen_sharing: boolean; is_hand_raised: boolean }) => ({
      userId: p.user_id,
      displayName: p.display_name,
      role: p.role,
      isMuted: p.is_muted,
      isVideoOn: p.is_video_on,
      isScreenSharing: p.is_screen_sharing,
      isHandRaised: p.is_hand_raised,
    })),
    routerRtpCapabilities,
    sendTransportOptions,
    recvTransportOptions,
    existingProducers: existingProducers.map((p) => ({
      producerId: p.id,
      userId: p.userId,
      kind: p.kind,
    })),
  });

  // Notify existing participants
  broadcastToMeeting(meetingId, {
    type: 'participant-joined',
    userId: client.userId,
    displayName: client.displayName,
    role: meeting.host_id === client.userId ? 'host' : 'participant',
  }, client.userId);

  logger.info({ meetingId, userId: client.userId, displayName: client.displayName }, 'Participant joined meeting via WS');
}

async function handleLeaveMeeting(client: WsClient) {
  if (!client.meetingId) return;

  const meetingId = client.meetingId;

  // Clean up SFU
  sfuService.leaveRoom(meetingId, client.userId);

  // Update DB
  await meetingService.leaveMeeting(meetingId, client.userId);

  // Notify others
  broadcastToMeeting(meetingId, {
    type: 'participant-left',
    userId: client.userId,
  }, client.userId);

  // Remove from clients map
  const clients = meetingClients.get(meetingId);
  if (clients) {
    clients.delete(client.userId);
    if (clients.size === 0) {
      meetingClients.delete(meetingId);
    }
  }
  activeParticipants.dec();

  client.meetingId = null;
  client.meetingCode = null;

  send(client.ws, { type: 'left', meetingId });
  logger.info({ meetingId, userId: client.userId }, 'Participant left meeting');
}

function handleProduce(
  client: WsClient,
  message: { kind: 'audio' | 'video' | 'screen'; rtpParameters: unknown }
) {
  if (!client.meetingId) {
    send(client.ws, { type: 'error', message: 'Not in a meeting' });
    return;
  }

  const { kind, rtpParameters } = message;
  const producerId = sfuService.createProducer(client.meetingId, client.userId, kind, rtpParameters);

  // Tell the producer their producerId
  send(client.ws, {
    type: 'produced',
    producerId,
    kind,
  });

  // Notify all other participants about the new producer
  broadcastToMeeting(client.meetingId, {
    type: 'new-producer',
    userId: client.userId,
    producerId,
    kind,
  }, client.userId);

  logger.info({ meetingId: client.meetingId, userId: client.userId, producerId, kind }, 'Producer created');
}

function handleConsume(client: WsClient, message: { producerId: string }) {
  if (!client.meetingId) {
    send(client.ws, { type: 'error', message: 'Not in a meeting' });
    return;
  }

  try {
    const { consumerId, kind, rtpParameters } = sfuService.createConsumer(
      client.meetingId,
      client.userId,
      message.producerId
    );

    send(client.ws, {
      type: 'consume-response',
      consumerId,
      producerId: message.producerId,
      kind,
      rtpParameters,
    });
  } catch (err) {
    logger.error({ err }, 'Consume error');
    send(client.ws, { type: 'error', message: 'Failed to consume' });
  }
}

function handleProducerClose(client: WsClient, message: { producerId: string }) {
  if (!client.meetingId) return;

  sfuService.closeProducer(client.meetingId, message.producerId);

  broadcastToMeeting(client.meetingId, {
    type: 'producer-closed',
    producerId: message.producerId,
    userId: client.userId,
  }, client.userId);
}

async function handleToggleMute(client: WsClient, message: { muted: boolean }) {
  if (!client.meetingId) return;

  await meetingService.updateParticipantState(client.meetingId, client.userId, {
    isMuted: message.muted,
  });

  broadcastToMeeting(client.meetingId, {
    type: 'participant-update',
    userId: client.userId,
    isMuted: message.muted,
  });
}

async function handleToggleVideo(client: WsClient, message: { videoOn: boolean }) {
  if (!client.meetingId) return;

  await meetingService.updateParticipantState(client.meetingId, client.userId, {
    isVideoOn: message.videoOn,
  });

  broadcastToMeeting(client.meetingId, {
    type: 'participant-update',
    userId: client.userId,
    isVideoOn: message.videoOn,
  });
}

async function handleStartScreenShare(client: WsClient) {
  if (!client.meetingId) return;

  await meetingService.updateParticipantState(client.meetingId, client.userId, {
    isScreenSharing: true,
  });

  broadcastToMeeting(client.meetingId, {
    type: 'participant-update',
    userId: client.userId,
    isScreenSharing: true,
  });
}

async function handleStopScreenShare(client: WsClient) {
  if (!client.meetingId) return;

  await meetingService.updateParticipantState(client.meetingId, client.userId, {
    isScreenSharing: false,
  });

  broadcastToMeeting(client.meetingId, {
    type: 'participant-update',
    userId: client.userId,
    isScreenSharing: false,
  });
}

async function handleRaiseHand(client: WsClient, message: { raised: boolean }) {
  if (!client.meetingId) return;

  await meetingService.updateParticipantState(client.meetingId, client.userId, {
    isHandRaised: message.raised,
  });

  broadcastToMeeting(client.meetingId, {
    type: 'participant-update',
    userId: client.userId,
    isHandRaised: message.raised,
  });
}

async function handleChatMessage(
  client: WsClient,
  message: { content: string; recipientId?: string }
) {
  if (!client.meetingId) return;

  const { content, recipientId } = message;

  // Save to DB
  const saved = await chatService.saveMessage(client.meetingId, client.userId, content, recipientId);

  const chatMsg = {
    type: 'chat-message',
    id: saved.id,
    senderId: client.userId,
    senderName: client.displayName,
    content,
    recipientId: recipientId || null,
    createdAt: saved.created_at,
  };

  if (recipientId) {
    // DM: send only to recipient and sender
    sendToUser(client.meetingId, recipientId, chatMsg);
    send(client.ws, chatMsg);
  } else {
    // Broadcast to all in meeting
    broadcastToMeeting(client.meetingId, chatMsg);
  }
}

function handleDisconnect(client: WsClient) {
  if (client.meetingId) {
    handleLeaveMeeting(client).catch((err) => {
      logger.error({ err, userId: client.userId }, 'Error during disconnect cleanup');
    });
  }
}
