import { useEffect, useRef } from 'react';
import { wsClient } from '../services/websocket';
import { useMarketStore } from '../stores/marketStore';
import type { PriceData } from '../types';

export function useWebSocket(): void {
  const updatePairPrices = useMarketStore((s) => s.updatePairPrices);
  const connected = useRef(false);

  useEffect(() => {
    if (connected.current) return;
    connected.current = true;

    wsClient.connect();

    const unsubscribe = wsClient.onPriceUpdate((prices: Record<string, PriceData>) => {
      updatePairPrices(prices);
    });

    return () => {
      unsubscribe();
      // Don't disconnect on cleanup - keep connection alive
    };
  }, [updatePairPrices]);
}

export function useTickerSubscription(symbol: string): void {
  useEffect(() => {
    if (!symbol) return;

    wsClient.subscribe([`ticker:${symbol}`]);

    return () => {
      wsClient.unsubscribe([`ticker:${symbol}`]);
    };
  }, [symbol]);
}
