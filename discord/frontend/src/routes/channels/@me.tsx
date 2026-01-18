/**
 * Home/DM Route (@me)
 *
 * Default view when user is logged in but not in a specific room.
 * Shows a welcome message prompting user to select or create a room.
 */

import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/channels/@me')({
  component: HomeView,
});

function HomeView() {
  return (
    <>
      {/* Header */}
      <div className="h-12 flex items-center px-4 shadow-md border-b border-discord-dark flex-shrink-0">
        <h3 className="font-semibold text-white">Baby Discord</h3>
      </div>

      {/* Welcome content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-discord-sidebar flex items-center justify-center">
            <svg
              className="w-12 h-12 text-discord-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            Welcome to Baby Discord!
          </h2>
          <p className="text-discord-muted mb-6">
            Select a room from the sidebar or create a new one to start chatting
            with others.
          </p>
          <div className="flex flex-col gap-2 text-sm text-discord-muted">
            <p>
              <span className="text-discord-text font-medium">💡 Tip:</span>{' '}
              Click the + button to create a new room
            </p>
            <p>
              <span className="text-discord-text font-medium">💬 Rooms:</span>{' '}
              Click any room icon to join and start chatting
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
