/**
 * @fileoverview Authentication API controller.
 * Handles user login, registration, logout, and current user retrieval.
 */

import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  authenticateUser,
  createSession,
  deleteSession,
  getUserById,
  createUser,
} from '../services/authService.js';

/**
 * Handles POST /api/v1/auth/login - User login.
 * Authenticates user credentials and creates a session.
 * @param req - Request with username and password in body
 * @param res - Response with token and user data or error
 */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const user = await authenticateUser(username, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = await createSession(user.id, user.role);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

/**
 * Handles POST /api/v1/auth/register - User registration.
 * Creates a new user account and establishes a session.
 * @param req - Request with username, email, display_name, and password in body
 * @param res - Response with token and user data or error
 */
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { username, email, display_name, password } = req.body;

    if (!username || !email || !display_name || !password) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const user = await createUser(username, email, display_name, password);
    if (!user) {
      res.status(400).json({ error: 'Username or email already exists' });
      return;
    }

    const token = await createSession(user.id, user.role);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

/**
 * Handles POST /api/v1/auth/logout - User logout.
 * Invalidates the current session token.
 * @param req - Request with auth token in header or cookie
 * @param res - Response with success status or error
 */
export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

    if (token) {
      await deleteSession(token);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
}

/**
 * Handles GET /api/v1/auth/me - Get current user.
 * Returns the authenticated user's profile information.
 * @param req - Authenticated request
 * @param res - Response with user data or error
 */
export async function getCurrentUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await getUserById(req.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      email: user.email,
      avatar_url: user.avatar_url,
      role: user.role,
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
}
