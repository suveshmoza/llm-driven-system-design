/**
 * @fileoverview Authentication state store using Zustand.
 * Manages user session state with localStorage persistence.
 * Provides login, register, logout, and session validation methods.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { authApi } from '@/services/api';

/**
 * Authentication state interface.
 * Contains current user, token, and authentication status.
 */
interface AuthState {
  /** Currently logged in user or null if not authenticated */
  user: User | null;
  /** Session token for API authentication */
  token: string | null;
  /** Whether user is currently authenticated */
  isAuthenticated: boolean;
  /** Whether initial auth check is in progress */
  isLoading: boolean;
  /**
   * Logs in with email and password.
   * @param email - User's email address
   * @param password - User's password
   */
  login: (email: string, password: string) => Promise<void>;
  /**
   * Registers a new user account.
   * @param username - Unique username
   * @param email - Email address
   * @param password - Password
   * @param displayName - Display name shown in UI
   */
  register: (username: string, email: string, password: string, displayName: string) => Promise<void>;
  /** Logs out the current user and clears session. */
  logout: () => Promise<void>;
  /** Validates existing token on app startup. */
  checkAuth: () => Promise<void>;
  /**
   * Updates the user object in state.
   * @param user - Updated user data
   */
  setUser: (user: User) => void;
}

/**
 * Zustand store for authentication state.
 * Persists token to localStorage for session persistence across page reloads.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,

      login: async (email: string, password: string) => {
        const response = await authApi.login({ email, password });
        localStorage.setItem('token', response.token);
        set({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
        });
      },

      register: async (username: string, email: string, password: string, displayName: string) => {
        const response = await authApi.register({
          username,
          email,
          password,
          display_name: displayName,
        });
        localStorage.setItem('token', response.token);
        set({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
        });
      },

      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // Ignore errors on logout
        }
        localStorage.removeItem('token');
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      },

      checkAuth: async () => {
        const token = localStorage.getItem('token');
        if (!token) {
          set({ isLoading: false, isAuthenticated: false });
          return;
        }

        try {
          const user = await authApi.getMe();
          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch {
          localStorage.removeItem('token');
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },

      setUser: (user: User) => {
        set({ user });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
      }),
    }
  )
);
