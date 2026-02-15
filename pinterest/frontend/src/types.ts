export interface User {
  id: string;
  username: string;
  email?: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  isFollowing?: boolean;
  createdAt: string;
}

export interface Pin {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  aspectRatio: number | null;
  dominantColor: string | null;
  linkUrl: string | null;
  saveCount: number;
  commentCount: number;
  isSaved?: boolean;
  savedBoardId?: string | null;
  createdAt: string;
  comments?: Comment[];
}

export interface Board {
  id: string;
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  name: string;
  description: string | null;
  isPrivate: boolean;
  pinCount: number;
  coverImageUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Comment {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  content: string;
  parentCommentId: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  pins?: T[];
  boards?: T[];
  users?: T[];
  nextCursor: string | null;
}
