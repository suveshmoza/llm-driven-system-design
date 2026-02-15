import type { Message } from '../types';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: Message[];
}

/** Renders a scrollable list of messages with empty state placeholder. */
export function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-2">👋</div>
          <p className="text-teams-secondary">No messages yet. Start the conversation!</p>
        </div>
      </div>
    );
  }

  // Group messages by date
  let lastDate = '';

  return (
    <div className="space-y-0.5">
      {messages.map((message) => {
        const messageDate = new Date(message.created_at).toLocaleDateString();
        const showDateSeparator = messageDate !== lastDate;
        lastDate = messageDate;

        return (
          <div key={message.id}>
            {showDateSeparator && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 border-t border-teams-border" />
                <span className="text-xs text-teams-secondary font-medium">{messageDate}</span>
                <div className="flex-1 border-t border-teams-border" />
              </div>
            )}
            <MessageItem message={message} />
          </div>
        );
      })}
    </div>
  );
}
