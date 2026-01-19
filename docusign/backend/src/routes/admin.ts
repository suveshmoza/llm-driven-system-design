import { Router, Request, Response } from 'express';
import { query } from '../utils/db.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { emailService } from '../services/emailService.js';

const router = Router();

interface EnvelopeStatsRow {
  total: string;
  draft: string;
  pending: string;
  completed: string;
  declined: string;
  voided: string;
  last_24h: string;
  last_7d: string;
}

interface UserStatsRow {
  total: string;
  admins: string;
  new_24h: string;
}

interface SignatureStatsRow {
  total: string;
  drawn: string;
  typed: string;
  last_24h: string;
}

interface DocumentStatsRow {
  total: string;
  total_size: string;
  avg_pages: string;
}

interface CountRow {
  total: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  envelope_count?: string;
}

interface EnvelopeRow {
  id: string;
  sender_id: string;
  name: string;
  message: string | null;
  status: string;
  created_at: string;
  sender_name?: string;
  sender_email?: string;
  document_count?: string;
  recipient_count?: string;
}

interface DocumentRow {
  id: string;
  envelope_id: string;
  name: string;
  page_count: number;
  s3_key: string;
  status: string;
  file_size: number;
  created_at: string;
}

interface RecipientRow {
  id: string;
  envelope_id: string;
  name: string;
  email: string;
  role: string;
  routing_order: number;
  status: string;
  access_token: string;
  created_at: string;
}

interface AuditEventRow {
  id: string;
  envelope_id: string;
  event_type: string;
  timestamp: string;
  actor: string | null;
  data: Record<string, unknown>;
  hash: string;
  previous_hash: string | null;
}

interface EnvelopeCountRow {
  count: string;
}

// Get system statistics
router.get('/stats', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    // Envelope stats
    const envelopeStats = await query<EnvelopeStatsRow>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'draft') as draft,
        COUNT(*) FILTER (WHERE status IN ('sent', 'delivered')) as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'declined') as declined,
        COUNT(*) FILTER (WHERE status = 'voided') as voided,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7d
      FROM envelopes
    `);

    // User stats
    const userStats = await query<UserStatsRow>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE role = 'admin') as admins,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_24h
      FROM users
    `);

    // Signature stats
    const signatureStats = await query<SignatureStatsRow>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE type = 'draw') as drawn,
        COUNT(*) FILTER (WHERE type = 'typed') as typed,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h
      FROM signatures
    `);

    // Document stats
    const documentStats = await query<DocumentStatsRow>(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(file_size), 0) as total_size,
        COALESCE(AVG(page_count), 0) as avg_pages
      FROM documents
    `);

    res.json({
      envelopes: envelopeStats.rows[0],
      users: userStats.rows[0],
      signatures: signatureStats.rows[0],
      documents: documentStats.rows[0]
    });
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// List all users
router.get('/users', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string };
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const countResult = await query<CountRow>('SELECT COUNT(*) as total FROM users');

    const result = await query<UserRow>(`
      SELECT u.id, u.email, u.name, u.role, u.created_at,
             (SELECT COUNT(*) FROM envelopes e WHERE e.sender_id = u.id) as envelope_count
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limitNum, offset]);

    res.json({
      users: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(parseInt(countResult.rows[0].total) / limitNum)
      }
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// List all envelopes (admin view)
router.get('/envelopes', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, page = '1', limit = '20' } = req.query as { status?: string; page?: string; limit?: string };
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let whereClause = '';
    const params: unknown[] = [];

    if (status) {
      whereClause = 'WHERE e.status = $1';
      params.push(status);
    }

    const countResult = await query<CountRow>(
      `SELECT COUNT(*) as total FROM envelopes e ${whereClause}`,
      params
    );

    params.push(limitNum, offset);
    const result = await query<EnvelopeRow>(`
      SELECT e.*, u.name as sender_name, u.email as sender_email,
             (SELECT COUNT(*) FROM documents d WHERE d.envelope_id = e.id) as document_count,
             (SELECT COUNT(*) FROM recipients r WHERE r.envelope_id = e.id) as recipient_count
      FROM envelopes e
      JOIN users u ON e.sender_id = u.id
      ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      envelopes: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(parseInt(countResult.rows[0].total) / limitNum)
      }
    });
  } catch (error) {
    console.error('List envelopes error:', error);
    res.status(500).json({ error: 'Failed to list envelopes' });
  }
});

// Get envelope details (admin view)
router.get('/envelopes/:id', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const envelopeResult = await query<EnvelopeRow>(`
      SELECT e.*, u.name as sender_name, u.email as sender_email
      FROM envelopes e
      JOIN users u ON e.sender_id = u.id
      WHERE e.id = $1
    `, [id]);

    if (envelopeResult.rows.length === 0) {
      res.status(404).json({ error: 'Envelope not found' });
      return;
    }

    const envelope = envelopeResult.rows[0];

    // Get documents
    const documentsResult = await query<DocumentRow>(
      'SELECT * FROM documents WHERE envelope_id = $1',
      [id]
    );

    // Get recipients
    const recipientsResult = await query<RecipientRow>(
      'SELECT * FROM recipients WHERE envelope_id = $1 ORDER BY routing_order',
      [id]
    );

    // Get audit events
    const auditResult = await query<AuditEventRow>(
      'SELECT * FROM audit_events WHERE envelope_id = $1 ORDER BY timestamp',
      [id]
    );

    res.json({
      envelope,
      documents: documentsResult.rows,
      recipients: recipientsResult.rows,
      auditEvents: auditResult.rows
    });
  } catch (error) {
    console.error('Get envelope error:', error);
    res.status(500).json({ error: 'Failed to get envelope' });
  }
});

// Get recent emails
router.get('/emails', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '50' } = req.query as { limit?: string };
    const emails = await emailService.getRecentEmails(parseInt(limit));
    res.json({ emails });
  } catch (error) {
    console.error('Get emails error:', error);
    res.status(500).json({ error: 'Failed to get emails' });
  }
});

// Get emails for envelope
router.get('/emails/envelope/:envelopeId', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { envelopeId } = req.params;
    const emails = await emailService.getEnvelopeEmails(envelopeId);
    res.json({ emails });
  } catch (error) {
    console.error('Get envelope emails error:', error);
    res.status(500).json({ error: 'Failed to get emails' });
  }
});

// Update user role
router.put('/users/:id/role', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.body as { role: string };

    if (!['user', 'admin'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }

    const result = await query<UserRow>(
      `UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1 RETURNING id, email, name, role`,
      [id, role]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Delete user (only if they have no envelopes)
router.delete('/users/:id', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Check for envelopes
    const envelopeCount = await query<EnvelopeCountRow>(
      'SELECT COUNT(*) as count FROM envelopes WHERE sender_id = $1',
      [id]
    );

    if (parseInt(envelopeCount.rows[0].count) > 0) {
      res.status(400).json({
        error: 'Cannot delete user with existing envelopes',
        envelopeCount: envelopeCount.rows[0].count
      });
      return;
    }

    await query('DELETE FROM users WHERE id = $1', [id]);

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
