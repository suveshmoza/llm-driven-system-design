import Redis from 'ioredis';
import config from '../config/index.js';

const redis = new Redis.default({
  host: config.redis.host,
  port: config.redis.port,
  retryStrategy: (times: number): number => Math.min(times * 100, 3000),
  maxRetriesPerRequest: 3,
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

// Cache helpers
/** Retrieves and deserializes a cached value by key. */
export const cacheGet = async <T = unknown>(key: string): Promise<T | null> => {
  const data = await redis.get(key);
  return data ? (JSON.parse(data) as T) : null;
};

/** Serializes and stores a value in Redis with a TTL. */
export const cacheSet = async (key: string, value: unknown, ttlSeconds: number = 3600): Promise<void> => {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
};

/** Deletes a single cache entry by key. */
export const cacheDel = async (key: string): Promise<void> => {
  await redis.del(key);
};

// Timeline cache (sorted sets for feed)
/** Adds a post to a user's feed timeline sorted set, capping at 500 entries. */
export const timelineAdd = async (userId: string, postId: string, timestamp: number): Promise<void> => {
  await redis.zadd(`timeline:${userId}`, timestamp, postId);
  // Keep only last 500 posts in timeline
  await redis.zremrangebyrank(`timeline:${userId}`, 0, -501);
};

/** Retrieves paginated post IDs from a user's feed timeline in reverse chronological order. */
export const timelineGet = async (userId: string, offset: number = 0, limit: number = 20): Promise<string[]> => {
  return redis.zrevrange(`timeline:${userId}`, offset, offset + limit - 1);
};

/** Removes a post from a user's feed timeline. */
export const timelineRemove = async (userId: string, postId: string): Promise<void> => {
  await redis.zrem(`timeline:${userId}`, postId);
};

// Story tray cache
export interface StoryTrayUser {
  id: string;
  username: string;
  displayName: string;
  profilePictureUrl: string | null;
  storyCount: number;
  hasSeen: boolean;
  latestStoryTime: string;
}

/** Caches the story tray data for a user with a 5-minute TTL. */
export const storyTraySet = async (
  userId: string,
  stories: StoryTrayUser[],
  ttlSeconds: number = 300
): Promise<void> => {
  await redis.set(`story_tray:${userId}`, JSON.stringify(stories), 'EX', ttlSeconds);
};

/** Retrieves cached story tray data for a user. */
export const storyTrayGet = async (userId: string): Promise<StoryTrayUser[] | null> => {
  const data = await redis.get(`story_tray:${userId}`);
  return data ? (JSON.parse(data) as StoryTrayUser[]) : null;
};

export default redis;
