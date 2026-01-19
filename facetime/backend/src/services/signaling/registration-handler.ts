/**
 * Registration Handler - Handles WebSocket client registration.
 *
 * Manages:
 * - User verification
 * - Device registration
 * - Presence updates
 */

import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';
import { query, queryOne } from '../../db/index.js';
import { setUserOnline, setUserOffline } from '../redis.js';
import type { User, WebSocketMessage } from '../../types/index.js';
import type { ConnectedClient, UserProfile } from './types.js';
import {
  createWebSocketLogger,
  logAudit,
} from '../../shared/logger.js';
import { withCircuitBreaker } from '../../shared/circuit-breaker.js';
import {
  updatePresence,
  removePresence,
  getCachedUserProfile,
  setCachedUserProfile,
} from '../../shared/cache.js';
import {
  sendToClient,
  setClient,
  deleteClient,
  addUserClient,
  removeUserClient,
} from './connection-manager.js';

/**
 * Handles client registration when a user connects via WebSocket.
 * Verifies user exists, creates client tracking entry, updates presence
 * in Redis, and records the device in the database.
 *
 * Uses circuit breaker for database operations to prevent cascade failures.
 *
 * @param ws - The WebSocket connection
 * @param clientId - Unique ID for this connection
 * @param message - The registration message containing userId and deviceId
 * @param log - Logger instance for this client
 * @returns The created ConnectedClient or null if registration failed
 */
export async function handleRegister(
  ws: WebSocket,
  clientId: string,
  message: WebSocketMessage,
  log: ReturnType<typeof createWebSocketLogger>
): Promise<ConnectedClient | null> {
  const { userId, deviceId, data } = message;
  const deviceType = (data as { deviceType?: string })?.deviceType || 'desktop';

  if (!userId) {
    sendToClient(ws, {
      type: 'error',
      data: { message: 'userId is required' },
    });
    return null;
  }

  // Check cache first for user profile
  const cachedUser = await getCachedUserProfile(userId);
  let userProfile: UserProfile | null = cachedUser ? {
    id: cachedUser.id,
    username: cachedUser.username,
    display_name: cachedUser.display_name,
    avatar_url: cachedUser.avatar_url,
  } : null;

  if (!userProfile) {
    // Cache miss - fetch from database with circuit breaker
    try {
      const dbUser = await withCircuitBreaker(
        'db-user-lookup',
        async () => queryOne<User>('SELECT * FROM users WHERE id = $1', [userId]),
        [userId, deviceId],
        null // Fallback to null if circuit is open
      );

      if (!dbUser) {
        sendToClient(ws, {
          type: 'error',
          data: { message: 'User not found' },
        });
        return null;
      }

      // Cache the user profile
      userProfile = {
        id: dbUser.id,
        username: dbUser.username,
        display_name: dbUser.display_name,
        avatar_url: dbUser.avatar_url,
      };
      await setCachedUserProfile(userId, userProfile);
    } catch (error) {
      log.error({ error }, 'Failed to lookup user');
      sendToClient(ws, {
        type: 'error',
        data: { message: 'Service temporarily unavailable' },
      });
      return null;
    }
  }

  const finalDeviceId = deviceId || uuidv4();
  const clientLogger = createWebSocketLogger(clientId, userId, finalDeviceId);

  const client: ConnectedClient = {
    ws,
    userId,
    deviceId: finalDeviceId,
    deviceType,
    lastPing: Date.now(),
    log: clientLogger,
  };

  setClient(clientId, client);
  addUserClient(userId, clientId);

  // Update Redis presence (write-through)
  await Promise.all([
    setUserOnline(userId, finalDeviceId),
    updatePresence(userId, finalDeviceId, deviceType),
  ]);

  // Update device last_seen in database (fire-and-forget with circuit breaker)
  withCircuitBreaker(
    'db-device-upsert',
    async () => query(
      `INSERT INTO user_devices (id, user_id, device_name, device_type, is_active, last_seen)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (id) DO UPDATE SET last_seen = NOW(), is_active = true`,
      [finalDeviceId, userId, `${deviceType} Device`, deviceType]
    )
  ).catch((err) => clientLogger.error({ err }, 'Failed to update device record'));

  // Audit log for device registration
  logAudit({
    timestamp: new Date().toISOString(),
    action: 'device.registered',
    actor: { userId, deviceId: finalDeviceId },
    resource: { type: 'device', id: finalDeviceId },
    outcome: 'success',
    details: { deviceType },
  });

  sendToClient(ws, {
    type: 'register',
    data: {
      success: true,
      userId,
      deviceId: finalDeviceId,
      user: {
        id: userProfile.id,
        username: userProfile.username,
        display_name: userProfile.display_name,
        avatar_url: userProfile.avatar_url,
      },
    },
  });

  clientLogger.info('User registered');
  return client;
}

/**
 * Cleans up when a WebSocket client disconnects.
 * Removes from tracking maps, updates Redis presence,
 * and marks device as inactive in database.
 *
 * @param clientId - The unique ID of the disconnecting client
 * @param client - The disconnecting client's data
 */
export async function handleDisconnect(clientId: string, client: ConnectedClient): Promise<void> {
  // Remove from clients map
  deleteClient(clientId);

  // Remove from user lookup
  removeUserClient(client.userId, clientId);

  // Update Redis presence
  await Promise.all([
    setUserOffline(client.userId, client.deviceId),
    removePresence(client.userId, client.deviceId),
  ]);

  // Update device in database (fire-and-forget with circuit breaker)
  withCircuitBreaker(
    'db-device-offline',
    async () => query(
      `UPDATE user_devices SET is_active = false, last_seen = NOW() WHERE id = $1`,
      [client.deviceId]
    )
  ).catch((err) => client.log.error({ err }, 'Failed to update device offline status'));

  client.log.info('Client disconnected and cleaned up');
}
