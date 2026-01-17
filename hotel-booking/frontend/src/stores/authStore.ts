import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { api } from '@/services/api';

/**
 * Shape of the authentication state and actions.
 * Manages user session, token storage, and auth-related operations.
 */
interface AuthState {
  /** Currently authenticated user, or null if not logged in */
  user: User | null;
  /** JWT token for API authentication */
  token: string | null;
  /** Whether the user is currently authenticated */
  isAuthenticated: boolean;
  /** Whether auth state is being restored from storage */
  isLoading: boolean;
  /** Authenticates user with email/password credentials */
  login: (email: string, password: string) => Promise<void>;
  /** Creates a new user account and logs them in */
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role?: string;
  }) => Promise<void>;
  /** Logs out the current user and clears session */
  logout: () => Promise<void>;
  /** Manually sets the user (used for testing or admin operations) */
  setUser: (user: User | null) => void;
  /** Validates stored token and restores session on app startup */
  checkAuth: () => Promise<void>;
}

/**
 * Authentication store using Zustand with persistence.
 * Persists the JWT token to localStorage and restores auth state on page refresh.
 * Integrates with the API service to keep auth tokens synchronized.
 *
 * The store uses the persist middleware to save only the token, which is then
 * validated via `checkAuth()` on app initialization to restore the full user session.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,

      /**
       * Logs in a user with email and password.
       * On success, stores the token and user data in state and API service.
       * @param email - User's email address
       * @param password - User's password
       */
      login: async (email: string, password: string) => {
        const response = await api.login(email, password);
        api.setToken(response.token);
        set({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
        });
      },

      /**
       * Registers a new user account.
       * Automatically logs in the user after successful registration.
       * @param data - Registration data including email, password, name, and optional role
       */
      register: async (data) => {
        const response = await api.register(data);
        api.setToken(response.token);
        set({
          user: response.user,
          token: response.token,
          isAuthenticated: true,
        });
      },

      /**
       * Logs out the current user.
       * Clears local state and API token regardless of server response.
       */
      logout: async () => {
        try {
          await api.logout();
        } catch {
          // Ignore logout errors
        }
        api.setToken(null);
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      },

      /**
       * Manually updates the user in state.
       * Useful for profile updates or admin impersonation.
       * @param user - User object or null to clear
       */
      setUser: (user) => {
        set({ user, isAuthenticated: !!user });
      },

      /**
       * Validates the stored token and restores the user session.
       * Called on app initialization to check if stored token is still valid.
       * If valid, fetches fresh user data; if invalid, clears auth state.
       */
      checkAuth: async () => {
        const { token } = get();
        if (!token) {
          set({ isLoading: false });
          return;
        }

        api.setToken(token);
        try {
          const response = await api.getMe();
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch {
          api.setToken(null);
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },
    }),
    {
      /** Storage key for persisted auth data */
      name: 'auth-storage',
      /** Only persist the token; user data is fetched fresh via checkAuth */
      partialize: (state) => ({ token: state.token }),
    }
  )
);
