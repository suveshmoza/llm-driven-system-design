import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem, MenuItem, Restaurant, DeliveryAddress } from '../types';

/**
 * Shopping cart state interface.
 * Defines the shape of the cart store including cart items,
 * delivery information, and available actions.
 */
interface CartState {
  /** Currently selected restaurant (cart is tied to one restaurant) */
  restaurant: Restaurant | null;
  /** Items in the cart with quantities and special instructions */
  items: CartItem[];
  /** Customer's delivery address */
  deliveryAddress: DeliveryAddress | null;
  /** Tip amount for the driver */
  tip: number;

  /**
   * Sets the current restaurant. Clears cart if switching restaurants.
   * @param restaurant - Restaurant to set as current
   */
  setRestaurant: (restaurant: Restaurant) => void;
  /**
   * Adds a menu item to the cart or increases quantity if already present.
   * @param menuItem - Item to add
   * @param quantity - Number to add (default: 1)
   * @param specialInstructions - Optional preparation instructions
   */
  addItem: (menuItem: MenuItem, quantity?: number, specialInstructions?: string) => void;
  /**
   * Removes an item from the cart entirely.
   * @param menuItemId - ID of item to remove
   */
  removeItem: (menuItemId: number) => void;
  /**
   * Updates the quantity of an item. Removes if quantity <= 0.
   * @param menuItemId - ID of item to update
   * @param quantity - New quantity
   */
  updateQuantity: (menuItemId: number, quantity: number) => void;
  /**
   * Sets the delivery address for the order.
   * @param address - Delivery address details
   */
  setDeliveryAddress: (address: DeliveryAddress) => void;
  /**
   * Sets the driver tip amount.
   * @param tip - Tip amount in dollars
   */
  setTip: (tip: number) => void;
  /** Clears the entire cart and resets to initial state */
  clearCart: () => void;

  /**
   * Calculates the subtotal of all items in the cart.
   * @returns Total price before fees and tip
   */
  subtotal: () => number;
  /**
   * Calculates the total number of items in the cart.
   * @returns Sum of all item quantities
   */
  itemCount: () => number;
}

/**
 * Global shopping cart store using Zustand.
 * Manages cart state with persistence to localStorage, allowing
 * customers to maintain their cart across page refreshes.
 *
 * The cart is tied to a single restaurant - switching restaurants
 * clears the cart to prevent mixed orders.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      restaurant: null,
      items: [],
      deliveryAddress: null,
      tip: 0,

      setRestaurant: (restaurant) => {
        const current = get().restaurant;
        // Clear cart if switching restaurants
        if (current && current.id !== restaurant.id) {
          set({ restaurant, items: [], tip: 0 });
        } else {
          set({ restaurant });
        }
      },

      addItem: (menuItem, quantity = 1, specialInstructions) => {
        const items = get().items;
        const existingIndex = items.findIndex((i) => i.menuItem.id === menuItem.id);

        if (existingIndex >= 0) {
          const newItems = [...items];
          newItems[existingIndex] = {
            ...newItems[existingIndex],
            quantity: newItems[existingIndex].quantity + quantity,
            specialInstructions: specialInstructions || newItems[existingIndex].specialInstructions,
          };
          set({ items: newItems });
        } else {
          set({
            items: [...items, { menuItem, quantity, specialInstructions }],
          });
        }
      },

      removeItem: (menuItemId) => {
        set({ items: get().items.filter((i) => i.menuItem.id !== menuItemId) });
      },

      updateQuantity: (menuItemId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(menuItemId);
          return;
        }
        const items = get().items.map((i) =>
          i.menuItem.id === menuItemId ? { ...i, quantity } : i
        );
        set({ items });
      },

      setDeliveryAddress: (address) => set({ deliveryAddress: address }),

      setTip: (tip) => set({ tip }),

      clearCart: () =>
        set({
          restaurant: null,
          items: [],
          deliveryAddress: null,
          tip: 0,
        }),

      subtotal: () => {
        return get().items.reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0);
      },

      itemCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: 'cart-storage',
    }
  )
);
