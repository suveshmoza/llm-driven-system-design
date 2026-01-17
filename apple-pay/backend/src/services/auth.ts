import { v4 as uuid } from 'uuid';
import bcrypt from 'bcrypt';
import { query } from '../db/index.js';
import redis from '../db/redis.js';
import { User, Device } from '../types/index.js';

/**
 * Service responsible for user authentication and device management.
 * Handles user registration, login/logout flows, session management,
 * and device lifecycle including registration and lost device handling.
 * Sessions are stored in Redis with 1-hour TTL for fast validation.
 */
export class AuthService {
  /**
   * Authenticates a user with email and password.
   * Creates a new session in Redis with 1-hour TTL.
   * Optionally associates the session with a specific device.
   *
   * @param email - The user's email address
   * @param password - The user's password
   * @param deviceId - Optional device ID to associate with the session
   * @returns Object with success status, session ID, and user details or error
   */
  async login(
    email: string,
    password: string,
    deviceId?: string
  ): Promise<{ success: boolean; sessionId?: string; user?: Partial<User>; error?: string }> {
    const result = await query(
      `SELECT * FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Invalid credentials' };
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return { success: false, error: 'Invalid credentials' };
    }

    // Create session
    const sessionId = uuid();
    const sessionData = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      deviceId: deviceId || null,
    };

    await redis.set(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      'EX',
      3600 // 1 hour
    );

    // Update device last active
    if (deviceId) {
      await query(
        `UPDATE devices SET last_active_at = NOW() WHERE id = $1 AND user_id = $2`,
        [deviceId, user.id]
      );
    }

    return {
      success: true,
      sessionId,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  /**
   * Registers a new user account.
   * Hashes the password using bcrypt before storage.
   * Email addresses are normalized to lowercase.
   *
   * @param email - The user's email address
   * @param password - The user's password (min 6 characters)
   * @param name - The user's display name
   * @returns Object with success status and user details or error
   */
  async register(
    email: string,
    password: string,
    name: string
  ): Promise<{ success: boolean; user?: Partial<User>; error?: string }> {
    // Check if user exists
    const existing = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return { success: false, error: 'Email already registered' };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuid();

    await query(
      `INSERT INTO users (id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, 'user')`,
      [userId, email.toLowerCase(), passwordHash, name]
    );

    return {
      success: true,
      user: {
        id: userId,
        email: email.toLowerCase(),
        name,
        role: 'user',
      },
    };
  }

  /**
   * Logs out a user by deleting their session from Redis.
   *
   * @param sessionId - The session ID to invalidate
   */
  async logout(sessionId: string): Promise<void> {
    await redis.del(`session:${sessionId}`);
  }

  /**
   * Retrieves the current user from a session ID.
   * Validates the session exists in Redis and fetches user details.
   *
   * @param sessionId - The session ID to look up
   * @returns The user if session is valid, null otherwise
   */
  async getCurrentUser(sessionId: string): Promise<User | null> {
    const sessionData = await redis.get(`session:${sessionId}`);
    if (!sessionData) {
      return null;
    }

    const session = JSON.parse(sessionData);
    const result = await query(
      `SELECT id, email, name, role, created_at FROM users WHERE id = $1`,
      [session.userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Registers a new Apple device for a user.
   * Generates a simulated Secure Element ID for the device.
   * Each device can have its own provisioned cards.
   *
   * @param userId - The user's unique identifier
   * @param deviceName - Human-readable device name (e.g., "My iPhone 15")
   * @param deviceType - The type of device (iphone, apple_watch, or ipad)
   * @returns The newly created device record
   */
  async registerDevice(
    userId: string,
    deviceName: string,
    deviceType: 'iphone' | 'apple_watch' | 'ipad'
  ): Promise<Device> {
    const deviceId = uuid();
    const secureElementId = `SE_${uuid().replace(/-/g, '').substring(0, 16)}`;

    await query(
      `INSERT INTO devices (id, user_id, device_name, device_type, secure_element_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [deviceId, userId, deviceName, deviceType, secureElementId]
    );

    const result = await query(
      `SELECT * FROM devices WHERE id = $1`,
      [deviceId]
    );

    return result.rows[0];
  }

  /**
   * Retrieves all devices registered to a user.
   * Sorted by creation date (newest first).
   *
   * @param userId - The user's unique identifier
   * @returns Array of device records
   */
  async getDevices(userId: string): Promise<Device[]> {
    const result = await query(
      `SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Removes a device and all its provisioned cards.
   * Marks all cards on the device as deleted and sets the device
   * status to inactive. This is a permanent action.
   *
   * @param userId - The user's unique identifier
   * @param deviceId - The device's unique identifier
   * @returns Object indicating success or failure with error message
   */
  async removeDevice(userId: string, deviceId: string): Promise<{ success: boolean; error?: string }> {
    const device = await query(
      `SELECT * FROM devices WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );

    if (device.rows.length === 0) {
      return { success: false, error: 'Device not found' };
    }

    // Mark all cards on this device as deleted
    await query(
      `UPDATE provisioned_cards SET status = 'deleted', updated_at = NOW()
       WHERE device_id = $1`,
      [deviceId]
    );

    // Mark device as inactive
    await query(
      `UPDATE devices SET status = 'inactive' WHERE id = $1`,
      [deviceId]
    );

    return { success: true };
  }

  /**
   * Reports a device as lost and suspends all its cards.
   * This is a security feature to prevent unauthorized use
   * if a device is stolen or misplaced. Cards can be reactivated
   * when the device is recovered.
   *
   * @param userId - The user's unique identifier
   * @param deviceId - The device's unique identifier
   * @returns Object with success status and count of suspended cards
   */
  async reportDeviceLost(userId: string, deviceId: string): Promise<{ success: boolean; suspendedCards: number; error?: string }> {
    const device = await query(
      `SELECT * FROM devices WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );

    if (device.rows.length === 0) {
      return { success: false, suspendedCards: 0, error: 'Device not found' };
    }

    // Suspend all cards on this device
    const result = await query(
      `UPDATE provisioned_cards
       SET status = 'suspended', suspended_at = NOW(), suspend_reason = 'device_lost', updated_at = NOW()
       WHERE device_id = $1 AND status = 'active'
       RETURNING id`,
      [deviceId]
    );

    // Mark device as lost
    await query(
      `UPDATE devices SET status = 'lost' WHERE id = $1`,
      [deviceId]
    );

    return { success: true, suspendedCards: result.rowCount || 0 };
  }
}

/** Singleton instance of the AuthService */
export const authService = new AuthService();
