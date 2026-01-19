/**
 * Ban/Unban Operations - Handles permanent bans and ban listing for channels.
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logUserBan, logUserUnban } from '../../utils/audit.js';
import { authenticateRequest, requireModeratorAccess, getUsername } from './helpers.js';
import type { ChannelParams, UserBanParams, BanBody, ChannelOwnerRow, BanRow } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/** Ban a user from a channel - POST /api/moderation/:channelId/ban */
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

/** Unban a user from a channel - DELETE /api/moderation/:channelId/ban/:userId */
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

/** Get banned users for a channel - GET /api/moderation/:channelId/bans */
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
