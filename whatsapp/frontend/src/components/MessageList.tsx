/**
 * Message List Component
 *
 * Virtualized message list with:
 * - Efficient rendering for large message histories
 * - Infinite scroll for loading older messages
 * - Date separators between days
 * - Scroll position maintenance when prepending messages
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Message } from '../types';
import { MessageBubble, DateSeparator } from './MessageBubble';
import { ReactionSummary } from './MessageReactions';

interface MessageListProps {
  messages: Message[];
  currentUserId: string;
  isGroup: boolean;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  messageReactions?: Record<string, ReactionSummary[]>;
  onReactionClick?: (messageId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
  onRemoveReaction?: (messageId: string, emoji: string) => void;
}

/**
 * Item in the virtual list - either a message or a date separator.
 */
type ListItem =
  | { type: 'message'; message: Message; showDate: boolean }
  | { type: 'loading' };

/**
 * Checks if a date separator should be shown before a message.
 */
function shouldShowDate(message: Message, prevMessage?: Message): boolean {
  if (!prevMessage) return true;
  const msgDate = new Date(message.created_at).toDateString();
  const prevDate = new Date(prevMessage.created_at).toDateString();
  return msgDate !== prevDate;
}

/**
 * Virtualized message list with infinite scroll support.
 */
export function MessageList({
  messages,
  currentUserId,
  isGroup,
  isLoading,
  hasMore,
  onLoadMore,
  messageReactions = {},
  onReactionClick,
  onAddReaction,
  onRemoveReaction,
}: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevMessagesLengthRef = useRef(messages.length);

  // Build list items from messages
  const items: ListItem[] = [];

  // Add loading indicator at top if loading more
  if (isLoading && hasMore) {
    items.push({ type: 'loading' });
  }

  // Add messages with date separator info
  messages.forEach((message, index) => {
    const prevMessage = index > 0 ? messages[index - 1] : undefined;
    items.push({
      type: 'message',
      message,
      showDate: shouldShowDate(message, prevMessage),
    });
  });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = items[index];
      if (item.type === 'loading') return 40;
      // Estimate: date separator + message bubble
      return item.showDate ? 100 : 60;
    },
    overscan: 5,
    getItemKey: (index) => {
      const item = items[index];
      if (item.type === 'loading') return 'loading';
      return item.message.id;
    },
  });

  // Track scroll position for auto-scroll to bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    setIsAtBottom(atBottom);

    // Load more when scrolled near top
    if (scrollTop < 100 && hasMore && !isLoading) {
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore]);

  // Scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current && isAtBottom) {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end', behavior: 'smooth' });
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, isAtBottom, virtualizer, items.length]);

  // Initial scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-500">No messages yet. Say hello!</div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto p-4"
      onScroll={handleScroll}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];

          if (item.type === 'loading') {
            return (
              <div
                key="loading"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className="flex justify-center items-center"
              >
                <div className="w-6 h-6 border-2 border-whatsapp-teal border-t-transparent rounded-full animate-spin" />
              </div>
            );
          }

          const { message, showDate } = item;
          const isOwn = message.sender_id === currentUserId;
          const reactions = messageReactions[message.id] || [];

          return (
            <div
              key={message.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
            >
              {showDate && <DateSeparator date={message.created_at} />}
              <div className="mb-2">
                <MessageBubble
                  message={message}
                  isOwn={isOwn}
                  isGroup={isGroup}
                  showSenderName={showDate || (virtualItem.index > 0 && messages[virtualItem.index - 1]?.sender_id !== message.sender_id)}
                  reactions={reactions}
                  onReactionClick={onReactionClick}
                  onAddReaction={onAddReaction}
                  onRemoveReaction={onRemoveReaction}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
