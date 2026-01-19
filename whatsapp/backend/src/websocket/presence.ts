import { config } from '../config.js';
import { redisPub, KEYS } from '../redis.js';
import { getUserServer } from '../services/userService.js';
import { getConversationParticipants } from '../services/conversationService.js';
import { withRedisCircuit } from '../shared/circuitBreaker.js';
import { createServiceLogger } from '../shared/logger.js';
import { getAllConnections, getConnection, sendToSocket } from './connection-manager.js';
import { ReactionSummary } from '../types/index.js';

const wsLogger = createServiceLogger('websocket-presence');

/**
 * Presence Module
 *
 * Handles user online/offline status broadcasting and reaction updates.
 * Uses Redis pub/sub for cross-server communication.
 */

/**
 * Broadcasts a user's presence change to all connected users on this server.
 *
 * @param userId - The user whose presence changed
 * @param status - The new presence status ('online' or 'offline')
 */
export async function broadcastPresence(
  userId: string,
  status: 'online' | 'offline'
): Promise<void> {
  const presencePayload = {
    type: 'presence',
    payload: {
      userId,
      status,
      timestamp: Date.now(),
    },
  };

  // Broadcast to all connected users on this server
  for (const [connectedUserId, socket] of getAllConnections()) {
    if (connectedUserId !== userId) {
      sendToSocket(socket, presencePayload);
    }
  }
}

/**
 * Sends a delivery or read receipt to a message sender.
 * Routes through local connection or Redis pub/sub based on recipient's server.
 *
 * @param recipientUserId - The message sender to notify
 * @param messageId - The message that was delivered/read
 * @param readerId - The user who received/read the message
 * @param status - Either 'delivered' or 'read'
 * @param allMessageIds - Optional array of all message IDs being marked
 */
export async function notifyDeliveryReceipt(
  recipientUserId: string,
  messageId: string,
  readerId: string,
  status: 'delivered' | 'read',
  allMessageIds?: string[]
): Promise<void> {
  const recipientServer = await getUserServer(recipientUserId);

  const receiptPayload = {
    type: status === 'read' ? 'read_receipt' : 'delivery_receipt',
    payload: {
      messageId,
      messageIds: allMessageIds || [messageId],
      recipientId: readerId,
      status,
      timestamp: new Date(),
    },
  };

  if (recipientServer === config.serverId) {
    const recipientSocket = getConnection(recipientUserId);
    if (recipientSocket) {
      sendToSocket(recipientSocket, receiptPayload);
    }
  } else if (recipientServer) {
    await withRedisCircuit(async () => {
      await redisPub.publish(
        KEYS.serverChannel(recipientServer),
        JSON.stringify({
          type: 'forward_receipt',
          recipientId: recipientUserId,
          payload: receiptPayload,
        })
      );
    });
  }
}

/**
 * Broadcasts a reaction update to all participants in a conversation.
 * Called when a reaction is added or removed via REST API.
 * Uses local delivery for same-server recipients, Redis pub/sub for others.
 *
 * @param conversationId - The conversation containing the message
 * @param messageId - The message that was reacted to
 * @param reactions - The updated reaction summaries
 * @param actorId - The user who added/removed the reaction
 */
export async function broadcastReactionUpdate(
  conversationId: string,
  messageId: string,
  reactions: ReactionSummary[],
  actorId: string
): Promise<void> {
  try {
    const participants = await getConversationParticipants(conversationId);

    const reactionPayload = {
      type: 'reaction_update',
      payload: {
        conversationId,
        messageId,
        reactions,
        actorId,
        timestamp: new Date(),
      },
    };

    for (const participant of participants) {
      const recipientServer = await getUserServer(participant.user_id);

      if (recipientServer === config.serverId) {
        // Local delivery
        const recipientSocket = getConnection(participant.user_id);
        if (recipientSocket) {
          sendToSocket(recipientSocket, reactionPayload);
        }
      } else if (recipientServer) {
        // Route through Redis pub/sub to other server
        await withRedisCircuit(async () => {
          await redisPub.publish(
            KEYS.serverChannel(recipientServer),
            JSON.stringify({
              type: 'forward_reaction',
              recipientId: participant.user_id,
              payload: reactionPayload,
            })
          );
        });
      }
    }
  } catch (error) {
    wsLogger.error(
      { error, conversationId, messageId },
      'Error broadcasting reaction update'
    );
  }
}
