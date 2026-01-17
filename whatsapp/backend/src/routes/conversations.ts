import { Router, Request, Response } from 'express';
import {
  createDirectConversation,
  createGroupConversation,
  getConversationsForUser,
  getConversationById,
  getConversationParticipants,
  isUserInConversation,
  addUserToGroup,
  removeUserFromGroup,
} from '../services/conversationService.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Conversation management routes.
 * Handles creating, listing, and managing conversations and group memberships.
 */
const router = Router();

/**
 * GET /api/conversations
 * Returns all conversations for the authenticated user.
 * Includes participants, last message, and unread counts.
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const conversations = await getConversationsForUser(req.session.userId!);
    res.json({ conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/conversations/direct
 * Creates a 1:1 conversation with another user.
 * Returns existing conversation if one already exists.
 */
router.post('/direct', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (userId === req.session.userId) {
      return res.status(400).json({ error: 'Cannot create conversation with yourself' });
    }

    const conversation = await createDirectConversation(req.session.userId!, userId);
    const participants = await getConversationParticipants(conversation.id);

    res.status(201).json({
      conversation: {
        ...conversation,
        participants,
      },
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/conversations/group
 * Creates a new group conversation.
 * Creator becomes admin, other members are regular participants.
 */
router.post('/group', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, memberIds } = req.body;

    if (!name || !memberIds || !Array.isArray(memberIds)) {
      return res.status(400).json({ error: 'Name and member IDs required' });
    }

    if (memberIds.length < 1) {
      return res.status(400).json({ error: 'At least one other member required' });
    }

    const conversation = await createGroupConversation(name, req.session.userId!, memberIds);
    const participants = await getConversationParticipants(conversation.id);

    res.status(201).json({
      conversation: {
        ...conversation,
        participants,
      },
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/conversations/:id
 * Returns a specific conversation with participants.
 * User must be a participant to access.
 */
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;

    const isParticipant = await isUserInConversation(req.session.userId!, conversationId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const participants = await getConversationParticipants(conversationId);

    res.json({
      conversation: {
        ...conversation,
        participants,
      },
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/conversations/:id/members
 * Adds a new member to a group conversation.
 * Requester must be a participant in the group.
 */
router.post('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const conversation = await getConversationById(conversationId);
    if (!conversation || !conversation.is_group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isParticipant = await isUserInConversation(req.session.userId!, conversationId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this group' });
    }

    await addUserToGroup(conversationId, userId);
    const participants = await getConversationParticipants(conversationId);

    res.json({
      conversation: {
        ...conversation,
        participants,
      },
    });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/conversations/:id/members/:userId
 * Removes a member from a group conversation.
 * Requester must be a participant in the group.
 */
router.delete('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;
    const userIdToRemove = req.params.userId;

    const conversation = await getConversationById(conversationId);
    if (!conversation || !conversation.is_group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isParticipant = await isUserInConversation(req.session.userId!, conversationId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this group' });
    }

    await removeUserFromGroup(conversationId, userIdToRemove);

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
