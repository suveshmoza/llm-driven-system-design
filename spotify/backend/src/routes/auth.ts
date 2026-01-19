import { Router, Response } from 'express';
import authService from '../services/authService.js';
import { rateLimiters } from '../shared/rateLimit.js';
import { auditLog, AuditActions } from '../shared/audit.js';
import { authEventsTotal } from '../shared/metrics.js';
import type { AuthenticatedRequest, UserRegistration, UserLogin } from '../types.js';

const router = Router();

// Apply auth rate limiting to sensitive endpoints
router.use('/register', rateLimiters.auth);
router.use('/login', rateLimiters.auth);

// Register
router.post('/register', async (req, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const { email, password, username, displayName } = req.body as UserRegistration;

    if (!email || !password || !username) {
      res.status(400).json({ error: 'Email, password, and username are required' });
      return;
    }

    const user = await authService.register({ email, password, username, displayName });

    // Set session
    authReq.session.userId = user.id;

    // Audit log
    await auditLog(authReq, AuditActions.USER_REGISTER, 'user', user.id, { email, username });

    // Metrics
    authEventsTotal.inc({ event: 'register', success: 'true' });

    res.status(201).json({ user });
  } catch (error) {
    const log = authReq.log || console;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Register error');
    authEventsTotal.inc({ event: 'register', success: 'false' });
    res.status(400).json({ error: errorMessage });
  }
});

// Login
router.post('/login', async (req, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    const { email, password } = req.body as UserLogin;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await authService.login({ email, password });

    // Set session
    authReq.session.userId = user.id;

    // Audit log
    await auditLog(authReq, AuditActions.USER_LOGIN, 'user', user.id, { email });

    // Metrics
    authEventsTotal.inc({ event: 'login', success: 'true' });

    res.json({ user });
  } catch (error) {
    const log = authReq.log || console;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const bodyEmail = (req.body as { email?: string }).email;
    log.warn({ error: errorMessage, email: bodyEmail }, 'Login failed');

    // Audit failed login attempt
    await auditLog(
      authReq,
      AuditActions.USER_LOGIN_FAILED,
      'user',
      null,
      { email: bodyEmail, reason: errorMessage },
      false
    );

    authEventsTotal.inc({ event: 'login', success: 'false' });
    res.status(401).json({ error: errorMessage });
  }
});

// Logout
router.post('/logout', (req, res: Response): void => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.session?.userId;

  authReq.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Failed to logout' });
      return;
    }

    // Audit log (async, don't wait)
    if (userId) {
      auditLog(
        { ...authReq, session: { userId } } as AuthenticatedRequest,
        AuditActions.USER_LOGOUT,
        'user',
        userId,
        {}
      ).catch(() => {});
    }

    authEventsTotal.inc({ event: 'logout', success: 'true' });

    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Get current user
router.get('/me', async (req, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const user = await authService.getUserById(authReq.session.userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (error) {
    const log = authReq.log || console;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Get user error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update profile
router.patch('/me', async (req, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.session.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const previousUser = await authService.getUserById(authReq.session.userId);
    const user = await authService.updateProfile(authReq.session.userId, req.body);

    // Audit log profile changes
    await auditLog(
      authReq,
      AuditActions.USER_UPDATE_PROFILE,
      'user',
      authReq.session.userId,
      {
        fields: Object.keys(req.body as object),
        previousDisplayName: previousUser?.display_name,
        newDisplayName: user.display_name,
      }
    );

    res.json({ user });
  } catch (error) {
    const log = authReq.log || console;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: errorMessage }, 'Update profile error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
