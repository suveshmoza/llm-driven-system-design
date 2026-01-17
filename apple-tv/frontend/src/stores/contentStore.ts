import { create } from 'zustand';
import type { Content, ContinueWatching, WatchlistItem, RecommendationSection } from '../types';
import { contentApi, watchProgressApi, watchlistApi, recommendationsApi } from '../services/api';

/**
 * Content state interface for managing the streaming catalog.
 * Handles featured content, continue watching, watchlist, and personalized recommendations.
 */
interface ContentState {
  /** Featured content for hero banners and promotional displays */
  featured: Content[];
  /** Content with in-progress watch history for "Continue Watching" row */
  continueWatching: ContinueWatching[];
  /** User's saved content for later viewing */
  watchlist: WatchlistItem[];
  /** Personalized content sections (trending, genre-based, etc.) */
  recommendations: RecommendationSection[];
  /** Available content genres for filtering */
  genres: string[];
  /** Loading state for async content operations */
  isLoading: boolean;
  /** Error message from last failed operation */
  error: string | null;

  /** Loads featured content for hero display */
  fetchFeatured: () => Promise<void>;
  /** Loads content with in-progress viewing for current profile */
  fetchContinueWatching: () => Promise<void>;
  /** Loads user's saved watchlist items */
  fetchWatchlist: () => Promise<void>;
  /** Loads personalized recommendation sections */
  fetchRecommendations: () => Promise<void>;
  /** Loads available content genres */
  fetchGenres: () => Promise<void>;
  /** Adds content to user's watchlist */
  addToWatchlist: (contentId: string) => Promise<void>;
  /** Removes content from user's watchlist */
  removeFromWatchlist: (contentId: string) => Promise<void>;
  /** Updates watch progress for a content item */
  updateProgress: (contentId: string, position: number, duration: number) => Promise<void>;
  /** Clears the current error state */
  clearError: () => void;
}

/**
 * Content store using Zustand for managing streaming content state.
 * Centralizes content data fetching and caching for the application.
 *
 * The store manages multiple content categories:
 * - Featured: Hero banner and promotional content
 * - Continue Watching: Profile-specific in-progress content
 * - Watchlist: Saved content for later viewing
 * - Recommendations: Personalized content discovery sections
 */
export const useContentStore = create<ContentState>()((set, get) => ({
  featured: [],
  continueWatching: [],
  watchlist: [],
  recommendations: [],
  genres: [],
  isLoading: false,
  error: null,

  fetchFeatured: async () => {
    try {
      const featured = await contentApi.getFeatured();
      set({ featured });
    } catch (error) {
      console.error('Failed to fetch featured:', error);
    }
  },

  fetchContinueWatching: async () => {
    try {
      const continueWatching = await watchProgressApi.getContinueWatching();
      set({ continueWatching });
    } catch (error) {
      console.error('Failed to fetch continue watching:', error);
    }
  },

  fetchWatchlist: async () => {
    try {
      const watchlist = await watchlistApi.getAll();
      set({ watchlist });
    } catch (error) {
      console.error('Failed to fetch watchlist:', error);
    }
  },

  fetchRecommendations: async () => {
    set({ isLoading: true });
    try {
      const recommendations = await recommendationsApi.getAll();
      set({ recommendations, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
      set({ isLoading: false });
    }
  },

  fetchGenres: async () => {
    try {
      const genres = await contentApi.getGenres();
      set({ genres });
    } catch (error) {
      console.error('Failed to fetch genres:', error);
    }
  },

  addToWatchlist: async (contentId: string) => {
    try {
      await watchlistApi.add(contentId);
      await get().fetchWatchlist();
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  removeFromWatchlist: async (contentId: string) => {
    try {
      await watchlistApi.remove(contentId);
      set((state) => ({
        watchlist: state.watchlist.filter((item) => item.id !== contentId),
      }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  updateProgress: async (contentId: string, position: number, duration: number) => {
    try {
      await watchProgressApi.updateProgress(contentId, position, duration);
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  },

  clearError: () => set({ error: null }),
}));
