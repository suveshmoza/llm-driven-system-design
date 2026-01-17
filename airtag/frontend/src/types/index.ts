/**
 * Frontend type definitions for the Find My application.
 * These types mirror the backend types but use string dates for JSON serialization.
 */

/**
 * Authenticated user information displayed in the UI.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
}

/**
 * Device registered in the Find My network.
 * Displayed in the device list and map view.
 */
export interface Device {
  id: string;
  user_id: string;
  device_type: 'airtag' | 'iphone' | 'macbook' | 'ipad' | 'airpods';
  name: string;
  emoji: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Decrypted location data for display on the map.
 */
export interface Location {
  id: number;
  device_id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
  timestamp: string;
  created_at: string;
}

/**
 * Lost mode settings for a device.
 */
export interface LostMode {
  device_id: string;
  enabled: boolean;
  contact_phone?: string;
  contact_email?: string;
  message?: string;
  notify_when_found: boolean;
  enabled_at?: string;
}

/**
 * User notification for device events and security alerts.
 */
export interface Notification {
  id: string;
  user_id: string;
  device_id?: string;
  type: 'device_found' | 'unknown_tracker' | 'low_battery' | 'system';
  title: string;
  message?: string;
  is_read: boolean;
  data?: Record<string, unknown>;
  created_at: string;
}

/**
 * Summary of an unknown tracker detected by the anti-stalking system.
 */
export interface UnknownTracker {
  identifier_hash: string;
  first_seen: string;
  last_seen: string;
  sighting_count: number;
}

/**
 * Individual sighting record for an unknown tracker.
 */
export interface TrackerSighting {
  id: number;
  identifier_hash: string;
  latitude: number;
  longitude: number;
  seen_at: string;
}

/**
 * Comprehensive statistics for the admin dashboard.
 */
export interface AdminStats {
  users: {
    total: number;
    admins: number;
    thisWeek: number;
  };
  devices: {
    total: number;
    byType: Record<string, number>;
    active: number;
  };
  reports: {
    total: number;
    last24h: number;
    lastHour: number;
    byRegion: Record<string, number>;
  };
  lostMode: {
    total: number;
    active: number;
  };
  notifications: {
    total: number;
    unread: number;
    byType: Record<string, number>;
  };
  antiStalking: {
    totalSightings: number;
    uniqueTrackers: number;
    alertsTriggered: number;
  };
}
