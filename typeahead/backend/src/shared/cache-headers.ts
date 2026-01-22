/**
 * Cache headers middleware for HTTP caching.
 * Provides different caching strategies for various endpoint types.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';

/**
 * Cache strategies for different endpoint types.
 */
export type CacheStrategy =
  | 'suggestions' // Public, short TTL, stale-while-revalidate
  | 'trending' // Public, very short TTL
  | 'user-specific' // Private, medium TTL
  | 'no-cache'; // No caching (mutations)

/**
 * Cache configuration for each strategy.
 */
const CACHE_CONFIGS: Record<
  CacheStrategy,
  {
    cacheControl: string;
    addETag: boolean;
  }
> = {
  suggestions: {
    cacheControl: 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    addETag: true,
  },
  trending: {
    cacheControl: 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
    addETag: true,
  },
  'user-specific': {
    cacheControl: 'private, max-age=300',
    addETag: true,
  },
  'no-cache': {
    cacheControl: 'no-cache, no-store, must-revalidate',
    addETag: false,
  },
};

/**
 * Generate ETag from response body.
 */
function generateETag(body: string): string {
  const hash = crypto.createHash('md5').update(body).digest('hex');
  return `"${hash}"`;
}

/**
 * Create cache headers middleware for a specific strategy.
 */
export function cacheHeaders(strategy: CacheStrategy): RequestHandler {
  const config = CACHE_CONFIGS[strategy];

  return (_req: Request, res: Response, next: NextFunction): void => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to add cache headers
    res.json = (body: unknown): Response => {
      // Set Cache-Control header
      res.set('Cache-Control', config.cacheControl);

      // Add ETag if configured
      if (config.addETag && body) {
        const bodyString = JSON.stringify(body);
        const etag = generateETag(bodyString);
        res.set('ETag', etag);

        // Check If-None-Match header for 304 response
        const ifNoneMatch = res.req.get('If-None-Match');
        if (ifNoneMatch === etag) {
          res.status(304);
          return res.end();
        }
      }

      // Add Vary header for proper cache key differentiation
      if (strategy === 'user-specific') {
        res.set('Vary', 'Authorization, Cookie');
      } else {
        res.set('Vary', 'Accept-Encoding');
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Middleware to set cache headers for suggestions endpoint.
 */
export const cacheSuggestions: RequestHandler = cacheHeaders('suggestions');

/**
 * Middleware to set cache headers for trending endpoint.
 */
export const cacheTrending: RequestHandler = cacheHeaders('trending');

/**
 * Middleware to set cache headers for user-specific endpoints.
 */
export const cacheUserSpecific: RequestHandler = cacheHeaders('user-specific');

/**
 * Middleware to prevent caching for mutation endpoints.
 */
export const noCache: RequestHandler = cacheHeaders('no-cache');

/**
 * Conditional caching based on request parameters.
 * Uses user-specific caching when userId is present, otherwise public caching.
 */
export function conditionalCache(
  publicStrategy: CacheStrategy,
  privateStrategy: CacheStrategy = 'user-specific'
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const hasUserContext = req.query.userId || req.headers.authorization;
    const strategy = hasUserContext ? privateStrategy : publicStrategy;
    cacheHeaders(strategy)(req, res, next);
  };
}
