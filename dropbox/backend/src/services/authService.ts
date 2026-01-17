/**
 * User authentication and account management service.
 * Handles registration, login, logout, and user profile operations.
 * Sessions are stored in both Redis (for fast lookup) and PostgreSQL (for persistence).
 * @module services/authService
 */

import bcrypt from 'bcrypt';
import { query, queryOne } from '../utils/database.js';
import { setSession, deleteSession } from '../utils/redis.js';
import { User, AuthResponse } from '../types/index.js';
import { generateToken } from '../utils/chunking.js';

/** Session duration in hours, configurable via environment variable */
const SESSION_EXPIRY_HOURS = parseInt(process.env.SESSION_EXPIRY_HOURS || '24', 10);

/**
 * Registers a new user account.
 * Creates the user record, hashes the password, and establishes a session.
 * @param email - User's email address (will be lowercased)
 * @param password - Plain text password (will be hashed with bcrypt)
 * @param name - User's display name
 * @returns User profile and session token
 * @throws Error if email is already registered
 */
export async function register(
  email: string,
  password: string,
  name: string
): Promise<AuthResponse> {
  // Check if user exists
  const existing = await queryOne<User>(
    `SELECT id FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (existing) {
    throw new Error('Email already registered');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const result = await query<User>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, role, quota_bytes as "quotaBytes", used_bytes as "usedBytes"`,
    [email.toLowerCase(), passwordHash, name]
  );

  const user = result[0];

  // Create session
  const token = generateToken(64);
  const expirySeconds = SESSION_EXPIRY_HOURS * 60 * 60;
  await setSession(token, user.id, expirySeconds);

  // Store in database too for persistence
  const expiresAt = new Date(Date.now() + expirySeconds * 1000);
  await query(
    `INSERT INTO sessions (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, token, expiresAt]
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      quotaBytes: user.quotaBytes,
      usedBytes: user.usedBytes,
    },
    token,
  };
}

/**
 * Authenticates a user with email and password.
 * Validates credentials and creates a new session.
 * @param email - User's email address
 * @param password - Plain text password to verify
 * @returns User profile and session token
 * @throws Error if credentials are invalid
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  // Find user
  const user = await queryOne<User & { password_hash: string }>(
    `SELECT id, email, name, role, quota_bytes as "quotaBytes", used_bytes as "usedBytes", password_hash
     FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Verify password
  const passwordMatch = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatch) {
    throw new Error('Invalid email or password');
  }

  // Create session
  const token = generateToken(64);
  const expirySeconds = SESSION_EXPIRY_HOURS * 60 * 60;
  await setSession(token, user.id, expirySeconds);

  // Store in database
  const expiresAt = new Date(Date.now() + expirySeconds * 1000);
  await query(
    `INSERT INTO sessions (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, token, expiresAt]
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      quotaBytes: user.quotaBytes,
      usedBytes: user.usedBytes,
    },
    token,
  };
}

/**
 * Terminates a user session.
 * Removes the session from both Redis and the database.
 * @param token - Session token to invalidate
 */
export async function logout(token: string): Promise<void> {
  await deleteSession(token);
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

/**
 * Retrieves a user by their ID.
 * @param userId - User's unique identifier
 * @returns User profile or null if not found
 */
export async function getUserById(userId: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT id, email, name, role, quota_bytes as "quotaBytes", used_bytes as "usedBytes",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM users WHERE id = $1`,
    [userId]
  );
}

/**
 * Updates user profile information.
 * @param userId - ID of user to update
 * @param updates - Object containing fields to update (name and/or password)
 * @returns Updated user profile
 * @throws Error if user not found
 */
export async function updateUser(
  userId: string,
  updates: { name?: string; password?: string }
): Promise<User> {
  let passwordHash: string | undefined;

  if (updates.password) {
    passwordHash = await bcrypt.hash(updates.password, 10);
  }

  const result = await query<User>(
    `UPDATE users
     SET name = COALESCE($1, name),
         password_hash = COALESCE($2, password_hash),
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, email, name, role, quota_bytes as "quotaBytes", used_bytes as "usedBytes"`,
    [updates.name, passwordHash, userId]
  );

  if (result.length === 0) {
    throw new Error('User not found');
  }

  return result[0];
}

// Admin functions

/**
 * Retrieves all user accounts (admin only).
 * Used for the admin dashboard user management interface.
 * @returns Array of all users ordered by creation date
 */
export async function getAllUsers(): Promise<User[]> {
  return query<User>(
    `SELECT id, email, name, role, quota_bytes as "quotaBytes", used_bytes as "usedBytes",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM users ORDER BY created_at DESC`
  );
}

/**
 * Updates a user's storage quota (admin only).
 * @param userId - ID of user to update
 * @param quotaBytes - New storage quota in bytes
 * @returns Updated user profile
 * @throws Error if user not found
 */
export async function updateUserQuota(userId: string, quotaBytes: number): Promise<User> {
  const result = await query<User>(
    `UPDATE users SET quota_bytes = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, email, name, role, quota_bytes as "quotaBytes", used_bytes as "usedBytes"`,
    [quotaBytes, userId]
  );

  if (result.length === 0) {
    throw new Error('User not found');
  }

  return result[0];
}

/**
 * Permanently deletes a user account (admin only).
 * Cascade deletes will remove all user's files, sessions, and shares.
 * @param userId - ID of user to delete
 */
export async function deleteUser(userId: string): Promise<void> {
  // Cascade delete will handle files, sessions, etc.
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}
