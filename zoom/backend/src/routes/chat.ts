import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import * as chatService from '../services/chatService.js';

const router = Router();

// Get chat messages for a meeting
router.get('/:meetingId/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const messages = await chatService.getMessages(req.params.meetingId, limit);
    res.json({ messages });
  } catch (err) {
    logger.error({ err }, 'Get chat messages error');
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send a chat message
router.post('/:meetingId/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const { content, recipientId } = req.body;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const message = await chatService.saveMessage(
      req.params.meetingId,
      req.session.userId!,
      content,
      recipientId
    );
    res.status(201).json({ message });
  } catch (err) {
    logger.error({ err }, 'Send chat message error');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
