/**
 * @fileoverview TypeScript type definitions for the Slack frontend.
 * Contains interfaces for API responses, component props, and WebSocket messages.
 */

/**
 * Represents an authenticated user in the frontend.
 */
export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

/**
 * Represents a workspace (team) in the multi-tenant system.
 */
export interface Workspace {
  id: string;
  name: string;
  domain: string;
  role?: 'owner' | 'admin' | 'member';
}

/**
 * A member of a workspace with their role and join information.
 */
export interface WorkspaceMember {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

/**
 * Represents a channel in a workspace (public, private, or DM).
 */
export interface Channel {
  id: string;
  workspace_id: string;
  name: string;
  topic: string | null;
  description: string | null;
  is_private: boolean;
  is_archived: boolean;
  is_dm: boolean;
  is_member: boolean;
  unread_count: number;
  created_at: string;
}

/**
 * Extended channel type for direct message conversations.
 * Includes the other participants and last message preview.
 */
export interface DMChannel extends Channel {
  other_members: User[];
  last_message: string | null;
  last_message_at: string | null;
}

/**
 * A single emoji reaction on a message.
 */
export interface Reaction {
  emoji: string;
  user_id: string;
}

/**
 * A message in a channel with author info and reactions.
 */
export interface Message {
  id: number;
  workspace_id: string;
  channel_id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  thread_ts: number | null;
  content: string;
  attachments: unknown[] | null;
  reply_count: number;
  reactions: Reaction[] | null;
  created_at: string;
  edited_at: string | null;
}

/**
 * A thread with parent message and all replies.
 */
export interface Thread {
  parent: Message;
  replies: Message[];
}

/**
 * A message search result with highlighted matching content.
 */
export interface SearchResult {
  id: number;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
  highlight?: string[];
  user: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
  channel_name: string;
}

/**
 * User presence status update from WebSocket.
 */
export interface PresenceUpdate {
  userId: string;
  status: 'online' | 'away' | 'offline';
  user?: User;
}

/**
 * WebSocket message envelope received from the server.
 */
export interface WSMessage {
  type: 'message' | 'message_update' | 'message_delete' | 'reaction_add' | 'reaction_remove' | 'typing' | 'presence' | 'connected' | 'pong';
  payload: unknown;
}
