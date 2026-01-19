import { Router, Request, Response } from 'express';
import { pool } from '../../utils/db.js';
import { ReviewWithUser, CountRow } from './types.js';

export const router = Router();

// Get reviews for a business
router.get(
  '/:id/reviews',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        page = '1',
        limit = '10',
        sort = 'recent',
      } = req.query as {
        page?: string;
        limit?: string;
        sort?: string;
      };
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      let orderBy = 'r.created_at DESC';
      if (sort === 'rating_high') orderBy = 'r.rating DESC, r.created_at DESC';
      if (sort === 'rating_low') orderBy = 'r.rating ASC, r.created_at DESC';
      if (sort === 'helpful') orderBy = 'r.helpful_count DESC, r.created_at DESC';

      const query = `
      SELECT r.*,
             u.name as user_name, u.avatar_url as user_avatar, u.review_count as user_review_count,
             rr.text as response_text, rr.created_at as response_created_at,
             array_agg(DISTINCT rp.url) FILTER (WHERE rp.url IS NOT NULL) as photos
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN review_responses rr ON r.id = rr.review_id
      LEFT JOIN review_photos rp ON r.id = rp.review_id
      WHERE r.business_id = $1
      GROUP BY r.id, u.name, u.avatar_url, u.review_count, rr.text, rr.created_at
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3
    `;

      const result = await pool.query<ReviewWithUser>(query, [
        id,
        parseInt(limit, 10),
        offset,
      ]);

      const countResult = await pool.query<CountRow>(
        'SELECT COUNT(*) FROM reviews WHERE business_id = $1',
        [id]
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
      console.error('Get reviews error:', error);
      res.status(500).json({ error: { message: 'Failed to fetch reviews' } });
    }
  }
);
