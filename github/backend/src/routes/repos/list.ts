import { Router, Request, Response } from 'express';
import { query } from '../../db/index.js';
import { ListQueryParams } from './types.js';

const router = Router();

/**
 * List repositories
 * Returns paginated list of public repositories, plus private repos owned by the authenticated user
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { owner, page = '1', limit = '20', sort = 'updated_at' } = req.query as ListQueryParams;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let whereClause = 'WHERE r.is_private = FALSE';
  const params: unknown[] = [];

  if (owner) {
    params.push(owner);
    whereClause += ` AND u.username = $${params.length}`;
  }

  // Include private repos if user is authenticated and is the owner
  if (req.user) {
    params.push(req.user.id);
    whereClause += ` OR r.owner_id = $${params.length}`;
  }

  const countResult = await query(
    `SELECT COUNT(*) FROM repositories r
     LEFT JOIN users u ON r.owner_id = u.id
     ${whereClause}`,
    params
  );

  const sortColumn = ['updated_at', 'created_at', 'stars_count', 'name'].includes(sort) ? sort : 'updated_at';

  const result = await query(
    `SELECT r.*, u.username as owner_name, u.avatar_url as owner_avatar
     FROM repositories r
     LEFT JOIN users u ON r.owner_id = u.id
     ${whereClause}
     ORDER BY r.${sortColumn} DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, parseInt(limit), offset]
  );

  res.json({
    repos: result.rows,
    total: parseInt(countResult.rows[0].count as string),
    page: parseInt(page),
    limit: parseInt(limit),
  });
});

export default router;
