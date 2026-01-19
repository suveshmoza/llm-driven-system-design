/**
 * Moderation Logs / History
 *
 * Handles message deletion, chat clearing, and moderation history.
 */

import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { getSession, publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logMessageDelete, logChatClear } from '../../utils/audit.js';
import { checkModeratorAccess, getUsername } from './helpers.js';
import type { ChannelParams, MessageParams, DeleteMessageBody } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/**
 * Delete a chat message
 * DELETE /api/moderation/:channelId/message/:messageId
 */
router.delete(
  '/:messageId',
  async (
    req: Request<MessageParams, object, DeleteMessageBody>,
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

      const { channelId, messageId } = req.params;
      const { reason } = req.body || {};

      // Check moderator access
      const { hasAccess } = await checkModeratorAccess(actorId, channelId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Not authorized to moderate this channel' });
        return;
      }

      // Mark message as deleted (soft delete for audit trail)
      const result = await query(
        `
        UPDATE chat_messages
        SET is_deleted = TRUE, deleted_by = $3, deleted_at = NOW()
        WHERE channel_id = $1 AND id = $2
        RETURNING id, user_id, message
      `,
        [channelId, messageId, actorId]
      );

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

      logger.info(
        {
          actor_id: actorId,
          message_id: messageId,
          channel_id: channelId
        },
        'Message deleted'
      );

      res.json({ success: true });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Delete message error');
      res.status(500).json({ error: 'Failed to delete message' });
    }
  }
);

/**
 * Clear all chat messages
 * POST /api/moderation/:channelId/clear
 */
router.post(
  '/clear',
  async (req: Request<ChannelParams>, res: Response): Promise<void> => {
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
      await query(
        `
        UPDATE chat_messages
        SET is_deleted = TRUE, deleted_by = $2, deleted_at = NOW()
        WHERE channel_id = $1 AND is_deleted = FALSE
      `,
        [channelId, actorId]
      );

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

      logger.info(
        { actor_id: actorId, channel_id: channelId },
        'Chat cleared'
      );

      res.json({ success: true });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Clear chat error');
      res.status(500).json({ error: 'Failed to clear chat' });
    }
  }
);

export default router;
