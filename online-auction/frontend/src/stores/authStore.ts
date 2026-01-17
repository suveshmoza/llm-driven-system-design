import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { api } from '../services/api';

/**
 * Shape of the authentication state managed by Zustand.
 * Provides user session data and authentication actions.
 */
interface AuthState {
  /** Currently authenticated user or null if not logged in */
  user: User | null;
  /** JWT token for API authentication (stored in localStorage) */
  token: string | null;
  /** True while checking authentication status on app load */
  isLoading: boolean;
  /** True if user is currently authenticated */
  isAuthenticated: boolean;
  /** Authenticates user with email and password */
  login: (email: string, password: string) => Promise<void>;
  /** Creates new user account and logs in */
  register: (username: string, email: string, password: string) => Promise<void>;
  /** Logs out current user and clears session */
  logout: () => Promise<void>;
  /** Validates current session on app startup */
  checkAuth: () => Promise<void>;
}

/**
 * Global authentication store using Zustand.
 *
 * This store manages user authentication state across the application.
 * It persists the JWT token to localStorage to maintain sessions across
 * browser refreshes, while keeping user data in memory.
 *
 * The store handles:
 * - User login/logout flows
 * - Session validation on app startup
 * - Token persistence for session continuity
 *
 * @example
 * ```tsx
 * const { user, isAuthenticated, login } = useAuthStore();
 *
 * if (!isAuthenticated) {
 *   await login('user@example.com', 'password');
 * }
 * ```
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: true,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        const { user, token } = await api.login(email, password);
        set({ user, token, isAuthenticated: true });
      },

      register: async (username: string, email: string, password: string) => {
        const { user, token } = await api.register(username, email, password);
        set({ user, token, isAuthenticated: true });
      },

      logout: async () => {
        try {
          await api.logout();
        } catch {
          // Ignore logout errors
        }
        set({ user: null, token: null, isAuthenticated: false });
      },

      checkAuth: async () => {
        try {
          const { user } = await api.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
        } catch {
          set({ user: null, token: null, isAuthenticated: false, isLoading: false });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
);
