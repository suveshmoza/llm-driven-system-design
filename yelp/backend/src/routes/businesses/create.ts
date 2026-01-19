import { Router, Response } from 'express';
import { pool } from '../../utils/db.js';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.js';
import { publishBusinessReindex } from '../../utils/queue.js';
import { BusinessRow, CreateBusinessBody, generateSlug } from './types.js';

export const router = Router();

// Create a new business
router.post(
  '/',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const {
        name,
        description,
        address,
        city,
        state,
        zip_code,
        country = 'USA',
        latitude,
        longitude,
        phone,
        website,
        email,
        price_level,
        categories = [],
      } = req.body as CreateBusinessBody;

      if (
        !name ||
        !address ||
        !city ||
        !state ||
        !zip_code ||
        !latitude ||
        !longitude
      ) {
        return res.status(400).json({
          error: {
            message:
              'Name, address, city, state, zip_code, latitude, and longitude are required',
          },
        });
      }

      // Generate unique slug
      let slug = generateSlug(name);
      const existingSlug = await pool.query<{ id: string }>(
        'SELECT id FROM businesses WHERE slug = $1',
        [slug]
      );
      if (existingSlug.rows.length > 0) {
        slug = `${slug}-${Date.now()}`;
      }

      // Insert business
      const result = await pool.query<BusinessRow>(
        `INSERT INTO businesses (name, slug, description, address, city, state, zip_code, country, latitude, longitude, phone, website, email, price_level, owner_id, is_claimed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true)
       RETURNING *`,
        [
          name,
          slug,
          description,
          address,
          city,
          state,
          zip_code,
          country,
          latitude,
          longitude,
          phone,
          website,
          email,
          price_level,
          req.user!.id,
        ]
      );

      const business = result.rows[0];

      // Add categories
      if (categories.length > 0) {
        const categoryValues = categories
          .map((_, index) => `($1, $${index + 2})`)
          .join(', ');
        await pool.query(
          `INSERT INTO business_categories (business_id, category_id) VALUES ${categoryValues}`,
          [business.id, ...categories]
        );
      }

      // Update user role if not already a business owner
      if (req.user!.role === 'user') {
        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [
          'business_owner',
          req.user!.id,
        ]);
      }

      // Publish to queue for async Elasticsearch indexing
      publishBusinessReindex(business.id);

      res.status(201).json({ business });
    } catch (error) {
      console.error('Create business error:', error);
      res.status(500).json({ error: { message: 'Failed to create business' } });
    }
  }
);
