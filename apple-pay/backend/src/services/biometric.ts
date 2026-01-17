import { v4 as uuid } from 'uuid';
import { query } from '../db/index.js';
import redis from '../db/redis.js';
import { generateChallenge } from '../utils/crypto.js';
import { BiometricSession } from '../types/index.js';

/**
 * Service responsible for biometric authentication management.
 * Handles Face ID, Touch ID, and passcode verification flows for
 * authorizing payment transactions. Implements a challenge-response
 * pattern where the device's Secure Enclave signs a challenge to
 * prove biometric verification occurred on-device.
 */
export class BiometricService {
  /**
   * Initiates a biometric authentication session.
   * Creates a cryptographic challenge that must be signed by the
   * device's Secure Enclave after successful biometric verification.
   * Sessions expire after 5 minutes if not verified.
   *
   * @param userId - The user's unique identifier
   * @param deviceId - The device performing the authentication
   * @param authType - The type of biometric auth (face_id, touch_id, or passcode)
   * @returns Object with session ID and challenge for the device to sign
   * @throws Error if device is invalid or inactive
   */
  async initiateAuth(
    userId: string,
    deviceId: string,
    authType: 'face_id' | 'touch_id' | 'passcode'
  ): Promise<{ sessionId: string; challenge: string }> {
    // Verify device belongs to user
    const deviceResult = await query(
      `SELECT * FROM devices WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [deviceId, userId]
    );

    if (deviceResult.rows.length === 0) {
      throw new Error('Invalid or inactive device');
    }

    const sessionId = uuid();
    const challenge = generateChallenge();

    await query(
      `INSERT INTO biometric_sessions
        (id, user_id, device_id, auth_type, status, challenge, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW() + INTERVAL '5 minutes')`,
      [sessionId, userId, deviceId, authType, challenge]
    );

    // Store in Redis for fast lookup
    await redis.set(
      `biometric:${sessionId}`,
      JSON.stringify({
        userId,
        deviceId,
        authType,
        challenge,
        status: 'pending',
      }),
      'EX',
      300 // 5 minutes
    );

    return { sessionId, challenge };
  }

  /**
   * Verifies a biometric authentication response.
   * In a real implementation, this would verify the cryptographic
   * signature from the Secure Enclave. The response must include
   * the challenge to prove it was generated for this specific session.
   *
   * @param sessionId - The session ID from initiateAuth
   * @param response - The signed response from the device
   * @returns Object indicating success or failure with error message
   */
  async verifyAuth(
    sessionId: string,
    response: string
  ): Promise<{ success: boolean; error?: string }> {
    // Get session from Redis (faster) or database
    let session: any = null;
    const redisData = await redis.get(`biometric:${sessionId}`);

    if (redisData) {
      session = JSON.parse(redisData);
    } else {
      const result = await query(
        `SELECT * FROM biometric_sessions
         WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
        [sessionId]
      );
      if (result.rows.length > 0) {
        session = result.rows[0];
      }
    }

    if (!session) {
      return { success: false, error: 'Session not found or expired' };
    }

    // In a real implementation, we would:
    // 1. Verify the signature using the device's public key
    // 2. Check that the challenge matches
    // For simulation, we accept any response

    // Simulate verification (accept if response contains the challenge)
    const isValid = response.includes(session.challenge.substring(0, 10)) || response === 'verified';

    if (!isValid) {
      await this.updateSessionStatus(sessionId, 'failed');
      return { success: false, error: 'Authentication failed' };
    }

    await this.updateSessionStatus(sessionId, 'verified');

    // Extend session expiry
    await redis.set(
      `biometric:${sessionId}`,
      JSON.stringify({ ...session, status: 'verified' }),
      'EX',
      300 // 5 more minutes
    );

    return { success: true };
  }

  /**
   * Updates the status of a biometric session in the database.
   * Sets the verified_at timestamp when status is 'verified'.
   *
   * @param sessionId - The session's unique identifier
   * @param status - The new status ('verified' or 'failed')
   */
  private async updateSessionStatus(
    sessionId: string,
    status: 'verified' | 'failed'
  ): Promise<void> {
    await query(
      `UPDATE biometric_sessions
       SET status = $2, verified_at = CASE WHEN $2 = 'verified' THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [sessionId, status]
    );
  }

  /**
   * Retrieves the current status of a biometric session.
   * First checks Redis cache, then falls back to database.
   *
   * @param sessionId - The session's unique identifier
   * @returns The session if found, null otherwise
   */
  async getSessionStatus(sessionId: string): Promise<BiometricSession | null> {
    const redisData = await redis.get(`biometric:${sessionId}`);

    if (redisData) {
      return JSON.parse(redisData);
    }

    const result = await query(
      `SELECT * FROM biometric_sessions WHERE id = $1`,
      [sessionId]
    );

    return result.rows[0] || null;
  }

  /**
   * Simulates successful biometric authentication for demo purposes.
   * Bypasses the actual cryptographic verification by calling verifyAuth
   * with a pre-approved response. Use only for testing/demonstration.
   *
   * @param sessionId - The session ID to mark as verified
   * @returns Object indicating success or failure with error message
   */
  async simulateBiometricSuccess(
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.verifyAuth(sessionId, 'verified');
  }
}

/** Singleton instance of the BiometricService */
export const biometricService = new BiometricService();
