import { Router, Response } from 'express';
import { register, login, logout, getUserDevices, deactivateDevice } from '../services/auth.js';
import { authenticateRequest, AuthenticatedRequest } from '../middleware/auth.js';
import { loginRateLimiter } from '../shared/rate-limiter.js';
import { createLogger, LoggedRequest } from '../shared/logger.js';
import { authAttempts } from '../shared/metrics.js';

const router = Router();
const logger = createLogger('auth-routes');

interface DbError extends Error {
  code?: string;
}

router.post('/register', async (req: LoggedRequest, res: Response): Promise<void> => {
  try {
    const { username, email, password, displayName, deviceName, deviceType } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password are required' });
      return;
    }

    const result = await register(username, email, password, displayName, deviceName, deviceType);

    logger.info({ userId: result.user.id, username }, 'User registered');
    authAttempts.inc({ result: 'success' });

    res.status(201).json(result);
  } catch (error) {
    logger.error({ error }, 'Registration error');
    const dbError = error as DbError;
    if (dbError.code === '23505') {
      res.status(409).json({ error: 'Username or email already exists' });
      return;
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Rate limited: 5 attempts per 15 minutes per IP
router.post('/login', loginRateLimiter, async (req: LoggedRequest, res: Response): Promise<void> => {
  try {
    const { usernameOrEmail, password, deviceName, deviceType } = req.body;

    if (!usernameOrEmail || !password) {
      res.status(400).json({ error: 'Username/email and password are required' });
      return;
    }

    const result = await login(usernameOrEmail, password, deviceName, deviceType);

    logger.info({ userId: result.user.id }, 'User logged in');
    authAttempts.inc({ result: 'success' });

    res.json(result);
  } catch (error) {
    if ((error as Error).message === 'Invalid credentials') {
      logger.warn({ usernameOrEmail: req.body.usernameOrEmail, ip: req.ip }, 'Failed login attempt');
      authAttempts.inc({ result: 'failure' });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    logger.error({ error }, 'Login error');
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', authenticateRequest as any, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization?.substring(7);
    await logout(token);

    logger.info({ userId: req.user.id }, 'User logged out');

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Logout error');
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', authenticateRequest as any, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  res.json({
    user: req.user,
    deviceId: req.deviceId,
  });
});

router.get('/devices', authenticateRequest as any, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const devices = await getUserDevices(req.user.id);
    res.json({ devices });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Get devices error');
    res.status(500).json({ error: 'Failed to get devices' });
  }
});

router.delete('/devices/:deviceId', authenticateRequest as any, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await deactivateDevice(req.user.id, req.params.deviceId);

    logger.info({ userId: req.user.id, deviceId: req.params.deviceId }, 'Device deactivated');

    res.json({ message: 'Device deactivated' });
  } catch (error) {
    logger.error({ error, userId: req.user?.id }, 'Deactivate device error');
    res.status(500).json({ error: 'Failed to deactivate device' });
  }
});

export default router;
