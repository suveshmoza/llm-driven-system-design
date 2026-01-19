import { Router, Response } from 'express';
import { authenticateRequest, AuthenticatedRequest } from '../middleware/auth.js';
import { isParticipant } from '../services/conversations.js';
import {
  getMessages,
  getMessage,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  markAsRead,
  getReadReceipts,
} from '../services/messages.js';
import { messageRateLimiter } from '../shared/rate-limiter.js';
import { idempotencyMiddleware } from '../shared/idempotency.js';
import { createLogger } from '../shared/logger.js';

const router = Router();
const logger = createLogger('messages-routes');

router.use(authenticateRequest as any);

// Get messages for a conversation
router.get('/conversation/:conversationId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { limit, before, after } = req.query;

    // Verify user is participant
    const isParticipantResult = await isParticipant(conversationId, req.user.id);
    if (!isParticipantResult) {
      res.status(403).json({ error: 'Not a participant of this conversation' });
      return;
    }

    const messages = await getMessages(conversationId, req.user.id, {
      limit: limit ? parseInt(limit as string) : 50,
      before: before as string | undefined,
      after: after as string | undefined,
    });

    res.json({ messages });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Get messages error');
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get a single message
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const message = await getMessage(req.params.id);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // Verify user is participant
    const isParticipantResult = await isParticipant(message.conversation_id, req.user.id);
    if (!isParticipantResult) {
      res.status(403).json({ error: 'Not a participant of this conversation' });
      return;
    }

    res.json({ message });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Get message error');
    res.status(500).json({ error: 'Failed to get message' });
  }
});

// Send a message (REST fallback, WebSocket preferred)
// Rate limited: 60 messages per minute per user
// Supports idempotency via clientMessageId or X-Idempotency-Key header
router.post('/conversation/:conversationId',
  messageRateLimiter,
  idempotencyMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const { content, contentType, replyToId, clientMessageId } = req.body;

      if (!content) {
        res.status(400).json({ error: 'Content is required' });
        return;
      }

      // Verify user is participant
      const isParticipantResult = await isParticipant(conversationId, req.user.id);
      if (!isParticipantResult) {
        res.status(403).json({ error: 'Not a participant of this conversation' });
        return;
      }

      const message = await sendMessage(conversationId, req.user.id, content, {
        contentType,
        replyToId,
        clientMessageId: clientMessageId || req.headers['x-idempotency-key'] as string,
      });

      // Return 200 if duplicate, 201 if new
      const statusCode = message.isDuplicate ? 200 : 201;
      res.status(statusCode).json({
        message,
        isDuplicate: message.isDuplicate || false,
      });
    } catch (error) {
      logger.error({ error, userId: req.user?.id }, 'Send message error');
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

// Edit a message
router.patch('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { content } = req.body;

    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const message = await editMessage(req.params.id, req.user.id, content);
    res.json({ message });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Edit message error');
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete a message
router.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await deleteMessage(req.params.id, req.user.id);
    res.json({ message: 'Message deleted' });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Delete message error');
    if ((error as Error).message.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Add reaction
router.post('/:id/reactions', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { reaction } = req.body;

    if (!reaction) {
      res.status(400).json({ error: 'Reaction is required' });
      return;
    }

    const result = await addReaction(req.params.id, req.user.id, reaction);
    res.status(201).json(result);
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Add reaction error');
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// Remove reaction
router.delete('/:id/reactions/:reaction', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await removeReaction(req.params.id, req.user.id, req.params.reaction);
    res.json({ message: 'Reaction removed' });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Remove reaction error');
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

// Mark as read
router.post('/conversation/:conversationId/read', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { messageId } = req.body;

    if (!messageId) {
      res.status(400).json({ error: 'Message ID is required' });
      return;
    }

    // Verify user is participant
    const isParticipantResult = await isParticipant(conversationId, req.user.id);
    if (!isParticipantResult) {
      res.status(403).json({ error: 'Not a participant of this conversation' });
      return;
    }

    await markAsRead(conversationId, req.user.id, req.deviceId, messageId);
    res.json({ message: 'Marked as read' });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Mark as read error');
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Get read receipts for a conversation
router.get('/conversation/:conversationId/read-receipts', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;

    // Verify user is participant
    const isParticipantResult = await isParticipant(conversationId, req.user.id);
    if (!isParticipantResult) {
      res.status(403).json({ error: 'Not a participant of this conversation' });
      return;
    }

    const receipts = await getReadReceipts(conversationId);
    res.json({ receipts });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Get read receipts error');
    res.status(500).json({ error: 'Failed to get read receipts' });
  }
});

export default router;
