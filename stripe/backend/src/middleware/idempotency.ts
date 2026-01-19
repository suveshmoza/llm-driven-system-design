import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import {
  getIdempotencyKey,
  setIdempotencyKey,
  acquireIdempotencyLock,
  releaseIdempotencyLock,
  IdempotencyResponse,
} from '../db/redis.js';

/**
 * Idempotency middleware - prevents duplicate requests
 */
export function idempotencyMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey) {
    // No idempotency key, proceed normally
    next();
    return;
  }

  // Validate key format (max 255 chars)
  if (idempotencyKey.length > 255) {
    res.status(400).json({
      error: {
        type: 'invalid_request_error',
        message: 'Idempotency key must be 255 characters or fewer',
      },
    });
    return;
  }

  const merchantId = req.merchantId;

  if (!merchantId) {
    // Can't use idempotency without merchant context
    next();
    return;
  }

  handleIdempotency(req, res, next, merchantId, idempotencyKey);
}

async function handleIdempotency(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  merchantId: string,
  idempotencyKey: string
): Promise<void> {
  try {
    // Try to acquire lock
    const acquired = await acquireIdempotencyLock(merchantId, idempotencyKey);

    if (!acquired) {
      // Another request with same key is in progress
      res.status(409).json({
        error: {
          type: 'idempotency_error',
          message: 'A request with this idempotency key is already in progress',
        },
      });
      return;
    }

    // Check for cached response
    const cached = await getIdempotencyKey(merchantId, idempotencyKey);
    if (cached) {
      await releaseIdempotencyLock(merchantId, idempotencyKey);

      // Verify request matches
      if (cached.requestPath !== req.path || cached.requestMethod !== req.method) {
        res.status(422).json({
          error: {
            type: 'idempotency_error',
            message: 'Idempotency key was used for a different request',
          },
        });
        return;
      }

      // Return cached response
      res.status(cached.statusCode).json(cached.body);
      return;
    }

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to capture response
    res.json = function (body: unknown) {
      // Cache successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const responseToCache: IdempotencyResponse = {
          statusCode: res.statusCode,
          body,
          requestPath: req.path,
          requestMethod: req.method,
        };
        setIdempotencyKey(merchantId, idempotencyKey, responseToCache).catch((err) =>
          console.error('Failed to cache idempotency:', err)
        );
      }

      // Release lock
      releaseIdempotencyLock(merchantId, idempotencyKey).catch((err) =>
        console.error('Failed to release lock:', err)
      );

      return originalJson(body);
    };

    // Attach cleanup for error cases
    res.on('finish', () => {
      releaseIdempotencyLock(merchantId, idempotencyKey).catch((err) =>
        console.error('Failed to release lock on finish:', err)
      );
    });

    next();
  } catch (error) {
    console.error('Idempotency middleware error:', error);
    await releaseIdempotencyLock(merchantId, idempotencyKey);
    next(error);
  }
}
