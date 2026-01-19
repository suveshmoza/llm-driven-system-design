import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { redisPub, KEYS } from '../redis.js';
import { getUserServer } from '../services/userService.js';
import {
  isUserInConversation,
  getConversationParticipants,
  getConversationById,
} from '../services/conversationService.js';
import { createMessage } from '../services/messageService.js';
import { WSChatMessage } from '../types/index.js';
import { createServiceLogger, LogEvents, logEvent } from '../shared/logger.js';
import { recordMessage, recordDeliveryDuration } from '../shared/metrics.js';
import { withRedisCircuit } from '../shared/circuitBreaker.js';
import { retryMessageDelivery } from '../shared/retry.js';
import { startDeliveryTracking, recordDelivery, idempotentStatusUpdate } from '../shared/deliveryTracker.js';
import { AuthenticatedSocket } from './types.js';
import { getConnection, sendToSocket } from './connection-manager.js';

const wsLogger = createServiceLogger('websocket-chat');

/**
 * Handles sending a chat message.
 * Persists to database, sends acknowledgment, and routes to all participants.
 */
export async function handleChatMessage(
  socket: AuthenticatedSocket,
  message: WSChatMessage
): Promise<void> {
  const userId = socket.userId;
  const { conversationId, content, contentType, mediaUrl } = message.payload;
  const clientMessageId = message.clientMessageId || uuidv4();
  const sendStartTime = Date.now();

  try {
    const isParticipant = await isUserInConversation(userId, conversationId);
    if (!isParticipant) {
      sendToSocket(socket, {
        type: 'error',
        payload: { message: 'Not a participant in this conversation', clientMessageId },
      });
      recordMessage('failed', contentType || 'text');
      return;
    }

    const savedMessage = await retryMessageDelivery(
      () => createMessage(conversationId, userId, content, contentType || 'text', mediaUrl),
      clientMessageId,
      userId
    );

    await startDeliveryTracking(savedMessage.id, userId);
    sendToSocket(socket, {
      type: 'message_ack',
      payload: { clientMessageId, messageId: savedMessage.id, status: 'sent', createdAt: savedMessage.created_at },
    });

    logEvent(LogEvents.MESSAGE_SENT, {
      message_id: savedMessage.id,
      conversation_id: conversationId,
      sender_id: userId,
      content_type: contentType || 'text',
    });

    const conversation = await getConversationById(conversationId);
    const participants = await getConversationParticipants(conversationId);
    await deliverToParticipants(socket, userId, conversationId, savedMessage, conversation, participants, sendStartTime);
  } catch (error) {
    wsLogger.error({ error, conversationId, userId }, 'Error handling chat message');
    recordMessage('failed', contentType || 'text');
    sendToSocket(socket, { type: 'error', payload: { message: 'Failed to send message', clientMessageId } });
  }
}

async function deliverToParticipants(
  socket: AuthenticatedSocket,
  userId: string,
  conversationId: string,
  savedMessage: { id: string; created_at: Date },
  conversation: { name?: string; is_group?: boolean } | null,
  participants: Array<{ user_id: string; user?: unknown }>,
  sendStartTime: number
): Promise<void> {
  for (const participant of participants) {
    if (participant.user_id === userId) continue;

    const recipientServer = await getUserServer(participant.user_id);
    const messagePayload = {
      ...savedMessage,
      sender: participant.user,
      conversation: { id: conversationId, name: conversation?.name, is_group: conversation?.is_group },
    };

    if (recipientServer === config.serverId) {
      await deliverLocally(socket, participant.user_id, savedMessage.id, messagePayload, sendStartTime);
    } else if (recipientServer) {
      await deliverViaRedis(userId, participant.user_id, recipientServer, savedMessage.id, messagePayload, sendStartTime);
    }
  }
}

async function deliverLocally(
  senderSocket: AuthenticatedSocket,
  recipientId: string,
  messageId: string,
  payload: unknown,
  sendStartTime: number
): Promise<void> {
  const recipientSocket = getConnection(recipientId);
  if (!recipientSocket) return;

  sendToSocket(recipientSocket, { type: 'message', payload });

  const wasUpdated = await idempotentStatusUpdate(messageId, recipientId, 'delivered');
  if (wasUpdated) {
    recordDeliveryDuration((Date.now() - sendStartTime) / 1000, 'local');
    await recordDelivery(messageId, recipientId, 'local');
    sendToSocket(senderSocket, {
      type: 'delivery_receipt',
      payload: { messageId, recipientId, status: 'delivered', timestamp: new Date() },
    });
  }
}

async function deliverViaRedis(
  senderId: string,
  recipientId: string,
  recipientServer: string,
  messageId: string,
  payload: unknown,
  sendStartTime: number
): Promise<void> {
  await withRedisCircuit(async () => {
    await redisPub.publish(
      KEYS.serverChannel(recipientServer),
      JSON.stringify({
        type: 'deliver_message',
        recipientId,
        senderId,
        senderServer: config.serverId,
        messageId,
        sendStartTime,
        payload,
      })
    );
  });
}
