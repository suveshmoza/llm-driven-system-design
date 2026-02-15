import { pool } from './db.js';
import { logger } from './logger.js';

interface Approval {
  id: string;
  page_id: string;
  requested_by: string;
  reviewed_by: string | null;
  status: string;
  comment: string | null;
  created_at: string;
  reviewed_at: string | null;
  requester_username?: string;
  reviewer_username?: string;
}

export async function requestApproval(pageId: string, requestedBy: string): Promise<Approval> {
  // Check for existing pending approval
  const existing = await pool.query(
    "SELECT * FROM page_approvals WHERE page_id = $1 AND status = 'pending'",
    [pageId],
  );

  if (existing.rows.length > 0) {
    throw new Error('An approval request is already pending for this page');
  }

  const result = await pool.query(
    `INSERT INTO page_approvals (page_id, requested_by) VALUES ($1, $2) RETURNING *`,
    [pageId, requestedBy],
  );

  logger.info({ pageId, requestedBy }, 'Approval requested');
  return result.rows[0];
}

export async function reviewApproval(
  approvalId: string,
  reviewedBy: string,
  status: 'approved' | 'rejected',
  comment?: string,
): Promise<Approval> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE page_approvals
       SET reviewed_by = $1, status = $2, comment = $3, reviewed_at = NOW()
       WHERE id = $4 AND status = 'pending'
       RETURNING *`,
      [reviewedBy, status, comment || null, approvalId],
    );

    if (result.rows.length === 0) {
      throw new Error('Approval not found or already reviewed');
    }

    const approval = result.rows[0];

    // If approved, publish the page
    if (status === 'approved') {
      await client.query(
        "UPDATE pages SET status = 'published', updated_at = NOW() WHERE id = $1",
        [approval.page_id],
      );
      logger.info({ approvalId, pageId: approval.page_id }, 'Page approved and published');
    } else {
      logger.info({ approvalId, pageId: approval.page_id }, 'Page approval rejected');
    }

    await client.query('COMMIT');
    return approval;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getPageApprovals(pageId: string): Promise<Approval[]> {
  const result = await pool.query(
    `SELECT pa.*,
            req.username as requester_username,
            rev.username as reviewer_username
     FROM page_approvals pa
     JOIN users req ON req.id = pa.requested_by
     LEFT JOIN users rev ON rev.id = pa.reviewed_by
     WHERE pa.page_id = $1
     ORDER BY pa.created_at DESC`,
    [pageId],
  );
  return result.rows;
}

export async function getPendingApprovals(userId?: string): Promise<Approval[]> {
  let query = `
    SELECT pa.*,
           p.title as page_title,
           s.key as space_key,
           req.username as requester_username
    FROM page_approvals pa
    JOIN pages p ON p.id = pa.page_id
    JOIN spaces s ON s.id = p.space_id
    JOIN users req ON req.id = pa.requested_by
    WHERE pa.status = 'pending'
  `;
  const params: string[] = [];

  if (userId) {
    query += ' AND pa.requested_by = $1';
    params.push(userId);
  }

  query += ' ORDER BY pa.created_at DESC';

  const result = await pool.query(query, params);
  return result.rows;
}
