/**
 * Authenticated user information.
 * Represents the currently logged-in user's profile data.
 */
export interface User {
  /** Unique user identifier */
  id: string;
  /** Unique username for login and @mentions */
  username: string;
  /** User's email address */
  email: string;
  /** Display name for the user's channel */
  channelName: string;
  /** User's role for authorization */
  role: 'user' | 'admin';
  /** URL to the user's avatar image */
  avatarUrl: string | null;
}

/**
 * Channel profile information.
 * Represents a content creator's public channel page.
 */
export interface Channel {
  /** Unique channel identifier (same as user ID) */
  id: string;
  /** Channel owner's username */
  username: string;
  /** Display name shown on the channel page */
  name: string;
  /** Channel description/bio */
  description: string | null;
  /** URL to the channel's avatar image */
  avatarUrl: string | null;
  /** Number of subscribers to this channel */
  subscriberCount: number;
  /** Total number of uploaded videos */
  videoCount?: number;
  /** Whether the current user is subscribed */
  isSubscribed?: boolean;
  /** When the channel was created */
  createdAt: string;
}

/**
 * Video metadata and statistics.
 * Core type representing a video in the platform.
 */
export interface Video {
  /** Unique video identifier */
  id: string;
  /** Video title */
  title: string;
  /** Video description text */
  description: string | null;
  /** Video duration in seconds */
  duration: number | null;
  /** Current processing/visibility status */
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'blocked';
  /** Video visibility setting */
  visibility: 'public' | 'unlisted' | 'private';
  /** URL to the video thumbnail image */
  thumbnailUrl: string | null;
  /** Total view count */
  viewCount: number;
  /** Number of likes */
  likeCount: number;
  /** Number of dislikes */
  dislikeCount: number;
  /** Number of comments */
  commentCount: number;
  /** Video categories for discovery */
  categories: string[];
  /** Tags for search and recommendations */
  tags: string[];
  /** When the video was published (made public) */
  publishedAt: string | null;
  /** When the video was uploaded */
  createdAt: string;
  /** Channel that uploaded the video */
  channel?: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
    subscriberCount?: number;
  };
  /** Current user's reaction (like/dislike) if any */
  userReaction?: 'like' | 'dislike' | null;
  /** Current user's watch progress for resuming */
  watchProgress?: {
    position: number;
    percentage: number;
  } | null;
}

/**
 * Video with recommendation source metadata.
 * Extends Video with information about why it was recommended.
 */
export interface RecommendedVideo extends Video {
  /** Source of the recommendation */
  source?: 'subscription' | 'category' | 'trending' | 'popular';
}

/**
 * Video streaming configuration.
 * Contains URLs and metadata needed for video playback.
 */
export interface StreamingInfo {
  /** Video identifier */
  videoId: string;
  /** Video title */
  title: string;
  /** Video description */
  description: string | null;
  /** Video duration in seconds */
  duration: number;
  /** Thumbnail URL for poster image */
  thumbnailUrl: string | null;
  /** Channel information */
  channel: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  };
  /** URL to HLS master manifest for adaptive streaming */
  masterManifestUrl: string;
  /** Available video quality options */
  resolutions: Resolution[];
  /** View count at time of fetch */
  viewCount: number;
  /** Like count at time of fetch */
  likeCount: number;
  /** Dislike count at time of fetch */
  dislikeCount: number;
  /** When the video was published */
  publishedAt: string;
}

/**
 * Video resolution/quality option.
 * Represents a single quality level for video playback.
 */
export interface Resolution {
  /** Human-readable resolution label (e.g., "720p") */
  resolution: string;
  /** URL to the HLS manifest for this resolution */
  manifestUrl: string;
  /** Direct URL to the video file */
  videoUrl: string;
  /** Video bitrate in bits per second */
  bitrate: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
}

/**
 * User comment on a video.
 */
export interface Comment {
  /** Unique comment identifier */
  id: string;
  /** Comment text content */
  text: string;
  /** Number of likes on this comment */
  likeCount: number;
  /** Whether the comment has been edited */
  isEdited: boolean;
  /** When the comment was posted */
  createdAt: string;
  /** Number of replies to this comment */
  replyCount?: number;
  /** Comment author information */
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
  /** Parent comment ID for replies (null for top-level) */
  parentId: string | null;
}

/**
 * Chunked upload session information.
 * Returned when initiating a large file upload.
 */
export interface UploadSession {
  /** Unique upload session identifier */
  uploadId: string;
  /** Total number of chunks expected */
  totalChunks: number;
  /** Size of each chunk in bytes */
  chunkSize: number;
  /** Storage key for the raw video file */
  rawVideoKey: string;
}

/**
 * Current upload progress information.
 */
export interface UploadProgress {
  /** Upload session identifier */
  uploadId: string;
  /** Original filename */
  filename: string;
  /** Total file size in bytes */
  fileSize: number;
  /** Current upload status */
  status: 'active' | 'completed' | 'cancelled';
  /** Number of chunks uploaded so far */
  uploadedChunks: number;
  /** Total number of chunks */
  totalChunks: number;
  /** Upload progress percentage (0-100) */
  progress: number;
}

/**
 * Video transcoding status after upload.
 */
export interface TranscodingStatus {
  /** Video identifier */
  videoId: string;
  /** Current transcoding status */
  status: 'queued' | 'processing' | 'completed' | 'failed';
  /** Transcoding progress percentage */
  progress?: number;
  /** List of completed resolution outputs */
  completedResolutions?: string[];
  /** Error message if transcoding failed */
  error?: string;
}

/**
 * Generic paginated API response wrapper.
 * Used for endpoints that return lists with pagination.
 */
export interface PaginatedResponse<T> {
  /** List of videos (for video endpoints) */
  videos?: T[];
  /** List of comments (for comment endpoints) */
  comments?: T[];
  /** List of subscriptions (for subscription endpoints) */
  subscriptions?: T[];
  /** Pagination metadata */
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Search results response.
 * Extends PaginatedResponse with the search query.
 */
export interface SearchResponse extends PaginatedResponse<Video> {
  /** The search query that produced these results */
  query: string;
}

/**
 * Authentication response from login/register endpoints.
 */
export interface AuthResponse {
  /** The authenticated user */
  user: User;
}

/**
 * Login credentials for authentication.
 */
export interface LoginCredentials {
  /** Username */
  username: string;
  /** Password */
  password: string;
}

/**
 * Registration data for new account creation.
 */
export interface RegisterData {
  /** Desired username */
  username: string;
  /** Email address */
  email: string;
  /** Password */
  password: string;
  /** Optional channel name (defaults to username) */
  channelName?: string;
}
