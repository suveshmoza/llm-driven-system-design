/**
 * Authentication Store
 *
 * Manages user authentication state using Zustand.
 * Handles login, registration, logout, and session validation.
 * Persists authentication across page refreshes via session cookies.
 */

import { create } from 'zustand';
import { User } from '../types';
import { authApi } from '../services/api';

/**
 * Authentication state interface.
 * Tracks current user, loading state, and error messages.
 */
interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

/**
 * Zustand store for authentication state management.
 * Provides reactive state updates for login/logout flows.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  login: async (username: string, password: string) => {
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

  register: async (username: string, displayName: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await authApi.register(username, displayName, password);
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
    } catch {
      // Ignore errors - clear local state anyway
    }
    set({ user: null, isLoading: false });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const { user } = await authApi.me();
      set({ user, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
