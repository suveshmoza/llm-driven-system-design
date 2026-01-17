import { create } from 'zustand';
import type { WebSocketMessage } from '../types';

/**
 * Shape of the WebSocket state managed by Zustand.
 * Handles real-time bidding updates via WebSocket connection.
 */
interface WebSocketState {
  /** Active WebSocket connection or null if disconnected */
  socket: WebSocket | null;
  /** True if WebSocket is currently connected */
  isConnected: boolean;
  /** Set of auction IDs currently subscribed to for real-time updates */
  subscribedAuctions: Set<string>;
  /** Most recently received WebSocket message */
  lastMessage: WebSocketMessage | null;
  /** Establishes WebSocket connection with optional auth token */
  connect: (token?: string) => void;
  /** Closes WebSocket connection */
  disconnect: () => void;
  /** Subscribes to real-time updates for an auction */
  subscribe: (auctionId: string) => void;
  /** Unsubscribes from real-time updates for an auction */
  unsubscribe: (auctionId: string) => void;
  /** Registers a callback for incoming messages, returns cleanup function */
  addMessageListener: (callback: (message: WebSocketMessage) => void) => () => void;
}

/**
 * Set of callback functions that receive WebSocket messages.
 * External to the store to avoid serialization issues.
 */
const messageListeners = new Set<(message: WebSocketMessage) => void>();

/**
 * Global WebSocket store for real-time auction updates.
 *
 * This store manages a single WebSocket connection to the server,
 * enabling real-time notifications for:
 * - New bids on subscribed auctions
 * - Auction end events
 * - Price updates
 *
 * The connection automatically reconnects on disconnect with a 3-second delay.
 * Subscriptions are preserved across reconnections.
 *
 * @example
 * ```tsx
 * const { connect, subscribe, addMessageListener } = useWebSocketStore();
 *
 * // Connect on app mount
 * connect(token);
 *
 * // Subscribe to auction updates
 * subscribe(auctionId);
 *
 * // Listen for messages
 * const removeListener = addMessageListener((msg) => {
 *   if (msg.type === 'new_bid') {
 *     console.log('New bid:', msg.bid_amount);
 *   }
 * });
 * ```
 */
export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  subscribedAuctions: new Set(),
  lastMessage: null,

  connect: (token?: string) => {
    const { socket: existingSocket } = get();
    if (existingSocket?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws${token ? `?token=${token}` : ''}`;

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('WebSocket connected');
      set({ isConnected: true });

      // Resubscribe to auctions
      const { subscribedAuctions } = get();
      subscribedAuctions.forEach((auctionId) => {
        socket.send(JSON.stringify({ type: 'subscribe', auction_id: auctionId }));
      });
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        set({ lastMessage: message });

        // Notify all listeners
        messageListeners.forEach((listener) => listener(message));
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      set({ isConnected: false, socket: null });

      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        const { socket: currentSocket } = get();
        if (!currentSocket) {
          get().connect(token);
        }
      }, 3000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.close();
      set({ socket: null, isConnected: false });
    }
  },

  subscribe: (auctionId: string) => {
    const { socket, subscribedAuctions, isConnected } = get();

    subscribedAuctions.add(auctionId);
    set({ subscribedAuctions: new Set(subscribedAuctions) });

    if (socket && isConnected) {
      socket.send(JSON.stringify({ type: 'subscribe', auction_id: auctionId }));
    }
  },

  unsubscribe: (auctionId: string) => {
    const { socket, subscribedAuctions, isConnected } = get();

    subscribedAuctions.delete(auctionId);
    set({ subscribedAuctions: new Set(subscribedAuctions) });

    if (socket && isConnected) {
      socket.send(JSON.stringify({ type: 'unsubscribe', auction_id: auctionId }));
    }
  },

  addMessageListener: (callback: (message: WebSocketMessage) => void) => {
    messageListeners.add(callback);
    return () => messageListeners.delete(callback);
  },
}));
