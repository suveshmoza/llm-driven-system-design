import { create } from 'zustand';
import { marketsApi } from '../services/api';
import type { TradingPair, Candle, PriceData } from '../types';

/** Real-time market data state with WebSocket price streaming and order book updates. */
interface OrderBookData {
  bids: { price: number; quantity: number; orderCount: number }[];
  asks: { price: number; quantity: number; orderCount: number }[];
  spread: number | null;
  bestBid: number | null;
  bestAsk: number | null;
}

interface MarketState {
  pairs: TradingPair[];
  prices: Record<string, PriceData>;
  candles: Candle[];
  orderBook: OrderBookData | null;
  isLoading: boolean;
  error: string | null;
  selectedSymbol: string | null;

  fetchPairs: () => Promise<void>;
  fetchCandles: (symbol: string, interval?: string) => Promise<void>;
  fetchOrderBook: (symbol: string) => Promise<void>;
  setSelectedSymbol: (symbol: string) => void;
  updatePrices: (prices: Record<string, PriceData>) => void;
  updatePairPrices: (priceMap: Record<string, PriceData>) => void;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  pairs: [],
  prices: {},
  candles: [],
  orderBook: null,
  isLoading: false,
  error: null,
  selectedSymbol: null,

  fetchPairs: async () => {
    set({ isLoading: true });
    try {
      const { pairs } = await marketsApi.getPairs();
      set({ pairs, isLoading: false });

      // Populate initial prices
      const prices: Record<string, PriceData> = {};
      for (const pair of pairs) {
        prices[pair.symbol] = {
          price: pair.price,
          change24h: pair.change24h,
          changePercent24h: pair.changePercent24h,
          volume24h: pair.volume24h,
          high24h: pair.high24h,
          low24h: pair.low24h,
        };
      }
      set({ prices });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch pairs',
        isLoading: false,
      });
    }
  },

  fetchCandles: async (symbol, interval = '1m') => {
    try {
      const { candles } = await marketsApi.getCandles(symbol, interval, 200);
      set({ candles });
    } catch (error) {
      console.error('Failed to fetch candles:', error);
    }
  },

  fetchOrderBook: async (symbol) => {
    try {
      const data = await marketsApi.getOrderBook(symbol, 15);
      set({ orderBook: data });
    } catch (error) {
      console.error('Failed to fetch order book:', error);
    }
  },

  setSelectedSymbol: (symbol) => {
    set({ selectedSymbol: symbol, candles: [], orderBook: null });
  },

  updatePrices: (prices) => {
    set({ prices: { ...get().prices, ...prices } });
  },

  updatePairPrices: (priceMap) => {
    const { pairs, prices } = get();
    const updatedPrices = { ...prices };
    const updatedPairs = pairs.map((pair) => {
      const update = priceMap[pair.symbol];
      if (update) {
        updatedPrices[pair.symbol] = update;
        return {
          ...pair,
          price: update.price,
          change24h: update.change24h,
          changePercent24h: update.changePercent24h,
          volume24h: update.volume24h,
          high24h: update.high24h,
          low24h: update.low24h,
        };
      }
      return pair;
    });
    set({ pairs: updatedPairs, prices: updatedPrices });
  },
}));
