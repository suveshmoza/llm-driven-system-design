import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import {
  listAuthUsers,
  getAuthUser,
  createAuthUser,
  updateAuthUser,
  deleteAuthUser,
} from '../services/authUserService.js';

const router = Router();

// GET /api/projects/:projectId/auth-users
router.get('/:projectId/auth-users', requireAuth, async (req: Request, res: Response) => {
  try {
    const users = await listAuthUsers(req.params.projectId);
    res.json({ users });
  } catch (err) {
    logger.error({ err }, 'Failed to list auth users');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:projectId/auth-users/:userId
router.get('/:projectId/auth-users/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await getAuthUser(req.params.userId, req.params.projectId);
    if (!user) {
      res.status(404).json({ error: 'Auth user not found' });
      return;
    }
    res.json({ user });
  } catch (err) {
    logger.error({ err }, 'Failed to get auth user');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:projectId/auth-users
router.post('/:projectId/auth-users', requireAuth, async (req: Request, res: Response) => {
  try {
    const { email, password, role, emailConfirmed, rawUserMetadata } = req.body;

    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }

    const user = await createAuthUser({
      projectId: req.params.projectId,
      email,
      password,
      role,
      emailConfirmed,
      rawUserMetadata,
    });

    res.status(201).json({ user });
  } catch (err) {
    logger.error({ err }, 'Failed to create auth user');
    const message = err instanceof Error && err.message.includes('unique')
      ? 'Email already exists for this project'
      : 'Internal server error';
    res.status(message.includes('Email') ? 409 : 500).json({ error: message });
  }
});

// PUT /api/projects/:projectId/auth-users/:userId
router.put('/:projectId/auth-users/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { email, password, role, emailConfirmed, rawUserMetadata } = req.body;

    const user = await updateAuthUser(req.params.userId, req.params.projectId, {
      email,
      password,
      role,
      emailConfirmed,
      rawUserMetadata,
    });

    if (!user) {
      res.status(404).json({ error: 'Auth user not found' });
      return;
    }

    res.json({ user });
  } catch (err) {
    logger.error({ err }, 'Failed to update auth user');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:projectId/auth-users/:userId
router.delete('/:projectId/auth-users/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteAuthUser(req.params.userId, req.params.projectId);
    if (!deleted) {
      res.status(404).json({ error: 'Auth user not found' });
      return;
    }
    res.json({ message: 'Auth user deleted' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete auth user');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Auth users router for managing simulated Supabase auth.users per project. */
export default router;
