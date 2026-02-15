export interface User {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  display_name?: string;
  avatar_url?: string | null;
  role?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  created_by?: string;
  created_at: string;
  member_role?: string;
}

export interface OrgMember {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
  joined_at: string;
}

export interface Team {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  is_private: boolean;
  created_by?: string;
  created_at: string;
  member_role?: string;
}

export interface TeamMember {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
  joined_at: string;
}

export interface Channel {
  id: string;
  team_id: string;
  name: string;
  description?: string;
  is_private: boolean;
  created_by?: string;
  created_at: string;
  is_member?: boolean;
}

export interface ChannelMember {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  last_read_at: string;
  joined_at: string;
  isOnline?: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  parent_message_id?: string | null;
  content: string;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  reply_count?: number;
  reactions: Reaction[];
}

export interface FileAttachment {
  id: string;
  message_id?: string;
  channel_id: string;
  user_id: string;
  filename: string;
  content_type?: string;
  size_bytes?: number;
  storage_path: string;
  created_at: string;
  username?: string;
  display_name?: string;
}
