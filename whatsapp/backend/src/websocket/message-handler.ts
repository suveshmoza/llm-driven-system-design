import {
  WSMessage,
  WSChatMessage,
  WSTypingMessage,
  WSReadReceiptMessage,
} from '../types/index.js';
import { checkWebSocketRateLimit } from '../shared/rateLimiter.js';
import { AuthenticatedSocket } from './types.js';
import { sendToSocket } from './connection-manager.js';
import { handleChatMessage } from './chat-handler.js';
import { handleTyping, handleReadReceipt } from './typing-handler.js';

/**
 * Message Handler Module
 *
 * Routes incoming WebSocket messages to appropriate specialized handlers.
 * Applies rate limiting to prevent spam.
 */

/**
 * Routes incoming WebSocket messages to appropriate handlers.
 * Applies rate limiting to prevent spam.
 *
 * @param socket - The authenticated WebSocket connection
 * @param message - The parsed WebSocket message
 */
export async function handleWebSocketMessage(
  socket: AuthenticatedSocket,
  message: WSMessage
): Promise<void> {
  const userId = socket.userId;

  switch (message.type) {
    case 'message': {
      // Apply rate limiting
      const rateCheck = await checkWebSocketRateLimit(userId, 'message');
      if (!rateCheck.allowed) {
        sendToSocket(socket, {
          type: 'error',
          payload: {
            code: 'RATE_LIMITED',
            message: `Too many messages. Please wait ${Math.ceil(rateCheck.resetIn / 1000)} seconds.`,
            remaining: rateCheck.remaining,
          },
        });
        return;
      }
      await handleChatMessage(socket, message as WSChatMessage);
      break;
    }

    case 'typing':
    case 'stop_typing': {
      // Apply rate limiting for typing events
      const rateCheck = await checkWebSocketRateLimit(userId, 'typing');
      if (!rateCheck.allowed) {
        return; // Silently drop typing events when rate limited
      }
      await handleTyping(socket, message as WSTypingMessage);
      break;
    }

    case 'read_receipt':
      await handleReadReceipt(socket, message as WSReadReceiptMessage);
      break;

    default:
      sendToSocket(socket, {
        type: 'error',
        payload: { message: `Unknown message type: ${message.type}` },
      });
  }
}
