/**
 * Room/Channel Route
 *
 * Displays a specific chat room with messages and input.
 * Loads room history and establishes SSE connection for real-time updates.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { MessageList } from '../../components/MessageList';
import { MessageInput } from '../../components/MessageInput';

export const Route = createFileRoute('/channels/$roomId')({
  component: RoomView,
});

function RoomView() {
  const { roomId } = Route.useParams();
  const { currentRoom, joinRoom, rooms } = useChatStore();
  const navigate = useNavigate();

  // Join room when route changes
  useEffect(() => {
    if (roomId && roomId !== currentRoom) {
      // Check if room exists
      const roomExists = rooms.some((r) => r.name === roomId);
      if (roomExists) {
        joinRoom(roomId);
      } else {
        // Room doesn't exist, try to join anyway (might be created by another user)
        joinRoom(roomId).catch(() => {
          navigate({ to: '/channels/@me' });
        });
      }
    }
  }, [roomId, currentRoom, joinRoom, rooms, navigate]);

  return (
    <>
      {/* Channel header */}
      <ChannelHeader roomId={roomId} />

      {/* Messages */}
      <MessageList />

      {/* Input */}
      <MessageInput />
    </>
  );
}

function ChannelHeader({ roomId }: { roomId: string }) {
  const { rooms } = useChatStore();
  const room = rooms.find((r) => r.name === roomId);

  return (
    <div className="h-12 flex items-center px-4 shadow-md border-b border-discord-dark flex-shrink-0">
      <span className="text-discord-muted text-xl mr-2">#</span>
      <h3 className="font-semibold text-white">{roomId}</h3>
      <div className="h-6 w-px bg-discord-sidebar mx-4" />
      <p className="text-discord-muted text-sm truncate">
        Welcome to the {roomId} channel
        {room && ` • ${room.memberCount} members`}
      </p>

      {/* Header actions */}
      <div className="ml-auto flex items-center gap-4">
        <button
          className="text-discord-muted hover:text-discord-text transition-colors"
          title="Members"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
