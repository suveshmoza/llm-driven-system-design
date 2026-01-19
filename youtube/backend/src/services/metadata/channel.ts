import { query } from '../../utils/db.js';
import { cacheGet, cacheSet, cacheDelete } from '../../utils/redis.js';
import {
  ChannelRow,
  ChannelResponse,
  ChannelUpdates,
  formatChannelResponse,
} from './types.js';

// Get channel by ID or username
export const getChannel = async (identifier: string): Promise<ChannelResponse | null> => {
  const cached = await cacheGet<ChannelResponse>(`channel:${identifier}`);
  if (cached) {
    return cached;
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  const result = await query<ChannelRow>(
    `SELECT id, username, email, channel_name, channel_description, avatar_url, subscriber_count, created_at
     FROM users
     WHERE ${isUuid ? 'id' : 'username'} = $1`,
    [identifier]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const channel = formatChannelResponse(row);

  // Get video count
  const videoCountResult = await query<{ count: string }>(
    "SELECT COUNT(*) FROM videos WHERE channel_id = $1 AND status = 'ready' AND visibility = 'public'",
    [channel.id]
  );

  const videoCountRow = videoCountResult.rows[0];
  channel.videoCount = videoCountRow ? parseInt(videoCountRow.count, 10) : 0;

  // Cache for 5 minutes
  await cacheSet(`channel:${identifier}`, channel, 300);

  return channel;
};

// Update channel
export const updateChannel = async (
  userId: string,
  updates: ChannelUpdates
): Promise<ChannelResponse | null> => {
  const { channelName, channelDescription, avatarUrl } = updates;

  const result = await query<ChannelRow>(
    `UPDATE users
     SET channel_name = COALESCE($1, channel_name),
         channel_description = COALESCE($2, channel_description),
         avatar_url = COALESCE($3, avatar_url)
     WHERE id = $4
     RETURNING id, username, channel_name, channel_description, avatar_url, subscriber_count`,
    [channelName, channelDescription, avatarUrl, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  // Invalidate cache
  await cacheDelete(`channel:${userId}`);

  return formatChannelResponse(row);
};
