/**
 * Moderation Logs / History - Handles message deletion and chat clearing.
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { logMessageDelete, logChatClear } from '../../utils/audit.js';
import { authenticateRequest, requireModeratorAccess, getUsername } from './helpers.js';
import type { ChannelParams, MessageParams, DeleteMessageBody } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/** Delete a chat message - DELETE /api/moderation/:channelId/message/:messageId */
router.delete('/:messageId', async (req: Request<MessageParams, object, DeleteMessageBody>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId, messageId } = req.params;
    const { reason } = req.body || {};
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    const result = await query(`
      UPDATE chat_messages SET is_deleted = TRUE, deleted_by = $3, deleted_at = NOW()
      WHERE channel_id = $1 AND id = $2
      RETURNING id, user_id, message
    `, [channelId, messageId, actorId]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const actorUsername = await getUsername(actorId);
    logMessageDelete({ userId: actorId, username: actorUsername, ip: req.ip || '' }, messageId, parseInt(channelId), reason);

    await publishMessage(`chat:${channelId}`, { type: 'message_deleted', channelId: parseInt(channelId), messageId });

    logger.info({ actor_id: actorId, message_id: messageId, channel_id: channelId }, 'Message deleted');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Delete message error');
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

/** Clear all chat messages - POST /api/moderation/:channelId/clear */
router.post('/clear', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId } = req.params;
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    await query(`
      UPDATE chat_messages SET is_deleted = TRUE, deleted_by = $2, deleted_at = NOW()
      WHERE channel_id = $1 AND is_deleted = FALSE
    `, [channelId, actorId]);

    const actorUsername = await getUsername(actorId);
    logChatClear({ userId: actorId, username: actorUsername, ip: req.ip || '' }, parseInt(channelId));

    await publishMessage(`chat:${channelId}`, { type: 'chat_cleared', channelId: parseInt(channelId) });

    logger.info({ actor_id: actorId, channel_id: channelId }, 'Chat cleared');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Clear chat error');
    res.status(500).json({ error: 'Failed to clear chat' });
  }
});

export default router;
