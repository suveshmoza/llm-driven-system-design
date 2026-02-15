import { create } from 'zustand';
import type { Pin } from '../types';
import * as api from '../services/api';

interface PinState {
  feedPins: Pin[];
  feedCursor: string | null;
  feedLoading: boolean;
  feedError: string | null;
  loadFeed: (reset?: boolean) => Promise<void>;
  loadDiscoverFeed: (reset?: boolean) => Promise<void>;
  clearFeed: () => void;
}

/** Pin feed state with cursor-based pagination for personalized and discover feeds. */
export const usePinStore = create<PinState>((set, get) => ({
  feedPins: [],
  feedCursor: null,
  feedLoading: false,
  feedError: null,

  loadFeed: async (reset = false) => {
    const state = get();
    if (state.feedLoading) return;
    if (!reset && !state.feedCursor && state.feedPins.length > 0) return;

    set({ feedLoading: true, feedError: null });

    try {
      const cursor = reset ? undefined : (state.feedCursor ?? undefined);
      const { pins, nextCursor } = await api.getFeed(cursor);

      set((s) => ({
        feedPins: reset ? pins : [...s.feedPins, ...pins],
        feedCursor: nextCursor,
        feedLoading: false,
      }));
    } catch (err) {
      set({ feedError: (err as Error).message, feedLoading: false });
    }
  },

  loadDiscoverFeed: async (reset = false) => {
    const state = get();
    if (state.feedLoading) return;
    if (!reset && !state.feedCursor && state.feedPins.length > 0) return;

    set({ feedLoading: true, feedError: null });

    try {
      const cursor = reset ? undefined : (state.feedCursor ?? undefined);
      const { pins, nextCursor } = await api.getDiscoverFeed(cursor);

      set((s) => ({
        feedPins: reset ? pins : [...s.feedPins, ...pins],
        feedCursor: nextCursor,
        feedLoading: false,
      }));
    } catch (err) {
      set({ feedError: (err as Error).message, feedLoading: false });
    }
  },

  clearFeed: () => set({ feedPins: [], feedCursor: null, feedError: null }),
}));
