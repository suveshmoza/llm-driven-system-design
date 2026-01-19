import { Router, Request, Response } from 'express';
import authService from '../services/authService.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

interface RegisterBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

// Register
router.post('/register', async (req: Request<object, unknown, RegisterBody>, res: Response): Promise<void> => {
  try {
    const { email, password, firstName, lastName, phone, role } = req.body;

    if (!email || !password || !firstName || !lastName) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Only allow 'user' role for public registration
    const userRole = role === 'hotel_admin' ? 'hotel_admin' : 'user';

    const result = await authService.register({
      email,
      password,
      firstName,
      lastName,
      phone,
      role: userRole,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Registration error:', error);
    if (error instanceof Error && error.message === 'Email already registered') {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req: Request<object, unknown, LoginBody>, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const result = await authService.login(email, password);
    res.json(result);
  } catch (error) {
    console.error('Login error:', error);
    if (error instanceof Error && error.message === 'Invalid credentials') {
      res.status(401).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.token) {
      await authService.logout(req.token);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
