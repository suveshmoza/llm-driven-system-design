import { Router, Request, Response } from 'express';
import {
  getMessagesForConversation,
  markConversationAsRead,
} from '../services/messageService.js';
import { isUserInConversation } from '../services/conversationService.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Message routes.
 * Handles fetching messages and marking conversations as read.
 * Message sending happens via WebSocket for real-time delivery.
 */
const router = Router();

/**
 * GET /api/messages/:conversationId
 * Returns messages for a conversation with pagination.
 * Supports cursor-based pagination via 'before' query param.
 */
router.get('/:conversationId', requireAuth, async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.conversationId;
    const limit = parseInt(req.query.limit as string) || 50;
    const beforeId = req.query.before as string | undefined;

    const isParticipant = await isUserInConversation(req.session.userId!, conversationId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    const messages = await getMessagesForConversation(conversationId, limit, beforeId);

    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/messages/:conversationId/read
 * Marks all messages in a conversation as read.
 * Returns the IDs of messages that were marked as read.
 */
router.post('/:conversationId/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.conversationId;

    const isParticipant = await isUserInConversation(req.session.userId!, conversationId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    const messageIds = await markConversationAsRead(conversationId, req.session.userId!);

    res.json({ messageIds });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
