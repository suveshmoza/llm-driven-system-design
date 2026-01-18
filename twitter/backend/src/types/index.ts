// Domain Models

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  header_url: string | null;
  is_verified: boolean;
  is_celebrity: boolean;
  role: 'user' | 'admin';
  follower_count: number;
  following_count: number;
  tweet_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface Tweet {
  id: number;
  author_id: number;
  content: string;
  media_urls: string[];
  hashtags: string[];
  mentions: number[];
  reply_to: number | null;
  retweet_of: number | null;
  quote_of: number | null;
  like_count: number;
  retweet_count: number;
  reply_count: number;
  is_deleted: boolean;
  deleted_at: Date | null;
  created_at: Date;
}

export interface TweetWithAuthor extends Tweet {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface Follow {
  id: number;
  follower_id: number;
  following_id: number;
  created_at: Date;
}

export interface Like {
  id: number;
  user_id: number;
  tweet_id: number;
  created_at: Date;
}

export interface Retweet {
  id: number;
  user_id: number;
  tweet_id: number;
  created_at: Date;
}

export interface Hashtag {
  id: number;
  hashtag: string;
  tweet_count: number;
  created_at: Date;
}

export interface HashtagActivity {
  id: number;
  hashtag: string;
  tweet_id: number;
  created_at: Date;
}

// API Request/Response Types

export interface CreateTweetRequest {
  content: string;
  mediaUrls?: string[];
  replyTo?: string;
  quoteOf?: string;
}

export interface TweetResponse {
  id: string;
  content: string;
  mediaUrls: string[];
  hashtags: string[];
  mentions: number[];
  replyTo: string | null;
  retweetOf: string | null;
  quoteOf: string | null;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  createdAt: Date;
  author: {
    id: number;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  isLiked: boolean;
  isRetweeted: boolean;
  originalTweet?: {
    id: string;
    content: string;
    mediaUrls: string[];
    author: {
      id: number;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
    };
  } | null;
  quotedTweet?: {
    id: string;
    content: string;
    mediaUrls: string[];
    author: {
      id: number;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
    };
  } | null;
}

export interface UserProfile {
  id: number;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  headerUrl: string | null;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  tweetCount: number;
  createdAt: Date;
  isFollowing?: boolean;
}

export interface TrendingHashtag {
  hashtag: string;
  tweetCount: number;
  score: number;
}

// Kafka Event Types

export interface TweetEvent {
  type: 'tweet_created';
  tweetId: number;
  authorId: number;
  content: string;
  hashtags: string[];
  timestamp: number;
}

export interface LikeEvent {
  type: 'like';
  userId: number;
  tweetId: number;
  timestamp: number;
}

export interface RetweetEvent {
  type: 'retweet';
  userId: number;
  tweetId: number;
  timestamp: number;
}

export type KafkaEvent = TweetEvent | LikeEvent | RetweetEvent;
