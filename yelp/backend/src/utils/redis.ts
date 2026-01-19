import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Redis client connected');
});

// Session data interface
interface SessionData {
  userId: string;
}

// Cache helper functions
export const cache = {
  // Get cached value
  async get<T>(key: string): Promise<T | null> {
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  },

  // Set cached value with TTL (default 1 hour)
  async set<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  },

  // Delete cached value
  async del(key: string): Promise<void> {
    await redis.del(key);
  },

  // Delete multiple keys by pattern
  async delPattern(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  },

  // Increment a counter
  async incr(key: string): Promise<number> {
    return await redis.incr(key);
  },

  // Get or set cached value
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = 3600
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;

    const value = await fetchFn();
    await this.set(key, value, ttlSeconds);
    return value;
  },
};

// Session management
export const sessions = {
  async create(
    userId: string,
    token: string,
    ttlSeconds: number = 86400 * 7
  ): Promise<void> {
    await redis.setex(
      `session:${token}`,
      ttlSeconds,
      JSON.stringify({ userId })
    );
  },

  async get(token: string): Promise<SessionData | null> {
    const session = await redis.get(`session:${token}`);
    return session ? (JSON.parse(session) as SessionData) : null;
  },

  async destroy(token: string): Promise<void> {
    await redis.del(`session:${token}`);
  },

  async destroyAllForUser(userId: string): Promise<void> {
    const keys = await redis.keys(`session:*`);
    for (const key of keys) {
      const session = await redis.get(key);
      if (session) {
        const parsed = JSON.parse(session) as SessionData;
        if (parsed.userId === userId) {
          await redis.del(key);
        }
      }
    }
  },
};
