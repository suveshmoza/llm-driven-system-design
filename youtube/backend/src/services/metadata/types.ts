// ============ Database Row Types ============

export interface VideoRow {
  id: string;
  title: string;
  description: string;
  duration_seconds: number;
  status: string;
  visibility: string;
  thumbnail_url: string;
  view_count: number;
  like_count: number;
  dislike_count: number;
  comment_count: number;
  categories: string[];
  tags: string[];
  published_at: string;
  created_at: string;
  channel_id: string;
  raw_video_key?: string;
  username?: string;
  channel_name?: string;
  avatar_url?: string;
  subscriber_count?: number;
}

export interface ChannelRow {
  id: string;
  username: string;
  email?: string;
  channel_name: string;
  channel_description: string;
  avatar_url: string;
  subscriber_count: number;
  created_at: string;
}

export interface CommentRow {
  id: string;
  user_id: string;
  video_id: string;
  text: string;
  parent_id: string | null;
  like_count: number;
  is_edited: boolean;
  created_at: string;
  username?: string;
  avatar_url?: string;
  reply_count?: string;
}

// ============ Response Types ============

export interface VideoResponse {
  id: string;
  title: string;
  description: string;
  duration: number;
  status: string;
  visibility: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  categories: string[];
  tags: string[];
  publishedAt: string;
  createdAt: string;
  channel?: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string;
    subscriberCount: number;
  };
}

export interface ChannelResponse {
  id: string;
  username: string;
  name: string;
  description: string;
  avatarUrl: string;
  subscriberCount: number;
  createdAt: string;
  videoCount?: number;
}

export interface CommentResponse {
  id: string;
  text: string;
  likeCount: number;
  isEdited: boolean;
  createdAt: string;
  replyCount?: number;
  user: {
    id: string;
    username: string;
    avatarUrl: string;
  };
  parentId: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============ Options Types ============

export interface GetVideosOptions {
  page?: number;
  limit?: number;
  channelId?: string | null;
  status?: string;
  visibility?: string;
  search?: string | null;
  category?: string | null;
  orderBy?: string;
  order?: string;
}

export interface VideoUpdates {
  title?: string;
  description?: string;
  categories?: string[];
  tags?: string[];
  visibility?: string;
}

export interface ChannelUpdates {
  channelName?: string;
  channelDescription?: string;
  avatarUrl?: string;
}

// ============ Result Types ============

export interface SubscriptionResult {
  subscribed: boolean;
  alreadySubscribed?: boolean;
}

export interface UnsubscriptionResult {
  unsubscribed: boolean;
}

export interface ReactionResult {
  reaction: string | null;
}

export interface CommentLikeResult {
  liked: boolean;
}

export interface DatabaseError extends Error {
  code?: string;
}

// ============ Helper Functions ============

export const formatVideoResponse = (row: VideoRow): VideoResponse => ({
  id: row.id,
  title: row.title,
  description: row.description,
  duration: row.duration_seconds,
  status: row.status,
  visibility: row.visibility,
  thumbnailUrl: row.thumbnail_url,
  viewCount: row.view_count,
  likeCount: row.like_count,
  dislikeCount: row.dislike_count,
  commentCount: row.comment_count,
  categories: row.categories,
  tags: row.tags,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  channel: row.username
    ? {
        id: row.channel_id,
        name: row.channel_name || '',
        username: row.username,
        avatarUrl: row.avatar_url || '',
        subscriberCount: row.subscriber_count || 0,
      }
    : undefined,
});

export const formatChannelResponse = (row: ChannelRow): ChannelResponse => ({
  id: row.id,
  username: row.username,
  name: row.channel_name,
  description: row.channel_description,
  avatarUrl: row.avatar_url,
  subscriberCount: row.subscriber_count,
  createdAt: row.created_at,
});

export const calculateTrendingScore = (video: VideoResponse): number => {
  const ageHours = (Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60);
  const decayFactor = Math.exp(-ageHours / 48); // Decay over 48 hours

  const engagementScore =
    video.viewCount * 1 + video.likeCount * 10 + video.commentCount * 20;

  return engagementScore * decayFactor;
};
