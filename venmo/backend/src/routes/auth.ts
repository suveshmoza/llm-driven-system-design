import express, { type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool, transaction } from '../db/pool.js';
import { setSession, deleteSession } from '../db/redis.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

const router = express.Router();

interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  name?: string;
  phone?: string;
}

interface LoginRequest {
  username: string;
  password: string;
}

interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  avatar_url?: string;
}

interface UserRow {
  id: string;
  username: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  password_hash?: string;
  role: string;
}

interface WalletRow {
  balance: number;
  pending_balance: number;
}

interface UserProfileRow {
  id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
  friends_count: string;
  transactions_count: string;
  is_friend: boolean;
}

// Register new user
router.post('/register', async (req: Request<object, unknown, RegisterRequest>, res: Response): Promise<void> => {
  try {
    const { username, email, password, name, phone } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password are required' });
      return;
    }

    // Check if username or email already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username.toLowerCase(), email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      res.status(400).json({ error: 'Username or email already taken' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;

    // Create user and wallet in transaction
    const user = await transaction(async (client) => {
      const userResult = await client.query<UserRow>(
        `INSERT INTO users (username, email, password_hash, name, phone, avatar_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, email, name, avatar_url, role`,
        [username.toLowerCase(), email.toLowerCase(), passwordHash, name, phone, avatarUrl]
      );

      // Create wallet with 0 balance
      await client.query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0)',
        [userResult.rows[0].id]
      );

      return userResult.rows[0];
    });

    // Create session
    const sessionId = uuidv4();
    await setSession(sessionId, user.id);

    res.status(201).json({ user, sessionId });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req: Request<object, unknown, LoginRequest>, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const result = await pool.query<UserRow>(
      'SELECT id, username, email, name, avatar_url, password_hash, role FROM users WHERE username = $1 OR email = $1',
      [username.toLowerCase()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash || '');

    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Create session
    const sessionId = uuidv4();
    await setSession(sessionId, user.id);

    // Remove password hash from response
    const { password_hash: _unused, ...userWithoutPassword } = user;

    res.json({ user: userWithoutPassword, sessionId });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    await deleteSession(authReq.sessionId);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    // Get wallet balance
    const walletResult = await pool.query<WalletRow>(
      'SELECT balance, pending_balance FROM wallets WHERE user_id = $1',
      [authReq.user.id]
    );

    const wallet = walletResult.rows[0] || { balance: 0, pending_balance: 0 };

    res.json({
      ...authReq.user,
      wallet: {
        balance: wallet.balance,
        pendingBalance: wallet.pending_balance,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Update user profile
router.put('/me', authMiddleware, async (req: Request<object, unknown, UpdateProfileRequest>, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name, phone, avatar_url } = req.body;

    const result = await pool.query<UserRow>(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone),
       avatar_url = COALESCE($3, avatar_url), updated_at = NOW()
       WHERE id = $4
       RETURNING id, username, email, name, avatar_url, role`,
      [name, phone, avatar_url, authReq.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Search users
router.get('/search', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { q } = req.query;

    if (!q || (typeof q === 'string' && q.length < 2)) {
      res.json([]);
      return;
    }

    const result = await pool.query<{ id: string; username: string; name: string | null; avatar_url: string | null }>(
      `SELECT id, username, name, avatar_url FROM users
       WHERE id != $1 AND (username ILIKE $2 OR name ILIKE $2)
       LIMIT 10`,
      [authReq.user.id, `%${q}%`]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get user by username
router.get('/:username', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const result = await pool.query<UserProfileRow>(
      `SELECT u.id, u.username, u.name, u.avatar_url,
              (SELECT COUNT(*) FROM friendships WHERE user_id = u.id AND status = 'accepted') as friends_count,
              (SELECT COUNT(*) FROM transfers WHERE sender_id = u.id OR receiver_id = u.id) as transactions_count,
              EXISTS(SELECT 1 FROM friendships WHERE user_id = $2 AND friend_id = u.id AND status = 'accepted') as is_friend
       FROM users u WHERE u.username = $1`,
      [req.params.username.toLowerCase(), authReq.user.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
