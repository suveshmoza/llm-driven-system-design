/**
 * Timeout Operations - Handles temporary bans (timeouts) for channels.
 *
 * Provides endpoints for:
 * - Timing out users (temporary ban with automatic expiration)
 * - Removing active timeouts early
 *
 * Timeouts are stored in the same table as bans but with an expiration date.
 * All actions are logged for audit purposes and broadcast via Redis pub/sub.
 *
 * @module routes/moderation/timeouts
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logUserTimeout } from '../../utils/audit.js';
import { authenticateRequest, requireModeratorAccess, getUsername } from './helpers.js';
import type { ChannelParams, TimeoutBody, ChannelOwnerRow, UserBanParams } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/**
 * Times out a user in a channel.
 *
 * Creates a temporary ban that automatically expires after the specified duration.
 * Channel owners cannot be timed out. If the user already has a timeout or ban,
 * it will be updated with the new duration.
 *
 * @description POST /api/moderation/:channelId/timeout - Timeout a user
 * @param req.params.channelId - The channel to timeout the user in
 * @param req.body.userId - The user ID to timeout (required)
 * @param req.body.durationSeconds - Duration in seconds (required, must be positive)
 * @param req.body.reason - Optional reason for the timeout
 * @returns JSON with success status and timeout details including expiration time
 * @throws 400 if userId or durationSeconds is missing/invalid, or target is channel owner
 * @throws 401 if not authenticated
 * @throws 403 if not authorized to moderate this channel
 * @throws 500 on database or server error
 *
 * @example
 * // 10-minute timeout
 * POST /api/moderation/123/timeout
 * { "userId": 456, "durationSeconds": 600, "reason": "Calm down" }
 */
router.post('/', async (req: Request<ChannelParams, object, TimeoutBody>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId } = req.params;
    const { userId: targetUserId, durationSeconds, reason } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    if (!durationSeconds || durationSeconds <= 0) {
      res.status(400).json({ error: 'durationSeconds is required and must be positive' });
      return;
    }
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    // Cannot timeout the channel owner
    const channelOwner = await query<ChannelOwnerRow>('SELECT user_id FROM channels WHERE id = $1', [channelId]);
    if (channelOwner.rows[0]?.user_id === targetUserId) {
      res.status(400).json({ error: 'Cannot timeout channel owner' });
      return;
    }

    const expiresAt = new Date(Date.now() + durationSeconds * 1000);

    await query(`
      INSERT INTO channel_bans (channel_id, user_id, banned_by, reason, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (channel_id, user_id)
      DO UPDATE SET banned_by = $3, reason = $4, expires_at = $5, created_at = NOW()
    `, [channelId, targetUserId, actorId, reason || null, expiresAt]);

    const [actorUsername, targetUsername] = await Promise.all([
      getUsername(actorId),
      getUsername(targetUserId)
    ]);

    logUserTimeout(
      { userId: actorId, username: actorUsername, ip: req.ip || '' },
      targetUserId, targetUsername, parseInt(channelId), durationSeconds, reason
    );

    await publishMessage(`chat:${channelId}`, {
      type: 'user_timeout', channelId: parseInt(channelId), userId: targetUserId,
      username: targetUsername, duration: durationSeconds,
      expiresAt: expiresAt.toISOString(), reason: reason || 'No reason provided'
    });

    logger.info({ actor_id: actorId, target_user_id: targetUserId, channel_id: channelId, duration_seconds: durationSeconds }, 'User timed out');
    res.json({ success: true, timeout: { userId: targetUserId, channelId: parseInt(channelId), durationSeconds, expiresAt } });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Timeout user error');
    res.status(500).json({ error: 'Failed to timeout user' });
  }
});

/**
 * Removes a timeout from a user.
 *
 * Deletes the timeout record, allowing the user to participate in chat
 * immediately rather than waiting for the timeout to expire. Only removes
 * timeouts (bans with expiration), not permanent bans.
 *
 * @description DELETE /api/moderation/:channelId/timeout/:userId - Remove timeout
 * @param req.params.channelId - The channel to remove the timeout from
 * @param req.params.userId - The user ID to remove the timeout for
 * @returns JSON with success status
 * @throws 401 if not authenticated
 * @throws 403 if not authorized to moderate this channel
 * @throws 404 if no timeout exists for this user (permanent bans not affected)
 * @throws 500 on database or server error
 *
 * @example
 * DELETE /api/moderation/123/timeout/456
 */
router.delete('/:userId', async (req: Request<UserBanParams>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId, userId: targetUserId } = req.params;
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    const result = await query(
      'DELETE FROM channel_bans WHERE channel_id = $1 AND user_id = $2 AND expires_at IS NOT NULL RETURNING *',
      [channelId, targetUserId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Timeout not found' });
      return;
    }

    const targetUsername = await getUsername(parseInt(targetUserId));

    await publishMessage(`chat:${channelId}`, {
      type: 'user_untimeout', channelId: parseInt(channelId),
      userId: parseInt(targetUserId), username: targetUsername
    });

    logger.info({ actor_id: actorId, target_user_id: targetUserId, channel_id: channelId }, 'User timeout removed');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Remove timeout error');
    res.status(500).json({ error: 'Failed to remove timeout' });
  }
});

export default router;
