import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { query } from '../services/db.js';
import logger from '../services/logger.js';

const router = Router();

interface ContactRow {
  id: string;
  contact_email: string;
  contact_name: string | null;
  frequency: number;
}

/**
 * GET /api/v1/contacts?q=search_term
 * Autocomplete contacts for the current user
 */
router.get('/', requireAuth as unknown as import('express').RequestHandler, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.session.userId!;
    const q = (req.query.q as string) || '';

    if (q.length < 1) {
      return res.json({ contacts: [] });
    }

    const result = await query<ContactRow>(
      `SELECT id, contact_email, contact_name, frequency
       FROM contacts
       WHERE user_id = $1
         AND (contact_email ILIKE $2 OR contact_name ILIKE $2)
       ORDER BY frequency DESC
       LIMIT 10`,
      [userId, `%${q}%`]
    );

    const contacts = result.rows.map((row) => ({
      id: row.id,
      email: row.contact_email,
      name: row.contact_name,
      frequency: row.frequency,
    }));

    res.json({ contacts });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Failed to search contacts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
