import { create } from 'zustand';
import type { SearchParams } from '@/types';

/**
 * Shape of the search state and actions.
 * Manages hotel search parameters across the application.
 */
interface SearchState {
  /** Current search parameters */
  params: SearchParams;
  /** Updates search parameters with partial values */
  setParams: (params: Partial<SearchParams>) => void;
  /** Resets search parameters to default values */
  resetParams: () => void;
}

/**
 * Default search parameters for initial state and reset.
 * Sets sensible defaults for a typical hotel search.
 */
const defaultParams: SearchParams = {
  city: '',
  checkIn: '',
  checkOut: '',
  guests: 2,
  rooms: 1,
  sortBy: 'relevance',
  page: 1,
  limit: 20,
};

/**
 * Search state store using Zustand.
 * Maintains search parameters across navigation and page refreshes.
 * Used by the SearchBar component to persist user's search criteria
 * and by the search results page to filter hotels.
 */
export const useSearchStore = create<SearchState>()((set) => ({
  params: defaultParams,

  /**
   * Merges new search parameters with existing ones.
   * Partial updates allow individual fields to be changed without losing others.
   * @param newParams - Partial search parameters to merge
   */
  setParams: (newParams) => {
    set((state) => ({
      params: { ...state.params, ...newParams },
    }));
  },

  /**
   * Resets all search parameters to their default values.
   * Useful for clearing filters or starting a new search.
   */
  resetParams: () => {
    set({ params: defaultParams });
  },
}));
