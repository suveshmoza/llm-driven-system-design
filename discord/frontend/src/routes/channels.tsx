/**
 * Channels Layout Route
 *
 * Protected layout for all channel-related routes. Requires authentication
 * and provides the main Discord-like UI shell with server list and sidebar.
 */

import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import { useChatStore } from '../stores/chatStore';
import { ServerList } from '../components/ServerList';
import { ChannelSidebar } from '../components/ChannelSidebar';

export const Route = createFileRoute('/channels')({
  beforeLoad: () => {
    const session = useChatStore.getState().session;
    if (!session) {
      throw redirect({ to: '/login' });
    }
  },
  component: ChannelsLayout,
});

function ChannelsLayout() {
  return (
    <div className="flex h-screen bg-discord-channel">
      {/* Server list - leftmost sidebar */}
      <ServerList />

      {/* Channel sidebar - second column */}
      <ChannelSidebar />

      {/* Main content area - renders child routes */}
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
