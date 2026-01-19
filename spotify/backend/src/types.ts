import type { Request, Response, NextFunction } from 'express';
import type { Session, SessionData } from 'express-session';
import type { Logger } from 'pino';

// Extend express-session to include our custom session data
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

// Extended Request type with our custom properties
export interface AuthenticatedRequest extends Request {
  session: Session & Partial<SessionData> & { userId?: string };
  requestId?: string;
  log?: Logger;
  userRole?: string;
  idempotencyKey?: string;
  idempotencyOperation?: string;
}

// User types
export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_premium: boolean;
  role: string;
  created_at: Date;
  updated_at?: Date;
  password_hash?: string;
}

export interface UserRegistration {
  email: string;
  password: string;
  username: string;
  displayName?: string;
}

export interface UserLogin {
  email: string;
  password: string;
}

export interface UserProfileUpdate {
  display_name?: string;
  avatar_url?: string;
}

// Artist types
export interface Artist {
  id: string;
  name: string;
  bio?: string;
  image_url: string | null;
  verified: boolean;
  monthly_listeners: number;
  created_at?: Date;
}

export interface ArtistWithDetails extends Artist {
  albums: Album[];
  topTracks: TrackWithDetails[];
}

// Album types
export interface Album {
  id: string;
  artist_id: string;
  title: string;
  release_date: string;
  cover_url: string | null;
  album_type: string;
  total_tracks: number;
  created_at?: Date;
}

export interface AlbumWithArtist extends Album {
  artist_name: string;
  track_count?: number;
}

export interface AlbumWithTracks extends AlbumWithArtist {
  tracks: TrackWithArtists[];
}

// Track types
export interface Track {
  id: string;
  album_id: string;
  title: string;
  duration_ms: number;
  track_number: number;
  disc_number?: number;
  audio_url: string | null;
  stream_count: number;
  audio_features?: AudioFeatures;
  created_at?: Date;
}

export interface AudioFeatures {
  tempo?: number;
  energy?: number;
  danceability?: number;
  acousticness?: number;
  genres?: string[];
}

export interface TrackWithDetails extends Track {
  album_title: string;
  album_cover_url: string | null;
  album_id: string;
  artist_name: string;
  artist_id: string;
}

export interface TrackWithArtists extends Track {
  artists: Array<{ id: string; name: string }>;
}

export interface TrackWithPlayedAt extends TrackWithDetails {
  played_at: Date;
  saved_at?: Date;
}

// Playlist types
export interface Playlist {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  cover_url?: string;
  is_public: boolean;
  is_collaborative?: boolean;
  follower_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface PlaylistWithOwner extends Playlist {
  owner_username: string;
  track_count?: number;
}

export interface PlaylistWithTracks extends PlaylistWithOwner {
  tracks: PlaylistTrack[];
}

export interface PlaylistTrack extends TrackWithDetails {
  position: number;
  added_at: Date;
  added_by_username?: string;
}

export interface PlaylistCreate {
  name: string;
  description?: string;
  isPublic?: boolean;
}

export interface PlaylistUpdate {
  name?: string;
  description?: string;
  is_public?: boolean;
  cover_url?: string;
}

export interface ReorderRequest {
  trackId: string;
  newPosition: number;
}

// Library types
export type LibraryItemType = 'track' | 'album' | 'artist' | 'playlist';

export interface LibraryItem {
  user_id: string;
  item_type: LibraryItemType;
  item_id: string;
  saved_at: Date;
}

// Playback types
export type PlaybackEventType =
  | 'play_started'
  | 'play_paused'
  | 'play_resumed'
  | 'play_completed'
  | 'stream_counted'
  | 'seeked'
  | 'skipped';

export interface PlaybackEvent {
  userId: string;
  trackId: string;
  eventType: PlaybackEventType;
  position: number;
  timestamp: number;
  deviceType?: string;
}

export interface PlaybackState {
  trackId?: string;
  position?: number;
  isPlaying?: boolean;
  queue?: string[];
  shuffleEnabled?: boolean;
  repeatMode?: string;
  updatedAt?: number;
}

export interface StreamInfo {
  url: string;
  expiresAt: number;
}

export interface TrackStats {
  stream_count: number;
  like_count: number;
}

// Listening history
export interface ListeningHistoryEntry {
  track_id: string;
  play_count: number;
  completed_count: number;
}

// Pagination
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  total: number;
  limit: number;
  offset: number;
  items?: T[];
}

// Search types
export interface SearchParams extends PaginationParams {
  types?: string[];
}

export interface SearchResults {
  artists?: Artist[];
  albums?: AlbumWithArtist[];
  tracks?: TrackWithDetails[];
}

// Rate limit types
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  count: number;
}

// Idempotency types
export interface IdempotencyResult {
  isDuplicate: boolean;
  cachedResult: unknown;
}

// Audit types
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  actor_id: string | null;
  actor_ip: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
  success: boolean;
  request_id: string | null;
  actor_username?: string;
  actor_email?: string;
}

export interface AuditLogFilters {
  actorId?: string | null;
  action?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  success?: boolean | null;
  limit?: number;
  offset?: number;
}

export interface AuditLogQueryResult {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

// Health check types
export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  dependencies: {
    postgres?: DependencyStatus;
    redis?: DependencyStatus;
  };
}

export interface DependencyStatus {
  status: 'healthy' | 'unhealthy';
  latencyMs?: number | null;
  error?: string;
}

// Admin stats
export interface PlatformStats {
  totalUsers: number;
  totalTracks: number;
  totalPlaylists: number;
  totalStreams: number;
}

// Role cache entry
export interface RoleCacheEntry {
  role: string;
  expiresAt: number;
}

// Kafka message
export interface KafkaPlaybackMessage {
  userId: string;
  trackId: string;
  eventType: PlaybackEventType;
  position: number;
  timestamp: number;
  deviceType?: string;
}

// Type guards
export function isPlaybackEventType(value: string): value is PlaybackEventType {
  return [
    'play_started',
    'play_paused',
    'play_resumed',
    'play_completed',
    'stream_counted',
    'seeked',
    'skipped',
  ].includes(value);
}

export function isLibraryItemType(value: string): value is LibraryItemType {
  return ['track', 'album', 'artist', 'playlist'].includes(value);
}
