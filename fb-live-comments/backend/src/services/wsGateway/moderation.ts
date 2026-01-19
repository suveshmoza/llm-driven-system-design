/**
 * Moderation Module
 *
 * Handles comment moderation, user validation, and ban checks
 * for the WebSocket gateway.
 *
 * @module services/wsGateway/moderation
 */

import { userService } from '../userService.js';
import { ExtendedWebSocket } from './types.js';
import { sendError } from './broadcast.js';
import { logger } from '../../shared/index.js';

const wsLogger = logger.child({ module: 'moderation' });

/**
 * Result of a ban check operation.
 */
export interface BanCheckResult {
  /** Whether the user is banned */
  isBanned: boolean;
  /** Reason for the ban, if applicable */
  reason?: string;
}

/**
 * Checks if a user is banned from a stream.
 *
 * @param userId - User to check
 * @param streamId - Stream to check against
 * @returns Promise resolving to ban check result
 */
export async function checkUserBan(userId: string, streamId: string): Promise<BanCheckResult> {
  try {
    const isBanned = await userService.isBanned(userId, streamId);
    return { isBanned };
  } catch (error) {
    wsLogger.error(
      { error: (error as Error).message, userId, streamId },
      'Error checking user ban status'
    );
    // Fail open - allow user if we can't check
    return { isBanned: false };
  }
}

/**
 * Validates that a user can post in a stream.
 * Checks that the user is connected to the specified stream.
 *
 * @param ws - WebSocket connection
 * @param streamId - Expected stream ID
 * @param userId - Expected user ID
 * @returns True if validation passes, false otherwise
 */
export function validateUserSession(
  ws: ExtendedWebSocket,
  streamId: string,
  userId: string
): boolean {
  if (!ws.streamId || !ws.userId) {
    sendError(ws, 'NOT_IN_STREAM', 'You must join a stream first');
    return false;
  }

  if (ws.streamId !== streamId || ws.userId !== userId) {
    sendError(ws, 'INVALID_REQUEST', 'Stream or user mismatch');
    return false;
  }

  return true;
}

/**
 * Rejects a connection if the user is banned.
 *
 * @param ws - WebSocket connection
 * @param userId - User to check
 * @param streamId - Stream to check against
 * @returns Promise resolving to true if user is banned (and error was sent)
 */
export async function rejectIfBanned(
  ws: ExtendedWebSocket,
  userId: string,
  streamId: string
): Promise<boolean> {
  const { isBanned } = await checkUserBan(userId, streamId);

  if (isBanned) {
    sendError(ws, 'BANNED', 'You are banned from this stream');
    wsLogger.info({ userId, streamId }, 'Banned user attempted to join stream');
    return true;
  }

  return false;
}
