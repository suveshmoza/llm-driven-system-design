import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../utils/database.js';
import { sessionCache } from '../utils/cache.js';
import { AUTH_CONFIG } from '../config.js';
import { User, UserPublic, CreateUserInput, Session } from '../models/types.js';

/**
 * Hashes a password using bcrypt.
 * @param password - Plain text password to hash
 * @returns Promise resolving to the hashed password
 */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, AUTH_CONFIG.bcryptRounds);
}

/**
 * Verifies a password against a bcrypt hash.
 * @param password - Plain text password to verify
 * @param hash - Bcrypt hash to compare against
 * @returns Promise resolving to true if password matches
 */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Converts a full user model to public format.
 * Removes sensitive data (password hash) before sending to clients.
 * @param user - Full user model with password hash
 * @returns Public user data safe for API responses
 */
function toPublicUser(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at.toISOString(),
  };
}

/**
 * Creates a new user account.
 * Validates email uniqueness and password requirements.
 * @param input - User registration data
 * @returns Promise resolving to the created user (public format)
 * @throws Error if email exists or password is too short
 */
export async function createUser(input: CreateUserInput): Promise<UserPublic> {
  const { email, password, role = 'user' } = input;

  // Check if email already exists
  const existing = await query<User>(
    `SELECT * FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (existing.length > 0) {
    throw new Error('Email already registered');
  }

  // Validate password
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const passwordHash = await hashPassword(password);

  const result = await query<User>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [email.toLowerCase(), passwordHash, role]
  );

  return toPublicUser(result[0]);
}

/**
 * Authenticates a user and creates a session.
 * Verifies credentials, generates a session token, and caches it.
 * @param email - User's email address
 * @param password - User's password
 * @returns Promise resolving to user and token, or null if invalid credentials
 */
export async function loginUser(
  email: string,
  password: string
): Promise<{ user: UserPublic; token: string } | null> {
  const users = await query<User>(
    `SELECT * FROM users WHERE email = $1 AND is_active = true`,
    [email.toLowerCase()]
  );

  if (users.length === 0) {
    return null;
  }

  const user = users[0];
  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    return null;
  }

  // Create session
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + AUTH_CONFIG.sessionDuration);

  await query(
    `INSERT INTO sessions (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, token, expiresAt]
  );

  // Cache session
  await sessionCache.set(token, user.id);

  return {
    user: toPublicUser(user),
    token,
  };
}

/**
 * Logs out a user by invalidating their session.
 * Removes the session from both database and cache.
 * @param token - The session token to invalidate
 */
export async function logoutUser(token: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
  await sessionCache.delete(token);
}

/**
 * Retrieves a user by their session token.
 * Checks cache first for performance, falls back to database.
 * @param token - The session token
 * @returns Promise resolving to user (public format) or null if invalid
 */
export async function getUserByToken(token: string): Promise<UserPublic | null> {
  // Check cache first
  const cachedUserId = await sessionCache.get(token);

  if (cachedUserId) {
    const users = await query<User>(
      `SELECT * FROM users WHERE id = $1 AND is_active = true`,
      [cachedUserId]
    );

    if (users.length > 0) {
      return toPublicUser(users[0]);
    }
  }

  // Cache miss - check database
  const sessions = await query<Session>(
    `SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (sessions.length === 0) {
    return null;
  }

  const users = await query<User>(
    `SELECT * FROM users WHERE id = $1 AND is_active = true`,
    [sessions[0].user_id]
  );

  if (users.length === 0) {
    return null;
  }

  // Update cache
  await sessionCache.set(token, users[0].id);

  return toPublicUser(users[0]);
}

/**
 * Retrieves a user by their ID.
 * @param userId - The user's UUID
 * @returns Promise resolving to user (public format) or null if not found
 */
export async function getUserById(userId: string): Promise<UserPublic | null> {
  const users = await query<User>(
    `SELECT * FROM users WHERE id = $1 AND is_active = true`,
    [userId]
  );

  if (users.length === 0) {
    return null;
  }

  return toPublicUser(users[0]);
}

/**
 * Retrieves a paginated list of all users.
 * Admin-only operation for user management.
 * @param limit - Maximum number of users to return (default: 50)
 * @param offset - Number of users to skip (default: 0)
 * @returns Promise resolving to users array and total count
 */
export async function getAllUsers(
  limit: number = 50,
  offset: number = 0
): Promise<{ users: UserPublic[]; total: number }> {
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM users`
  );

  const users = await query<User>(
    `SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return {
    users: users.map(toPublicUser),
    total: parseInt(countResult[0].count, 10),
  };
}

/**
 * Updates a user's role.
 * Admin-only operation for granting or revoking admin privileges.
 * @param userId - The user's UUID
 * @param role - New role ('user' or 'admin')
 * @returns Promise resolving to updated user or null if not found
 */
export async function updateUserRole(
  userId: string,
  role: 'user' | 'admin'
): Promise<UserPublic | null> {
  const result = await query<User>(
    `UPDATE users SET role = $1 WHERE id = $2 RETURNING *`,
    [role, userId]
  );

  if (result.length === 0) {
    return null;
  }

  return toPublicUser(result[0]);
}

/**
 * Deactivates a user account.
 * Admin-only operation that prevents the user from logging in.
 * @param userId - The user's UUID
 * @returns Promise resolving to true if deactivated, false if not found
 */
export async function deactivateUser(userId: string): Promise<boolean> {
  const result = await query<User>(
    `UPDATE users SET is_active = false WHERE id = $1 RETURNING *`,
    [userId]
  );

  return result.length > 0;
}
