import type { Request, Response, NextFunction } from 'express';
import { MerchantService } from '../services/merchant.service.js';
import type { Merchant } from '../types/index.js';

/**
 * Extends Express Request interface to include authenticated merchant.
 * The merchant property is populated by authentication middleware.
 */
declare global {
  namespace Express {
    interface Request {
      merchant?: Merchant;
    }
  }
}

const merchantService = new MerchantService();

/**
 * Authenticates requests using API key in the Authorization header.
 * Required for all protected payment and merchant endpoints.
 * Expects format: "Authorization: Bearer pk_xxx"
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const apiKey = authHeader.substring(7); // Remove "Bearer "

    const merchant = await merchantService.authenticateByApiKey(apiKey);

    if (!merchant) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    if (merchant.status !== 'active') {
      res.status(403).json({ error: 'Merchant account is not active' });
      return;
    }

    req.merchant = merchant;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Optional authentication middleware that doesn't fail if no auth is provided.
 * Populates req.merchant if valid credentials are present, continues otherwise.
 * Useful for endpoints that behave differently for authenticated vs anonymous users.
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const apiKey = authHeader.substring(7);
      const merchant = await merchantService.authenticateByApiKey(apiKey);
      if (merchant && merchant.status === 'active') {
        req.merchant = merchant;
      }
    }

    next();
  } catch (error) {
    // Continue without auth on error
    next();
  }
}

/**
 * Extracts idempotency key from request headers and adds it to the request body.
 * Used to prevent duplicate payment processing on network retries.
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function extractIdempotencyKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (idempotencyKey) {
    req.body.idempotency_key = idempotencyKey;
  }

  next();
}

/**
 * Logs all incoming requests with timing information.
 * Records HTTP method, path, status code, and response duration.
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
  });

  next();
}

/**
 * Global error handler for uncaught exceptions in route handlers.
 * Returns sanitized error messages in production, detailed messages in development.
 * @param err - Error object thrown by route handlers
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('Error:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
