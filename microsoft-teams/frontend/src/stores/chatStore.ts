import { create } from 'zustand';
import type { Organization, Team, Channel, Message, ChannelMember } from '../types';
import { orgApi, teamApi, channelApi, messageApi, presenceApi } from '../services/api';

interface ChatState {
  // Data
  organizations: Organization[];
  teams: Team[];
  channels: Channel[];
  messages: Message[];
  threadMessages: Message[];
  channelMembers: ChannelMember[];

  // Selection
  currentOrgId: string | null;
  currentTeamId: string | null;
  currentChannelId: string | null;
  threadParentId: string | null;

  // UI state
  loading: boolean;
  sseConnection: EventSource | null;
  showMemberList: boolean;

  // Actions
  loadOrganizations: () => Promise<void>;
  loadTeams: (orgId: string) => Promise<void>;
  loadChannels: (teamId: string) => Promise<void>;
  loadMessages: (channelId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  loadThread: (messageId: string) => Promise<void>;
  loadChannelMembers: (channelId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  sendThreadReply: (content: string) => Promise<void>;
  setCurrentOrg: (orgId: string) => void;
  setCurrentTeam: (teamId: string) => void;
  setCurrentChannel: (channelId: string) => void;
  openThread: (messageId: string) => void;
  closeThread: () => void;
  toggleMemberList: () => void;
  connectSSE: (channelId: string) => void;
  disconnectSSE: () => void;
  addMessageFromSSE: (message: Message) => void;
  startPresenceHeartbeat: () => () => void;
}

/** Chat state managing org/team/channel hierarchy, messages, threads, SSE connection, and presence. */
export const useChatStore = create<ChatState>((set, get) => ({
  organizations: [],
  teams: [],
  channels: [],
  messages: [],
  threadMessages: [],
  channelMembers: [],
  currentOrgId: null,
  currentTeamId: null,
  currentChannelId: null,
  threadParentId: null,
  loading: false,
  sseConnection: null,
  showMemberList: false,

  loadOrganizations: async () => {
    try {
      const { organizations } = await orgApi.list();
      set({ organizations });
    } catch (err) {
      console.error('Failed to load organizations:', err);
    }
  },

  loadTeams: async (orgId: string) => {
    try {
      const { teams } = await teamApi.list(orgId);
      set({ teams, currentOrgId: orgId });
    } catch (err) {
      console.error('Failed to load teams:', err);
    }
  },

  loadChannels: async (teamId: string) => {
    try {
      const { channels } = await channelApi.list(teamId);
      set({ channels, currentTeamId: teamId });
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  },

  loadMessages: async (channelId: string) => {
    set({ loading: true });
    try {
      const { messages } = await messageApi.list(channelId);
      set({ messages: messages.reverse(), currentChannelId: channelId, loading: false });
    } catch (err) {
      console.error('Failed to load messages:', err);
      set({ loading: false });
    }
  },

  loadMoreMessages: async () => {
    const { messages, currentChannelId } = get();
    if (!currentChannelId || messages.length === 0) return;

    try {
      const oldest = messages[0];
      const { messages: olderMessages } = await messageApi.list(
        currentChannelId,
        oldest.created_at,
      );
      set({ messages: [...olderMessages.reverse(), ...messages] });
    } catch (err) {
      console.error('Failed to load more messages:', err);
    }
  },

  loadThread: async (messageId: string) => {
    try {
      const { messages } = await messageApi.getThread(messageId);
      set({ threadMessages: messages, threadParentId: messageId });
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  },

  loadChannelMembers: async (channelId: string) => {
    try {
      const { members } = await presenceApi.getChannelPresence(channelId);
      set({ channelMembers: members });
    } catch (err) {
      console.error('Failed to load channel members:', err);
    }
  },

  sendMessage: async (content: string) => {
    const { currentChannelId } = get();
    if (!currentChannelId) return;

    try {
      await messageApi.send(currentChannelId, content);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  },

  sendThreadReply: async (content: string) => {
    const { currentChannelId, threadParentId } = get();
    if (!currentChannelId || !threadParentId) return;

    try {
      const { message } = await messageApi.send(currentChannelId, content, threadParentId);
      set((state) => ({
        threadMessages: [...state.threadMessages, message],
      }));
    } catch (err) {
      console.error('Failed to send thread reply:', err);
    }
  },

  setCurrentOrg: (orgId: string) => {
    set({ currentOrgId: orgId, teams: [], channels: [], messages: [], currentTeamId: null, currentChannelId: null });
    get().loadTeams(orgId);
  },

  setCurrentTeam: (teamId: string) => {
    set({ currentTeamId: teamId, channels: [], messages: [], currentChannelId: null });
    get().loadChannels(teamId);
  },

  setCurrentChannel: (channelId: string) => {
    const { currentChannelId, sseConnection } = get();
    if (currentChannelId === channelId) return;

    // Disconnect old SSE
    if (sseConnection) {
      sseConnection.close();
    }

    set({ currentChannelId: channelId, messages: [], threadParentId: null, threadMessages: [] });
    get().loadMessages(channelId);
    get().loadChannelMembers(channelId);
    get().connectSSE(channelId);
  },

  openThread: (messageId: string) => {
    set({ threadParentId: messageId });
    get().loadThread(messageId);
  },

  closeThread: () => {
    set({ threadParentId: null, threadMessages: [] });
  },

  toggleMemberList: () => {
    set((state) => ({ showMemberList: !state.showMemberList }));
  },

  connectSSE: (channelId: string) => {
    const eventSource = new EventSource(`/api/sse/${channelId}`, {
      withCredentials: true,
    });

    eventSource.addEventListener('new_message', (event) => {
      const message = JSON.parse(event.data) as Message;
      get().addMessageFromSSE(message);
    });

    eventSource.addEventListener('message_edited', (event) => {
      const edited = JSON.parse(event.data) as Message;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === edited.id ? { ...m, ...edited } : m)),
      }));
    });

    eventSource.addEventListener('reaction_added', (event) => {
      const data = JSON.parse(event.data);
      set((state) => ({
        messages: state.messages.map((m) => {
          if (m.id !== data.messageId) return m;
          const existing = m.reactions.find((r) => r.emoji === data.emoji);
          if (existing) {
            return {
              ...m,
              reactions: m.reactions.map((r) =>
                r.emoji === data.emoji
                  ? { ...r, count: r.count + 1, users: [...r.users, data.username] }
                  : r,
              ),
            };
          }
          return {
            ...m,
            reactions: [...m.reactions, { emoji: data.emoji, count: 1, users: [data.username] }],
          };
        }),
      }));
    });

    eventSource.addEventListener('reaction_removed', (event) => {
      const data = JSON.parse(event.data);
      set((state) => ({
        messages: state.messages.map((m) => {
          if (m.id !== data.messageId) return m;
          return {
            ...m,
            reactions: m.reactions
              .map((r) =>
                r.emoji === data.emoji
                  ? { ...r, count: r.count - 1, users: r.users.filter((u) => u !== data.username) }
                  : r,
              )
              .filter((r) => r.count > 0),
          };
        }),
      }));
    });

    eventSource.onerror = () => {
      console.error('SSE connection error, will retry...');
    };

    set({ sseConnection: eventSource });
  },

  disconnectSSE: () => {
    const { sseConnection } = get();
    if (sseConnection) {
      sseConnection.close();
      set({ sseConnection: null });
    }
  },

  addMessageFromSSE: (message: Message) => {
    set((state) => {
      // Check if message already exists
      if (state.messages.some((m) => m.id === message.id)) return state;

      if (message.parent_message_id) {
        // Thread reply - update reply count on parent
        const updatedMessages = state.messages.map((m) =>
          m.id === message.parent_message_id
            ? { ...m, reply_count: (m.reply_count || 0) + 1 }
            : m,
        );

        // Also add to thread if thread is open
        if (state.threadParentId === message.parent_message_id) {
          return {
            messages: updatedMessages,
            threadMessages: state.threadMessages.some((m) => m.id === message.id)
              ? state.threadMessages
              : [...state.threadMessages, message],
          };
        }
        return { messages: updatedMessages };
      }

      // Top-level message
      return { messages: [...state.messages, message] };
    });
  },

  startPresenceHeartbeat: () => {
    // Send heartbeat every 30 seconds
    presenceApi.heartbeat().catch(() => {});
    const interval = setInterval(() => {
      presenceApi.heartbeat().catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  },
}));
