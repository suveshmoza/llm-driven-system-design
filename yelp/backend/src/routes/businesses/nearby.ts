import { Router, Request, Response } from 'express';
import { pool } from '../../utils/db.js';
import { BusinessRow } from './types.js';

export const router = Router();

// Get nearby businesses
router.get(
  '/nearby',
  async (req: Request, res: Response): Promise<void | Response> => {
    try {
      const {
        latitude,
        longitude,
        distance = '10',
        limit = '20',
      } = req.query as {
        latitude?: string;
        longitude?: string;
        distance?: string;
        limit?: string;
      };

      if (!latitude || !longitude) {
        return res
          .status(400)
          .json({ error: { message: 'Latitude and longitude are required' } });
      }

      const query = `
      SELECT b.*,
             ST_Distance(b.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 as distance_km,
             array_agg(DISTINCT c.slug) FILTER (WHERE c.slug IS NOT NULL) as categories,
             array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as category_names,
             (SELECT url FROM business_photos WHERE business_id = b.id AND is_primary = true LIMIT 1) as photo_url
      FROM businesses b
      LEFT JOIN business_categories bc ON b.id = bc.business_id
      LEFT JOIN categories c ON bc.category_id = c.id
      WHERE ST_DWithin(
        b.location,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3 * 1000
      )
      GROUP BY b.id
      ORDER BY distance_km ASC
      LIMIT $4
    `;

      const result = await pool.query<BusinessRow>(query, [
        parseFloat(longitude),
        parseFloat(latitude),
        parseFloat(distance),
        parseInt(limit, 10),
      ]);

      res.json({ businesses: result.rows });
    } catch (error) {
      console.error('Get nearby businesses error:', error);
      res
        .status(500)
        .json({ error: { message: 'Failed to fetch nearby businesses' } });
    }
  }
);
