/**
 * Structured JSON Logging Module with Pino
 *
 * Provides centralized, structured logging for the distributed cache.
 * Features:
 * - JSON format for log aggregation (ELK, Loki, etc.)
 * - Request ID tracking
 * - Log levels: trace, debug, info, warn, error, fatal
 * - Child loggers with context
 */

import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';

// Environment configuration
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ID = process.env.NODE_ID || 'unknown';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Pretty print in development, JSON in production
const transport =
  NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

/**
 * Create the base logger instance
 */
const baseLogger = pino({
  level: LOG_LEVEL,
  transport,
  base: {
    nodeId: NODE_ID,
    service: 'distributed-cache',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  // Redact sensitive fields
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-admin-key"]'],
    censor: '[REDACTED]',
  },
});

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown> = {}): pino.Logger {
  return baseLogger.child(context);
}

/**
 * Create HTTP request logger middleware for Express
 */
export function createHttpLogger(options: Record<string, unknown> = {}) {
  return pinoHttp({
    logger: baseLogger,
    // Generate request ID
    genReqId: (req: IncomingMessage) => {
      return (req.headers['x-request-id'] as string) || crypto.randomUUID();
    },
    // Custom log level based on response status
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err: Error | undefined) => {
      if (res.statusCode >= 500 || err) {
        return 'error';
      }
      if (res.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    // Custom success message
    customSuccessMessage: (req: IncomingMessage, res: ServerResponse) => {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    // Custom error message
    customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) => {
      return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
    },
    // Custom request serializer
    serializers: {
      req: (req: Record<string, unknown>) => ({
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
        remoteAddress: req.remoteAddress,
      }),
      res: (res: Record<string, unknown>) => ({
        statusCode: res.statusCode,
      }),
    },
    // Don't log health checks at info level
    autoLogging: {
      ignore: (req: IncomingMessage) => {
        return req.url === '/health' || req.url === '/metrics';
      },
    },
    ...options,
  });
}

/**
 * Log cache operations
 */
export const cacheLogger = baseLogger.child({ component: 'cache' });

/**
 * Log cluster operations
 */
export const clusterLogger = baseLogger.child({ component: 'cluster' });

/**
 * Log admin operations
 */
export const adminLogger = baseLogger.child({ component: 'admin' });

/**
 * Log persistence operations
 */
export const persistenceLogger = baseLogger.child({ component: 'persistence' });

/**
 * Log rebalancing operations
 */
export const rebalanceLogger = baseLogger.child({ component: 'rebalance' });

/**
 * Log circuit breaker events
 */
export const circuitBreakerLogger = baseLogger.child({
  component: 'circuit-breaker',
});

// ======================
// Structured Log Helpers
// ======================

/**
 * Log a cache hit event
 */
export function logCacheHit(key: string, durationMs: number): void {
  cacheLogger.debug({ key, durationMs, hit: true }, 'cache_hit');
}

/**
 * Log a cache miss event
 */
export function logCacheMiss(key: string, durationMs: number): void {
  cacheLogger.debug({ key, durationMs, hit: false }, 'cache_miss');
}

/**
 * Log a cache set event
 */
export function logCacheSet(key: string, ttl: number, durationMs: number): void {
  cacheLogger.debug({ key, ttl, durationMs }, 'cache_set');
}

/**
 * Log a cache delete event
 */
export function logCacheDelete(key: string): void {
  cacheLogger.debug({ key }, 'cache_delete');
}

/**
 * Log an eviction event
 */
export function logEviction(key: string, reason: string): void {
  cacheLogger.info({ key, reason }, 'cache_eviction');
}

/**
 * Log a TTL expiration event
 */
export function logExpiration(key: string): void {
  cacheLogger.debug({ key }, 'cache_expiration');
}

/**
 * Log node health change
 */
export function logNodeHealthChange(nodeUrl: string, healthy: boolean, reason: string): void {
  const level = healthy ? 'info' : 'warn';
  clusterLogger[level](
    { nodeUrl, healthy, reason },
    healthy ? 'node_healthy' : 'node_unhealthy'
  );
}

/**
 * Log node added to cluster
 */
export function logNodeAdded(nodeUrl: string): void {
  clusterLogger.info({ nodeUrl }, 'node_added');
}

/**
 * Log node removed from cluster
 */
export function logNodeRemoved(nodeUrl: string, reason: string): void {
  clusterLogger.warn({ nodeUrl, reason }, 'node_removed');
}

/**
 * Log admin authentication failure
 */
export function logAdminAuthFailure(ip: string, endpoint: string): void {
  adminLogger.warn({ ip, endpoint }, 'admin_auth_failure');
}

/**
 * Log admin operation
 */
export function logAdminOperation(operation: string, details: Record<string, unknown>): void {
  adminLogger.info({ operation, ...details }, 'admin_operation');
}

/**
 * Log circuit breaker state change
 */
export function logCircuitBreakerStateChange(targetNode: string, state: string): void {
  const level = state === 'open' ? 'warn' : 'info';
  circuitBreakerLogger[level](
    { targetNode, state },
    'circuit_breaker_state_change'
  );
}

/**
 * Log snapshot creation
 */
export function logSnapshotCreated(nodeId: string, entries: number, durationMs: number): void {
  persistenceLogger.info(
    { nodeId, entries, durationMs },
    'snapshot_created'
  );
}

/**
 * Log snapshot load
 */
export function logSnapshotLoaded(nodeId: string, entries: number, durationMs: number): void {
  persistenceLogger.info({ nodeId, entries, durationMs }, 'snapshot_loaded');
}

/**
 * Log rebalance start
 */
export function logRebalanceStart(reason: string, keysToMove: number): void {
  rebalanceLogger.info({ reason, keysToMove }, 'rebalance_start');
}

/**
 * Log rebalance progress
 */
export function logRebalanceProgress(keysMoved: number, totalKeys: number): void {
  rebalanceLogger.info(
    { keysMoved, totalKeys, progress: ((keysMoved / totalKeys) * 100).toFixed(1) + '%' },
    'rebalance_progress'
  );
}

/**
 * Log rebalance complete
 */
export function logRebalanceComplete(keysMoved: number, durationMs: number): void {
  rebalanceLogger.info({ keysMoved, durationMs }, 'rebalance_complete');
}

/**
 * Log hot keys detected
 */
export function logHotKeysDetected(hotKeys: unknown[]): void {
  if (hotKeys.length > 0) {
    cacheLogger.info({ hotKeys: hotKeys.slice(0, 5) }, 'hot_keys_detected');
  }
}

export default baseLogger;
