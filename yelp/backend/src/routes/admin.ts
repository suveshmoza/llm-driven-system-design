import { Router, Response } from 'express';
import { pool } from '../utils/db.js';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { cache } from '../utils/redis.js';

const router = Router();

// Admin stats interface
interface AdminStats {
  total_users: number;
  total_businesses: number;
  total_reviews: number;
  claimed_businesses: number;
  unclaimed_businesses: number;
  reviews_last_24h: number;
  new_users_last_7d: number;
  average_rating: string;
  top_cities: Array<{ city: string; state: string; count: number }>;
}

// All admin routes require authentication and admin role
router.use(authenticate as any);
router.use(requireAdmin as any);

// Dashboard stats
router.get(
  '/stats',
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const cacheKey = 'admin:stats';
      const cached = await cache.get<AdminStats>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const stats: Partial<AdminStats> = {};

      // Total counts
      const usersResult = await pool.query<{ count: string }>(
        'SELECT COUNT(*) FROM users'
      );
      stats.total_users = parseInt(usersResult.rows[0].count, 10);

      const businessesResult = await pool.query<{ count: string }>(
        'SELECT COUNT(*) FROM businesses'
      );
      stats.total_businesses = parseInt(businessesResult.rows[0].count, 10);

      const reviewsResult = await pool.query<{ count: string }>(
        'SELECT COUNT(*) FROM reviews'
      );
      stats.total_reviews = parseInt(reviewsResult.rows[0].count, 10);

      // Claimed vs unclaimed businesses
      const claimedResult = await pool.query<{ count: string }>(
        'SELECT COUNT(*) FROM businesses WHERE is_claimed = true'
      );
      stats.claimed_businesses = parseInt(claimedResult.rows[0].count, 10);
      stats.unclaimed_businesses =
        stats.total_businesses - stats.claimed_businesses;

      // Reviews in last 24 hours
      const recentReviewsResult = await pool.query<{ count: string }>(
        "SELECT COUNT(*) FROM reviews WHERE created_at > NOW() - INTERVAL '24 hours'"
      );
      stats.reviews_last_24h = parseInt(recentReviewsResult.rows[0].count, 10);

      // New users in last 7 days
      const newUsersResult = await pool.query<{ count: string }>(
        "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days'"
      );
      stats.new_users_last_7d = parseInt(newUsersResult.rows[0].count, 10);

      // Average rating across all businesses
      const avgRatingResult = await pool.query<{ avg_rating: string | null }>(
        'SELECT AVG(rating) as avg_rating FROM businesses WHERE review_count > 0'
      );
      stats.average_rating = parseFloat(
        avgRatingResult.rows[0].avg_rating || '0'
      ).toFixed(2);

      // Top cities by business count
      const topCitiesResult = await pool.query<{
        city: string;
        state: string;
        count: number;
      }>(`
      SELECT city, state, COUNT(*) as count
      FROM businesses
      GROUP BY city, state
      ORDER BY count DESC
      LIMIT 5
    `);
      stats.top_cities = topCitiesResult.rows;

      // Cache for 5 minutes
      await cache.set(cacheKey, stats as AdminStats, 300);

      res.json(stats);
    } catch (error) {
      console.error('Get admin stats error:', error);
      res.status(500).json({ error: { message: 'Failed to fetch stats' } });
    }
  }
);

// List all users
router.get(
  '/users',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        page = '1',
        limit = '20',
        role,
        search,
      } = req.query as {
        page?: string;
        limit?: string;
        role?: string;
        search?: string;
      };
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      let query = `
      SELECT id, email, name, avatar_url, role, review_count, created_at, updated_at
      FROM users
      WHERE 1=1
    `;
      const params: unknown[] = [];
      let paramIndex = 1;

      if (role) {
        query += ` AND role = $${paramIndex++}`;
        params.push(role);
      }

      if (search) {
        query += ` AND (LOWER(name) LIKE $${paramIndex} OR LOWER(email) LIKE $${paramIndex++})`;
        params.push(`%${search.toLowerCase()}%`);
      }

      query += ` ORDER BY created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(parseInt(limit, 10), offset);

      const result = await pool.query(query, params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) FROM users WHERE 1=1';
      const countParams: unknown[] = [];
      let countParamIndex = 1;

      if (role) {
        countQuery += ` AND role = $${countParamIndex++}`;
        countParams.push(role);
      }
      if (search) {
        countQuery += ` AND (LOWER(name) LIKE $${countParamIndex} OR LOWER(email) LIKE $${countParamIndex++})`;
        countParams.push(`%${search.toLowerCase()}%`);
      }

      const countResult = await pool.query<{ count: string }>(
        countQuery,
        countParams
      );

      res.json({
        users: result.rows,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: parseInt(countResult.rows[0].count, 10),
          pages: Math.ceil(
            parseInt(countResult.rows[0].count, 10) / parseInt(limit, 10)
          ),
        },
      });
    } catch (error) {
      console.error('List users error:', error);
      res.status(500).json({ error: { message: 'Failed to fetch users' } });
    }
  }
);

// Update user role
router.patch(
  '/users/:id/role',
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { id } = req.params;
      const { role } = req.body as { role?: string };

      if (!role || !['user', 'business_owner', 'admin'].includes(role)) {
        return res.status(400).json({ error: { message: 'Invalid role' } });
      }

      const result = await pool.query(
        'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role',
        [role, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }

      res.json({ user: result.rows[0] });
    } catch (error) {
      console.error('Update user role error:', error);
      res.status(500).json({ error: { message: 'Failed to update role' } });
    }
  }
);

// List all businesses with admin filters
router.get(
  '/businesses',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        page = '1',
        limit = '20',
        claimed,
        verified,
        search,
      } = req.query as {
        page?: string;
        limit?: string;
        claimed?: string;
        verified?: string;
        search?: string;
      };
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      let query = `
      SELECT b.*, u.name as owner_name, u.email as owner_email
      FROM businesses b
      LEFT JOIN users u ON b.owner_id = u.id
      WHERE 1=1
    `;
      const params: unknown[] = [];
      let paramIndex = 1;

      if (claimed !== undefined) {
        query += ` AND b.is_claimed = $${paramIndex++}`;
        params.push(claimed === 'true');
      }

      if (verified !== undefined) {
        query += ` AND b.is_verified = $${paramIndex++}`;
        params.push(verified === 'true');
      }

      if (search) {
        query += ` AND LOWER(b.name) LIKE $${paramIndex++}`;
        params.push(`%${search.toLowerCase()}%`);
      }

      query += ` ORDER BY b.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(parseInt(limit, 10), offset);

      const result = await pool.query(query, params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) FROM businesses WHERE 1=1';
      const countParams: unknown[] = [];
      let countParamIndex = 1;

      if (claimed !== undefined) {
        countQuery += ` AND is_claimed = $${countParamIndex++}`;
        countParams.push(claimed === 'true');
      }
      if (verified !== undefined) {
        countQuery += ` AND is_verified = $${countParamIndex++}`;
        countParams.push(verified === 'true');
      }
      if (search) {
        countQuery += ` AND LOWER(name) LIKE $${countParamIndex++}`;
        countParams.push(`%${search.toLowerCase()}%`);
      }

      const countResult = await pool.query<{ count: string }>(
        countQuery,
        countParams
      );

      res.json({
        businesses: result.rows,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: parseInt(countResult.rows[0].count, 10),
          pages: Math.ceil(
            parseInt(countResult.rows[0].count, 10) / parseInt(limit, 10)
          ),
        },
      });
    } catch (error) {
      console.error('List businesses error:', error);
      res
        .status(500)
        .json({ error: { message: 'Failed to fetch businesses' } });
    }
  }
);

// Verify a business
router.patch(
  '/businesses/:id/verify',
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { id } = req.params;
      const { verified } = req.body as { verified?: boolean };

      const result = await pool.query(
        'UPDATE businesses SET is_verified = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [verified !== false, id]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: { message: 'Business not found' } });
      }

      // Clear cache
      await cache.delPattern(`business:${id}*`);

      res.json({ business: result.rows[0] });
    } catch (error) {
      console.error('Verify business error:', error);
      res
        .status(500)
        .json({ error: { message: 'Failed to verify business' } });
    }
  }
);

// List recent reviews for moderation
router.get(
  '/reviews',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const {
        page = '1',
        limit = '20',
        minRating,
        maxRating,
      } = req.query as {
        page?: string;
        limit?: string;
        minRating?: string;
        maxRating?: string;
      };
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      let query = `
      SELECT r.*,
             u.name as user_name, u.email as user_email,
             b.name as business_name, b.slug as business_slug
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      JOIN businesses b ON r.business_id = b.id
      WHERE 1=1
    `;
      const params: unknown[] = [];
      let paramIndex = 1;

      if (minRating) {
        query += ` AND r.rating >= $${paramIndex++}`;
        params.push(parseInt(minRating, 10));
      }

      if (maxRating) {
        query += ` AND r.rating <= $${paramIndex++}`;
        params.push(parseInt(maxRating, 10));
      }

      query += ` ORDER BY r.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(parseInt(limit, 10), offset);

      const result = await pool.query(query, params);

      const countResult = await pool.query<{ count: string }>(
        'SELECT COUNT(*) FROM reviews'
      );

      res.json({
        reviews: result.rows,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: parseInt(countResult.rows[0].count, 10),
          pages: Math.ceil(
            parseInt(countResult.rows[0].count, 10) / parseInt(limit, 10)
          ),
        },
      });
    } catch (error) {
      console.error('List reviews error:', error);
      res.status(500).json({ error: { message: 'Failed to fetch reviews' } });
    }
  }
);

// Delete a review (moderation)
router.delete(
  '/reviews/:id',
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { id } = req.params;

      const reviewCheck = await pool.query<{ business_id: string }>(
        'SELECT business_id FROM reviews WHERE id = $1',
        [id]
      );

      if (reviewCheck.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Review not found' } });
      }

      await pool.query('DELETE FROM reviews WHERE id = $1', [id]);

      // Clear cache
      await cache.delPattern(`business:${reviewCheck.rows[0].business_id}*`);

      res.json({ message: 'Review deleted successfully' });
    } catch (error) {
      console.error('Delete review error:', error);
      res.status(500).json({ error: { message: 'Failed to delete review' } });
    }
  }
);

export default router;
