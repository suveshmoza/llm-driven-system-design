import { Router, Request, Response } from 'express';
import { pool } from '../../utils/db.js';
import { cache } from '../../utils/redis.js';
import { optionalAuth, AuthenticatedRequest } from '../../middleware/auth.js';
import { BusinessRow, BusinessHour, BusinessPhoto, CountRow } from './types.js';

export const router = Router();

// Get all businesses with pagination
router.get(
  '/',
  async (req: Request, res: Response): Promise<void | Response> => {
    try {
      const {
        page = '1',
        limit = '20',
        city,
        category,
        minRating,
      } = req.query as {
        page?: string;
        limit?: string;
        city?: string;
        category?: string;
        minRating?: string;
      };
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      let query = `
      SELECT b.*,
             array_agg(DISTINCT c.slug) FILTER (WHERE c.slug IS NOT NULL) as categories,
             array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as category_names,
             (SELECT url FROM business_photos WHERE business_id = b.id AND is_primary = true LIMIT 1) as photo_url
      FROM businesses b
      LEFT JOIN business_categories bc ON b.id = bc.business_id
      LEFT JOIN categories c ON bc.category_id = c.id
      WHERE 1=1
    `;

      const params: unknown[] = [];
      let paramIndex = 1;

      if (city) {
        query += ` AND LOWER(b.city) = LOWER($${paramIndex++})`;
        params.push(city);
      }

      if (category) {
        query += ` AND c.slug = $${paramIndex++}`;
        params.push(category);
      }

      if (minRating) {
        query += ` AND b.rating >= $${paramIndex++}`;
        params.push(parseFloat(minRating));
      }

      query += ` GROUP BY b.id ORDER BY b.rating DESC, b.review_count DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(parseInt(limit, 10), offset);

      const result = await pool.query<BusinessRow>(query, params);

      // Get total count
      let countQuery = `
      SELECT COUNT(DISTINCT b.id)
      FROM businesses b
      LEFT JOIN business_categories bc ON b.id = bc.business_id
      LEFT JOIN categories c ON bc.category_id = c.id
      WHERE 1=1
    `;
      const countParams: unknown[] = [];
      let countParamIndex = 1;

      if (city) {
        countQuery += ` AND LOWER(b.city) = LOWER($${countParamIndex++})`;
        countParams.push(city);
      }
      if (category) {
        countQuery += ` AND c.slug = $${countParamIndex++}`;
        countParams.push(category);
      }
      if (minRating) {
        countQuery += ` AND b.rating >= $${countParamIndex++}`;
        countParams.push(parseFloat(minRating));
      }

      const countResult = await pool.query<CountRow>(countQuery, countParams);

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
      console.error('Get businesses error:', error);
      res.status(500).json({ error: { message: 'Failed to fetch businesses' } });
    }
  }
);

// Get business by ID or slug
router.get(
  '/:idOrSlug',
  optionalAuth as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const idOrSlug = req.params.idOrSlug;
      const identifier = Array.isArray(idOrSlug) ? idOrSlug[0] : idOrSlug;
      const cacheKey = `business:${identifier}`;

      // Try cache first
      const cached = await cache.get<BusinessRow>(cacheKey);
      if (cached) {
        return res.json({ business: cached });
      }

      // Check if it's a UUID or slug
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          identifier
        );

      const query = `
      SELECT b.*,
             array_agg(DISTINCT jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug)) FILTER (WHERE c.id IS NOT NULL) as categories,
             u.name as owner_name
      FROM businesses b
      LEFT JOIN business_categories bc ON b.id = bc.business_id
      LEFT JOIN categories c ON bc.category_id = c.id
      LEFT JOIN users u ON b.owner_id = u.id
      WHERE ${isUUID ? 'b.id = $1' : 'b.slug = $1'}
      GROUP BY b.id, u.name
    `;

      const result = await pool.query<BusinessRow>(query, [identifier]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Business not found' } });
      }

      const business = result.rows[0];

      // Get business hours
      const hoursResult = await pool.query<BusinessHour>(
        'SELECT day_of_week, open_time, close_time, is_closed FROM business_hours WHERE business_id = $1 ORDER BY day_of_week',
        [business.id]
      );
      business.hours = hoursResult.rows;

      // Get photos
      const photosResult = await pool.query<BusinessPhoto>(
        'SELECT id, url, caption, is_primary FROM business_photos WHERE business_id = $1 ORDER BY is_primary DESC, created_at DESC',
        [business.id]
      );
      business.photos = photosResult.rows;

      // Check if current user is owner
      if (req.user) {
        business.is_owner = req.user.id === business.owner_id;
      }

      // Cache for 5 minutes
      await cache.set(cacheKey, business, 300);

      res.json({ business });
    } catch (error) {
      console.error('Get business error:', error);
      res.status(500).json({ error: { message: 'Failed to fetch business' } });
    }
  }
);
