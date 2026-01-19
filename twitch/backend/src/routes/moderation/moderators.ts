/**
 * Moderator Management - Handles adding/removing channel moderators.
 *
 * Provides endpoints for:
 * - Adding new moderators to a channel
 * - Removing moderators from a channel
 * - Listing all moderators for a channel
 *
 * Only channel owners and platform admins can manage moderators.
 *
 * @module routes/moderation/moderators
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { logger } from '../../utils/logger.js';
import { logModeratorAdd, logModeratorRemove } from '../../utils/audit.js';
import { authenticateRequest, getUsername } from './helpers.js';
import type { ChannelParams, ModeratorParams, AddModeratorBody, ChannelOwnerRow, RoleRow, ModeratorRow } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/**
 * Checks if the actor is the channel owner or a platform admin.
 *
 * Only owners and admins can add/remove moderators. Regular moderators
 * cannot manage the moderator list.
 *
 * @description Validates owner/admin access for moderator management
 * @param actorId - The numeric ID of the user attempting the action
 * @param channelId - The string ID of the channel
 * @param res - The Express response object for sending error responses
 * @returns Object with isOwner and isAdmin flags, or null if unauthorized
 * @throws Sends 404 if channel not found
 * @throws Sends 403 if user is not owner or admin
 */
async function checkOwnerOrAdmin(actorId: number, channelId: string, res: Response): Promise<{ isOwner: boolean; isAdmin: boolean } | null> {
  const ownerCheck = await query<ChannelOwnerRow>('SELECT user_id FROM channels WHERE id = $1', [channelId]);
  if (!ownerCheck.rows[0]) {
    res.status(404).json({ error: 'Channel not found' });
    return null;
  }
  const isOwner = ownerCheck.rows[0].user_id === actorId;
  const adminCheck = await query<RoleRow>('SELECT role FROM users WHERE id = $1', [actorId]);
  const isAdmin = adminCheck.rows[0]?.role === 'admin';
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'Only channel owner can manage moderators' });
    return null;
  }
  return { isOwner, isAdmin };
}

/**
 * Adds a moderator to a channel.
 *
 * Grants moderator privileges to a user for the specified channel.
 * Only channel owners and platform admins can add moderators.
 * If the user is already a moderator, returns success without error.
 *
 * @description POST /api/moderation/:channelId/moderator - Add a moderator
 * @param req.params.channelId - The channel to add the moderator to
 * @param req.body.userId - The user ID to grant moderator privileges to (required)
 * @returns JSON with success status
 * @throws 400 if userId is missing
 * @throws 401 if not authenticated
 * @throws 403 if not channel owner or admin
 * @throws 404 if channel not found
 * @throws 500 on database or server error
 *
 * @example
 * POST /api/moderation/123/moderator
 * { "userId": 456 }
 */
router.post('/', async (req: Request<ChannelParams, object, AddModeratorBody>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId } = req.params;
    const { userId: targetUserId } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    if (!(await checkOwnerOrAdmin(actorId, channelId, res))) return;

    const existing = await query('SELECT 1 FROM channel_moderators WHERE channel_id = $1 AND user_id = $2', [channelId, targetUserId]);
    if (existing.rows.length > 0) {
      res.json({ success: true, message: 'Already a moderator' });
      return;
    }

    await query('INSERT INTO channel_moderators (channel_id, user_id, added_by) VALUES ($1, $2, $3)', [channelId, targetUserId, actorId]);

    const [actorUsername, targetUsername] = await Promise.all([getUsername(actorId), getUsername(targetUserId)]);
    logModeratorAdd({ userId: actorId, username: actorUsername, ip: req.ip || '' }, targetUserId, targetUsername, parseInt(channelId));

    logger.info({ actor_id: actorId, target_user_id: targetUserId, channel_id: channelId }, 'Moderator added');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Add moderator error');
    res.status(500).json({ error: 'Failed to add moderator' });
  }
});

/**
 * Removes a moderator from a channel.
 *
 * Revokes moderator privileges from a user for the specified channel.
 * Only channel owners and platform admins can remove moderators.
 *
 * @description DELETE /api/moderation/:channelId/moderator/:userId - Remove moderator
 * @param req.params.channelId - The channel to remove the moderator from
 * @param req.params.userId - The user ID to revoke moderator privileges from
 * @returns JSON with success status
 * @throws 401 if not authenticated
 * @throws 403 if not channel owner or admin
 * @throws 404 if channel not found or user is not a moderator
 * @throws 500 on database or server error
 *
 * @example
 * DELETE /api/moderation/123/moderator/456
 */
router.delete('/:userId', async (req: Request<ModeratorParams>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId, userId: targetUserId } = req.params;
    if (!(await checkOwnerOrAdmin(actorId, channelId, res))) return;

    const result = await query('DELETE FROM channel_moderators WHERE channel_id = $1 AND user_id = $2 RETURNING *', [channelId, targetUserId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Moderator not found' });
      return;
    }

    const [actorUsername, targetUsername] = await Promise.all([getUsername(actorId), getUsername(parseInt(targetUserId))]);
    logModeratorRemove({ userId: actorId, username: actorUsername, ip: req.ip || '' }, parseInt(targetUserId), targetUsername, parseInt(channelId));

    logger.info({ actor_id: actorId, target_user_id: targetUserId, channel_id: channelId }, 'Moderator removed');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Remove moderator error');
    res.status(500).json({ error: 'Failed to remove moderator' });
  }
});

/**
 * Gets the list of moderators for a channel.
 *
 * Returns all moderators with user details and when they were added.
 * This endpoint is publicly accessible (no authentication required).
 *
 * @description GET /api/moderation/:channelId/moderators - Get moderator list
 * @param req.params.channelId - The channel to get moderators for
 * @returns JSON with array of moderator records including user info
 * @throws 500 on database or server error
 *
 * @example
 * GET /api/moderation/123/moderators
 * // Response:
 * {
 *   "moderators": [
 *     {
 *       "userId": 456,
 *       "username": "trusted_mod",
 *       "displayName": "Trusted Mod",
 *       "addedAt": "2024-01-10T08:00:00Z",
 *       "addedByUsername": "channel_owner"
 *     }
 *   ]
 * }
 */
router.get('s', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
  try {
    const { channelId } = req.params;
    const result = await query<ModeratorRow>(`
      SELECT cm.user_id, cm.created_at, u.username, u.display_name, u.avatar_url, au.username as added_by_username
      FROM channel_moderators cm
      JOIN users u ON cm.user_id = u.id
      LEFT JOIN users au ON cm.added_by = au.id
      WHERE cm.channel_id = $1
      ORDER BY cm.created_at DESC
    `, [channelId]);

    res.json({
      moderators: result.rows.map((row) => ({
        userId: row.user_id, username: row.username, displayName: row.display_name,
        avatarUrl: row.avatar_url, addedAt: row.created_at, addedByUsername: row.added_by_username
      }))
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Get moderators error');
    res.status(500).json({ error: 'Failed to get moderators' });
  }
});

export default router;
