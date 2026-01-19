/**
 * Moderator Management
 *
 * Handles adding/removing channel moderators and listing moderators.
 */

import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { getSession } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logModeratorAdd, logModeratorRemove } from '../../utils/audit.js';
import { getUsername } from './helpers.js';
import type {
  ChannelParams,
  ModeratorParams,
  AddModeratorBody,
  ChannelOwnerRow,
  RoleRow,
  ModeratorRow
} from './types.js';

const router: Router = express.Router({ mergeParams: true });

/**
 * Add a moderator to a channel
 * POST /api/moderation/:channelId/moderator
 */
router.post(
  '/',
  async (
    req: Request<ChannelParams, object, AddModeratorBody>,
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
      const { userId: targetUserId } = req.body;

      if (!targetUserId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      // Only channel owner or admin can add moderators
      const ownerCheck = await query<ChannelOwnerRow>(
        'SELECT user_id FROM channels WHERE id = $1',
        [channelId]
      );

      if (!ownerCheck.rows[0]) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const isOwner = ownerCheck.rows[0].user_id === actorId;
      const adminCheck = await query<RoleRow>(
        'SELECT role FROM users WHERE id = $1',
        [actorId]
      );
      const isAdmin = adminCheck.rows[0]?.role === 'admin';

      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: 'Only channel owner can add moderators' });
        return;
      }

      // Check if already a moderator
      const existing = await query(
        'SELECT 1 FROM channel_moderators WHERE channel_id = $1 AND user_id = $2',
        [channelId, targetUserId]
      );

      if (existing.rows.length > 0) {
        res.json({ success: true, message: 'Already a moderator' });
        return;
      }

      // Add moderator
      await query(
        'INSERT INTO channel_moderators (channel_id, user_id, added_by) VALUES ($1, $2, $3)',
        [channelId, targetUserId, actorId]
      );

      // Get usernames for audit log
      const actorUsername = await getUsername(actorId);
      const targetUsername = await getUsername(targetUserId);

      // Log audit event
      logModeratorAdd(
        { userId: actorId, username: actorUsername, ip: req.ip || '' },
        targetUserId,
        targetUsername,
        parseInt(channelId)
      );

      logger.info(
        {
          actor_id: actorId,
          target_user_id: targetUserId,
          channel_id: channelId
        },
        'Moderator added'
      );

      res.json({ success: true });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Add moderator error');
      res.status(500).json({ error: 'Failed to add moderator' });
    }
  }
);

/**
 * Remove a moderator from a channel
 * DELETE /api/moderation/:channelId/moderator/:userId
 */
router.delete(
  '/:userId',
  async (req: Request<ModeratorParams>, res: Response): Promise<void> => {
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

      // Only channel owner or admin can remove moderators
      const ownerCheck = await query<ChannelOwnerRow>(
        'SELECT user_id FROM channels WHERE id = $1',
        [channelId]
      );

      const isOwner = ownerCheck.rows[0]?.user_id === actorId;
      const adminCheck = await query<RoleRow>(
        'SELECT role FROM users WHERE id = $1',
        [actorId]
      );
      const isAdmin = adminCheck.rows[0]?.role === 'admin';

      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: 'Only channel owner can remove moderators' });
        return;
      }

      // Remove moderator
      const result = await query(
        'DELETE FROM channel_moderators WHERE channel_id = $1 AND user_id = $2 RETURNING *',
        [channelId, targetUserId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Moderator not found' });
        return;
      }

      // Get usernames for audit log
      const actorUsername = await getUsername(actorId);
      const targetUsername = await getUsername(parseInt(targetUserId));

      // Log audit event
      logModeratorRemove(
        { userId: actorId, username: actorUsername, ip: req.ip || '' },
        parseInt(targetUserId),
        targetUsername,
        parseInt(channelId)
      );

      logger.info(
        {
          actor_id: actorId,
          target_user_id: targetUserId,
          channel_id: channelId
        },
        'Moderator removed'
      );

      res.json({ success: true });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Remove moderator error');
      res.status(500).json({ error: 'Failed to remove moderator' });
    }
  }
);

/**
 * Get moderators for a channel
 * GET /api/moderation/:channelId/moderators
 */
router.get(
  's',
  async (req: Request<ChannelParams>, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;

      const result = await query<ModeratorRow>(
        `
        SELECT cm.user_id, cm.created_at,
               u.username, u.display_name, u.avatar_url,
               au.username as added_by_username
        FROM channel_moderators cm
        JOIN users u ON cm.user_id = u.id
        LEFT JOIN users au ON cm.added_by = au.id
        WHERE cm.channel_id = $1
        ORDER BY cm.created_at DESC
      `,
        [channelId]
      );

      res.json({
        moderators: result.rows.map((row) => ({
          userId: row.user_id,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          addedAt: row.created_at,
          addedByUsername: row.added_by_username
        }))
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Get moderators error');
      res.status(500).json({ error: 'Failed to get moderators' });
    }
  }
);

export default router;
