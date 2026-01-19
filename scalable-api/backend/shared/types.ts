import type { Request } from 'express';
import type { Redis } from 'ioredis';

// User types
export interface ApiUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  tier: 'enterprise' | 'professional' | 'basic' | 'free' | 'anonymous';
  scopes?: string[];
  apiKeyId?: string;
  apiKey?: string;
}

// Rate limit result types
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  retryAfter?: number;
  error?: boolean;
}

// Extend Express Request
export interface AuthenticatedRequest extends Request {
  user?: ApiUser | null;
  authMethod?: 'api-key' | 'bearer' | 'anonymous';
  rateLimit?: RateLimitResult;
}

// Cache statistics
export interface CacheStats {
  localHits: number;
  redisHits: number;
  misses: number;
  localCacheSize: number;
  hitRate: number;
}

// Local cache entry
export interface LocalCacheEntry<T = unknown> {
  value: T;
  expiry: number;
}

// Cache service interface
export interface ICacheService {
  redis: Redis;
  localCache: Map<string, LocalCacheEntry>;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number | null): Promise<void>;
  delete(key: string): Promise<void>;
  invalidate(pattern: string): Promise<void>;
  getOrFetch<T>(key: string, fetchFn: () => Promise<T>, ttl?: number | null): Promise<T>;
  getStats(): CacheStats;
  clear(): Promise<void>;
}
