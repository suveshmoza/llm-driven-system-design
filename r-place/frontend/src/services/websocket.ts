/**
 * WebSocket service for real-time communication with the server.
 *
 * Manages WebSocket connection lifecycle including:
 * - Automatic reconnection with exponential backoff
 * - Event-based message handling
 * - Connection state tracking
 */
import type { PixelEvent, WebSocketMessage } from '../types';

/** Handler function type for processing WebSocket messages. */
type MessageHandler = (message: WebSocketMessage) => void;

/** Handler function type for connection state changes. */
type ConnectionHandler = () => void;

/**
 * WebSocket service class managing real-time server communication.
 * Implements singleton pattern for application-wide connection management.
 */
class WebSocketService {
  /** Active WebSocket connection, if any. */
  private ws: WebSocket | null = null;

  /** Set of registered message handlers. */
  private messageHandlers: Set<MessageHandler> = new Set();

  /** Set of handlers called on successful connection. */
  private connectHandlers: Set<ConnectionHandler> = new Set();

  /** Set of handlers called on disconnection. */
  private disconnectHandlers: Set<ConnectionHandler> = new Set();

  /** Number of reconnection attempts made. */
  private reconnectAttempts = 0;

  /** Maximum reconnection attempts before giving up. */
  private maxReconnectAttempts = 10;

  /** Base delay for reconnection (doubled each attempt). */
  private reconnectDelay = 1000;

  /** Flag to prevent multiple simultaneous connection attempts. */
  private isConnecting = false;

  /**
   * Establishes a WebSocket connection to the server.
   * Uses the current page's protocol to determine ws:// or wss://.
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log('Connecting to WebSocket:', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.connectHandlers.forEach((handler) => handler());
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.messageHandlers.forEach((handler) => handler(message));
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnecting = false;
        this.disconnectHandlers.forEach((handler) => handler());
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.isConnecting = false;
      this.attemptReconnect();
    }
  }

  /**
   * Attempts to reconnect with exponential backoff.
   * Gives up after maxReconnectAttempts failures.
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Closes the WebSocket connection.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Sends a message to the server.
   *
   * @param message - Object to send (will be JSON stringified).
   */
  send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Registers a handler for incoming messages.
   *
   * @param handler - Function to call when a message is received.
   * @returns Cleanup function to unregister the handler.
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Registers a handler for connection events.
   *
   * @param handler - Function to call when connection is established.
   * @returns Cleanup function to unregister the handler.
   */
  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  /**
   * Registers a handler for disconnection events.
   *
   * @param handler - Function to call when connection is lost.
   * @returns Cleanup function to unregister the handler.
   */
  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  /**
   * Checks if the WebSocket is currently connected.
   *
   * @returns True if connected, false otherwise.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/** Singleton WebSocket service instance. */
export const wsService = new WebSocketService();
