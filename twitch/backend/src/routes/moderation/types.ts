/**
 * Shared types and interfaces for moderation routes
 */
import type { ParamsDictionary } from 'express-serve-static-core';

// ===================
// Request Params
// ===================

export interface ChannelParams extends ParamsDictionary {
  channelId: string;
}

export interface UserBanParams extends ParamsDictionary {
  channelId: string;
  userId: string;
}

export interface MessageParams extends ParamsDictionary {
  channelId: string;
  messageId: string;
}

export interface ModeratorParams extends ParamsDictionary {
  channelId: string;
  userId: string;
}

// ===================
// Request Bodies
// ===================

export interface BanBody {
  userId?: number;
  reason?: string;
  durationSeconds?: number;
}

export interface TimeoutBody {
  userId?: number;
  durationSeconds?: number;
  reason?: string;
}

export interface DeleteMessageBody {
  reason?: string;
}

export interface AddModeratorBody {
  userId?: number;
}

// ===================
// Database Rows
// ===================

export interface UserRow {
  username: string;
}

export interface ChannelOwnerRow {
  user_id: number;
}

export interface RoleRow {
  role: string;
}

export interface BanRow {
  user_id: number;
  reason: string | null;
  expires_at: Date | null;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banned_by_username: string | null;
}

export interface ModeratorRow {
  user_id: number;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_url: string | null;
  added_by_username: string | null;
}

// ===================
// Access Control
// ===================

export interface ModeratorAccessResult {
  hasAccess: boolean;
  role: string | null;
}
