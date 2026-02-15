import { useEffect } from 'react';
import { useMailStore } from '../stores/mailStore';

const SYSTEM_LABEL_ORDER = [
  'INBOX',
  'STARRED',
  'SENT',
  'DRAFTS',
  'ALL_MAIL',
  'SPAM',
  'TRASH',
];

const LABEL_ICONS: Record<string, string> = {
  INBOX: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
  STARRED: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  SENT: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  DRAFTS: 'M21.99 8c0-.72-.37-1.35-.94-1.7L12 1 2.95 6.3C2.38 6.65 2 7.28 2 8v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2l-.01-10zM12 13L3.74 7.84 12 3l8.26 4.84L12 13z',
  ALL_MAIL: 'M20 6H10v6H8V4h6V0H6v6H0v14h20V6zm-2 10H2V8h6v6h8v-4h2v6z',
  SPAM: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  TRASH: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  IMPORTANT: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
};

interface SidebarProps {
  onCompose: () => void;
  onNavigate: (label: string) => void;
}

export function Sidebar({ onCompose, onNavigate }: SidebarProps) {
  const { labels, unreadCounts, currentLabel, fetchLabels, fetchUnreadCounts } =
    useMailStore();

  useEffect(() => {
    fetchLabels();
    fetchUnreadCounts();
  }, [fetchLabels, fetchUnreadCounts]);

  const systemLabels = labels.filter((l) => l.isSystem);
  const customLabels = labels.filter((l) => !l.isSystem);

  const sortedSystemLabels = [...systemLabels].sort((a, b) => {
    const aIdx = SYSTEM_LABEL_ORDER.indexOf(a.name);
    const bIdx = SYSTEM_LABEL_ORDER.indexOf(b.name);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  // Filter out IMPORTANT and ALL_MAIL from main display for cleaner UI
  const displayLabels = sortedSystemLabels.filter(
    (l) => l.name !== 'IMPORTANT' && l.name !== 'ALL_MAIL'
  );

  return (
    <aside className="w-64 bg-gmail-sidebar pt-2 flex-shrink-0 overflow-y-auto">
      {/* Compose Button */}
      <div className="px-4 mb-4">
        <button
          onClick={onCompose}
          className="flex items-center gap-3 bg-white hover:shadow-md text-gmail-text px-6 py-3 rounded-2xl shadow-sm transition-shadow w-full"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            className="text-gmail-text"
          >
            <path
              fill="currentColor"
              d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
            />
          </svg>
          <span className="text-sm font-medium">Compose</span>
        </button>
      </div>

      {/* System Labels */}
      <nav>
        {displayLabels.map((label) => {
          const isActive = currentLabel === label.name;
          const unread = unreadCounts[label.name] || 0;
          const displayName =
            label.name === 'ALL_MAIL'
              ? 'All Mail'
              : label.name.charAt(0) + label.name.slice(1).toLowerCase();
          const iconPath = LABEL_ICONS[label.name];

          return (
            <button
              key={label.id}
              onClick={() => onNavigate(label.name)}
              className={`w-full flex items-center gap-4 px-6 py-1.5 text-sm rounded-r-full transition-colors ${
                isActive
                  ? 'bg-blue-100 text-gmail-blue font-semibold'
                  : 'text-gmail-text hover:bg-gmail-hover'
              }`}
            >
              {iconPath ? (
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path
                    fill={isActive ? '#1A73E8' : '#5F6368'}
                    d={iconPath}
                  />
                </svg>
              ) : (
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
              )}
              <span className="flex-1 text-left">{displayName}</span>
              {unread > 0 && (
                <span className="text-xs font-semibold">{unread}</span>
              )}
            </button>
          );
        })}

        {/* More section */}
        <div className="border-t border-gmail-border my-2 mx-4" />

        {sortedSystemLabels
          .filter((l) => l.name === 'ALL_MAIL' || l.name === 'IMPORTANT')
          .map((label) => {
            const isActive = currentLabel === label.name;
            const displayName =
              label.name === 'ALL_MAIL' ? 'All Mail' : 'Important';

            return (
              <button
                key={label.id}
                onClick={() => onNavigate(label.name)}
                className={`w-full flex items-center gap-4 px-6 py-1.5 text-sm rounded-r-full transition-colors ${
                  isActive
                    ? 'bg-blue-100 text-gmail-blue font-semibold'
                    : 'text-gmail-text-secondary hover:bg-gmail-hover'
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path
                    fill={isActive ? '#1A73E8' : '#5F6368'}
                    d={LABEL_ICONS[label.name] || ''}
                  />
                </svg>
                <span className="flex-1 text-left">{displayName}</span>
              </button>
            );
          })}

        {/* Custom Labels */}
        {customLabels.length > 0 && (
          <>
            <div className="border-t border-gmail-border my-2 mx-4" />
            <div className="px-6 py-1 text-xs text-gmail-text-secondary font-medium uppercase">
              Labels
            </div>
            {customLabels.map((label) => {
              const isActive = currentLabel === label.name;
              return (
                <button
                  key={label.id}
                  onClick={() => onNavigate(label.name)}
                  className={`w-full flex items-center gap-4 px-6 py-1.5 text-sm rounded-r-full transition-colors ${
                    isActive
                      ? 'bg-blue-100 text-gmail-blue font-semibold'
                      : 'text-gmail-text hover:bg-gmail-hover'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="flex-1 text-left truncate">
                    {label.name}
                  </span>
                  {(unreadCounts[label.name] || 0) > 0 && (
                    <span className="text-xs font-semibold">
                      {unreadCounts[label.name]}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
