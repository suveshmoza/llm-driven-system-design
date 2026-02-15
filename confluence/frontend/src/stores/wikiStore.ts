import { create } from 'zustand';
import type { Space, Page, PageTreeNode } from '../types';
import * as api from '../services/api';

interface WikiState {
  spaces: Space[];
  currentSpace: Space | null;
  currentPage: Page | null;
  pageTree: PageTreeNode[];
  recentPages: Page[];
  loading: boolean;
  error: string | null;

  loadSpaces: () => Promise<void>;
  loadSpace: (key: string) => Promise<void>;
  loadPageTree: (spaceKey: string) => Promise<void>;
  loadPage: (spaceKey: string, slug: string) => Promise<void>;
  loadRecentPages: () => Promise<void>;
  setCurrentPage: (page: Page | null) => void;
  clearError: () => void;
}

/** Wiki state managing spaces, pages, page tree, and recent pages. */
export const useWikiStore = create<WikiState>((set) => ({
  spaces: [],
  currentSpace: null,
  currentPage: null,
  pageTree: [],
  recentPages: [],
  loading: false,
  error: null,

  loadSpaces: async () => {
    try {
      set({ loading: true, error: null });
      const { spaces } = await api.getSpaces();
      set({ spaces, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load spaces';
      set({ error: message, loading: false });
    }
  },

  loadSpace: async (key: string) => {
    try {
      set({ loading: true, error: null });
      const { space } = await api.getSpace(key);
      set({ currentSpace: space, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load space';
      set({ error: message, loading: false });
    }
  },

  loadPageTree: async (spaceKey: string) => {
    try {
      const { tree } = await api.getPageTree(spaceKey);
      set({ pageTree: tree });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load page tree';
      set({ error: message });
    }
  },

  loadPage: async (spaceKey: string, slug: string) => {
    try {
      set({ loading: true, error: null });
      const { page } = await api.getPageBySlug(spaceKey, slug);
      set({ currentPage: page, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load page';
      set({ error: message, loading: false });
    }
  },

  loadRecentPages: async () => {
    try {
      const { pages } = await api.getRecentPages();
      set({ recentPages: pages });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load recent pages';
      set({ error: message });
    }
  },

  setCurrentPage: (page) => set({ currentPage: page }),
  clearError: () => set({ error: null }),
}));
