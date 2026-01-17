/**
 * User account information.
 * Represents an authenticated user in the system with role-based access.
 */
export interface User {
  /** Unique user identifier */
  id: number;
  /** User's email address (used for login) */
  email: string;
  /** User's display name */
  name: string;
  /** Optional phone number for contact/notifications */
  phone?: string;
  /** User role determining access and UI experience */
  role: 'customer' | 'restaurant_owner' | 'driver' | 'admin';
  /** Account creation timestamp */
  created_at: string;
  /** Associated driver profile if user is also a driver */
  driverProfile?: Driver;
}

/**
 * Restaurant entity.
 * Represents a restaurant available for ordering on the platform.
 */
export interface Restaurant {
  /** Unique restaurant identifier */
  id: number;
  /** ID of the restaurant owner (user) */
  owner_id?: number;
  /** Restaurant name */
  name: string;
  /** Optional description of the restaurant */
  description?: string;
  /** Physical address of the restaurant */
  address: string;
  /** Restaurant latitude for geolocation */
  lat: number;
  /** Restaurant longitude for geolocation */
  lon: number;
  /** Type of cuisine (e.g., 'Italian', 'Mexican') */
  cuisine_type?: string;
  /** Average rating (1-5 scale) */
  rating: number;
  /** Number of ratings received */
  rating_count: number;
  /** Average food preparation time in minutes */
  prep_time_minutes: number;
  /** Whether the restaurant is currently accepting orders */
  is_open: boolean;
  /** URL to restaurant image/logo */
  image_url?: string;
  /** Delivery fee charged per order */
  delivery_fee: number;
  /** Minimum order amount required */
  min_order: number;
  /** Distance from user's location (calculated at query time) */
  distance?: number;
}

/**
 * Menu item available for ordering.
 * Represents a single food item on a restaurant's menu.
 */
export interface MenuItem {
  /** Unique item identifier */
  id: number;
  /** ID of the restaurant this item belongs to */
  restaurant_id: number;
  /** Item name */
  name: string;
  /** Optional item description */
  description?: string;
  /** Price in dollars */
  price: number;
  /** Menu category (e.g., 'Appetizers', 'Main Course') */
  category?: string;
  /** URL to item image */
  image_url?: string;
  /** Whether item is currently available for ordering */
  is_available: boolean;
}

/**
 * Menu items organized by category.
 * Used for displaying restaurant menus in a grouped format.
 */
export type MenuByCategory = Record<string, MenuItem[]>;

/**
 * Driver profile information.
 * Represents a delivery driver on the platform.
 */
export interface Driver {
  /** Unique driver identifier */
  id: number;
  /** Associated user account ID */
  user_id: number;
  /** Driver's display name */
  name: string;
  /** Phone number for customer contact */
  phone?: string;
  /** Type of vehicle used for deliveries */
  vehicle_type: 'car' | 'bike' | 'scooter' | 'walk';
  /** Vehicle license plate (required for car/scooter) */
  license_plate?: string;
  /** Whether driver is online and accepting orders */
  is_active: boolean;
  /** Whether driver is available (not on an active delivery) */
  is_available: boolean;
  /** Current latitude for location tracking */
  current_lat?: number;
  /** Current longitude for location tracking */
  current_lon?: number;
  /** Average driver rating (1-5 scale) */
  rating: number;
  /** Number of ratings received */
  rating_count: number;
  /** Total completed deliveries */
  total_deliveries: number;
}

/**
 * Order status enumeration.
 * Represents the state machine states for an order's lifecycle.
 */
export type OrderStatus =
  | 'PLACED'           // Order submitted by customer
  | 'CONFIRMED'        // Restaurant accepted the order
  | 'PREPARING'        // Restaurant is preparing food
  | 'READY_FOR_PICKUP' // Food ready, waiting for driver
  | 'PICKED_UP'        // Driver picked up the order
  | 'DELIVERED'        // Order delivered to customer
  | 'COMPLETED'        // Order fully completed (rated, finalized)
  | 'CANCELLED';       // Order was cancelled

/**
 * Delivery address information.
 * Contains location details for order delivery.
 */
export interface DeliveryAddress {
  /** Street address */
  address: string;
  /** Delivery location latitude */
  lat: number;
  /** Delivery location longitude */
  lon: number;
  /** Apartment/unit number */
  apt?: string;
  /** Delivery instructions (e.g., 'Leave at door') */
  instructions?: string;
}

/**
 * Order item representing a menu item in an order.
 * Contains quantity and price at time of order.
 */
export interface OrderItem {
  /** Unique order item identifier */
  id: number;
  /** Parent order ID */
  order_id: number;
  /** Referenced menu item ID */
  menu_item_id: number;
  /** Item name (denormalized for display) */
  name: string;
  /** Price per unit at time of order */
  price: number;
  /** Quantity ordered */
  quantity: number;
  /** Special preparation instructions */
  special_instructions?: string;
}

/**
 * Order entity.
 * Represents a complete food delivery order with all associated data.
 */
export interface Order {
  /** Unique order identifier */
  id: number;
  /** Customer who placed the order */
  customer_id: number;
  /** Restaurant fulfilling the order */
  restaurant_id: number;
  /** Assigned driver (if any) */
  driver_id?: number;
  /** Current order status */
  status: OrderStatus;
  /** Subtotal before fees and tax */
  subtotal: number;
  /** Delivery fee charged */
  delivery_fee: number;
  /** Tax amount */
  tax: number;
  /** Driver tip amount */
  tip: number;
  /** Total order amount */
  total: number;
  /** Delivery destination */
  delivery_address: DeliveryAddress;
  /** Additional delivery instructions */
  delivery_instructions?: string;
  /** Estimated delivery time */
  estimated_delivery_at?: string;
  /** Timestamp when order was placed */
  placed_at: string;
  /** Timestamp when restaurant confirmed */
  confirmed_at?: string;
  /** Timestamp when preparation started */
  preparing_at?: string;
  /** Timestamp when food was ready */
  ready_at?: string;
  /** Timestamp when driver picked up */
  picked_up_at?: string;
  /** Timestamp when delivered */
  delivered_at?: string;
  /** Timestamp when cancelled */
  cancelled_at?: string;
  /** Reason for cancellation */
  cancel_reason?: string;
  /** Items in the order */
  items: OrderItem[];
  /** Restaurant details (expanded) */
  restaurant?: Restaurant;
  /** Restaurant name (denormalized) */
  restaurant_name?: string;
  /** Restaurant address (denormalized) */
  restaurant_address?: string;
  /** Restaurant image URL (denormalized) */
  restaurant_image?: string;
  /** Assigned driver details (expanded) */
  driver?: Driver;
  /** ETA calculation breakdown */
  eta_breakdown?: ETABreakdown;
}

/**
 * ETA calculation breakdown.
 * Provides detailed time estimates for each phase of delivery.
 */
export interface ETABreakdown {
  /** Time for driver to reach restaurant (minutes) */
  toRestaurantMinutes: number;
  /** Food preparation time (minutes) */
  prepTimeMinutes: number;
  /** Time from restaurant to customer (minutes) */
  deliveryMinutes: number;
  /** Buffer time for pickup/dropoff (minutes) */
  bufferMinutes: number;
  /** Total estimated delivery time (minutes) */
  totalMinutes: number;
}

/**
 * Shopping cart item.
 * Represents a menu item added to the customer's cart.
 */
export interface CartItem {
  /** The menu item added to cart */
  menuItem: MenuItem;
  /** Quantity of this item */
  quantity: number;
  /** Special instructions for this item */
  specialInstructions?: string;
}

/**
 * WebSocket message format.
 * Used for real-time communication between client and server.
 */
export interface WSMessage {
  /** Message type identifier (e.g., 'order_status_update') */
  type: string;
  /** Additional message payload (varies by type) */
  [key: string]: unknown;
}
