/**
 * Chat View Component
 *
 * Displays the main chat interface for a conversation including:
 * - Virtualized message history with infinite scroll
 * - Message status indicators (sent, delivered, read)
 * - Typing indicators for other participants
 * - Message input with typing event broadcasting
 * - Message reactions with emoji picker
 */

import { useState, useEffect, useRef, FormEvent, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { sendMessage, sendTyping, sendReadReceipt } from '../hooks/useWebSocket';
import { messagesApi } from '../services/api';
import { Message } from '../types';
import { MessageList } from './MessageList';
import { ReactionPicker } from './ReactionPicker';

/**
 * Props for the ChatView component.
 */
interface ChatViewProps {
  /** ID of the conversation to display */
  conversationId: string;
  /** Optional callback for back navigation (mobile) */
  onBack?: () => void;
}

/**
 * Main chat interface with virtualized message list and input.
 * Handles real-time message sending, typing indicators, read receipts, and reactions.
 * @param props - Component props with conversation ID and back callback
 */
export function ChatView({ conversationId, onBack }: ChatViewProps) {
  const { user } = useAuthStore();
  const {
    conversations,
    messages,
    typingUsers,
    userPresence,
    isLoadingMessages,
    hasMoreMessages,
    isLoadingMoreMessages,
    messageReactions,
    loadMessages,
    loadMoreMessages,
    addMessage,
    setCurrentConversation,
    toggleReaction,
  } = useChatStore();

  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [reactionPickerState, setReactionPickerState] = useState<{
    isOpen: boolean;
    messageId: string | null;
    position?: { x: number; y: number };
  }>({ isOpen: false, messageId: null });
  const typingTimeoutRef = useRef<number | null>(null);

  const conversation = conversations.find((c) => c.id === conversationId);
  const conversationMessages = messages[conversationId] || [];
  const typing = typingUsers[conversationId] || [];
  const hasMore = hasMoreMessages[conversationId] ?? true;

  // Load messages when conversation changes
  useEffect(() => {
    setCurrentConversation(conversationId);
    loadMessages(conversationId);

    // Mark as read
    messagesApi.markRead(conversationId).catch(console.error);
    sendReadReceipt(conversationId, []);

    return () => {
      setCurrentConversation(null);
    };
  }, [conversationId, loadMessages, setCurrentConversation]);

  // Handle typing indicator
  const handleTyping = useCallback(() => {
    if (!isTyping) {
      setIsTyping(true);
      sendTyping(conversationId, true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      setIsTyping(false);
      sendTyping(conversationId, false);
    }, 2000);
  }, [conversationId, isTyping]);

  // Clean up typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (isTyping) {
        sendTyping(conversationId, false);
      }
    };
  }, [conversationId, isTyping]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const clientMessageId = crypto.randomUUID();

    // Add optimistic message
    const optimisticMessage: Message = {
      id: clientMessageId,
      conversation_id: conversationId,
      sender_id: user!.id,
      content: inputValue,
      content_type: 'text',
      created_at: new Date().toISOString(),
      status: 'sending',
      clientMessageId,
      sender: user!,
    };

    addMessage(optimisticMessage);

    // Send via WebSocket
    const sent = sendMessage(conversationId, inputValue, clientMessageId);

    if (!sent) {
      console.error('Failed to send message');
    }

    setInputValue('');
    setIsTyping(false);
    sendTyping(conversationId, false);
  };

  const getConversationName = (): string => {
    if (!conversation) return 'Loading...';
    if (conversation.is_group && conversation.name) {
      return conversation.name;
    }
    const otherParticipant = conversation.participants?.find(
      (p) => p.user_id !== user?.id
    );
    return otherParticipant?.user?.display_name || 'Unknown';
  };

  const getOnlineStatus = (): string => {
    if (!conversation || conversation.is_group) return '';

    const otherParticipant = conversation.participants?.find(
      (p) => p.user_id !== user?.id
    );
    if (!otherParticipant) return '';

    const presence = userPresence[otherParticipant.user_id];
    if (presence?.status === 'online') return 'Online';

    if (presence?.last_seen) {
      const lastSeen = new Date(presence.last_seen);
      return `Last seen ${lastSeen.toLocaleString()}`;
    }

    return 'Offline';
  };

  const getTypingNames = (): string | null => {
    if (typing.length === 0) return null;

    const names = typing
      .map((userId) => {
        const participant = conversation?.participants?.find(
          (p) => p.user_id === userId
        );
        return participant?.user?.display_name || 'Someone';
      })
      .join(', ');

    return `${names} is typing...`;
  };

  const handleReactionClick = useCallback((messageId: string) => {
    setReactionPickerState({
      isOpen: true,
      messageId,
    });
  }, []);

  const handleReactionSelect = useCallback(
    (emoji: string) => {
      if (reactionPickerState.messageId) {
        toggleReaction(conversationId, reactionPickerState.messageId, emoji);
      }
      setReactionPickerState({ isOpen: false, messageId: null });
    },
    [conversationId, reactionPickerState.messageId, toggleReaction]
  );

  const handleLoadMore = useCallback(() => {
    loadMoreMessages(conversationId);
  }, [conversationId, loadMoreMessages]);

  return (
    <div className="flex flex-col h-full whatsapp-chat-bg">
      {/* Header */}
      <div className="px-4 py-2 bg-whatsapp-header text-white flex items-center space-x-3">
        {onBack && (
          <button onClick={onBack} className="p-1 hover:bg-whatsapp-teal rounded transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
            conversation?.is_group ? 'bg-gray-400' : 'bg-whatsapp-teal'
          }`}
        >
          {getConversationName().charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="font-medium text-contact">{getConversationName()}</div>
          <div className="text-timestamp text-green-100">
            {getTypingNames() || getOnlineStatus()}
          </div>
        </div>
      </div>

      {/* Virtualized Messages */}
      <MessageList
        messages={conversationMessages}
        currentUserId={user?.id || ''}
        isGroup={conversation?.is_group || false}
        isLoading={isLoadingMessages || isLoadingMoreMessages}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        messageReactions={messageReactions}
        onReactionClick={handleReactionClick}
        onAddReaction={(messageId, emoji) => toggleReaction(conversationId, messageId, emoji)}
        onRemoveReaction={(messageId, emoji) => toggleReaction(conversationId, messageId, emoji)}
      />

      {/* Reaction Picker */}
      <ReactionPicker
        isOpen={reactionPickerState.isOpen}
        onClose={() => setReactionPickerState({ isOpen: false, messageId: null })}
        onSelect={handleReactionSelect}
        position={reactionPickerState.position}
      />

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-2 bg-whatsapp-input-bg flex items-center space-x-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              handleTyping();
            }}
            placeholder="Type a message"
            className="w-full py-2.5 px-4 rounded-lg bg-white border-none focus:outline-none text-message text-whatsapp-text-primary placeholder:text-whatsapp-text-secondary"
          />
        </div>
        <button
          type="submit"
          disabled={!inputValue.trim()}
          className="p-2.5 bg-whatsapp-header text-white rounded-full hover:bg-whatsapp-teal transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
