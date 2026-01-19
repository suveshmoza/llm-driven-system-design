import { query } from '../utils/db.js';
import { cacheGet, cacheSet, getTrendingVideos } from '../utils/redis.js';

// ============ Type Definitions ============

interface VideoRow {
  id: string;
  title: string;
  description: string;
  duration_seconds: number;
  thumbnail_url: string;
  view_count: number;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  published_at: Date;
  channel_id: string;
  channel_name: string;
  username: string;
  avatar_url: string | null;
  categories: string[];
  tags: string[];
  status: string;
  visibility: string;
  source?: string;
}

interface WatchHistoryRow extends VideoRow {
  watched_at: Date;
  watch_percentage: number;
  last_position_seconds: number;
}

interface VideoRecommendation {
  id: string;
  title: string;
  description: string;
  duration: number;
  thumbnailUrl: string | null;
  viewCount: number;
  likeCount: number;
  publishedAt: Date;
  source?: string;
  channel: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  };
}

interface WatchHistoryVideo extends VideoRecommendation {
  watchedAt: Date;
  watchPercentage: number;
  resumePosition: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface PaginatedResult<T> {
  videos: T[];
  pagination: Pagination;
}

interface SearchResult extends PaginatedResult<VideoRecommendation> {
  query: string;
}

interface SearchOptions {
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'date' | 'views' | 'rating';
}

// ============ Service Functions ============

/**
 * Get personalized recommendations for a user
 */
export const getRecommendations = async (
  userId: string | null | undefined,
  limit: number = 20
): Promise<VideoRecommendation[]> => {
  // Check cache first
  const cacheKey = userId ? `recommendations:${userId}` : 'recommendations:anonymous';
  const cached = await cacheGet<VideoRecommendation[]>(cacheKey);
  if (cached) {
    return cached;
  }

  let recommendations: VideoRecommendation[];

  if (userId) {
    recommendations = await getPersonalizedRecommendations(userId, limit);
  } else {
    recommendations = await getGenericRecommendations(limit);
  }

  // Cache for 10 minutes
  await cacheSet(cacheKey, recommendations, 600);

  return recommendations;
};

/**
 * Get personalized recommendations based on watch history
 */
const getPersonalizedRecommendations = async (
  userId: string,
  limit: number
): Promise<VideoRecommendation[]> => {
  // Get user's watch history and preferences
  const watchHistory = await query<{ video_id: string; watch_percentage: number }>(
    `SELECT video_id, watch_percentage
     FROM watch_history
     WHERE user_id = $1
     ORDER BY watched_at DESC
     LIMIT 50`,
    [userId]
  );

  const watchedVideoIds = watchHistory.rows.map((r) => r.video_id);

  // Get preferred categories from watched videos
  const categoryPreferences = await query<{ category: string; count: string }>(
    `SELECT UNNEST(categories) as category, COUNT(*) as count
     FROM videos
     WHERE id = ANY($1)
     GROUP BY category
     ORDER BY count DESC
     LIMIT 5`,
    [watchedVideoIds.length > 0 ? watchedVideoIds : ['none']]
  );

  const preferredCategories = categoryPreferences.rows.map((r) => r.category);

  // Get subscribed channels
  const subscriptions = await query<{ channel_id: string }>(
    'SELECT channel_id FROM subscriptions WHERE subscriber_id = $1',
    [userId]
  );

  const subscribedChannelIds = subscriptions.rows.map((r) => r.channel_id);

  // Combine multiple recommendation sources
  const recommendations: (VideoRow & { source: string })[] = [];

  // 1. Recent videos from subscribed channels (highest priority)
  if (subscribedChannelIds.length > 0) {
    const subscriptionVideos = await query<VideoRow>(
      `SELECT v.*, u.username, u.channel_name, u.avatar_url
       FROM videos v
       JOIN users u ON v.channel_id = u.id
       WHERE v.channel_id = ANY($1)
         AND v.status = 'ready'
         AND v.visibility = 'public'
         AND v.id != ALL($2)
       ORDER BY v.published_at DESC
       LIMIT $3`,
      [
        subscribedChannelIds,
        watchedVideoIds.length > 0 ? watchedVideoIds : ['none'],
        Math.ceil(limit * 0.4),
      ]
    );

    recommendations.push(
      ...subscriptionVideos.rows.map((v) => ({ ...v, source: 'subscription' }))
    );
  }

  // 2. Videos from preferred categories
  if (preferredCategories.length > 0) {
    const categoryVideos = await query<VideoRow>(
      `SELECT v.*, u.username, u.channel_name, u.avatar_url
       FROM videos v
       JOIN users u ON v.channel_id = u.id
       WHERE v.categories && $1
         AND v.status = 'ready'
         AND v.visibility = 'public'
         AND v.id != ALL($2)
       ORDER BY v.view_count DESC, v.published_at DESC
       LIMIT $3`,
      [
        preferredCategories,
        watchedVideoIds.length > 0 ? watchedVideoIds : ['none'],
        Math.ceil(limit * 0.3),
      ]
    );

    recommendations.push(
      ...categoryVideos.rows.map((v) => ({ ...v, source: 'category' }))
    );
  }

  // 3. Trending videos
  const trendingIds = await getTrendingVideos(Math.ceil(limit * 0.3));
  if (trendingIds.length > 0) {
    const trendingVideos = await query<VideoRow>(
      `SELECT v.*, u.username, u.channel_name, u.avatar_url
       FROM videos v
       JOIN users u ON v.channel_id = u.id
       WHERE v.id = ANY($1)
         AND v.status = 'ready'
         AND v.visibility = 'public'
         AND v.id != ALL($2)`,
      [trendingIds, watchedVideoIds.length > 0 ? watchedVideoIds : ['none']]
    );

    recommendations.push(
      ...trendingVideos.rows.map((v) => ({ ...v, source: 'trending' }))
    );
  }

  // Deduplicate and shuffle
  const uniqueRecommendations = deduplicateAndShuffle(recommendations, limit);

  return uniqueRecommendations.map(formatVideoForRecommendation);
};

/**
 * Get generic recommendations for anonymous users
 */
const getGenericRecommendations = async (limit: number): Promise<VideoRecommendation[]> => {
  // Mix of trending and recent popular videos
  const recommendations: (VideoRow & { source: string })[] = [];

  // 1. Trending videos
  const trendingIds = await getTrendingVideos(Math.ceil(limit * 0.5));
  if (trendingIds.length > 0) {
    const trendingVideos = await query<VideoRow>(
      `SELECT v.*, u.username, u.channel_name, u.avatar_url
       FROM videos v
       JOIN users u ON v.channel_id = u.id
       WHERE v.id = ANY($1)
         AND v.status = 'ready'
         AND v.visibility = 'public'`,
      [trendingIds]
    );

    recommendations.push(
      ...trendingVideos.rows.map((v) => ({ ...v, source: 'trending' }))
    );
  }

  // 2. Recent popular videos
  const popularVideos = await query<VideoRow>(
    `SELECT v.*, u.username, u.channel_name, u.avatar_url
     FROM videos v
     JOIN users u ON v.channel_id = u.id
     WHERE v.status = 'ready'
       AND v.visibility = 'public'
       AND v.published_at > NOW() - INTERVAL '7 days'
     ORDER BY v.view_count DESC
     LIMIT $1`,
    [Math.ceil(limit * 0.5)]
  );

  recommendations.push(
    ...popularVideos.rows.map((v) => ({ ...v, source: 'popular' }))
  );

  // Deduplicate and shuffle
  const uniqueRecommendations = deduplicateAndShuffle(recommendations, limit);

  return uniqueRecommendations.map(formatVideoForRecommendation);
};

/**
 * Get trending videos
 */
export const getTrending = async (
  limit: number = 50,
  category: string | null = null
): Promise<VideoRecommendation[]> => {
  const cacheKey = category ? `trending:${category}` : 'trending:all';
  const cached = await cacheGet<VideoRecommendation[]>(cacheKey);
  if (cached) {
    return cached;
  }

  let queryText = `
    SELECT v.*, u.username, u.channel_name, u.avatar_url
    FROM videos v
    JOIN users u ON v.channel_id = u.id
    WHERE v.status = 'ready'
      AND v.visibility = 'public'
      AND v.published_at > NOW() - INTERVAL '7 days'
  `;

  const params: (string | number)[] = [];

  if (category) {
    queryText += ` AND $1 = ANY(v.categories)`;
    params.push(category);
  }

  queryText += `
    ORDER BY
      (v.view_count * 1 + v.like_count * 10 + v.comment_count * 20) *
      EXP(-EXTRACT(EPOCH FROM (NOW() - v.published_at)) / (48 * 3600))
    DESC
    LIMIT $${params.length + 1}
  `;

  params.push(limit);

  const result = await query<VideoRow>(queryText, params);

  const trending = result.rows.map(formatVideoForRecommendation);

  // Cache for 10 minutes
  await cacheSet(cacheKey, trending, 600);

  return trending;
};

/**
 * Search videos
 */
export const searchVideos = async (
  searchQuery: string,
  options: SearchOptions = {}
): Promise<SearchResult> => {
  const { page = 1, limit = 20, sortBy = 'relevance' } = options;

  const offset = (page - 1) * limit;

  // Build search query with ranking
  let orderClause: string;
  switch (sortBy) {
    case 'date':
      orderClause = 'v.published_at DESC';
      break;
    case 'views':
      orderClause = 'v.view_count DESC';
      break;
    case 'rating':
      orderClause =
        '(v.like_count::float / NULLIF(v.like_count + v.dislike_count, 0)) DESC NULLS LAST';
      break;
    default:
      // Relevance: combine text matching with popularity
      orderClause = `
        (
          CASE WHEN v.title ILIKE $1 THEN 100 ELSE 0 END +
          CASE WHEN v.title ILIKE $2 THEN 50 ELSE 0 END +
          CASE WHEN v.description ILIKE $2 THEN 20 ELSE 0 END +
          LOG(GREATEST(v.view_count, 1))
        ) DESC
      `;
  }

  const exactMatch = searchQuery;
  const fuzzyMatch = `%${searchQuery}%`;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)
     FROM videos v
     WHERE v.status = 'ready'
       AND v.visibility = 'public'
       AND (v.title ILIKE $1 OR v.description ILIKE $1 OR $2 = ANY(v.tags))`,
    [fuzzyMatch, searchQuery.toLowerCase()]
  );

  const countRow = countResult.rows[0];
  const total = countRow ? parseInt(countRow.count, 10) : 0;

  const result = await query<VideoRow>(
    `SELECT v.*, u.username, u.channel_name, u.avatar_url
     FROM videos v
     JOIN users u ON v.channel_id = u.id
     WHERE v.status = 'ready'
       AND v.visibility = 'public'
       AND (v.title ILIKE $2 OR v.description ILIKE $2 OR $3 = ANY(v.tags))
     ORDER BY ${orderClause}
     LIMIT $4 OFFSET $5`,
    [exactMatch, fuzzyMatch, searchQuery.toLowerCase(), limit, offset]
  );

  return {
    videos: result.rows.map(formatVideoForRecommendation),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    query: searchQuery,
  };
};

/**
 * Get subscription feed
 */
export const getSubscriptionFeed = async (
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<PaginatedResult<VideoRecommendation>> => {
  const offset = (page - 1) * limit;

  // Get subscribed channel IDs
  const subscriptions = await query<{ channel_id: string }>(
    'SELECT channel_id FROM subscriptions WHERE subscriber_id = $1',
    [userId]
  );

  if (subscriptions.rows.length === 0) {
    return {
      videos: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
  }

  const channelIds = subscriptions.rows.map((r) => r.channel_id);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)
     FROM videos
     WHERE channel_id = ANY($1)
       AND status = 'ready'
       AND visibility = 'public'`,
    [channelIds]
  );

  const countRow = countResult.rows[0];
  const total = countRow ? parseInt(countRow.count, 10) : 0;

  const result = await query<VideoRow>(
    `SELECT v.*, u.username, u.channel_name, u.avatar_url
     FROM videos v
     JOIN users u ON v.channel_id = u.id
     WHERE v.channel_id = ANY($1)
       AND v.status = 'ready'
       AND v.visibility = 'public'
     ORDER BY v.published_at DESC
     LIMIT $2 OFFSET $3`,
    [channelIds, limit, offset]
  );

  return {
    videos: result.rows.map(formatVideoForRecommendation),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get watch history
 */
export const getWatchHistory = async (
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<PaginatedResult<WatchHistoryVideo>> => {
  const offset = (page - 1) * limit;

  const countResult = await query<{ count: string }>(
    'SELECT COUNT(DISTINCT video_id) FROM watch_history WHERE user_id = $1',
    [userId]
  );

  const countRow = countResult.rows[0];
  const total = countRow ? parseInt(countRow.count, 10) : 0;

  const result = await query<WatchHistoryRow>(
    `SELECT DISTINCT ON (wh.video_id)
       v.*, u.username, u.channel_name, u.avatar_url,
       wh.watched_at, wh.watch_percentage, wh.last_position_seconds
     FROM watch_history wh
     JOIN videos v ON wh.video_id = v.id
     JOIN users u ON v.channel_id = u.id
     WHERE wh.user_id = $1
       AND v.status = 'ready'
     ORDER BY wh.video_id, wh.watched_at DESC`,
    [userId]
  );

  // Sort by watched_at after deduplication
  const sorted = result.rows.sort(
    (a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime()
  );

  const paginated = sorted.slice(offset, offset + limit);

  return {
    videos: paginated.map((v) => ({
      ...formatVideoForRecommendation(v),
      watchedAt: v.watched_at,
      watchPercentage: v.watch_percentage,
      resumePosition: v.last_position_seconds,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// ============ Helper Functions ============

/**
 * Deduplicate videos by ID and shuffle
 */
const deduplicateAndShuffle = <T extends { id: string }>(
  videos: T[],
  limit: number
): T[] => {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const video of videos) {
    if (!seen.has(video.id)) {
      seen.add(video.id);
      unique.push(video);
    }
  }

  // Fisher-Yates shuffle
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = unique[i];
    const swapVal = unique[j];
    if (temp !== undefined && swapVal !== undefined) {
      unique[i] = swapVal;
      unique[j] = temp;
    }
  }

  return unique.slice(0, limit);
};

/**
 * Format video row for recommendation response
 */
const formatVideoForRecommendation = (row: VideoRow): VideoRecommendation => ({
  id: row.id,
  title: row.title,
  description: row.description,
  duration: row.duration_seconds,
  thumbnailUrl: row.thumbnail_url,
  viewCount: row.view_count,
  likeCount: row.like_count,
  publishedAt: row.published_at,
  source: row.source,
  channel: {
    id: row.channel_id,
    name: row.channel_name,
    username: row.username,
    avatarUrl: row.avatar_url,
  },
});
