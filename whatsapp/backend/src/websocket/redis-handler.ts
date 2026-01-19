import { config as _config } from '../config.js';
import { redisPub, KEYS } from '../redis.js';
import { createServiceLogger } from '../shared/logger.js';
import { recordDeliveryDuration } from '../shared/metrics.js';
import { withRedisCircuit } from '../shared/circuitBreaker.js';
import { recordDelivery, idempotentStatusUpdate } from '../shared/deliveryTracker.js';
import { getConnection, sendToSocket } from './connection-manager.js';

const _wsLogger = createServiceLogger('websocket-redis');

/**
 * Redis Message Handler Module
 *
 * @description Handles messages received from Redis pub/sub for cross-server communication.
 * This module processes incoming messages from other server instances and routes them
 * to locally connected users. Supports message delivery, typing indicators, receipts,
 * and reaction updates.
 *
 * @module redis-handler
 */

/**
 * Data structure for messages received from Redis pub/sub.
 *
 * @description Represents the parsed JSON structure of inter-server messages.
 * Different message types populate different optional fields.
 *
 * @property type - The message type discriminator
 * @property recipientId - The target user ID for this message
 * @property senderId - Original sender's user ID (for deliver_message)
 * @property senderServer - Server ID of the sender (for routing receipts back)
 * @property messageId - The message ID (for deliver_message and receipts)
 * @property sendStartTime - Unix timestamp when send started (for latency metrics)
 * @property payload - The message content to deliver to the recipient
 */
export interface RedisMessageData {
  type: string;
  recipientId: string;
  senderId?: string;
  senderServer?: string;
  messageId?: string;
  sendStartTime?: number;
  payload?: unknown;
}

/**
 * Handles messages received from Redis pub/sub.
 *
 * @description Main entry point for processing cross-server messages. Routes messages
 * to appropriate handlers based on the message type:
 *
 * - `deliver_message` - Delivers a chat message to a local user
 * - `forward_typing` - Forwards typing indicator to a local user
 * - `forward_receipt` - Forwards delivery/read receipt to a local user
 * - `forward_reaction` - Forwards reaction update to a local user
 *
 * @param data - The parsed message from Redis pub/sub
 * @returns Promise that resolves when the message is processed
 *
 * @example
 * ```typescript
 * redisSub.on('message', async (channel, message) => {
 *   if (channel === KEYS.serverChannel(config.serverId)) {
 *     await handleRedisMessage(JSON.parse(message));
 *   }
 * });
 * ```
 */
export async function handleRedisMessage(data: RedisMessageData): Promise<void> {
  switch (data.type) {
    case 'deliver_message':
      await handleDeliverMessage(data);
      break;

    case 'forward_typing':
    case 'forward_receipt':
    case 'forward_reaction':
      handleForwardMessage(data);
      break;
  }
}

/**
 * Handles cross-server message delivery.
 *
 * @description Delivers a message to a locally connected recipient and handles
 * delivery receipt generation. After successful delivery:
 * 1. Sends the message to the recipient's WebSocket
 * 2. Updates message status to 'delivered' (idempotent)
 * 3. Records delivery metrics and duration
 * 4. Publishes delivery receipt back to sender's server via Redis
 *
 * @param data - The Redis message data containing recipient and message info
 * @returns Promise that resolves when delivery and receipt are complete
 * @internal
 */
async function handleDeliverMessage(data: RedisMessageData): Promise<void> {
  const socket = getConnection(data.recipientId);
  if (!socket) return;

  sendToSocket(socket, {
    type: 'message',
    payload: data.payload,
  });

  const wasUpdated = await idempotentStatusUpdate(
    data.messageId!,
    data.recipientId,
    'delivered'
  );

  if (wasUpdated) {
    const deliveryDuration = (Date.now() - data.sendStartTime!) / 1000;
    recordDeliveryDuration(deliveryDuration, 'cross_server');

    await recordDelivery(data.messageId!, data.recipientId, 'cross_server');

    // Send delivery receipt back to sender's server
    await withRedisCircuit(async () => {
      await redisPub.publish(
        KEYS.serverChannel(data.senderServer!),
        JSON.stringify({
          type: 'forward_receipt',
          recipientId: data.senderId,
          payload: {
            type: 'delivery_receipt',
            payload: {
              messageId: data.messageId,
              recipientId: data.recipientId,
              status: 'delivered',
              timestamp: new Date(),
            },
          },
        })
      );
    });
  }
}

/**
 * Handles forwarding of typing indicators, receipts, and reactions.
 *
 * @description Delivers forwarded messages directly to locally connected recipients.
 * These message types don't require acknowledgment or tracking - they are
 * fire-and-forget notifications.
 *
 * @param data - The Redis message data containing recipient and payload
 * @internal
 */
function handleForwardMessage(data: RedisMessageData): void {
  const socket = getConnection(data.recipientId);
  if (socket) {
    sendToSocket(socket, data.payload);
  }
}
