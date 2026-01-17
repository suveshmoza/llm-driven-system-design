import { create } from 'zustand';
import type { Conversation, Message, TypingUser, WebSocketMessage } from '@/types';
import { api } from '@/services/api';
import { wsService } from '@/services/websocket';

/**
 * Chat state interface.
 * Manages conversations, messages, typing indicators, and real-time updates.
 * Uses Maps for efficient message lookup by conversation ID.
 */
interface ChatState {
  /** All conversations the user is participating in */
  conversations: Conversation[];
  /** Currently selected conversation ID for the chat view */
  currentConversationId: string | null;
  /** Messages indexed by conversation ID for efficient access */
  messages: Map<string, Message[]>;
  /** Users currently typing, indexed by conversation ID */
  typingUsers: Map<string, TypingUser[]>;
  /** Loading state for conversations list */
  isLoadingConversations: boolean;
  /** Loading state for messages in current conversation */
  isLoadingMessages: boolean;
  /** Queue of messages to send when connection is restored */
  offlineQueue: Message[];

  // Actions
  /** Fetches all conversations from the server */
  loadConversations: () => Promise<void>;
  /**
   * Selects a conversation and loads its messages.
   * @param id - Conversation UUID or null to deselect
   */
  selectConversation: (id: string | null) => void;
  /**
   * Loads messages for a specific conversation.
   * @param conversationId - Target conversation UUID
   */
  loadMessages: (conversationId: string) => Promise<void>;
  /**
   * Sends a message via WebSocket with optimistic update.
   * @param conversationId - Target conversation UUID
   * @param content - Message text
   * @param replyToId - Optional message ID for threaded replies
   */
  sendMessage: (conversationId: string, content: string, replyToId?: string) => Promise<void>;
  /**
   * Adds a message to the local state (from WebSocket or optimistic update).
   * @param message - The message to add
   */
  addMessage: (message: Message) => void;
  /**
   * Updates an existing message in state.
   * @param messageId - UUID of message to update
   * @param updates - Partial message fields to merge
   */
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  /**
   * Removes a message from local state.
   * @param conversationId - Conversation containing the message
   * @param messageId - UUID of message to remove
   */
  deleteMessage: (conversationId: string, messageId: string) => void;
  /**
   * Sends typing indicator via WebSocket.
   * @param conversationId - Target conversation UUID
   * @param isTyping - Whether user is currently typing
   */
  setTyping: (conversationId: string, isTyping: boolean) => void;
  /**
   * Processes incoming WebSocket messages and updates state accordingly.
   * @param message - The WebSocket message to handle
   */
  handleWebSocketMessage: (message: WebSocketMessage) => void;
  /**
   * Creates a new direct (1:1) conversation.
   * @param userId - UUID of the other user
   * @returns The created conversation
   */
  createDirectConversation: (userId: string) => Promise<Conversation>;
  /**
   * Creates a new group conversation.
   * @param name - Group name
   * @param participantIds - Array of user UUIDs
   * @returns The created conversation
   */
  createGroupConversation: (name: string, participantIds: string[]) => Promise<Conversation>;
  /**
   * Marks a message as read and updates unread count.
   * @param conversationId - Target conversation UUID
   * @param messageId - UUID of the last read message
   */
  markAsRead: (conversationId: string, messageId: string) => void;
  /**
   * Updates a conversation's properties in state.
   * @param conversationId - Target conversation UUID
   * @param updates - Partial conversation fields to merge
   */
  updateConversation: (conversationId: string, updates: Partial<Conversation>) => void;
}

/**
 * Zustand store for chat state management.
 * Handles all messaging-related state including conversations, messages,
 * typing indicators, and real-time WebSocket updates.
 *
 * Uses optimistic updates for sending messages to provide instant feedback,
 * with the actual message being confirmed/replaced when the server responds.
 */
export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: new Map(),
  typingUsers: new Map(),
  isLoadingConversations: false,
  isLoadingMessages: false,
  offlineQueue: [],

  loadConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const response = await api.getConversations();
      set({ conversations: response.conversations });
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      set({ isLoadingConversations: false });
    }
  },

  selectConversation: (id: string | null) => {
    set({ currentConversationId: id });
    if (id) {
      get().loadMessages(id);
    }
  },

  loadMessages: async (conversationId: string) => {
    set({ isLoadingMessages: true });
    try {
      const response = await api.getMessages(conversationId, { limit: 50 });
      const messages = new Map(get().messages);
      messages.set(conversationId, response.messages);
      set({ messages });

      // Mark last message as read
      if (response.messages.length > 0) {
        const lastMessage = response.messages[response.messages.length - 1];
        get().markAsRead(conversationId, lastMessage.id);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: async (conversationId: string, content: string, replyToId?: string) => {
    const clientMessageId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Optimistically add message
    const tempMessage: Message = {
      id: clientMessageId,
      conversation_id: conversationId,
      sender_id: '', // Will be set by the server
      content,
      content_type: 'text',
      reply_to_id: replyToId || null,
      edited_at: null,
      created_at: new Date().toISOString(),
      sender_username: '',
      sender_display_name: '',
      sender_avatar_url: null,
      reactions: null,
      reply_to: null,
      status: 'sending',
      clientMessageId,
    };

    get().addMessage(tempMessage);

    // Send via WebSocket
    wsService.sendMessage(conversationId, content, {
      replyToId,
      clientMessageId,
    });
  },

  addMessage: (message: Message) => {
    const messages = new Map(get().messages);
    const conversationMessages = messages.get(message.conversation_id) || [];

    // Check if message already exists (by id or clientMessageId)
    const existingIndex = conversationMessages.findIndex(
      (m) => m.id === message.id || (message.clientMessageId && m.clientMessageId === message.clientMessageId)
    );

    if (existingIndex >= 0) {
      // Update existing message
      conversationMessages[existingIndex] = { ...conversationMessages[existingIndex], ...message };
    } else {
      // Add new message
      conversationMessages.push(message);
    }

    // Sort by created_at
    conversationMessages.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    messages.set(message.conversation_id, conversationMessages);
    set({ messages });

    // Update conversation's last message and move to top
    const conversations = [...get().conversations];
    const convIndex = conversations.findIndex((c) => c.id === message.conversation_id);
    if (convIndex >= 0) {
      const conv = { ...conversations[convIndex] };
      conv.last_message = message;
      conv.updated_at = message.created_at;
      conversations.splice(convIndex, 1);
      conversations.unshift(conv);
      set({ conversations });
    }
  },

  updateMessage: (messageId: string, updates: Partial<Message>) => {
    const messages = new Map(get().messages);

    for (const [convId, convMessages] of messages) {
      const index = convMessages.findIndex((m) => m.id === messageId || m.clientMessageId === messageId);
      if (index >= 0) {
        convMessages[index] = { ...convMessages[index], ...updates };
        messages.set(convId, [...convMessages]);
        set({ messages });
        return;
      }
    }
  },

  deleteMessage: (conversationId: string, messageId: string) => {
    const messages = new Map(get().messages);
    const convMessages = messages.get(conversationId);
    if (convMessages) {
      messages.set(
        conversationId,
        convMessages.filter((m) => m.id !== messageId)
      );
      set({ messages });
    }
  },

  setTyping: (conversationId: string, isTyping: boolean) => {
    wsService.sendTyping(conversationId, isTyping);
  },

  handleWebSocketMessage: (message: WebSocketMessage) => {
    switch (message.type) {
      case 'new_message':
        get().addMessage(message.message as Message);
        break;

      case 'message_sent':
        // Update optimistic message with server response
        const sentMessage = message.message as Message;
        get().updateMessage(message.clientMessageId as string, {
          ...sentMessage,
          status: 'sent',
        });
        break;

      case 'typing':
        const typingUsers = new Map(get().typingUsers);
        const convTyping = typingUsers.get(message.conversationId as string) || [];

        if (message.isTyping) {
          // Add user if not already in list
          if (!convTyping.find((u) => u.userId === message.userId)) {
            convTyping.push({
              userId: message.userId as string,
              username: message.username as string,
              displayName: message.displayName as string,
            });
          }
        } else {
          // Remove user from typing list
          const index = convTyping.findIndex((u) => u.userId === message.userId);
          if (index >= 0) {
            convTyping.splice(index, 1);
          }
        }

        typingUsers.set(message.conversationId as string, convTyping);
        set({ typingUsers });
        break;

      case 'read_receipt':
        // Could update UI to show who has read messages
        break;

      case 'reaction_update':
        // Update message reactions
        const messages = new Map(get().messages);
        const convMessages = messages.get(message.conversationId as string);
        if (convMessages) {
          const msgIndex = convMessages.findIndex((m) => m.id === message.messageId);
          if (msgIndex >= 0) {
            const msg = { ...convMessages[msgIndex] };
            const reactions = [...(msg.reactions || [])];

            if (message.remove) {
              const rIndex = reactions.findIndex(
                (r) => r.user_id === message.userId && r.reaction === message.reaction
              );
              if (rIndex >= 0) {
                reactions.splice(rIndex, 1);
              }
            } else {
              reactions.push({
                id: '',
                user_id: message.userId as string,
                reaction: message.reaction as string,
              });
            }

            msg.reactions = reactions;
            convMessages[msgIndex] = msg;
            messages.set(message.conversationId as string, [...convMessages]);
            set({ messages });
          }
        }
        break;

      case 'offline_messages':
        // Process offline messages
        const offlineMessages = message.messages as { type: string; message: Message }[];
        for (const offlineMsg of offlineMessages) {
          if (offlineMsg.type === 'new_message') {
            get().addMessage(offlineMsg.message);
          }
        }
        break;

      case 'error':
        console.error('WebSocket error:', message.error);
        break;
    }
  },

  createDirectConversation: async (userId: string) => {
    const response = await api.createDirectConversation(userId);
    const conversations = [response.conversation, ...get().conversations];
    set({ conversations });
    return response.conversation;
  },

  createGroupConversation: async (name: string, participantIds: string[]) => {
    const response = await api.createGroupConversation(name, participantIds);
    const conversations = [response.conversation, ...get().conversations];
    set({ conversations });
    return response.conversation;
  },

  markAsRead: (conversationId: string, messageId: string) => {
    wsService.sendRead(conversationId, messageId);

    // Update local unread count
    const conversations = get().conversations.map((c) => {
      if (c.id === conversationId) {
        return { ...c, unread_count: 0 };
      }
      return c;
    });
    set({ conversations });
  },

  updateConversation: (conversationId: string, updates: Partial<Conversation>) => {
    const conversations = get().conversations.map((c) => {
      if (c.id === conversationId) {
        return { ...c, ...updates };
      }
      return c;
    });
    set({ conversations });
  },
}));
