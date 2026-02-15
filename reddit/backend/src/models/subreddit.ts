import { query } from '../db/index.js';

export interface Subreddit {
  id: number;
  name: string;
  title: string;
  description: string;
  created_by: number;
  subscriber_count: number;
  created_at: Date;
  creator_username?: string;
}

/** Creates a new subreddit with a lowercase name. */
export const createSubreddit = async (
  name: string,
  title: string,
  description: string,
  createdBy: number
): Promise<Subreddit> => {
  const result = await query<Subreddit>(
    `INSERT INTO subreddits (name, title, description, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name.toLowerCase(), title, description, createdBy]
  );
  return result.rows[0];
};

/** Finds a subreddit by its case-insensitive name with creator info. */
export const findSubredditByName = async (name: string): Promise<Subreddit | undefined> => {
  const result = await query<Subreddit>(
    `SELECT s.*, u.username as creator_username
     FROM subreddits s
     LEFT JOIN users u ON s.created_by = u.id
     WHERE s.name = $1`,
    [name.toLowerCase()]
  );
  return result.rows[0];
};

/** Finds a subreddit by its numeric ID with creator info. */
export const findSubredditById = async (id: number): Promise<Subreddit | undefined> => {
  const result = await query<Subreddit>(
    `SELECT s.*, u.username as creator_username
     FROM subreddits s
     LEFT JOIN users u ON s.created_by = u.id
     WHERE s.id = $1`,
    [id]
  );
  return result.rows[0];
};

/** Lists subreddits ordered by subscriber count with pagination. */
export const listSubreddits = async (limit: number = 25, offset: number = 0): Promise<Subreddit[]> => {
  const result = await query<Subreddit>(
    `SELECT s.*, u.username as creator_username
     FROM subreddits s
     LEFT JOIN users u ON s.created_by = u.id
     ORDER BY s.subscriber_count DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
};

/** Searches subreddits by name, title, or description using ILIKE. */
export const searchSubreddits = async (searchQuery: string, limit: number = 25): Promise<Subreddit[]> => {
  const result = await query<Subreddit>(
    `SELECT s.*, u.username as creator_username
     FROM subreddits s
     LEFT JOIN users u ON s.created_by = u.id
     WHERE s.name ILIKE $1 OR s.title ILIKE $1 OR s.description ILIKE $1
     ORDER BY s.subscriber_count DESC
     LIMIT $2`,
    [`%${searchQuery}%`, limit]
  );
  return result.rows;
};

/** Subscribes a user to a subreddit and increments the subscriber count. */
export const subscribe = async (userId: number, subredditId: number): Promise<void> => {
  await query(
    `INSERT INTO subscriptions (user_id, subreddit_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, subredditId]
  );

  // Update subscriber count
  await query(
    `UPDATE subreddits SET subscriber_count = subscriber_count + 1 WHERE id = $1`,
    [subredditId]
  );
};

/** Unsubscribes a user from a subreddit and decrements the subscriber count. */
export const unsubscribe = async (userId: number, subredditId: number): Promise<void> => {
  const result = await query(
    `DELETE FROM subscriptions WHERE user_id = $1 AND subreddit_id = $2`,
    [userId, subredditId]
  );

  if (result.rowCount && result.rowCount > 0) {
    await query(
      `UPDATE subreddits SET subscriber_count = GREATEST(subscriber_count - 1, 0) WHERE id = $1`,
      [subredditId]
    );
  }
};

/** Checks whether a user is subscribed to a given subreddit. */
export const isSubscribed = async (userId: number, subredditId: number): Promise<boolean> => {
  const result = await query(
    `SELECT 1 FROM subscriptions WHERE user_id = $1 AND subreddit_id = $2`,
    [userId, subredditId]
  );
  return result.rows.length > 0;
};

/** Returns all subreddits a user is subscribed to, ordered alphabetically. */
export const getUserSubscriptions = async (userId: number): Promise<Subreddit[]> => {
  const result = await query<Subreddit>(
    `SELECT s.*
     FROM subreddits s
     JOIN subscriptions sub ON s.id = sub.subreddit_id
     WHERE sub.user_id = $1
     ORDER BY s.name`,
    [userId]
  );
  return result.rows;
};
