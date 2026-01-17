import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

/**
 * Generates a new UUID v4 identifier.
 * Used for device IDs, notification IDs, and session IDs.
 *
 * @returns A new UUID string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateUUID(): string {
  return uuidv4();
}

/**
 * Creates a SHA-256 hash of a device token.
 * Tokens are hashed before storage for security; the raw token is never persisted.
 *
 * @param token - Raw device token from iOS (64-char hex string)
 * @returns Hex-encoded SHA-256 hash
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a cryptographically secure random token.
 * Used for session tokens and other security-sensitive identifiers.
 *
 * @param length - Number of random bytes (default 32, produces 64-char hex string)
 * @returns Hex-encoded random string
 */
export function generateRandomToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Validates an iOS device token format.
 * Device tokens from APNs are 64-character hexadecimal strings.
 *
 * @param token - Token string to validate
 * @returns True if token is a valid 64-char hex string
 */
export function validateDeviceToken(token: string): boolean {
  // Device tokens are 64 character hex strings
  return /^[a-fA-F0-9]{64}$/.test(token);
}

/**
 * Validates an iOS app bundle identifier format.
 * Bundle IDs follow reverse domain notation (e.g., "com.example.myapp").
 *
 * @param bundleId - Bundle ID to validate
 * @returns True if bundle ID matches reverse domain notation
 */
export function validateBundleId(bundleId: string): boolean {
  // Bundle IDs follow reverse domain notation
  return /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(bundleId);
}

/**
 * Validates a topic name for push notification subscriptions.
 * Topics must be alphanumeric with dots, hyphens, and underscores, max 200 chars.
 *
 * @param topic - Topic name to validate
 * @returns True if topic is valid
 */
export function validateTopic(topic: string): boolean {
  // Topics are alphanumeric with dots and hyphens, max 200 chars
  return (
    topic.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(topic)
  );
}

/**
 * Validates an APNs notification payload.
 * Ensures the payload has an 'aps' key and is under 4KB.
 *
 * @param payload - Payload object to validate
 * @returns True if payload is valid APNs structure under 4KB
 */
export function validatePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const p = payload as Record<string, unknown>;

  // Must have 'aps' key
  if (!p.aps || typeof p.aps !== "object") {
    return false;
  }

  // Payload size must be under 4KB
  const payloadSize = JSON.stringify(payload).length;
  if (payloadSize > 4096) {
    return false;
  }

  return true;
}

/**
 * Type guard to validate notification priority values.
 * APNs supports three priority levels: 1, 5, and 10.
 *
 * @param priority - Value to check
 * @returns True if priority is 1, 5, or 10
 */
export function validatePriority(priority: unknown): priority is 1 | 5 | 10 {
  return priority === 1 || priority === 5 || priority === 10;
}

/**
 * Parses an expiration value into a Date object.
 * Supports Unix timestamps (seconds) and ISO date strings.
 * Zero means immediate-only delivery (no storage).
 *
 * @param expiration - Unix timestamp, ISO string, or null/undefined
 * @returns Date object or null if no expiration
 */
export function parseExpiration(expiration: unknown): Date | null {
  if (!expiration) return null;

  if (typeof expiration === "number") {
    // Unix timestamp
    if (expiration === 0) return null; // 0 means immediate delivery, no storage
    return new Date(expiration * 1000);
  }

  if (typeof expiration === "string") {
    const date = new Date(expiration);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  return null;
}

/**
 * Checks if an expiration date has passed.
 *
 * @param expiration - Expiration date or null
 * @returns True if expired, false if null or still valid
 */
export function isExpired(expiration: Date | null): boolean {
  if (!expiration) return false;
  return expiration.getTime() < Date.now();
}

/**
 * Formats a Date as an ISO 8601 string.
 *
 * @param date - Date to format
 * @returns ISO 8601 formatted string
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Returns a promise that resolves after the specified delay.
 * Useful for backoff strategies and testing.
 *
 * @param ms - Milliseconds to wait
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a SHA-256 hash of a password for storage.
 * Note: In production, use bcrypt or argon2 for password hashing.
 * SHA-256 is used here for simplicity in this learning project.
 *
 * @param password - Plain text password
 * @returns Hex-encoded SHA-256 hash
 */
export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

/**
 * Verifies a password against its stored hash.
 *
 * @param password - Plain text password to verify
 * @param hash - Stored password hash to compare against
 * @returns True if password matches hash
 */
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}
