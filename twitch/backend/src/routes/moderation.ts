/**
 * Moderation Routes
 *
 * Handles all moderation actions with comprehensive audit logging:
 * - Ban/timeout users
 * - Delete messages
 * - Add/remove moderators
 * - Clear chat
 *
 * All actions are logged for:
 * - User appeal handling
 * - Abuse investigation
 * - Platform transparency
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../services/database.js';
import { getSession, publishMessage } from '../services/redis.js';
import { logger } from '../utils/logger.js';
import {
  logUserBan,
  logUserUnban,
  logUserTimeout,
  logMessageDelete,
  logChatClear,
  logModeratorAdd,
  logModeratorRemove
} from '../utils/audit.js';

const router: Router = express.Router();

interface ModeratorAccessResult {
  hasAccess: boolean;
  role: string | null;
}

interface ChannelParams {
  channelId: string;
}

interface UserBanParams extends ChannelParams {
  userId: string;
}

interface MessageParams extends ChannelParams {
  messageId: string;
}

interface ModeratorParams extends ChannelParams {
  userId: string;
}

interface BanBody {
  userId?: number;
  reason?: string;
  durationSeconds?: number;
}

interface DeleteMessageBody {
  reason?: string;
}

interface AddModeratorBody {
  userId?: number;
}

interface UserRow {
  username: string;
}

interface ChannelOwnerRow {
  user_id: number;
}

interface RoleRow {
  role: string;
}

interface BanRow {
  user_id: number;
  reason: string | null;
  expires_at: Date | null;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banned_by_username: string | null;
}

interface ModeratorRow {
  user_id: number;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
  added_by_username: string | null;
}

/**
 * Helper to check if user is moderator or owner of channel
 */
async function checkModeratorAccess(userId: number, channelId: string): Promise<ModeratorAccessResult> {
  // Check if channel owner
  const ownerCheck = await query(
    'SELECT 1 FROM channels WHERE id = $1 AND user_id = $2',
    [channelId, userId]
  );
  if (ownerCheck.rows.length > 0) {
    return { hasAccess: true, role: 'owner' };
  }

  // Check if moderator
  const modCheck = await query(
    'SELECT 1 FROM channel_moderators WHERE channel_id = $1 AND user_id = $2',
    [channelId, userId]
  );
  if (modCheck.rows.length > 0) {
    return { hasAccess: true, role: 'moderator' };
  }

  // Check if admin
  const adminCheck = await query<RoleRow>(
    'SELECT role FROM users WHERE id = $1',
    [userId]
  );
  if (adminCheck.rows[0]?.role === 'admin') {
    return { hasAccess: true, role: 'admin' };
  }

  return { hasAccess: false, role: null };
}

/**
 * Helper to get username from user ID
 */
async function getUsername(userId: number): Promise<string> {
  const result = await query<UserRow>('SELECT username FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.username || 'unknown';
}

// ===================
// Ban Management
// ===================

/**
 * Ban a user from a channel
 * POST /api/moderation/:channelId/ban
 */
router.post('/:channelId/ban', async (req: Request<ChannelParams, object, BanBody>, res: Response): Promise<void> => {
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
    const { userId: targetUserId, reason, durationSeconds } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    // Check moderator access
    const { hasAccess } = await checkModeratorAccess(actorId, channelId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Not authorized to moderate this channel' });
      return;
    }

    // Cannot ban the channel owner
    const channelOwner = await query<ChannelOwnerRow>('SELECT user_id FROM channels WHERE id = $1', [channelId]);
    if (channelOwner.rows[0]?.user_id === targetUserId) {
      res.status(400).json({ error: 'Cannot ban channel owner' });
      return;
    }

    // Calculate expiration
    const expiresAt = durationSeconds
      ? new Date(Date.now() + durationSeconds * 1000)
      : null;

    // Create or update ban
    await query(`
      INSERT INTO channel_bans (channel_id, user_id, banned_by, reason, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (channel_id, user_id)
      DO UPDATE SET banned_by = $3, reason = $4, expires_at = $5, created_at = NOW()
    `, [channelId, targetUserId, actorId, reason || null, expiresAt]);

    // Get usernames for audit log
    const actorUsername = await getUsername(actorId);
    const targetUsername = await getUsername(targetUserId);

    // Log audit event
    if (durationSeconds) {
      logUserTimeout(
        { userId: actorId, username: actorUsername, ip: req.ip || '' },
        targetUserId,
        targetUsername,
        parseInt(channelId),
        durationSeconds,
        reason
      );
    } else {
      logUserBan(
        { userId: actorId, username: actorUsername, ip: req.ip || '' },
        targetUserId,
        targetUsername,
        parseInt(channelId),
        reason,
        expiresAt
      );
    }

    // Notify chat of ban (so UI can update)
    await publishMessage(`chat:${channelId}`, {
      type: 'user_banned',
      channelId: parseInt(channelId),
      userId: targetUserId,
      username: targetUsername,
      isPermanent: !durationSeconds,
      duration: durationSeconds,
      reason: reason || 'No reason provided'
    });

    logger.info({
      actor_id: actorId,
      target_user_id: targetUserId,
      channel_id: channelId,
      is_permanent: !durationSeconds
    }, 'User banned from channel');

    res.json({
      success: true,
      ban: {
        userId: targetUserId,
        channelId: parseInt(channelId),
        expiresAt,
        isPermanent: !durationSeconds
      }
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Ban user error');
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

/**
 * Unban a user from a channel
 * DELETE /api/moderation/:channelId/ban/:userId
 */
router.delete('/:channelId/ban/:userId', async (req: Request<UserBanParams>, res: Response): Promise<void> => {
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

    // Remove ban
    const result = await query(
      'DELETE FROM channel_bans WHERE channel_id = $1 AND user_id = $2 RETURNING *',
      [channelId, targetUserId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ban not found' });
      return;
    }

    // Get usernames for audit log
    const actorUsername = await getUsername(actorId);
    const targetUsername = await getUsername(parseInt(targetUserId));

    // Log audit event
    logUserUnban(
      { userId: actorId, username: actorUsername, ip: req.ip || '' },
      parseInt(targetUserId),
      targetUsername,
      parseInt(channelId)
    );

    // Notify chat of unban
    await publishMessage(`chat:${channelId}`, {
      type: 'user_unbanned',
      channelId: parseInt(channelId),
      userId: parseInt(targetUserId),
      username: targetUsername
    });

    logger.info({
      actor_id: actorId,
      target_user_id: targetUserId,
      channel_id: channelId
    }, 'User unbanned from channel');

    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Unban user error');
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

/**
 * Get banned users for a channel
 * GET /api/moderation/:channelId/bans
 */
router.get('/:channelId/bans', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
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

    // Check moderator access
    const { hasAccess } = await checkModeratorAccess(actorId, channelId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Not authorized to moderate this channel' });
      return;
    }

    const result = await query<BanRow>(`
      SELECT cb.user_id, cb.reason, cb.expires_at, cb.created_at,
             u.username, u.display_name, u.avatar_url,
             bu.username as banned_by_username
      FROM channel_bans cb
      JOIN users u ON cb.user_id = u.id
      LEFT JOIN users bu ON cb.banned_by = bu.id
      WHERE cb.channel_id = $1
      ORDER BY cb.created_at DESC
    `, [channelId]);

    res.json({
      bans: result.rows.map(row => ({
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        reason: row.reason,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        bannedByUsername: row.banned_by_username,
        isPermanent: !row.expires_at
      }))
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Get bans error');
    res.status(500).json({ error: 'Failed to get bans' });
  }
});

// ===================
// Message Moderation
// ===================

/**
 * Delete a chat message
 * DELETE /api/moderation/:channelId/message/:messageId
 */
router.delete('/:channelId/message/:messageId', async (req: Request<MessageParams, object, DeleteMessageBody>, res: Response): Promise<void> => {
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

    const { channelId, messageId } = req.params;
    const { reason } = req.body || {};

    // Check moderator access
    const { hasAccess } = await checkModeratorAccess(actorId, channelId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Not authorized to moderate this channel' });
      return;
    }

    // Mark message as deleted (soft delete for audit trail)
    const result = await query(`
      UPDATE chat_messages
      SET is_deleted = TRUE, deleted_by = $3, deleted_at = NOW()
      WHERE channel_id = $1 AND id = $2
      RETURNING id, user_id, message
    `, [channelId, messageId, actorId]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // Get actor username for audit log
    const actorUsername = await getUsername(actorId);

    // Log audit event
    logMessageDelete(
      { userId: actorId, username: actorUsername, ip: req.ip || '' },
      messageId,
      parseInt(channelId),
      reason
    );

    // Notify chat to remove message
    await publishMessage(`chat:${channelId}`, {
      type: 'message_deleted',
      channelId: parseInt(channelId),
      messageId: messageId
    });

    logger.info({
      actor_id: actorId,
      message_id: messageId,
      channel_id: channelId
    }, 'Message deleted');

    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Delete message error');
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

/**
 * Clear all chat messages
 * POST /api/moderation/:channelId/clear
 */
router.post('/:channelId/clear', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
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

    // Check moderator access
    const { hasAccess } = await checkModeratorAccess(actorId, channelId);
    if (!hasAccess) {
      res.status(403).json({ error: 'Not authorized to moderate this channel' });
      return;
    }

    // Mark all recent messages as deleted
    await query(`
      UPDATE chat_messages
      SET is_deleted = TRUE, deleted_by = $2, deleted_at = NOW()
      WHERE channel_id = $1 AND is_deleted = FALSE
    `, [channelId, actorId]);

    // Get actor username for audit log
    const actorUsername = await getUsername(actorId);

    // Log audit event
    logChatClear(
      { userId: actorId, username: actorUsername, ip: req.ip || '' },
      parseInt(channelId)
    );

    // Notify chat to clear
    await publishMessage(`chat:${channelId}`, {
      type: 'chat_cleared',
      channelId: parseInt(channelId)
    });

    logger.info({
      actor_id: actorId,
      channel_id: channelId
    }, 'Chat cleared');

    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Clear chat error');
    res.status(500).json({ error: 'Failed to clear chat' });
  }
});

// ===================
// Moderator Management
// ===================

/**
 * Add a moderator to a channel
 * POST /api/moderation/:channelId/moderator
 */
router.post('/:channelId/moderator', async (req: Request<ChannelParams, object, AddModeratorBody>, res: Response): Promise<void> => {
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
    const adminCheck = await query<RoleRow>('SELECT role FROM users WHERE id = $1', [actorId]);
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

    logger.info({
      actor_id: actorId,
      target_user_id: targetUserId,
      channel_id: channelId
    }, 'Moderator added');

    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Add moderator error');
    res.status(500).json({ error: 'Failed to add moderator' });
  }
});

/**
 * Remove a moderator from a channel
 * DELETE /api/moderation/:channelId/moderator/:userId
 */
router.delete('/:channelId/moderator/:userId', async (req: Request<ModeratorParams>, res: Response): Promise<void> => {
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
    const adminCheck = await query<RoleRow>('SELECT role FROM users WHERE id = $1', [actorId]);
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

    logger.info({
      actor_id: actorId,
      target_user_id: targetUserId,
      channel_id: channelId
    }, 'Moderator removed');

    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Remove moderator error');
    res.status(500).json({ error: 'Failed to remove moderator' });
  }
});

/**
 * Get moderators for a channel
 * GET /api/moderation/:channelId/moderators
 */
router.get('/:channelId/moderators', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
  try {
    const { channelId } = req.params;

    const result = await query<ModeratorRow>(`
      SELECT cm.user_id, cm.created_at,
             u.username, u.display_name, u.avatar_url,
             au.username as added_by_username
      FROM channel_moderators cm
      JOIN users u ON cm.user_id = u.id
      LEFT JOIN users au ON cm.added_by = au.id
      WHERE cm.channel_id = $1
      ORDER BY cm.created_at DESC
    `, [channelId]);

    res.json({
      moderators: result.rows.map(row => ({
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
});

export default router;
