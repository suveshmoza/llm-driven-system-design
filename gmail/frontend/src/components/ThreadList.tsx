import { useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMailStore } from '../stores/mailStore';
import { ThreadListItem } from './ThreadListItem';

/** Renders a virtualized list of email threads with pagination for the current label. */
export function ThreadList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { threads, totalThreads, isLoading, currentLabel, currentPage, fetchThreads } =
    useMailStore();

  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 5,
  });

  const handleThreadClick = (threadId: string) => {
    navigate({ to: '/thread/$threadId', params: { threadId } });
  };

  const totalPages = Math.ceil(totalThreads / 25);

  const labelDisplayName =
    currentLabel === 'ALL_MAIL'
      ? 'All Mail'
      : currentLabel.charAt(0) + currentLabel.slice(1).toLowerCase();

  if (isLoading && threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gmail-text-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gmail-border bg-white">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gmail-text-secondary">
            {labelDisplayName}
          </span>
          {totalThreads > 0 && (
            <span className="text-xs text-gmail-text-secondary">
              {(currentPage - 1) * 25 + 1}-
              {Math.min(currentPage * 25, totalThreads)} of {totalThreads}
            </span>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchThreads(currentLabel, currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 rounded hover:bg-gmail-hover disabled:opacity-30"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  fill="#5F6368"
                  d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
                />
              </svg>
            </button>
            <button
              onClick={() => fetchThreads(currentLabel, currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-1 rounded hover:bg-gmail-hover disabled:opacity-30"
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path
                  fill="#5F6368"
                  d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Thread List */}
      {threads.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-gmail-text-secondary">
          <svg width="48" height="48" viewBox="0 0 24 24" className="mb-4 opacity-30">
            <path
              fill="currentColor"
              d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
            />
          </svg>
          <p>No conversations in {labelDisplayName}</p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const thread = threads[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <ThreadListItem
                    thread={thread}
                    onClick={() => handleThreadClick(thread.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
