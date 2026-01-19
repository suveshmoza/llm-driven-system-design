/**
 * Ban/Unban Operations - Handles permanent bans and ban listing for channels.
 *
 * Provides endpoints for:
 * - Banning users (permanent or timed)
 * - Unbanning users
 * - Listing all banned users in a channel
 *
 * All actions are logged for audit purposes and broadcast via Redis pub/sub.
 *
 * @module routes/moderation/bans
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logUserBan, logUserUnban } from '../../utils/audit.js';
import { authenticateRequest, requireModeratorAccess, getUsername } from './helpers.js';
import type { ChannelParams, UserBanParams, BanBody, ChannelOwnerRow, BanRow } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/**
 * Bans a user from a channel.
 *
 * Creates or updates a ban record for the target user. Supports both permanent
 * bans and timed bans with expiration. Channel owners cannot be banned.
 *
 * @description POST /api/moderation/:channelId/ban - Ban a user from a channel
 * @param req.params.channelId - The channel to ban the user from
 * @param req.body.userId - The user ID to ban (required)
 * @param req.body.reason - Optional reason for the ban
 * @param req.body.durationSeconds - Optional duration; omit for permanent ban
 * @returns JSON with success status and ban details
 * @throws 400 if userId is missing or target is the channel owner
 * @throws 401 if not authenticated
 * @throws 403 if not authorized to moderate this channel
 * @throws 500 on database or server error
 *
 * @example
 * // Permanent ban
 * POST /api/moderation/123/ban
 * { "userId": 456, "reason": "Spam" }
 *
 * // Timed ban (1 hour)
 * POST /api/moderation/123/ban
 * { "userId": 456, "durationSeconds": 3600 }
 */
router.post('/', async (req: Request<ChannelParams, object, BanBody>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId } = req.params;
    const { userId: targetUserId, reason, durationSeconds } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    // Cannot ban the channel owner
    const channelOwner = await query<ChannelOwnerRow>('SELECT user_id FROM channels WHERE id = $1', [channelId]);
    if (channelOwner.rows[0]?.user_id === targetUserId) {
      res.status(400).json({ error: 'Cannot ban channel owner' });
      return;
    }

    const expiresAt = durationSeconds ? new Date(Date.now() + durationSeconds * 1000) : null;

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

    logUserBan(
      { userId: actorId, username: actorUsername, ip: req.ip || '' },
      targetUserId, targetUsername, parseInt(channelId), reason, expiresAt
    );

    await publishMessage(`chat:${channelId}`, {
      type: 'user_banned', channelId: parseInt(channelId), userId: targetUserId,
      username: targetUsername, isPermanent: !durationSeconds,
      duration: durationSeconds, reason: reason || 'No reason provided'
    });

    logger.info({ actor_id: actorId, target_user_id: targetUserId, channel_id: channelId, is_permanent: !durationSeconds }, 'User banned');

    res.json({ success: true, ban: { userId: targetUserId, channelId: parseInt(channelId), expiresAt, isPermanent: !durationSeconds } });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Ban user error');
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

/**
 * Unbans a user from a channel.
 *
 * Removes the ban record for the target user, allowing them to participate
 * in chat again. Broadcasts the unban event to all connected clients.
 *
 * @description DELETE /api/moderation/:channelId/ban/:userId - Unban a user
 * @param req.params.channelId - The channel to unban the user from
 * @param req.params.userId - The user ID to unban
 * @returns JSON with success status
 * @throws 401 if not authenticated
 * @throws 403 if not authorized to moderate this channel
 * @throws 404 if no ban exists for this user
 * @throws 500 on database or server error
 *
 * @example
 * DELETE /api/moderation/123/ban/456
 */
router.delete('/:userId', async (req: Request<UserBanParams>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId, userId: targetUserId } = req.params;
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    const result = await query('DELETE FROM channel_bans WHERE channel_id = $1 AND user_id = $2 RETURNING *', [channelId, targetUserId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ban not found' });
      return;
    }

    const [actorUsername, targetUsername] = await Promise.all([
      getUsername(actorId),
      getUsername(parseInt(targetUserId))
    ]);

    logUserUnban(
      { userId: actorId, username: actorUsername, ip: req.ip || '' },
      parseInt(targetUserId), targetUsername, parseInt(channelId)
    );

    await publishMessage(`chat:${channelId}`, {
      type: 'user_unbanned', channelId: parseInt(channelId),
      userId: parseInt(targetUserId), username: targetUsername
    });

    logger.info({ actor_id: actorId, target_user_id: targetUserId, channel_id: channelId }, 'User unbanned');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Unban user error');
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

/**
 * Gets the list of banned users for a channel.
 *
 * Returns all active bans with user details and ban metadata.
 * Only moderators, channel owners, and admins can view the ban list.
 *
 * @description GET /api/moderation/:channelId/bans - Get banned users list
 * @param req.params.channelId - The channel to get bans for
 * @returns JSON with array of ban records including user info
 * @throws 401 if not authenticated
 * @throws 403 if not authorized to moderate this channel
 * @throws 500 on database or server error
 *
 * @example
 * GET /api/moderation/123/bans
 * // Response:
 * {
 *   "bans": [
 *     {
 *       "userId": 456,
 *       "username": "spammer",
 *       "reason": "Spam",
 *       "isPermanent": true,
 *       "createdAt": "2024-01-15T10:30:00Z"
 *     }
 *   ]
 * }
 */
router.get('s', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId } = req.params;
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    const result = await query<BanRow>(`
      SELECT cb.user_id, cb.reason, cb.expires_at, cb.created_at,
             u.username, u.display_name, u.avatar_url, bu.username as banned_by_username
      FROM channel_bans cb
      JOIN users u ON cb.user_id = u.id
      LEFT JOIN users bu ON cb.banned_by = bu.id
      WHERE cb.channel_id = $1
      ORDER BY cb.created_at DESC
    `, [channelId]);

    res.json({
      bans: result.rows.map((row) => ({
        userId: row.user_id, username: row.username, displayName: row.display_name,
        avatarUrl: row.avatar_url, reason: row.reason, expiresAt: row.expires_at,
        createdAt: row.created_at, bannedByUsername: row.banned_by_username, isPermanent: !row.expires_at
      }))
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Get bans error');
    res.status(500).json({ error: 'Failed to get bans' });
  }
});

export default router;
