import { Router, Response } from 'express';
import { pool } from '../../utils/db.js';
import { cache } from '../../utils/redis.js';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.js';
import {
  BusinessPhoto,
  OwnerCheckRow,
  ClaimCheckRow,
  AddHoursBody,
  AddPhotoBody,
} from './types.js';

export const router = Router();

// Add business hours
router.post(
  '/:id/hours',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { id } = req.params;
      const { hours } = req.body as AddHoursBody;

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
        return res.status(403).json({ error: { message: 'Not authorized' } });
      }

      // Delete existing hours and insert new ones
      await pool.query('DELETE FROM business_hours WHERE business_id = $1', [id]);

      for (const hour of hours) {
        await pool.query(
          `INSERT INTO business_hours (business_id, day_of_week, open_time, close_time, is_closed)
         VALUES ($1, $2, $3, $4, $5)`,
          [id, hour.day_of_week, hour.open_time, hour.close_time, hour.is_closed || false]
        );
      }

      // Clear cache
      await cache.delPattern(`business:${id}*`);

      res.json({ message: 'Hours updated successfully' });
    } catch (error) {
      console.error('Update hours error:', error);
      res.status(500).json({ error: { message: 'Failed to update hours' } });
    }
  }
);

// Add business photo
router.post(
  '/:id/photos',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { id } = req.params;
      const { url, caption, is_primary = false } = req.body as AddPhotoBody;

      if (!url) {
        return res.status(400).json({ error: { message: 'Photo URL is required' } });
      }

      // Check if business exists
      const businessCheck = await pool.query<{ id: string }>(
        'SELECT id FROM businesses WHERE id = $1',
        [id]
      );
      if (businessCheck.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Business not found' } });
      }

      // If setting as primary, unset other primary photos
      if (is_primary) {
        await pool.query(
          'UPDATE business_photos SET is_primary = false WHERE business_id = $1',
          [id]
        );
      }

      const result = await pool.query<BusinessPhoto & { uploaded_by: string; created_at: string }>(
        `INSERT INTO business_photos (business_id, url, caption, is_primary, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
        [id, url, caption, is_primary, req.user!.id]
      );

      // Update photo count
      await pool.query(
        'UPDATE businesses SET photo_count = photo_count + 1 WHERE id = $1',
        [id]
      );

      // Clear cache
      await cache.delPattern(`business:${id}*`);

      res.status(201).json({ photo: result.rows[0] });
    } catch (error) {
      console.error('Add photo error:', error);
      res.status(500).json({ error: { message: 'Failed to add photo' } });
    }
  }
);

// Claim a business
router.post(
  '/:id/claim',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void | Response> => {
    try {
      const { id } = req.params;

      const result = await pool.query<ClaimCheckRow>(
        'SELECT is_claimed, owner_id FROM businesses WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: { message: 'Business not found' } });
      }

      if (result.rows[0].is_claimed) {
        return res
          .status(409)
          .json({ error: { message: 'Business already claimed' } });
      }

      await pool.query(
        'UPDATE businesses SET is_claimed = true, owner_id = $1 WHERE id = $2',
        [req.user!.id, id]
      );

      // Update user role
      if (req.user!.role === 'user') {
        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [
          'business_owner',
          req.user!.id,
        ]);
      }

      res.json({ message: 'Business claimed successfully' });
    } catch (error) {
      console.error('Claim business error:', error);
      res.status(500).json({ error: { message: 'Failed to claim business' } });
    }
  }
);
