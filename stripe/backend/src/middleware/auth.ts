import type { Request, Response, NextFunction } from 'express';
import { query } from '../db/pool.js';

// Extend Request type for merchant data
export interface AuthenticatedRequest extends Request {
  merchant?: MerchantRow;
  merchantId?: string;
}

export interface MerchantRow {
  id: string;
  name: string;
  email: string;
  status: string;
  webhook_url: string | null;
  webhook_secret: string | null;
}

/**
 * Authentication middleware - validates API key
 */
export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Get API key from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: {
        type: 'authentication_error',
        message: 'No API key provided. Use Authorization: Bearer sk_test_xxx',
      },
    });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    res.status(401).json({
      error: {
        type: 'authentication_error',
        message: 'Invalid authorization format. Use Authorization: Bearer sk_test_xxx',
      },
    });
    return;
  }

  const apiKey = parts[1];

  // Validate API key format
  if (!apiKey.startsWith('sk_test_') && !apiKey.startsWith('sk_live_')) {
    res.status(401).json({
      error: {
        type: 'authentication_error',
        message: 'Invalid API key format',
      },
    });
    return;
  }

  try {
    // Look up merchant by API key
    const result = await query<MerchantRow>(
      `
      SELECT id, name, email, status, webhook_url, webhook_secret
      FROM merchants
      WHERE api_key = $1 AND status = 'active'
    `,
      [apiKey]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        error: {
          type: 'authentication_error',
          message: 'Invalid API key',
        },
      });
      return;
    }

    // Attach merchant to request
    req.merchant = result.rows[0];
    req.merchantId = result.rows[0].id;

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Authentication failed',
      },
    });
  }
}

/**
 * Optional authentication - attach merchant if API key provided
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  return authenticateApiKey(req, res, next);
}
