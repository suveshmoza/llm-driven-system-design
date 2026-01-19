/**
 * Shared types and interfaces for moderation routes.
 *
 * Contains all TypeScript type definitions used across the moderation module,
 * including request parameters, request bodies, and database row types.
 *
 * @module routes/moderation/types
 */
import type { ParamsDictionary } from 'express-serve-static-core';

// ===================
// Request Params
// ===================

/**
 * Route parameters for channel-scoped endpoints.
 *
 * @description Parameters extracted from routes like /:channelId/*
 */
export interface ChannelParams extends ParamsDictionary {
  /** The unique identifier of the channel */
  channelId: string;
}

/**
 * Route parameters for user ban operations.
 *
 * @description Parameters for routes like /:channelId/ban/:userId
 */
export interface UserBanParams extends ParamsDictionary {
  /** The unique identifier of the channel */
  channelId: string;
  /** The unique identifier of the user being banned/unbanned */
  userId: string;
}

/**
 * Route parameters for message operations.
 *
 * @description Parameters for routes like /:channelId/message/:messageId
 */
export interface MessageParams extends ParamsDictionary {
  /** The unique identifier of the channel */
  channelId: string;
  /** The unique identifier of the message */
  messageId: string;
}

/**
 * Route parameters for moderator management.
 *
 * @description Parameters for routes like /:channelId/moderator/:userId
 */
export interface ModeratorParams extends ParamsDictionary {
  /** The unique identifier of the channel */
  channelId: string;
  /** The unique identifier of the moderator user */
  userId: string;
}

// ===================
// Request Bodies
// ===================

/**
 * Request body for banning a user.
 *
 * @description Payload for POST /:channelId/ban endpoint
 */
export interface BanBody {
  /** The ID of the user to ban */
  userId?: number;
  /** Optional reason for the ban (shown to user and logged) */
  reason?: string;
  /** Optional duration in seconds; if omitted, ban is permanent */
  durationSeconds?: number;
}

/**
 * Request body for timing out a user.
 *
 * @description Payload for POST /:channelId/timeout endpoint
 */
export interface TimeoutBody {
  /** The ID of the user to timeout */
  userId?: number;
  /** Duration of the timeout in seconds (required) */
  durationSeconds?: number;
  /** Optional reason for the timeout */
  reason?: string;
}

/**
 * Request body for deleting a message.
 *
 * @description Payload for DELETE /:channelId/message/:messageId endpoint
 */
export interface DeleteMessageBody {
  /** Optional reason for the deletion (for audit logging) */
  reason?: string;
}

/**
 * Request body for adding a moderator.
 *
 * @description Payload for POST /:channelId/moderator endpoint
 */
export interface AddModeratorBody {
  /** The ID of the user to add as moderator */
  userId?: number;
}

// ===================
// Database Rows
// ===================

/**
 * Database row for user username lookup.
 *
 * @description Result from users table username query
 */
export interface UserRow {
  /** The user's username */
  username: string;
}

/**
 * Database row for channel owner lookup.
 *
 * @description Result from channels table for owner verification
 */
export interface ChannelOwnerRow {
  /** The user ID of the channel owner */
  user_id: number;
}

/**
 * Database row for user role lookup.
 *
 * @description Result from users table for admin role check
 */
export interface RoleRow {
  /** The user's role (e.g., 'admin', 'user') */
  role: string;
}

/**
 * Database row for ban list query.
 *
 * @description Full ban record with user details for list display
 */
export interface BanRow {
  /** The banned user's ID */
  user_id: number;
  /** The reason for the ban, if provided */
  reason: string | null;
  /** When the ban expires, null for permanent bans */
  expires_at: Date | null;
  /** When the ban was created */
  created_at: Date;
  /** The banned user's username */
  username: string;
  /** The banned user's display name */
  display_name: string;
  /** The banned user's avatar URL */
  avatar_url: string | null;
  /** Username of the moderator who issued the ban */
  banned_by_username: string | null;
}

/**
 * Database row for moderator list query.
 *
 * @description Full moderator record with user details for list display
 */
export interface ModeratorRow {
  /** The moderator's user ID */
  user_id: number;
  /** When the moderator was added */
  created_at: Date;
  /** The moderator's username */
  username: string;
  /** The moderator's display name */
  display_name: string;
  /** The moderator's avatar URL */
  avatar_url: string | null;
  /** Username of who added this moderator */
  added_by_username: string | null;
}

// ===================
// Access Control
// ===================

/**
 * Result of a moderator access check.
 *
 * @description Returned by checkModeratorAccess to indicate access level
 */
export interface ModeratorAccessResult {
  /** Whether the user has access to moderate the channel */
  hasAccess: boolean;
  /** The role granting access: 'owner', 'moderator', 'admin', or null */
  role: string | null;
}
