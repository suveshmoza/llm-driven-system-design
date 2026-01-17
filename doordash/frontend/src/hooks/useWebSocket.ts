import { useEffect, useRef, useCallback } from 'react';
import type { WSMessage } from '../types';

/**
 * Callback type for handling incoming WebSocket messages.
 */
type MessageHandler = (message: WSMessage) => void;

/**
 * React hook for managing WebSocket connections with automatic reconnection.
 * Provides real-time updates for order status, driver location, and other events.
 *
 * This hook establishes a WebSocket connection to the server, subscribes to
 * specified channels, and automatically handles reconnection on disconnect.
 * It's used throughout the app for real-time features like order tracking.
 *
 * @param channels - Array of channel names to subscribe to (e.g., 'order:123', 'driver:456:orders')
 * @param onMessage - Callback function invoked when a message is received
 * @returns Object with a send function for sending messages to the server
 *
 * @example
 * ```tsx
 * const { send } = useWebSocket(['order:123'], (message) => {
 *   if (message.type === 'order_status_update') {
 *     updateOrder(message.order);
 *   }
 * });
 * ```
 */
export function useWebSocket(channels: string[], onMessage: MessageHandler) {
  /** Reference to the WebSocket instance */
  const wsRef = useRef<WebSocket | null>(null);
  /** Reference to the current message handler (kept up-to-date for closures) */
  const handlersRef = useRef<MessageHandler>(onMessage);

  // Keep handler ref up to date
  handlersRef.current = onMessage;

  /**
   * Establishes a WebSocket connection and sets up event handlers.
   * Automatically subscribes to the specified channels on connect
   * and attempts to reconnect after disconnection.
   */
  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Subscribe to channels
      for (const channel of channels) {
        ws.send(JSON.stringify({ type: 'subscribe', channel }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSMessage;
        handlersRef.current(message);
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      // Reconnect after delay
      setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    wsRef.current = ws;
  }, [channels]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  /**
   * Sends a message through the WebSocket connection.
   * Only sends if the connection is open.
   * @param message - Object to send (will be JSON serialized)
   */
  const send = useCallback((message: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { send };
}
