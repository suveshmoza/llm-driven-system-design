import type { Thread } from '../types';
import { formatDate, truncate } from '../utils/format';
import { useMailStore } from '../stores/mailStore';

interface ThreadListItemProps {
  thread: Thread;
  onClick: () => void;
}

export function ThreadListItem({ thread, onClick }: ThreadListItemProps) {
  const { toggleStar, moveToTrash, archiveThread } = useMailStore();

  const participantNames = thread.participants
    .map((p) => p.displayName.split(' ')[0])
    .slice(0, 3)
    .join(', ');

  const customLabels = thread.labels.filter(
    (l) =>
      !l.isSystem ||
      (l.name !== 'INBOX' &&
        l.name !== 'SENT' &&
        l.name !== 'ALL_MAIL')
  );

  return (
    <div
      onClick={onClick}
      className={`flex items-center px-4 py-2 cursor-pointer border-b border-gmail-border group hover:shadow-sm transition-shadow ${
        thread.isRead ? 'bg-gmail-read' : 'bg-gmail-unread'
      }`}
    >
      {/* Star */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleStar(thread.id);
        }}
        className="mr-2 flex-shrink-0"
      >
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path
            fill={thread.isStarred ? '#F4B400' : 'none'}
            stroke={thread.isStarred ? '#F4B400' : '#C4C7C5'}
            strokeWidth="2"
            d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
          />
        </svg>
      </button>

      {/* Participants */}
      <div
        className={`w-48 flex-shrink-0 truncate text-sm ${
          thread.isRead ? 'text-gmail-text' : 'font-bold text-gmail-text'
        }`}
      >
        {participantNames}
        {thread.messageCount > 1 && (
          <span className="text-gmail-text-secondary font-normal ml-1">
            ({thread.messageCount})
          </span>
        )}
      </div>

      {/* Subject & Snippet */}
      <div className="flex-1 flex items-center gap-2 min-w-0 mx-4">
        <span
          className={`truncate text-sm ${
            thread.isRead ? 'text-gmail-text' : 'font-bold text-gmail-text'
          }`}
        >
          {thread.subject}
        </span>
        {customLabels.length > 0 &&
          customLabels.map((label) => (
            <span
              key={label.id}
              className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                backgroundColor: label.color + '20',
                color: label.color,
              }}
            >
              {label.name}
            </span>
          ))}
        <span className="text-sm text-gmail-text-secondary truncate">
          {' '}
          - {truncate(thread.snippet, 80)}
        </span>
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mr-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            archiveThread(thread.id);
          }}
          className="p-1 rounded-full hover:bg-gray-200"
          title="Archive"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#5F6368"
              d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"
            />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            moveToTrash(thread.id);
          }}
          className="p-1 rounded-full hover:bg-gray-200"
          title="Delete"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#5F6368"
              d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
            />
          </svg>
        </button>
      </div>

      {/* Date */}
      <div
        className={`text-xs flex-shrink-0 ${
          thread.isRead
            ? 'text-gmail-text-secondary'
            : 'font-bold text-gmail-text'
        }`}
      >
        {formatDate(thread.lastMessageAt)}
      </div>
    </div>
  );
}
