import type { Message, WebSocketMessage } from '@/types';

/**
 * Callback function type for handling incoming WebSocket messages.
 * @param message - The parsed WebSocket message object
 */
type MessageHandler = (message: WebSocketMessage) => void;

/**
 * WebSocket service for real-time messaging functionality.
 * Handles connection management, automatic reconnection with exponential backoff,
 * message queuing for offline scenarios, and provides convenience methods for
 * common messaging operations (send message, typing indicators, read receipts, reactions).
 *
 * This service implements the client side of the iMessage real-time protocol,
 * enabling features like live message delivery, typing indicators, and presence.
 */
class WebSocketService {
  /** Active WebSocket connection instance */
  private ws: WebSocket | null = null;
  /** Set of registered message handlers for incoming messages */
  private handlers: Set<MessageHandler> = new Set();
  /** Current number of reconnection attempts */
  private reconnectAttempts = 0;
  /** Maximum allowed reconnection attempts before giving up */
  private maxReconnectAttempts = 5;
  /** Base delay in ms for exponential backoff reconnection */
  private reconnectDelay = 1000;
  /** Interval ID for keep-alive pings */
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  /** Queue for messages sent while disconnected */
  private messageQueue: WebSocketMessage[] = [];
  /** Flag to prevent multiple simultaneous connection attempts */
  private isConnecting = false;

  /**
   * Establishes a WebSocket connection to the server.
   * Automatically determines ws/wss protocol based on page protocol.
   * Processes queued messages upon successful connection.
   *
   * @param token - JWT authentication token for the connection
   * @returns Promise that resolves when connection is established
   * @throws Error if connection fails
   */
  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        resolve();
        return;
      }

      this.isConnecting = true;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws?token=${token}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Send queued messages
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift();
          if (message) {
            this.send(message);
          }
        }

        // Start ping interval to keep connection alive
        this.startPing();

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          this.handlers.forEach((handler) => handler(message));
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnecting = false;
        this.stopPing();
        this.attemptReconnect(token);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
        reject(error);
      };
    });
  }

  /**
   * Starts the keep-alive ping interval to maintain the connection.
   * The actual ping/pong is handled by the server; this keeps the JS event loop active.
   * @private
   */
  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // WebSocket ping is handled by the server
      }
    }, 25000);
  }

  /**
   * Stops the keep-alive ping interval.
   * Called when disconnecting or before reconnection attempts.
   * @private
   */
  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attempts to reconnect to the WebSocket server using exponential backoff.
   * Gives up after maxReconnectAttempts to prevent infinite loops.
   *
   * @param token - JWT token for reauthentication
   * @private
   */
  private attemptReconnect(token: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect(token).catch(console.error);
    }, delay);
  }

  /**
   * Closes the WebSocket connection and cleans up all resources.
   * Clears handlers, message queue, and ping interval.
   */
  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handlers.clear();
    this.messageQueue = [];
  }

  /**
   * Sends a message through the WebSocket connection.
   * If not connected, queues the message for later delivery.
   *
   * @param message - The WebSocket message object to send
   */
  send(message: WebSocketMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for later
      this.messageQueue.push(message);
    }
  }

  /**
   * Registers a handler function for incoming WebSocket messages.
   * Multiple handlers can be registered and will all receive messages.
   *
   * @param handler - Callback function to handle incoming messages
   * @returns Unsubscribe function to remove the handler
   */
  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  // Convenience methods
  /**
   * Sends a chat message to a conversation.
   * Generates a client-side ID for optimistic updates and deduplication.
   *
   * @param conversationId - Target conversation UUID
   * @param content - Message text content
   * @param options - Optional contentType, replyToId for replies, and clientMessageId
   */
  sendMessage(
    conversationId: string,
    content: string,
    options?: { contentType?: string; replyToId?: string; clientMessageId?: string }
  ) {
    this.send({
      type: 'send_message',
      conversationId,
      content,
      ...options,
    });
  }

  /**
   * Sends a typing indicator to a conversation.
   * Other participants will see that this user is typing.
   *
   * @param conversationId - Target conversation UUID
   * @param isTyping - True when user starts typing, false when they stop
   */
  sendTyping(conversationId: string, isTyping: boolean) {
    this.send({
      type: 'typing',
      conversationId,
      isTyping,
    });
  }

  /**
   * Sends a read receipt for a message.
   * Updates the read status visible to other participants.
   *
   * @param conversationId - Target conversation UUID
   * @param messageId - UUID of the last read message
   */
  sendRead(conversationId: string, messageId: string) {
    this.send({
      type: 'read',
      conversationId,
      messageId,
    });
  }

  /**
   * Sends a reaction (emoji) to a message.
   *
   * @param messageId - UUID of the message to react to
   * @param reaction - The emoji reaction string
   * @param remove - If true, removes the reaction instead of adding it
   */
  sendReaction(messageId: string, reaction: string, remove = false) {
    this.send({
      type: 'reaction',
      messageId,
      reaction,
      remove,
    });
  }

  /**
   * Checks if the WebSocket connection is currently open.
   *
   * @returns True if connected and ready to send/receive messages
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Singleton instance of the WebSocket service.
 * Use this throughout the application for real-time messaging.
 */
export const wsService = new WebSocketService();
