import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Publisher client
export const redis = new Redis(redisUrl);

// Subscriber client (separate connection for pub/sub)
export const redisSub = new Redis(redisUrl);

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

redisSub.on('error', (err) => {
  console.error('Redis subscriber error:', err);
});

// Session management
export async function getSession(sessionId: string) {
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

export async function setSession(sessionId: string, data: object, ttlSeconds = 86400) {
  await redis.setex(`session:${sessionId}`, ttlSeconds, JSON.stringify(data));
}

export async function deleteSession(sessionId: string) {
  await redis.del(`session:${sessionId}`);
}

// Pub/Sub for cross-server collaboration
export function publishToSpreadsheet(spreadsheetId: string, message: object) {
  redis.publish(`spreadsheet:${spreadsheetId}`, JSON.stringify(message));
}

export function subscribeToSpreadsheet(spreadsheetId: string, callback: (message: object) => void) {
  redisSub.subscribe(`spreadsheet:${spreadsheetId}`);
  redisSub.on('message', (channel, message) => {
    if (channel === `spreadsheet:${spreadsheetId}`) {
      try {
        callback(JSON.parse(message));
      } catch (e) {
        console.error('Failed to parse pub/sub message:', e);
      }
    }
  });
}

export function unsubscribeFromSpreadsheet(spreadsheetId: string) {
  redisSub.unsubscribe(`spreadsheet:${spreadsheetId}`);
}
