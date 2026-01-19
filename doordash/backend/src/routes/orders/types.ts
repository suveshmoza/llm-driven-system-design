import { ETAResult } from '../../utils/geo.js';

/**
 * Tax rate applied to order subtotals.
 * @description 8.75% tax rate used for calculating order totals.
 */
export const TAX_RATE = 0.0875; // 8.75% tax

/**
 * Represents a valid order status transition.
 * @description Defines which statuses an order can transition to and who can perform the transition.
 */
export interface OrderTransition {
  /**
   * Array of valid next statuses the order can transition to.
   */
  next: string[];
  /**
   * The actor type authorized to perform this transition.
   * Can be 'restaurant', 'driver', 'system', or null for terminal states.
   */
  actor: string | null;
}

/**
 * State machine defining valid order status transitions.
 * @description Maps each order status to its allowed transitions and the actor who can perform them.
 *
 * Order flow:
 * - PLACED -> CONFIRMED/CANCELLED (restaurant)
 * - CONFIRMED -> PREPARING/CANCELLED (restaurant)
 * - PREPARING -> READY_FOR_PICKUP (restaurant)
 * - READY_FOR_PICKUP -> PICKED_UP (driver)
 * - PICKED_UP -> DELIVERED (driver)
 * - DELIVERED -> COMPLETED (system)
 * - COMPLETED/CANCELLED are terminal states
 */
export const ORDER_TRANSITIONS: Record<string, OrderTransition> = {
  PLACED: { next: ['CONFIRMED', 'CANCELLED'], actor: 'restaurant' },
  CONFIRMED: { next: ['PREPARING', 'CANCELLED'], actor: 'restaurant' },
  PREPARING: { next: ['READY_FOR_PICKUP'], actor: 'restaurant' },
  READY_FOR_PICKUP: { next: ['PICKED_UP'], actor: 'driver' },
  PICKED_UP: { next: ['DELIVERED'], actor: 'driver' },
  DELIVERED: { next: ['COMPLETED'], actor: 'system' },
  COMPLETED: { next: [], actor: null },
  CANCELLED: { next: [], actor: null },
};

/**
 * Represents a delivery address with geographic coordinates.
 * @description Contains latitude, longitude, and human-readable address for delivery location.
 */
export interface DeliveryAddress {
  /**
   * Latitude coordinate of the delivery location.
   */
  lat: number;
  /**
   * Longitude coordinate of the delivery location.
   */
  lon: number;
  /**
   * Human-readable street address for the delivery.
   */
  address: string;
}

/**
 * Represents an item within an order.
 * @description Contains menu item details, quantity, and any special instructions.
 */
export interface OrderItem {
  /**
   * Unique identifier of the menu item.
   */
  menuItemId: number;
  /**
   * Display name of the menu item.
   */
  name: string;
  /**
   * Price per unit of the item.
   */
  price: number;
  /**
   * Number of units ordered.
   */
  quantity: number;
  /**
   * Optional special preparation instructions from the customer.
   */
  specialInstructions?: string;
}

/**
 * Represents a complete order with all associated data.
 * @description Contains order details, pricing, delivery info, timestamps, and related entities.
 */
export interface Order {
  /**
   * Unique identifier for the order.
   */
  id: number;
  /**
   * ID of the customer who placed the order.
   */
  customer_id: number;
  /**
   * ID of the restaurant fulfilling the order.
   */
  restaurant_id: number;
  /**
   * ID of the assigned driver, if any.
   */
  driver_id?: number | null;
  /**
   * Current status of the order (e.g., PLACED, CONFIRMED, PREPARING).
   */
  status: string;
  /**
   * Sum of item prices before fees and taxes.
   */
  subtotal: number;
  /**
   * Delivery fee charged to the customer.
   */
  delivery_fee: number;
  /**
   * Tax amount applied to the order.
   */
  tax: number;
  /**
   * Tip amount for the driver.
   */
  tip: number;
  /**
   * Total amount charged (subtotal + delivery_fee + tax + tip).
   */
  total: number;
  /**
   * Delivery location information.
   */
  delivery_address: DeliveryAddress;
  /**
   * Optional delivery instructions from the customer.
   */
  delivery_instructions?: string;
  /**
   * Timestamp when the order was placed.
   */
  placed_at?: string;
  /**
   * Timestamp when the restaurant confirmed the order.
   */
  confirmed_at?: string;
  /**
   * Timestamp when preparation began.
   */
  preparing_at?: string;
  /**
   * Timestamp when the order was ready for pickup.
   */
  ready_at?: string;
  /**
   * Timestamp when the driver picked up the order.
   */
  picked_up_at?: string;
  /**
   * Timestamp when the order was delivered.
   */
  delivered_at?: string;
  /**
   * Timestamp when the order was cancelled, if applicable.
   */
  cancelled_at?: string;
  /**
   * Reason for cancellation, if applicable.
   */
  cancel_reason?: string;
  /**
   * Estimated delivery time.
   */
  estimated_delivery_at?: string;
  /**
   * Breakdown of ETA calculation components.
   */
  eta_breakdown?: ETAResult['breakdown'];
  /**
   * List of items in the order.
   */
  items?: OrderItem[];
  /**
   * Associated restaurant information.
   */
  restaurant?: {
    id: number;
    name: string;
    address: string;
    lat: number;
    lon: number;
    prep_time_minutes?: number;
    image_url?: string;
    owner_id?: number;
  };
  /**
   * Associated driver information, if assigned.
   */
  driver?: {
    id: number;
    user_id: number;
    name: string;
    phone?: string;
    current_lat?: number;
    current_lon?: number;
    rating?: number;
    vehicle_type?: string;
    total_deliveries?: number;
  };
}

/**
 * Represents a driver found within a geographic search radius.
 * @description Used when finding available drivers near a restaurant.
 */
export interface NearbyDriver {
  /**
   * Unique identifier of the driver.
   */
  id: number;
  /**
   * Distance from the search point in kilometers.
   */
  distance: number;
}

/**
 * Represents a driver with a calculated match score for an order.
 * @description Used during driver matching to rank candidates.
 */
export interface ScoredDriver {
  /**
   * Driver information.
   */
  driver: {
    id: number;
    name: string;
    rating?: number | string;
    total_deliveries: number;
    user_id: number;
    current_lat?: number;
    current_lon?: number;
  };
  /**
   * Calculated match score (higher is better).
   */
  score: number;
  /**
   * Distance from the restaurant in kilometers.
   */
  distance: number;
}

/**
 * Represents a menu item from a restaurant.
 * @description Contains basic menu item information for order creation.
 */
export interface MenuItem {
  /**
   * Unique identifier of the menu item.
   */
  id: number;
  /**
   * Display name of the menu item.
   */
  name: string;
  /**
   * Price of the item as a string (from database).
   */
  price: string;
  /**
   * Whether the item is currently available for ordering.
   */
  is_available: boolean;
}

/**
 * Represents an item in an order creation request.
 * @description Client-provided data for items to include in a new order.
 */
export interface RequestOrderItem {
  /**
   * ID of the menu item to order.
   */
  menuItemId: number;
  /**
   * Number of units to order (defaults to 1).
   */
  quantity?: number;
  /**
   * Optional special instructions for preparation.
   */
  specialInstructions?: string;
}
