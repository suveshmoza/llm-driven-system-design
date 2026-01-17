/**
 * User Routes Module
 *
 * Express router handling HTTP endpoints for user operations.
 * Provides REST API for user CRUD and ban management.
 *
 * @module routes/users
 */

import { Router, Request, Response } from 'express';
import { userService } from '../services/userService.js';

/** Express router for user-related endpoints */
const router = Router();

/**
 * GET /api/users
 * Retrieves all users in the system.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const users = await userService.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/users/:userId
 * Retrieves a single user by ID.
 */
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const user = await userService.getUser(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * POST /api/users
 * Creates a new user account.
 * Body: { username: string, display_name: string, avatar_url?: string }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { username, display_name, avatar_url } = req.body;
    if (!username || !display_name) {
      return res.status(400).json({ error: 'username and display_name are required' });
    }
    const user = await userService.createUser(username, display_name, avatar_url);
    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * POST /api/users/:userId/ban
 * Bans a user globally or from a specific stream.
 * Body: { banned_by: string, reason?: string, stream_id?: string, expires_at?: string }
 */
router.post('/:userId/ban', async (req: Request, res: Response) => {
  try {
    const { banned_by, reason, stream_id, expires_at } = req.body;
    if (!banned_by) {
      return res.status(400).json({ error: 'banned_by is required' });
    }
    await userService.banUser(
      req.params.userId,
      banned_by,
      reason,
      stream_id,
      expires_at ? new Date(expires_at) : undefined
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error banning user:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

/**
 * DELETE /api/users/:userId/ban
 * Removes a ban from a user.
 * Query params: stream_id (optional, for stream-specific unban)
 */
router.delete('/:userId/ban', async (req: Request, res: Response) => {
  try {
    const { stream_id } = req.query;
    await userService.unbanUser(req.params.userId, stream_id as string);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unbanning user:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

export default router;
