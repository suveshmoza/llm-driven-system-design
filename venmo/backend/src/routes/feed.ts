import express, { type Request, type Response } from 'express';
import { pool } from '../db/pool.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

const router = express.Router();

interface FeedItem {
  id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  note: string;
  visibility: string;
  status: string;
  created_at: Date;
  sender_username: string;
  sender_name: string | null;
  sender_avatar: string | null;
  receiver_username: string;
  receiver_name: string | null;
  receiver_avatar: string | null;
  likes_count: string;
  comments_count: string;
  user_liked: boolean;
}

// Get user's social feed (pre-computed via fan-out)
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { limit = '20', before } = req.query;

    let query = `
      SELECT DISTINCT ON (t.id)
             t.*,
             sender.username as sender_username,
             sender.name as sender_name,
             sender.avatar_url as sender_avatar,
             receiver.username as receiver_username,
             receiver.name as receiver_name,
             receiver.avatar_url as receiver_avatar,
             (SELECT COUNT(*) FROM transfer_likes WHERE transfer_id = t.id) as likes_count,
             (SELECT COUNT(*) FROM transfer_comments WHERE transfer_id = t.id) as comments_count,
             EXISTS(SELECT 1 FROM transfer_likes WHERE user_id = $1 AND transfer_id = t.id) as user_liked
      FROM feed_items f
      JOIN transfers t ON f.transfer_id = t.id
      JOIN users sender ON t.sender_id = sender.id
      JOIN users receiver ON t.receiver_id = receiver.id
      WHERE f.user_id = $1
    `;

    const params: (string | number)[] = [authReq.user.id];
    let paramIndex = 2;

    if (before && typeof before === 'string') {
      query += ` AND t.created_at < $${paramIndex}`;
      params.push(before);
      paramIndex++;
    }

    query += ` ORDER BY t.id, t.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit as string));

    // Final ordering after DISTINCT
    const result = await pool.query<FeedItem>(
      `SELECT * FROM (${query}) sub ORDER BY created_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get feed error:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

// Get global/public feed (all public transactions)
router.get('/global', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { limit = '20', before } = req.query;

    let query = `
      SELECT t.*,
             sender.username as sender_username,
             sender.name as sender_name,
             sender.avatar_url as sender_avatar,
             receiver.username as receiver_username,
             receiver.name as receiver_name,
             receiver.avatar_url as receiver_avatar,
             (SELECT COUNT(*) FROM transfer_likes WHERE transfer_id = t.id) as likes_count,
             (SELECT COUNT(*) FROM transfer_comments WHERE transfer_id = t.id) as comments_count,
             EXISTS(SELECT 1 FROM transfer_likes WHERE user_id = $1 AND transfer_id = t.id) as user_liked
      FROM transfers t
      JOIN users sender ON t.sender_id = sender.id
      JOIN users receiver ON t.receiver_id = receiver.id
      WHERE t.visibility = 'public'
    `;

    const params: (string | number)[] = [authReq.user.id];
    let paramIndex = 2;

    if (before && typeof before === 'string') {
      query += ` AND t.created_at < $${paramIndex}`;
      params.push(before);
      paramIndex++;
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit as string));

    const result = await pool.query<FeedItem>(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get global feed error:', error);
    res.status(500).json({ error: 'Failed to get global feed' });
  }
});

// Get user's own transaction history for their profile
router.get('/user/:username', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { limit = '20', before } = req.query;
    const { username } = req.params;

    // Get user ID
    const userResult = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [username.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const targetUserId = userResult.rows[0].id;
    const isOwnProfile = targetUserId === authReq.user.id;

    // Check if friends
    const friendResult = await pool.query(
      `SELECT 1 FROM friendships
       WHERE user_id = $1 AND friend_id = $2 AND status = 'accepted'`,
      [authReq.user.id, targetUserId]
    );
    const isFriend = friendResult.rows.length > 0;

    let query = `
      SELECT t.*,
             sender.username as sender_username,
             sender.name as sender_name,
             sender.avatar_url as sender_avatar,
             receiver.username as receiver_username,
             receiver.name as receiver_name,
             receiver.avatar_url as receiver_avatar,
             (SELECT COUNT(*) FROM transfer_likes WHERE transfer_id = t.id) as likes_count,
             (SELECT COUNT(*) FROM transfer_comments WHERE transfer_id = t.id) as comments_count,
             EXISTS(SELECT 1 FROM transfer_likes WHERE user_id = $1 AND transfer_id = t.id) as user_liked
      FROM transfers t
      JOIN users sender ON t.sender_id = sender.id
      JOIN users receiver ON t.receiver_id = receiver.id
      WHERE (t.sender_id = $2 OR t.receiver_id = $2)
    `;

    const params: (string | number)[] = [authReq.user.id, targetUserId];
    let paramIndex = 3;

    // Apply visibility filter if not own profile
    if (!isOwnProfile) {
      if (isFriend) {
        query += ` AND t.visibility IN ('public', 'friends')`;
      } else {
        query += ` AND t.visibility = 'public'`;
      }
    }

    if (before && typeof before === 'string') {
      query += ` AND t.created_at < $${paramIndex}`;
      params.push(before);
      paramIndex++;
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit as string));

    const result = await pool.query<FeedItem>(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get user feed error:', error);
    res.status(500).json({ error: 'Failed to get user feed' });
  }
});

export default router;
