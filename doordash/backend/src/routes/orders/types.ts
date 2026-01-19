import { ETAResult } from '../../utils/geo.js';

export const TAX_RATE = 0.0875; // 8.75% tax

export interface OrderTransition {
  next: string[];
  actor: string | null;
}

// Order status flow
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

export interface DeliveryAddress {
  lat: number;
  lon: number;
  address: string;
}

export interface OrderItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  specialInstructions?: string;
}

export interface Order {
  id: number;
  customer_id: number;
  restaurant_id: number;
  driver_id?: number | null;
  status: string;
  subtotal: number;
  delivery_fee: number;
  tax: number;
  tip: number;
  total: number;
  delivery_address: DeliveryAddress;
  delivery_instructions?: string;
  placed_at?: string;
  confirmed_at?: string;
  preparing_at?: string;
  ready_at?: string;
  picked_up_at?: string;
  delivered_at?: string;
  cancelled_at?: string;
  cancel_reason?: string;
  estimated_delivery_at?: string;
  eta_breakdown?: ETAResult['breakdown'];
  items?: OrderItem[];
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

export interface NearbyDriver {
  id: number;
  distance: number;
}

export interface ScoredDriver {
  driver: {
    id: number;
    name: string;
    rating?: number | string;
    total_deliveries: number;
    user_id: number;
    current_lat?: number;
    current_lon?: number;
  };
  score: number;
  distance: number;
}

export interface MenuItem {
  id: number;
  name: string;
  price: string;
  is_available: boolean;
}

export interface RequestOrderItem {
  menuItemId: number;
  quantity?: number;
  specialInstructions?: string;
}
