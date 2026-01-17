/**
 * @fileoverview TypeScript type definitions for the News Feed backend.
 * Defines database models, API response types, and request payloads.
 */

// Database types

/**
 * User entity representing a registered account in the system.
 * Stores profile information, role, and social metrics.
 */
export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  follower_count: number;
  following_count: number;
  is_celebrity: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Post entity representing user-generated content.
 * Supports text, image, and link post types with privacy controls.
 */
export interface Post {
  id: string;
  author_id: string;
  content: string | null;
  image_url: string | null;
  post_type: 'text' | 'image' | 'link';
  privacy: 'public' | 'friends';
  like_count: number;
  comment_count: number;
  share_count: number;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Friendship entity representing a follow relationship between users.
 * Supports pending, active, and blocked states for moderation.
 */
export interface Friendship {
  id: string;
  follower_id: string;
  following_id: string;
  status: 'pending' | 'active' | 'blocked';
  created_at: Date;
}

/**
 * Like entity recording when a user likes a post.
 * Used for like counts and checking if user has liked a post.
 */
export interface Like {
  id: string;
  user_id: string;
  post_id: string;
  created_at: Date;
}

/**
 * Comment entity for user replies on posts.
 * Supports nested comments and engagement tracking.
 */
export interface Comment {
  id: string;
  user_id: string;
  post_id: string;
  content: string;
  like_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * FeedItem entity linking posts to user feeds with ranking scores.
 * Pre-computed during fan-out to enable fast feed retrieval.
 */
export interface FeedItem {
  id: string;
  user_id: string;
  post_id: string;
  score: number;
  created_at: Date;
}

/**
 * Session entity for tracking authenticated user sessions.
 * Tokens are stored in both PostgreSQL and Redis for validation.
 */
export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * Notification entity for user activity alerts.
 * Tracks likes, comments, follows, and other social interactions.
 */
export interface Notification {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: Date;
}

/**
 * AffinityScore entity tracking relationship strength between users.
 * Higher scores surface more content from that user in feeds.
 */
export interface AffinityScore {
  id: string;
  user_id: string;
  target_user_id: string;
  score: number;
  last_interaction_at: Date | null;
  updated_at: Date;
}

// API Response types

/**
 * Public user profile data safe for API responses.
 * Excludes sensitive fields like email and password_hash.
 */
export interface UserPublic {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  follower_count: number;
  following_count: number;
  is_celebrity: boolean;
  created_at: Date;
}

/**
 * Post with embedded author info for display in feeds.
 * Includes is_liked flag indicating current user's like status.
 */
export interface PostWithAuthor extends Post {
  author: UserPublic;
  is_liked?: boolean;
}

/**
 * Comment with embedded author info for display in comment lists.
 */
export interface CommentWithAuthor extends Comment {
  author: UserPublic;
}

/**
 * Paginated feed response with cursor for infinite scroll.
 */
export interface FeedResponse {
  posts: PostWithAuthor[];
  cursor: string | null;
  has_more: boolean;
}

// Request types

/**
 * Request payload for creating a new post.
 */
export interface CreatePostRequest {
  content: string;
  image_url?: string;
  post_type?: 'text' | 'image' | 'link';
  privacy?: 'public' | 'friends';
}

/**
 * Request payload for creating a new comment.
 */
export interface CreateCommentRequest {
  content: string;
}

/**
 * Request payload for updating user profile.
 */
export interface UpdateUserRequest {
  display_name?: string;
  bio?: string;
  avatar_url?: string;
}

/**
 * Request payload for user registration.
 */
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  display_name: string;
}

/**
 * Request payload for user login.
 */
export interface LoginRequest {
  email: string;
  password: string;
}
