/**
 * Timeout Operations - Handles temporary bans (timeouts) for channels.
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logUserTimeout } from '../../utils/audit.js';
import { authenticateRequest, requireModeratorAccess, getUsername } from './helpers.js';
import type { ChannelParams, TimeoutBody, ChannelOwnerRow, UserBanParams } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/** Timeout a user in a channel - POST /api/moderation/:channelId/timeout */
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

/** Remove a timeout - DELETE /api/moderation/:channelId/timeout/:userId */
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
