import { Router, Request, Response } from 'express';
import authService from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest, VehicleInfo } from '../types/index.js';

const router = Router();

// Request body interfaces
interface RegisterRiderBody {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

interface RegisterDriverBody extends RegisterRiderBody {
  vehicle: VehicleInfo;
}

interface LoginBody {
  email: string;
  password: string;
}

// Register rider
router.post('/register/rider', async (req: Request<object, object, RegisterRiderBody>, res: Response): Promise<void> => {
  try {
    const { email, password, name, phone } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    const result = await authService.register(email, password, name, phone || null, 'rider');

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Register driver
router.post('/register/driver', async (req: Request<object, object, RegisterDriverBody>, res: Response): Promise<void> => {
  try {
    const { email, password, name, phone, vehicle } = req.body;

    if (!email || !password || !name || !vehicle) {
      res.status(400).json({ error: 'Email, password, name, and vehicle info are required' });
      return;
    }

    const result = await authService.registerDriver(email, password, name, phone || null, vehicle);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Driver registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req: Request<object, object, LoginBody>, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const result = await authService.login(email, password);

    if (!result.success) {
      res.status(401).json({ error: result.error });
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authenticate as never, (req: AuthenticatedRequest, res: Response): void => {
  res.json({ user: req.user });
});

// Logout
router.post('/logout', authenticate as never, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await authService.logout(req.token);
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;
