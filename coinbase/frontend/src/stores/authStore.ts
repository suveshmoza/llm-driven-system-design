import { create } from 'zustand';
import { authApi } from '../services/api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await authApi.login(username, password);
      set({ user, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  register: async (username, email, password, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await authApi.register(username, email, password, displayName);
      set({ user, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Registration failed',
        isLoading: false,
      });
      throw error;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch (_e) {
      // Ignore
    }
    set({ user: null, isLoading: false });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const { user } = await authApi.getMe();
      set({ user, isLoading: false });
    } catch (_e) {
      set({ user: null, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
