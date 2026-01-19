import { Router, Response } from 'express';
import { pool } from '../../utils/db.js';
import { cache } from '../../utils/redis.js';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.js';
import { publishBusinessReindex } from '../../utils/queue.js';
import { BusinessRow, OwnerCheckRow, UpdateBusinessBody } from './types.js';

export const router = Router();

// Update business
router.patch(
  '/:id',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const paramId = req.params.id;
      const id = Array.isArray(paramId) ? paramId[0] : paramId;
      const body = req.body as UpdateBusinessBody;

      // Check ownership
      const ownerCheck = await pool.query<OwnerCheckRow>(
        'SELECT owner_id FROM businesses WHERE id = $1',
        [id]
      );

      if (ownerCheck.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Business not found' } });
      }

      if (
        ownerCheck.rows[0].owner_id !== req.user!.id &&
        req.user!.role !== 'admin'
      ) {
        return res
          .status(403)
          .json({ error: { message: 'Not authorized to update this business' } });
      }

      const allowedFields = [
        'name',
        'description',
        'address',
        'city',
        'state',
        'zip_code',
        'phone',
        'website',
        'email',
        'price_level',
        'latitude',
        'longitude',
      ];
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      for (const field of allowedFields) {
        if ((body as Record<string, unknown>)[field] !== undefined) {
          updates.push(`${field} = $${paramIndex++}`);
          values.push((body as Record<string, unknown>)[field]);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: { message: 'No updates provided' } });
      }

      values.push(id);

      const result = await pool.query<BusinessRow>(
        `UPDATE businesses SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
        values
      );

      const business = result.rows[0];

      // Update categories if provided
      if (body.categories) {
        await pool.query('DELETE FROM business_categories WHERE business_id = $1', [
          id,
        ]);
        if (body.categories.length > 0) {
          const categoryValues = body.categories
            .map((_, index) => `($1, $${index + 2})`)
            .join(', ');
          await pool.query(
            `INSERT INTO business_categories (business_id, category_id) VALUES ${categoryValues}`,
            [id, ...body.categories]
          );
        }
      }

      // Publish to queue for async Elasticsearch reindex
      publishBusinessReindex(id);

      // Clear cache
      await cache.delPattern(`business:${id}*`);
      await cache.delPattern(`business:${business.slug}*`);

      res.json({ business });
    } catch (error) {
      console.error('Update business error:', error);
      res.status(500).json({ error: { message: 'Failed to update business' } });
    }
  }
);
