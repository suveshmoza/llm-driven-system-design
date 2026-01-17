import pool from '../db/pool.js';
import bcrypt from 'bcrypt';
import { User } from '../types/index.js';

/** Number of bcrypt salt rounds for password hashing */
const SALT_ROUNDS = 10;

/**
 * Service for user account management.
 * Handles registration, authentication, and profile management.
 * Uses bcrypt for secure password hashing.
 */
export class UserService {
  /**
   * Create a new user account.
   * Hashes the password using bcrypt before storage.
   *
   * @param data - User registration data
   * @param data.email - User's email address (must be unique)
   * @param data.password - User's plaintext password
   * @param data.name - User's display name
   * @returns The created user (includes password_hash)
   */
  async createUser(data: {
    email: string;
    password: string;
    name: string;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.email, passwordHash, data.name]
    );

    return result.rows[0];
  }

  /**
   * Find a user by their email address.
   * Used for login and duplicate email checking.
   *
   * @param email - Email address to search for
   * @returns The user if found, null otherwise
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );
    return result.rows[0] || null;
  }

  /**
   * Find a user by their unique ID.
   * Used for session validation and profile lookups.
   *
   * @param id - User's UUID
   * @returns The user if found, null otherwise
   */
  async findById(id: string): Promise<User | null> {
    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Verify a password against the stored hash.
   * Uses bcrypt's timing-safe comparison.
   *
   * @param user - The user to verify password for
   * @param password - Plaintext password to verify
   * @returns True if password matches, false otherwise
   */
  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  }

  /**
   * Update a user's profile information.
   *
   * @param userId - The UUID of the user to update
   * @param data - Fields to update (name and/or email)
   * @returns The updated user, or null if not found
   */
  async updateUser(
    userId: string,
    data: { name?: string; email?: string }
  ): Promise<User | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (data.name) {
      fields.push(`name = $${paramCount++}`);
      values.push(data.name);
    }
    if (data.email) {
      fields.push(`email = $${paramCount++}`);
      values.push(data.email);
    }

    if (fields.length === 0) {
      return this.findById(userId);
    }

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  /**
   * Change a user's password.
   * Hashes the new password using bcrypt.
   *
   * @param userId - The UUID of the user
   * @param newPassword - The new plaintext password
   * @returns True if password was changed, false if user not found
   */
  async changePassword(userId: string, newPassword: string): Promise<boolean> {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const result = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get all users (excluding password hashes).
   * Admin-only operation for user management.
   *
   * @returns Array of all users sorted by creation date descending
   */
  async getAllUsers(): Promise<User[]> {
    const result = await pool.query(
      `SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY created_at DESC`
    );
    return result.rows;
  }

  /**
   * Get user statistics for the admin dashboard.
   *
   * @returns Statistics with total users, admin count, and new users this week
   */
  async getUserStats(): Promise<{ total: number; admins: number; thisWeek: number }> {
    const total = await pool.query(`SELECT COUNT(*) as count FROM users`);
    const admins = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE role = 'admin'`
    );
    const thisWeek = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`
    );

    return {
      total: parseInt(total.rows[0].count),
      admins: parseInt(admins.rows[0].count),
      thisWeek: parseInt(thisWeek.rows[0].count),
    };
  }
}

export const userService = new UserService();
