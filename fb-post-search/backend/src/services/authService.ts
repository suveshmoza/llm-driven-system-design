/**
 * @fileoverview Authentication service for user management and session handling.
 * Provides user registration, login, session creation/validation, and user queries.
 * Uses Redis for session caching and PostgreSQL for persistent storage.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../config/database.js';
import { setCache, getCache, deleteCache, cacheKeys } from '../config/redis.js';
import type { User } from '../types/index.js';

/**
 * Hashes a password using SHA-256.
 * Note: Use bcrypt in production for secure password hashing.
 * @param password - Plain text password to hash
 * @returns Hexadecimal hash string
 */
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Session data stored in cache and used for authentication.
 */
interface SessionData {
  userId: string;
  role: string;
  expiresAt: string;
}

/**
 * Creates a new user account.
 * @param username - Unique username
 * @param email - User's email address
 * @param displayName - User's display name
 * @param password - Plain text password (will be hashed)
 * @param role - User role (defaults to 'user')
 * @returns Promise resolving to the created User or null if creation fails
 */
export async function createUser(
  username: string,
  email: string,
  displayName: string,
  password: string,
  role: 'user' | 'admin' = 'user'
): Promise<User | null> {
  try {
    const user = await queryOne<User>(
      `INSERT INTO users (username, email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [username, email, displayName, hashPassword(password), role]
    );
    return user;
  } catch (error) {
    console.error('Error creating user:', error);
    return null;
  }
}

/**
 * Authenticates a user by username and password.
 * @param username - The user's username
 * @param password - The user's plain text password
 * @returns Promise resolving to the User if credentials are valid, null otherwise
 */
export async function authenticateUser(
  username: string,
  password: string
): Promise<User | null> {
  const user = await queryOne<User>(
    `SELECT * FROM users WHERE username = $1 AND password_hash = $2`,
    [username, hashPassword(password)]
  );
  return user;
}

/**
 * Creates a new session for an authenticated user.
 * Stores session in PostgreSQL for persistence and Redis for fast lookup.
 * Sessions expire after 24 hours.
 * @param userId - The user's ID
 * @param role - The user's role
 * @returns Promise resolving to the session token
 */
export async function createSession(userId: string, role: string): Promise<string> {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Store in database
  await query(
    `INSERT INTO sessions (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );

  // Cache session
  const sessionData: SessionData = {
    userId,
    role,
    expiresAt: expiresAt.toISOString(),
  };
  await setCache(cacheKeys.userSession(token), sessionData, 24 * 60 * 60);

  return token;
}

/**
 * Validates a session token and returns session data.
 * First checks Redis cache, then falls back to PostgreSQL.
 * Automatically deletes expired sessions.
 * @param token - The session token to validate
 * @returns Promise resolving to SessionData if valid, null if invalid or expired
 */
export async function validateSession(token: string): Promise<SessionData | null> {
  // Check cache first
  const cached = await getCache<SessionData>(cacheKeys.userSession(token));
  if (cached) {
    if (new Date(cached.expiresAt) > new Date()) {
      return cached;
    }
    // Session expired
    await deleteSession(token);
    return null;
  }

  // Check database
  interface SessionRow {
    user_id: string;
    expires_at: Date;
    role: string;
  }

  const session = await queryOne<SessionRow>(
    `SELECT s.user_id, s.expires_at, u.role
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = $1`,
    [token]
  );

  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) {
      await deleteSession(token);
    }
    return null;
  }

  const sessionData: SessionData = {
    userId: session.user_id,
    role: session.role,
    expiresAt: session.expires_at.toISOString(),
  };

  // Cache for future requests
  await setCache(cacheKeys.userSession(token), sessionData, 24 * 60 * 60);

  return sessionData;
}

/**
 * Deletes a session, effectively logging the user out.
 * Removes from both PostgreSQL and Redis.
 * @param token - The session token to delete
 * @returns Promise that resolves when session is deleted
 */
export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
  await deleteCache(cacheKeys.userSession(token));
}

/**
 * Retrieves a user by their ID.
 * @param userId - The user's ID
 * @returns Promise resolving to the User or null if not found
 */
export async function getUserById(userId: string): Promise<User | null> {
  return queryOne<User>('SELECT * FROM users WHERE id = $1', [userId]);
}

/**
 * Retrieves a user by their username.
 * @param username - The user's username
 * @returns Promise resolving to the User or null if not found
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  return queryOne<User>('SELECT * FROM users WHERE username = $1', [username]);
}

/**
 * Retrieves all users with pagination (admin only).
 * Excludes password_hash from returned data.
 * @param limit - Maximum number of users to return
 * @param offset - Number of users to skip
 * @returns Promise resolving to array of Users
 */
export async function getAllUsers(limit: number = 50, offset: number = 0): Promise<User[]> {
  return query<User>(
    `SELECT id, username, email, display_name, avatar_url, role, created_at, updated_at
     FROM users
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
}
