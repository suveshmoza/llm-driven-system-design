import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool.js';
import { generateApiKey, hashApiKey, generateWebhookSecret } from '../utils/helpers.js';

const router = Router();

// Interfaces
interface MerchantRow {
  id: string;
  name: string;
  email: string;
  status: string;
  webhook_url: string | null;
  created_at: Date;
}

interface MerchantResponse {
  id: string;
  object: 'merchant';
  name: string;
  email: string;
  status: string;
  webhook_url: string | null;
  created: number;
}

/**
 * Create a new merchant (for demo/testing)
 * POST /v1/merchants
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body as { name?: string; email?: string };

    if (!name || !email) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Name and email are required',
        },
      });
      return;
    }

    // Check if email already exists
    const existing = await query<{ id: string }>(`
      SELECT id FROM merchants WHERE email = $1
    `, [email]);

    if (existing.rows.length > 0) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'A merchant with this email already exists',
          param: 'email',
        },
      });
      return;
    }

    const id = uuidv4();
    const apiKey = generateApiKey('sk_test');
    const apiKeyHash = hashApiKey(apiKey);
    const webhookSecret = generateWebhookSecret();

    const result = await query<MerchantRow>(`
      INSERT INTO merchants (id, name, email, api_key, api_key_hash, webhook_secret)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, status, created_at
    `, [id, name, email, apiKey, apiKeyHash, webhookSecret]);

    res.status(201).json({
      ...formatMerchant(result.rows[0]),
      api_key: apiKey, // Only returned on creation
      webhook_secret: webhookSecret,
    });
  } catch (error) {
    console.error('Create merchant error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to create merchant',
      },
    });
  }
});

/**
 * Get merchant by API key (self)
 * GET /v1/merchants/me
 */
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          type: 'authentication_error',
          message: 'API key required',
        },
      });
      return;
    }

    const apiKey = authHeader.slice(7);
    const result = await query<MerchantRow>(`
      SELECT id, name, email, status, webhook_url, created_at
      FROM merchants
      WHERE api_key = $1
    `, [apiKey]);

    if (result.rows.length === 0) {
      res.status(401).json({
        error: {
          type: 'authentication_error',
          message: 'Invalid API key',
        },
      });
      return;
    }

    res.json(formatMerchant(result.rows[0]));
  } catch (error) {
    console.error('Get merchant error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to retrieve merchant',
      },
    });
  }
});

/**
 * List all merchants (admin endpoint for demo)
 * GET /v1/merchants
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = '50', offset = '0' } = req.query as { limit?: string; offset?: string };

    const result = await query<MerchantRow>(`
      SELECT id, name, email, status, webhook_url, created_at
      FROM merchants
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);

    const countResult = await query<{ count: string }>(`SELECT COUNT(*) FROM merchants`);

    res.json({
      object: 'list',
      data: result.rows.map(formatMerchant),
      total_count: parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    console.error('List merchants error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to list merchants',
      },
    });
  }
});

/**
 * Get merchant by ID
 * GET /v1/merchants/:id
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query<MerchantRow>(`
      SELECT id, name, email, status, webhook_url, created_at
      FROM merchants
      WHERE id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      res.status(404).json({
        error: {
          type: 'invalid_request_error',
          message: 'Merchant not found',
        },
      });
      return;
    }

    res.json(formatMerchant(result.rows[0]));
  } catch (error) {
    console.error('Get merchant error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to retrieve merchant',
      },
    });
  }
});

/**
 * Regenerate API key
 * POST /v1/merchants/:id/rotate-key
 */
router.post('/:id/rotate-key', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify ownership (in production, this would be more secure)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          type: 'authentication_error',
          message: 'API key required',
        },
      });
      return;
    }

    const currentApiKey = authHeader.slice(7);
    const verifyResult = await query<{ id: string }>(`
      SELECT id FROM merchants WHERE id = $1 AND api_key = $2
    `, [req.params.id, currentApiKey]);

    if (verifyResult.rows.length === 0) {
      res.status(403).json({
        error: {
          type: 'authentication_error',
          message: 'Not authorized to rotate this API key',
        },
      });
      return;
    }

    // Generate new key
    const newApiKey = generateApiKey('sk_test');
    const newApiKeyHash = hashApiKey(newApiKey);

    await query(`
      UPDATE merchants
      SET api_key = $2, api_key_hash = $3
      WHERE id = $1
    `, [req.params.id, newApiKey, newApiKeyHash]);

    res.json({
      api_key: newApiKey,
      message: 'API key rotated successfully. Update your integration with the new key.',
    });
  } catch (error) {
    console.error('Rotate API key error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to rotate API key',
      },
    });
  }
});

/**
 * Format merchant for API response
 */
function formatMerchant(row: MerchantRow): MerchantResponse {
  return {
    id: row.id,
    object: 'merchant',
    name: row.name,
    email: row.email,
    status: row.status,
    webhook_url: row.webhook_url,
    created: Math.floor(new Date(row.created_at).getTime() / 1000),
  };
}

export default router;
