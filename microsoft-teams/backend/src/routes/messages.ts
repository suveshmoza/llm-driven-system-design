import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { messageLimiter } from '../services/rateLimiter.js';
import { messagesTotal } from '../services/metrics.js';
import {
  getChannelMessages,
  getThreadMessages,
  createMessage,
  editMessage,
  deleteMessage,
  getMessageReactions,
} from '../services/messageService.js';
import { publishToChannel } from '../services/pubsub.js';

const router = Router();

// GET /api/messages?channelId=xxx&before=xxx&limit=50 - get channel messages
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { channelId, before, limit } = req.query;

    if (!channelId) {
      res.status(400).json({ error: 'channelId query parameter is required' });
      return;
    }

    const messages = await getChannelMessages(
      channelId as string,
      parseInt(limit as string) || 50,
      before as string | undefined,
    );

    // Fetch reactions for all messages
    const messageIds = messages.map((m) => m.id);
    const reactions = await getMessageReactions(messageIds);

    const messagesWithReactions = messages.map((m) => ({
      ...m,
      reactions: reactions[m.id] || [],
    }));

    res.json({ messages: messagesWithReactions });
  } catch (err) {
    logger.error({ err }, 'Failed to get messages');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/messages/:messageId/thread - get thread messages
router.get('/:messageId/thread', requireAuth, async (req: Request, res: Response) => {
  try {
    const messages = await getThreadMessages(req.params.messageId);

    const messageIds = messages.map((m) => m.id);
    const reactions = await getMessageReactions(messageIds);

    const messagesWithReactions = messages.map((m) => ({
      ...m,
      reactions: reactions[m.id] || [],
    }));

    res.json({ messages: messagesWithReactions });
  } catch (err) {
    logger.error({ err }, 'Failed to get thread');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/messages - send message
router.post('/', requireAuth, messageLimiter, async (req: Request, res: Response) => {
  try {
    const { channelId, content, parentMessageId } = req.body;

    if (!channelId || !content) {
      res.status(400).json({ error: 'channelId and content are required' });
      return;
    }

    if (content.length > 10000) {
      res.status(400).json({ error: 'Message too long (max 10000 characters)' });
      return;
    }

    const message = await createMessage(
      channelId,
      req.session.userId!,
      content,
      parentMessageId,
    );

    messagesTotal.inc({ channel_id: channelId });

    // Broadcast via pub/sub
    await publishToChannel(channelId, 'new_message', message);

    res.status(201).json({ message });
  } catch (err) {
    logger.error({ err }, 'Failed to send message');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/messages/:messageId - edit message
router.put('/:messageId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const message = await editMessage(req.params.messageId, req.session.userId!, content);

    if (!message) {
      res.status(404).json({ error: 'Message not found or not yours' });
      return;
    }

    // Broadcast edit
    await publishToChannel(message.channel_id, 'message_edited', message);

    res.json({ message });
  } catch (err) {
    logger.error({ err }, 'Failed to edit message');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/messages/:messageId - delete message
router.delete('/:messageId', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteMessage(req.params.messageId, req.session.userId!);

    if (!deleted) {
      res.status(404).json({ error: 'Message not found or not yours' });
      return;
    }

    res.json({ message: 'Message deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete message');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
