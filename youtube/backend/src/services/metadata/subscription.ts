import { query } from '../../utils/db.js';
import { cacheDelete } from '../../utils/redis.js';
import {
  ChannelRow,
  ChannelResponse,
  Pagination,
  SubscriptionResult,
  UnsubscriptionResult,
  DatabaseError,
  formatChannelResponse,
} from './types.js';

// Subscribe to channel
export const subscribe = async (
  subscriberId: string,
  channelId: string
): Promise<SubscriptionResult> => {
  if (subscriberId === channelId) {
    throw new Error('Cannot subscribe to your own channel');
  }

  try {
    await query('INSERT INTO subscriptions (subscriber_id, channel_id) VALUES ($1, $2)', [
      subscriberId,
      channelId,
    ]);

    // Invalidate cache
    await cacheDelete(`channel:${channelId}`);

    return { subscribed: true };
  } catch (error) {
    const dbError = error as DatabaseError;
    if (dbError.code === '23505') {
      // Already subscribed
      return { subscribed: true, alreadySubscribed: true };
    }
    throw error;
  }
};

// Unsubscribe from channel
export const unsubscribe = async (
  subscriberId: string,
  channelId: string
): Promise<UnsubscriptionResult> => {
  const result = await query<{ subscriber_id: string }>(
    'DELETE FROM subscriptions WHERE subscriber_id = $1 AND channel_id = $2 RETURNING subscriber_id',
    [subscriberId, channelId]
  );

  // Invalidate cache
  await cacheDelete(`channel:${channelId}`);

  return { unsubscribed: result.rows.length > 0 };
};

// Check subscription status
export const isSubscribed = async (subscriberId: string, channelId: string): Promise<boolean> => {
  const result = await query(
    'SELECT 1 FROM subscriptions WHERE subscriber_id = $1 AND channel_id = $2',
    [subscriberId, channelId]
  );

  return result.rows.length > 0;
};

// Get user's subscriptions
export const getSubscriptions = async (
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ subscriptions: ChannelResponse[]; pagination: Pagination }> => {
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM subscriptions WHERE subscriber_id = $1',
    [userId]
  );

  const countRow = countResult.rows[0];
  const total = countRow ? parseInt(countRow.count, 10) : 0;

  const result = await query<ChannelRow>(
    `SELECT u.id, u.username, u.channel_name, u.avatar_url, u.subscriber_count
     FROM subscriptions s
     JOIN users u ON s.channel_id = u.id
     WHERE s.subscriber_id = $1
     ORDER BY s.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return {
    subscriptions: result.rows.map(formatChannelResponse),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};
