/**
 * Cache Node - Main Server Entry Point
 *
 * An individual cache server in the distributed cluster.
 *
 * Features:
 * - LRU eviction with TTL support
 * - HTTP API for cache operations
 * - Health check endpoint
 * - Prometheus metrics endpoint
 * - Structured JSON logging
 * - Snapshot persistence
 * - Hot key detection
 */

import express from 'express';
import cors from 'cors';
import { LRUCache } from '../lib/lru-cache.js';
import {
  updateCacheStats,
  HotKeyDetector,
  cacheEvictions,
  cacheExpirations,
  cacheMemoryLimitBytes,
} from '../shared/metrics.js';
import { createLogger, createHttpLogger, logHotKeysDetected } from '../shared/logger.js';
import { createPersistenceManager } from '../shared/persistence.js';
import { createHealthRoutes } from './health-routes.js';
import { createCacheRoutes } from './cache-routes.js';
import { createBulkRoutes } from './bulk-routes.js';
import { createAdminRoutes } from './admin-routes.js';
import { createErrorHandler } from './middleware.js';
import type { ServerConfig, ServerContext } from './types.js';

// ======================
// Configuration
// ======================

const config: ServerConfig = {
  port: process.env.PORT || 3000,
  nodeId: process.env.NODE_ID || `node-${process.env.PORT || 3000}`,
  maxSize: parseInt(process.env.MAX_SIZE || '10000', 10),
  maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB || '100', 10),
  defaultTTL: parseInt(process.env.DEFAULT_TTL || '0', 10),
};

// ======================
// Initialize Components
// ======================

const logger = createLogger({ nodeId: config.nodeId });

const cache = new LRUCache({
  maxSize: config.maxSize,
  maxMemoryMB: config.maxMemoryMB,
  defaultTTL: config.defaultTTL,
});

const hotKeyDetector = new HotKeyDetector(config.nodeId, {
  windowMs: 60000,
  threshold: 0.01, // 1% of traffic
});

const persistence = createPersistenceManager(config.nodeId, cache);

// Set memory limit metric
cacheMemoryLimitBytes.labels(config.nodeId).set(config.maxMemoryMB * 1024 * 1024);

// ======================
// Create Server Context
// ======================

const context: ServerContext = {
  cache,
  hotKeyDetector,
  persistence,
  logger,
  config,
};

// ======================
// Initialize Express App
// ======================

const app = express();

// Global middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(createHttpLogger());

// Mount routes
app.use(createHealthRoutes(context));
app.use(createCacheRoutes(context));
app.use(createBulkRoutes(context));
app.use(createAdminRoutes(context));

// Error handling
app.use(createErrorHandler(context));

// ======================
// Metrics Update Timer
// ======================

function updateMetrics(): void {
  const stats = cache.getStats();
  updateCacheStats(config.nodeId, stats);

  const hotKeys = hotKeyDetector.getHotKeys();
  if (hotKeys.length > 0) {
    logHotKeysDetected(hotKeys);
  }
}

setInterval(updateMetrics, 5000);

// ======================
// Start Server
// ======================

async function start(): Promise<void> {
  try {
    // Initialize persistence and load snapshot
    const loadResult = await persistence.initialize();
    if (loadResult.loaded && 'durationMs' in loadResult) {
      logger.info(
        { entries: loadResult.entries, durationMs: loadResult.durationMs },
        'cache_warmed_from_snapshot'
      );
    }

    // Hook into cache eviction events
    const originalEvict = (cache as any)._evict.bind(cache);
    (cache as any)._evict = function () {
      const sizeBefore = this.cache.size;
      originalEvict();
      const evicted = sizeBefore - this.cache.size;
      if (evicted > 0) {
        cacheEvictions.labels(config.nodeId).inc(evicted);
      }
    };

    // Hook into cache expiration events
    const originalExpireCycle = (cache as any)._expireCycle.bind(cache);
    (cache as any)._expireCycle = function () {
      const expiredBefore = this.stats.expirations;
      originalExpireCycle();
      const expired = this.stats.expirations - expiredBefore;
      if (expired > 0) {
        cacheExpirations.labels(config.nodeId).inc(expired);
      }
    };

    const server = app.listen(config.port, () => {
      logger.info(
        {
          nodeId: config.nodeId,
          port: config.port,
          maxSize: config.maxSize,
          maxMemoryMB: config.maxMemoryMB,
          defaultTTL: config.defaultTTL,
        },
        'cache_node_started'
      );

      console.log(`
==============================================
  Cache Node Started
==============================================
  Node ID:    ${config.nodeId}
  Port:       ${config.port}
  Max Size:   ${config.maxSize} entries
  Max Memory: ${config.maxMemoryMB} MB
  Default TTL: ${config.defaultTTL} seconds (0 = no expiration)
  Metrics:    http://localhost:${config.port}/metrics
==============================================
`);
    });

    // Graceful shutdown
    async function shutdown(signal: string): Promise<void> {
      logger.info({ signal }, 'shutdown_initiated');

      server.close(async () => {
        logger.info({}, 'server_closed');

        await persistence.shutdown();
        hotKeyDetector.destroy();
        cache.destroy();

        logger.info({}, 'cleanup_complete');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error({}, 'forced_shutdown');
        process.exit(1);
      }, 10000);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    const err = error as Error;
    logger.fatal({ error: err.message }, 'startup_failed');
    process.exit(1);
  }
}

start();

export default app;
