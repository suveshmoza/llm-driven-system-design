import { create } from 'zustand';
import type { User } from '../types';
import * as api from '../services/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

/** Authentication state with session check, login, register, and logout actions. */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  checkAuth: async () => {
    try {
      const { user } = await api.getMe();
      set({ user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  login: async (username: string, password: string) => {
    try {
      set({ error: null });
      const { user } = await api.login(username, password);
      set({ user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      set({ error: message });
      throw err;
    }
  },

  register: async (username: string, email: string, password: string) => {
    try {
      set({ error: null });
      const { user } = await api.register(username, email, password);
      set({ user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      set({ error: message });
      throw err;
    }
  },

  logout: async () => {
    try {
      await api.logout();
      set({ user: null });
    } catch {
      set({ user: null });
    }
  },

  clearError: () => set({ error: null }),
}));
