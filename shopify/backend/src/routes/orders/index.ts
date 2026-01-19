/**
 * Orders module - barrel export for order-related handlers and types.
 *
 * @description This module provides all order management functionality including:
 * - Order retrieval and updates
 * - Shopping cart operations
 * - Checkout processing
 * - Customer management
 *
 * @module routes/orders
 */

// Re-export all order-related handlers from their respective modules
export { listOrders, getOrder } from './get.js';
export { updateOrder } from './update.js';
export { getCart, addToCart, updateCartItem } from './cart.js';
export { checkout } from './checkout.js';
export { listCustomers, getCustomer } from './customers.js';

// Re-export types for convenience
export type {
  Order,
  OrderItem,
  Cart,
  CartItem,
  Variant,
  LineItem,
  Address,
} from './types.js';
