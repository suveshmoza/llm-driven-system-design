/**
 * @fileoverview Zustand stores for global state management.
 * Provides stores for authentication, workspaces, channels, messages, presence, and UI state.
 * Uses Zustand for lightweight, hook-based state management.
 */

import { create } from 'zustand';
import type { User, Workspace, Channel, DMChannel, Message, Thread, PresenceUpdate } from '../types';

/**
 * Authentication state and actions.
 */
interface AuthState {
  /** Currently authenticated user or null if not logged in */
  user: User | null;
  /** Whether initial auth check is in progress */
  isLoading: boolean;
  /** Update the current user */
  setUser: (user: User | null) => void;
  /** Update loading state */
  setLoading: (loading: boolean) => void;
}

/**
 * Store for authentication state.
 * Tracks the current user and auth loading status.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
}));

/**
 * Workspace state and actions.
 */
interface WorkspaceState {
  /** List of workspaces the user belongs to */
  workspaces: Workspace[];
  /** Currently selected workspace */
  currentWorkspace: Workspace | null;
  /** Cached member lists by workspace ID */
  members: Record<string, User[]>;
  /** Update the workspace list */
  setWorkspaces: (workspaces: Workspace[]) => void;
  /** Set the active workspace */
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  /** Cache members for a workspace */
  setMembers: (workspaceId: string, members: User[]) => void;
}

/**
 * Store for workspace state.
 * Manages the list of workspaces and the currently active workspace.
 */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  currentWorkspace: null,
  members: {},
  setWorkspaces: (workspaces) => set({ workspaces }),
  setCurrentWorkspace: (currentWorkspace) => set({ currentWorkspace }),
  setMembers: (workspaceId, members) =>
    set((state) => ({ members: { ...state.members, [workspaceId]: members } })),
}));

/**
 * Channel state and actions.
 */
interface ChannelState {
  /** List of channels in the current workspace */
  channels: Channel[];
  /** List of direct message conversations */
  dms: DMChannel[];
  /** Currently selected channel or DM */
  currentChannel: Channel | DMChannel | null;
  /** Update the channel list */
  setChannels: (channels: Channel[]) => void;
  /** Update the DM list */
  setDMs: (dms: DMChannel[]) => void;
  /** Set the active channel */
  setCurrentChannel: (channel: Channel | DMChannel | null) => void;
  /** Update a specific channel */
  updateChannel: (channel: Channel) => void;
  /** Update unread count for a channel */
  updateUnreadCount: (channelId: string, count: number) => void;
}

/**
 * Store for channel and DM state.
 * Manages channel lists and the currently viewed channel.
 */
export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  dms: [],
  currentChannel: null,
  setChannels: (channels) => set({ channels }),
  setDMs: (dms) => set({ dms }),
  setCurrentChannel: (currentChannel) => set({ currentChannel }),
  updateChannel: (channel) =>
    set((state) => ({
      channels: state.channels.map((c) => (c.id === channel.id ? { ...c, ...channel } : c)),
    })),
  updateUnreadCount: (channelId, count) =>
    set((state) => ({
      channels: state.channels.map((c) => (c.id === channelId ? { ...c, unread_count: count } : c)),
    })),
}));

/**
 * Message state and actions.
 */
interface MessageState {
  /** Messages by channel ID */
  messages: Record<string, Message[]>;
  /** Currently open thread */
  activeThread: Thread | null;
  /** Users currently typing by channel ID */
  typingUsers: Record<string, string[]>;
  /** Set messages for a channel */
  setMessages: (channelId: string, messages: Message[]) => void;
  /** Add a new message (from WebSocket) */
  addMessage: (message: Message) => void;
  /** Update an existing message */
  updateMessage: (message: Message) => void;
  /** Delete a message by ID */
  deleteMessage: (messageId: number, channelId: string) => void;
  /** Set the active thread */
  setActiveThread: (thread: Thread | null) => void;
  /** Add a reply to the active thread */
  addThreadReply: (reply: Message) => void;
  /** Update typing users for a channel */
  setTypingUsers: (channelId: string, users: string[]) => void;
  /** Add a reaction to a message */
  addReaction: (messageId: number, channelId: string, userId: string, emoji: string) => void;
  /** Remove a reaction from a message */
  removeReaction: (messageId: number, channelId: string, userId: string, emoji: string) => void;
}

/**
 * Store for message state.
 * Manages messages, threads, typing indicators, and reactions.
 */
export const useMessageStore = create<MessageState>((set) => ({
  messages: {},
  activeThread: null,
  typingUsers: {},
  setMessages: (channelId, messages) =>
    set((state) => ({ messages: { ...state.messages, [channelId]: messages } })),
  addMessage: (message) =>
    set((state) => {
      const channelMessages = state.messages[message.channel_id] || [];
      // Check if message already exists
      if (channelMessages.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messages: {
          ...state.messages,
          [message.channel_id]: [...channelMessages, message],
        },
      };
    }),
  updateMessage: (message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [message.channel_id]: (state.messages[message.channel_id] || []).map((m) =>
          m.id === message.id ? message : m
        ),
      },
    })),
  deleteMessage: (messageId, channelId) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).filter((m) => m.id !== messageId),
      },
    })),
  setActiveThread: (activeThread) => set({ activeThread }),
  addThreadReply: (reply) =>
    set((state) => {
      if (!state.activeThread) return state;
      // Check if reply already exists
      if (state.activeThread.replies.some((r) => r.id === reply.id)) {
        return state;
      }
      return {
        activeThread: {
          ...state.activeThread,
          replies: [...state.activeThread.replies, reply],
        },
      };
    }),
  setTypingUsers: (channelId, users) =>
    set((state) => ({ typingUsers: { ...state.typingUsers, [channelId]: users } })),
  addReaction: (messageId, channelId, userId, emoji) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).map((m) => {
          if (m.id !== messageId) return m;
          const reactions = m.reactions || [];
          return { ...m, reactions: [...reactions, { emoji, user_id: userId }] };
        }),
      },
    })),
  removeReaction: (messageId, channelId, userId, emoji) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).map((m) => {
          if (m.id !== messageId) return m;
          const reactions = (m.reactions || []).filter(
            (r) => !(r.emoji === emoji && r.user_id === userId)
          );
          return { ...m, reactions };
        }),
      },
    })),
}));

/**
 * Presence state and actions.
 */
interface PresenceState {
  /** Online status by user ID (true = online) */
  onlineUsers: Record<string, boolean>;
  /** Mark a user as online */
  setOnline: (userId: string) => void;
  /** Mark a user as offline */
  setOffline: (userId: string) => void;
  /** Process a presence update from WebSocket */
  updatePresence: (update: PresenceUpdate) => void;
}

/**
 * Store for user presence state.
 * Tracks which users are online in the workspace.
 */
export const usePresenceStore = create<PresenceState>((set) => ({
  onlineUsers: {},
  setOnline: (userId) =>
    set((state) => ({ onlineUsers: { ...state.onlineUsers, [userId]: true } })),
  setOffline: (userId) =>
    set((state) => ({ onlineUsers: { ...state.onlineUsers, [userId]: false } })),
  updatePresence: (update) =>
    set((state) => ({
      onlineUsers: {
        ...state.onlineUsers,
        [update.userId]: update.status !== 'offline',
      },
    })),
}));

/**
 * UI state and actions.
 */
interface UIState {
  /** Whether the sidebar is expanded */
  isSidebarOpen: boolean;
  /** Whether the thread panel is visible */
  isThreadPanelOpen: boolean;
  /** Whether the search modal is open */
  isSearchOpen: boolean;
  /** Current search query */
  searchQuery: string;
  /** Toggle sidebar visibility */
  toggleSidebar: () => void;
  /** Set thread panel visibility */
  setThreadPanelOpen: (open: boolean) => void;
  /** Set search modal visibility */
  setSearchOpen: (open: boolean) => void;
  /** Update search query */
  setSearchQuery: (query: string) => void;
}

/**
 * Store for UI state.
 * Manages sidebar, thread panel, and search modal visibility.
 */
export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  isThreadPanelOpen: false,
  isSearchOpen: false,
  searchQuery: '',
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setThreadPanelOpen: (isThreadPanelOpen) => set({ isThreadPanelOpen }),
  setSearchOpen: (isSearchOpen) => set({ isSearchOpen }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
