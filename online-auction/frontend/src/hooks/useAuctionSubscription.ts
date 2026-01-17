import { useEffect, useCallback } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import type { WebSocketMessage } from '../types';

/**
 * React hook for subscribing to real-time auction updates.
 *
 * This hook manages the WebSocket subscription lifecycle for a specific auction.
 * It automatically subscribes when mounted, unsubscribes on unmount, and filters
 * messages to only pass relevant ones to the callback.
 *
 * Essential for the auction detail page to receive live bid updates without
 * polling the server.
 *
 * @param auctionId - The auction to subscribe to for real-time updates
 * @param onMessage - Optional callback invoked when a message for this auction is received
 * @returns Object containing WebSocket connection status
 *
 * @example
 * ```tsx
 * const { isConnected } = useAuctionSubscription(auctionId, (message) => {
 *   if (message.type === 'new_bid') {
 *     setCurrentPrice(message.current_price);
 *   }
 * });
 * ```
 */
export function useAuctionSubscription(
  auctionId: string,
  onMessage?: (message: WebSocketMessage) => void
) {
  const { subscribe, unsubscribe, addMessageListener, isConnected } = useWebSocketStore();

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (message.auction_id === auctionId && onMessage) {
        onMessage(message);
      }
    },
    [auctionId, onMessage]
  );

  useEffect(() => {
    subscribe(auctionId);

    const removeListener = addMessageListener(handleMessage);

    return () => {
      unsubscribe(auctionId);
      removeListener();
    };
  }, [auctionId, subscribe, unsubscribe, addMessageListener, handleMessage]);

  return { isConnected };
}
