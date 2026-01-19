// Order interface
export interface Order {
  id: number;
  store_id: number;
  order_number: string;
  customer_email: string;
  subtotal: number;
  shipping_cost: number;
  tax: number;
  total: number;
  payment_status: string;
  fulfillment_status: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
  items?: OrderItem[];
}

// Order item interface
export interface OrderItem {
  id: number;
  order_id: number;
  store_id: number;
  variant_id: number;
  title: string;
  variant_title: string;
  sku: string | null;
  quantity: number;
  price: number;
  total: number;
}

// Cart item interface
export interface CartItem {
  variant_id: number;
  quantity: number;
}

// Cart interface
export interface Cart {
  id: number;
  store_id: number;
  session_id: string;
  items: CartItem[];
  subtotal: number;
}

// Variant interface
export interface Variant {
  id: number;
  product_id: number;
  store_id: number;
  sku: string | null;
  title: string;
  price: number;
  compare_at_price: number | null;
  inventory_quantity: number;
  options: Record<string, unknown>;
  product_title?: string;
}

// Line item interface for checkout
export interface LineItem {
  variant: Variant;
  quantity: number;
  price: number;
  total: number;
  oldQuantity: number;
}

// Address interface
export interface Address {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
}
