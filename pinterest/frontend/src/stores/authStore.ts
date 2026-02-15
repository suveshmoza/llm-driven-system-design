import { create } from 'zustand';
import type { User } from '../types';
import * as api from '../services/api';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (data: { username: string; email: string; password: string; displayName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  checkAuth: async () => {
    try {
      const { user } = await api.getMe();
      set({ user, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },

  login: async (username: string, password: string) => {
    set({ error: null, isLoading: true });
    try {
      const { user } = await api.login({ username, password });
      set({ user, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      throw err;
    }
  },

  register: async (data) => {
    set({ error: null, isLoading: true });
    try {
      const { user } = await api.register(data);
      set({ user, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null });
    }
  },

  clearError: () => set({ error: null }),
}));
