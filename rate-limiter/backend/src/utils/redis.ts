/**
 * @fileoverview Redis client management and metrics utilities.
 *
 * Provides a singleton Redis client for the rate limiter service, along with
 * helper functions for recording and retrieving rate limiting metrics.
 * The metrics are stored in Redis with minute-level granularity for dashboards.
 */

import Redis from 'ioredis';
import { config } from '../config/index.js';

/** Singleton Redis client instance */
let redisClient: Redis | null = null;

/**
 * Get the singleton Redis client instance.
 * Creates and configures the client on first call, returns existing instance thereafter.
 * The client includes automatic retry logic and event handlers for connection management.
 *
 * @returns Configured Redis client instance
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times) => {
        // Stop retrying after 3 attempts
        if (times > 3) {
          console.error('Redis connection failed after 3 retries');
          return null;
        }
        // Exponential backoff with max 3 second delay
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
    });

    redisClient.on('connect', () => {
      console.log('Connected to Redis');
    });

    redisClient.on('error', (err) => {
      console.error('Redis error:', err.message);
    });

    redisClient.on('close', () => {
      console.log('Redis connection closed');
    });
  }

  return redisClient;
}

/**
 * Gracefully close the Redis client connection.
 * Should be called during application shutdown to clean up resources.
 *
 * @returns Promise that resolves when connection is closed
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Record a rate limit check metric in Redis.
 * Metrics are aggregated per minute for efficient storage and querying.
 * Used by the MetricsDashboard component to display real-time statistics.
 *
 * @param redis - Redis client instance
 * @param type - Whether the request was 'allowed' or 'denied'
 * @param latencyMs - Time taken to perform the rate limit check in milliseconds
 */
export async function recordMetric(
  redis: Redis,
  type: 'allowed' | 'denied',
  latencyMs: number
): Promise<void> {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `metrics:${minute}`;

  // Use pipeline for efficiency (batch multiple commands)
  const pipeline = redis.pipeline();
  pipeline.hincrby(key, 'total', 1);
  pipeline.hincrby(key, type, 1);
  pipeline.hincrbyfloat(key, 'latency_sum', latencyMs);

  // Store individual latencies for percentile calculation
  pipeline.lpush(`metrics:latencies:${minute}`, latencyMs);
  pipeline.ltrim(`metrics:latencies:${minute}`, 0, 999); // Keep last 1000

  // Keep metrics for 1 hour (3600 seconds)
  pipeline.expire(key, 3600);
  pipeline.expire(`metrics:latencies:${minute}`, 3600);

  await pipeline.exec();
}

/**
 * Retrieve aggregated metrics for the last 5 minutes.
 * Calculates totals, averages, and percentiles from stored metric data.
 *
 * @param redis - Redis client instance
 * @returns Aggregated metrics including request counts, latencies, and active identifiers
 */
export async function getMetrics(redis: Redis): Promise<{
  totalRequests: number;
  allowedRequests: number;
  deniedRequests: number;
  averageLatencyMs: number;
  p99LatencyMs: number;
  activeIdentifiers: number;
}> {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);

  // Initialize aggregation variables
  let totalRequests = 0;
  let allowedRequests = 0;
  let deniedRequests = 0;
  let latencySum = 0;
  const allLatencies: number[] = [];

  // Fetch metrics for the last 5 minutes in a single pipeline
  const pipeline = redis.pipeline();
  for (let i = 0; i < 5; i++) {
    const minute = currentMinute - i;
    pipeline.hgetall(`metrics:${minute}`);
    pipeline.lrange(`metrics:latencies:${minute}`, 0, -1);
  }

  const results = await pipeline.exec();
  if (results) {
    for (let i = 0; i < 5; i++) {
      const metrics = results[i * 2]?.[1] as Record<string, string> | null;
      const latencies = results[i * 2 + 1]?.[1] as string[] | null;

      if (metrics) {
        totalRequests += parseInt(metrics.total || '0', 10);
        allowedRequests += parseInt(metrics.allowed || '0', 10);
        deniedRequests += parseInt(metrics.denied || '0', 10);
        latencySum += parseFloat(metrics.latency_sum || '0');
      }

      if (latencies) {
        allLatencies.push(...latencies.map(Number));
      }
    }
  }

  // Calculate p99 latency
  allLatencies.sort((a, b) => a - b);
  const p99Index = Math.floor(allLatencies.length * 0.99);
  const p99LatencyMs = allLatencies[p99Index] || 0;

  // Count active identifiers (approximate by counting rate limit keys)
  const keys = await redis.keys('ratelimit:*');
  const activeIdentifiers = keys.length;

  return {
    totalRequests,
    allowedRequests,
    deniedRequests,
    averageLatencyMs: totalRequests > 0 ? latencySum / totalRequests : 0,
    p99LatencyMs,
    activeIdentifiers,
  };
}
