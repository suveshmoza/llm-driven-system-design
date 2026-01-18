/**
 * Message Bubble Component
 *
 * Renders an individual message with:
 * - Message content
 * - Sender name (for group chats)
 * - Timestamp and delivery status
 * - Support for reactions (Phase 5)
 */

import { Message, MessageStatus } from '../types';
import { ReactionSummary } from './MessageReactions';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  isGroup: boolean;
  showSenderName: boolean;
  reactions?: ReactionSummary[];
  onReactionClick?: (messageId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
  onRemoveReaction?: (messageId: string, emoji: string) => void;
}

/**
 * Renders message status indicator (sending, sent, delivered, read).
 */
function MessageStatusIndicator({ status }: { status: MessageStatus | undefined }) {
  switch (status) {
    case 'sending':
      return (
        <svg className="w-4 h-4 text-whatsapp-single-tick" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" />
        </svg>
      );
    case 'sent':
      return (
        <svg className="w-4 h-4 text-whatsapp-single-tick" viewBox="0 0 16 15" fill="currentColor">
          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
        </svg>
      );
    case 'delivered':
      return (
        <svg className="w-4 h-4 text-whatsapp-single-tick" viewBox="0 0 16 15" fill="currentColor">
          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
          <path d="M11.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
        </svg>
      );
    case 'read':
      return (
        <svg className="w-4 h-4 text-whatsapp-blue-tick" viewBox="0 0 16 15" fill="currentColor">
          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
          <path d="M11.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L4.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512z" />
        </svg>
      );
    case 'failed':
      return (
        <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Formats timestamp for display in message bubble.
 */
function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Individual message bubble with content, timestamp, and status.
 */
export function MessageBubble({
  message,
  isOwn,
  isGroup,
  showSenderName,
  reactions = [],
  onReactionClick,
}: MessageBubbleProps) {
  const hasReactions = reactions.length > 0;

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[65%] rounded-lg px-3 py-1.5 shadow-sm relative group ${
          isOwn
            ? 'bg-whatsapp-message-out message-out-tail'
            : 'bg-whatsapp-message-in message-in-tail'
        } ${hasReactions ? 'mb-4' : ''}`}
        onDoubleClick={() => onReactionClick?.(message.id)}
      >
        {isGroup && showSenderName && !isOwn && (
          <div className="text-timestamp font-medium text-whatsapp-teal mb-0.5">
            {message.sender?.display_name}
          </div>
        )}
        <div className="text-message text-whatsapp-text-primary whitespace-pre-wrap break-words">
          {message.content}
        </div>
        <div className="flex items-center justify-end space-x-1 -mb-0.5">
          <span className="text-timestamp text-whatsapp-text-secondary">
            {formatMessageTime(message.created_at)}
          </span>
          {isOwn && <MessageStatusIndicator status={message.status} />}
        </div>

        {/* Reaction button (appears on hover) */}
        <button
          onClick={() => onReactionClick?.(message.id)}
          className="absolute -right-2 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-white shadow-md hover:bg-gray-100"
          title="React to message"
        >
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        {/* Reactions display */}
        {hasReactions && (
          <div className="absolute -bottom-3 left-2 flex gap-0.5 bg-white rounded-full px-1.5 py-0.5 shadow-md">
            {reactions.slice(0, 3).map((reaction) => (
              <span
                key={reaction.emoji}
                className={`text-sm cursor-pointer ${reaction.userReacted ? 'opacity-100' : 'opacity-70'}`}
                title={`${reaction.count} reaction${reaction.count > 1 ? 's' : ''}`}
              >
                {reaction.emoji}
                {reaction.count > 1 && (
                  <span className="text-xs text-gray-500 ml-0.5">{reaction.count}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Date separator between messages from different days.
 */
export function DateSeparator({ date }: { date: string }) {
  const formatDate = (dateString: string): string => {
    const msgDate = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (msgDate.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (msgDate.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return msgDate.toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }
  };

  return (
    <div className="flex justify-center my-4">
      <span className="px-3 py-1 bg-white rounded-lg text-timestamp text-whatsapp-text-secondary shadow-sm">
        {formatDate(date)}
      </span>
    </div>
  );
}
