/**
 * Timeout Operations
 *
 * Handles temporary bans (timeouts) for channels.
 * Timeouts are temporary restrictions that expire after a specified duration.
 */

import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { getSession, publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logUserTimeout } from '../../utils/audit.js';
import { checkModeratorAccess, getUsername } from './helpers.js';
import type { ChannelParams, TimeoutBody, ChannelOwnerRow } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/**
 * Timeout a user in a channel (temporary ban)
 * POST /api/moderation/:channelId/timeout
 */
router.post(
  '/',
  async (
    req: Request<ChannelParams, object, TimeoutBody>,
    res: Response
  ): Promise<void> => {
    try {
      const sessionId = req.cookies.session as string | undefined;
      if (!sessionId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const actorId = await getSession(sessionId);
      if (!actorId) {
        res.status(401).json({ error: 'Session expired' });
        return;
      }

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

      // Check moderator access
      const { hasAccess } = await checkModeratorAccess(actorId, channelId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Not authorized to moderate this channel' });
        return;
      }

      // Cannot timeout the channel owner
      const channelOwner = await query<ChannelOwnerRow>(
        'SELECT user_id FROM channels WHERE id = $1',
        [channelId]
      );
      if (channelOwner.rows[0]?.user_id === targetUserId) {
        res.status(400).json({ error: 'Cannot timeout channel owner' });
        return;
      }

      // Calculate expiration
      const expiresAt = new Date(Date.now() + durationSeconds * 1000);

      // Create or update timeout (stored as ban with expiration)
      await query(
        `
        INSERT INTO channel_bans (channel_id, user_id, banned_by, reason, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (channel_id, user_id)
        DO UPDATE SET banned_by = $3, reason = $4, expires_at = $5, created_at = NOW()
      `,
        [channelId, targetUserId, actorId, reason || null, expiresAt]
      );

      // Get usernames for audit log
      const actorUsername = await getUsername(actorId);
      const targetUsername = await getUsername(targetUserId);

      // Log audit event
      logUserTimeout(
        { userId: actorId, username: actorUsername, ip: req.ip || '' },
        targetUserId,
        targetUsername,
        parseInt(channelId),
        durationSeconds,
        reason
      );

      // Notify chat of timeout
      await publishMessage(`chat:${channelId}`, {
        type: 'user_timeout',
        channelId: parseInt(channelId),
        userId: targetUserId,
        username: targetUsername,
        duration: durationSeconds,
        expiresAt: expiresAt.toISOString(),
        reason: reason || 'No reason provided'
      });

      logger.info(
        {
          actor_id: actorId,
          target_user_id: targetUserId,
          channel_id: channelId,
          duration_seconds: durationSeconds
        },
        'User timed out from channel'
      );

      res.json({
        success: true,
        timeout: {
          userId: targetUserId,
          channelId: parseInt(channelId),
          durationSeconds,
          expiresAt
        }
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Timeout user error');
      res.status(500).json({ error: 'Failed to timeout user' });
    }
  }
);

/**
 * Remove a timeout (untimeout a user)
 * DELETE /api/moderation/:channelId/timeout/:userId
 */
router.delete(
  '/:userId',
  async (req: Request<ChannelParams & { userId: string }>, res: Response): Promise<void> => {
    try {
      const sessionId = req.cookies.session as string | undefined;
      if (!sessionId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const actorId = await getSession(sessionId);
      if (!actorId) {
        res.status(401).json({ error: 'Session expired' });
        return;
      }

      const { channelId, userId: targetUserId } = req.params;

      // Check moderator access
      const { hasAccess } = await checkModeratorAccess(actorId, channelId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Not authorized to moderate this channel' });
        return;
      }

      // Remove timeout (only if it has an expiration)
      const result = await query(
        `DELETE FROM channel_bans
         WHERE channel_id = $1 AND user_id = $2 AND expires_at IS NOT NULL
         RETURNING *`,
        [channelId, targetUserId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Timeout not found' });
        return;
      }

      const targetUsername = await getUsername(parseInt(targetUserId));

      // Notify chat of untimeout
      await publishMessage(`chat:${channelId}`, {
        type: 'user_untimeout',
        channelId: parseInt(channelId),
        userId: parseInt(targetUserId),
        username: targetUsername
      });

      logger.info(
        {
          actor_id: actorId,
          target_user_id: targetUserId,
          channel_id: channelId
        },
        'User timeout removed'
      );

      res.json({ success: true });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Remove timeout error');
      res.status(500).json({ error: 'Failed to remove timeout' });
    }
  }
);

export default router;
