/**
 * Merchant Store
 *
 * Zustand store for managing merchant authentication state.
 * Persists credentials to localStorage to maintain sessions across page reloads.
 * This is the central source of truth for the authenticated merchant's identity.
 *
 * @module stores/merchantStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Shape of the merchant authentication state.
 */
interface MerchantState {
  /** The merchant's API key for authenticating requests (null when not logged in) */
  apiKey: string | null;
  /** The merchant's unique identifier (null when not logged in) */
  merchantId: string | null;
  /** The merchant's display name (null when not logged in) */
  merchantName: string | null;
  /**
   * Sets the merchant credentials after successful authentication.
   * @param apiKey - The merchant's API key
   * @param merchantId - The merchant's unique ID
   * @param merchantName - The merchant's business name
   */
  setCredentials: (apiKey: string, merchantId: string, merchantName: string) => void;
  /**
   * Clears all credentials and logs out the merchant.
   * Removes persisted data from localStorage.
   */
  clearCredentials: () => void;
}

/**
 * Zustand store hook for accessing and managing merchant authentication.
 *
 * Uses the persist middleware to automatically save credentials to localStorage
 * under the key 'stripe-merchant-storage'. This enables the dashboard to
 * maintain the user's session across browser refreshes.
 *
 * @example
 * ```tsx
 * // In a component
 * const { apiKey, merchantName, clearCredentials } = useMerchantStore();
 *
 * // Check if authenticated
 * if (!apiKey) {
 *   return <LoginForm />;
 * }
 *
 * // Access state outside of React components
 * const apiKey = useMerchantStore.getState().apiKey;
 * ```
 */
export const useMerchantStore = create<MerchantState>()(
  persist(
    (set) => ({
      apiKey: null,
      merchantId: null,
      merchantName: null,

      setCredentials: (apiKey, merchantId, merchantName) =>
        set({ apiKey, merchantId, merchantName }),

      clearCredentials: () =>
        set({ apiKey: null, merchantId: null, merchantName: null }),
    }),
    {
      name: 'stripe-merchant-storage',
    }
  )
);
