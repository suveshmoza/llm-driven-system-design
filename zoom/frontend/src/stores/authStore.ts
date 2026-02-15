import { create } from 'zustand';
import type { User } from '../types';
import * as api from '../services/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

/** Authentication state with login, register, logout, and session validation. */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const { user } = await api.login(username, password);
      set({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          createdAt: '',
        },
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  register: async (username, email, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const { user } = await api.register(username, email, password, displayName);
      set({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          createdAt: '',
        },
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null, loading: false, error: null });
    }
  },

  checkAuth: async () => {
    set({ loading: true });
    try {
      const { user } = await api.getMe();
      set({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          createdAt: '',
        },
        loading: false,
      });
    } catch {
      set({ user: null, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
