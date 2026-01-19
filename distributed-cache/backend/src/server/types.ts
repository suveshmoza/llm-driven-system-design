/**
 * Shared Types for Cache Server
 *
 * This module defines TypeScript types and interfaces used across
 * the cache server modules.
 */

import type { Request, Response, NextFunction } from 'express';
import type { LRUCache } from '../lib/lru-cache.js';
import type { HotKeyDetector } from '../shared/metrics.js';
import type { PersistenceManager } from '../shared/persistence.js';
import type { Logger } from 'pino';

/**
 * Cache server configuration loaded from environment
 */
export interface ServerConfig {
  port: number | string;
  nodeId: string;
  maxSize: number;
  maxMemoryMB: number;
  defaultTTL: number;
}

/**
 * Cache entry for bulk operations
 */
export interface CacheEntry {
  key: string;
  value: unknown;
  ttl?: number;
}

/**
 * Request body for cache set operations
 */
export interface SetRequestBody {
  value: unknown;
  ttl?: number;
}

/**
 * Request body for bulk get operations
 */
export interface MGetRequestBody {
  keys: string[];
}

/**
 * Request body for bulk set operations
 */
export interface MSetRequestBody {
  entries: CacheEntry[];
}

/**
 * Request body for expire operation
 */
export interface ExpireRequestBody {
  ttl: number;
}

/**
 * Request body for increment operation
 */
export interface IncrRequestBody {
  delta?: number;
}

/**
 * Response for health check endpoint
 */
export interface HealthResponse {
  status: string;
  nodeId: string;
  port: number | string;
  uptime: number;
  cache: {
    entries: number;
    memoryMB: string;
    hitRate: string;
  };
  process: {
    heapUsedMB: string;
    heapTotalMB: string;
    rssMB: string;
  };
  timestamp: string;
}

/**
 * Server context containing shared dependencies
 * Passed to route handlers for accessing cache, metrics, etc.
 */
export interface ServerContext {
  cache: LRUCache;
  hotKeyDetector: HotKeyDetector;
  persistence: PersistenceManager;
  logger: Logger;
  config: ServerConfig;
}

/**
 * Extended Express Request with cache key params
 */
export interface CacheKeyRequest extends Request {
  params: {
    key: string;
  };
}

/**
 * Async request handler type for Express
 */
export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

/**
 * Error response format
 */
export interface ErrorResponse {
  error: string;
  key?: string;
  message?: string;
}

/**
 * Cache operation types for metrics
 */
export type CacheOperation = 'get' | 'set' | 'delete';
