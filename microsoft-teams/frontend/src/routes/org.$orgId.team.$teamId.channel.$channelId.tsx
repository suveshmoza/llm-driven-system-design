import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { ChatArea } from '../components/ChatArea';
import { ThreadPanel } from '../components/ThreadPanel';
import { MemberList } from '../components/MemberList';

function ChannelPage() {
  const { channelId } = Route.useParams();
  const { setCurrentChannel, threadParentId, showMemberList, disconnectSSE } = useChatStore();

  useEffect(() => {
    setCurrentChannel(channelId);
    return () => {
      disconnectSSE();
    };
  }, [channelId, setCurrentChannel, disconnectSSE]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <ChatArea />
      {threadParentId && <ThreadPanel />}
      {showMemberList && <MemberList />}
    </div>
  );
}

export const Route = createFileRoute('/org/$orgId/team/$teamId/channel/$channelId')({
  component: ChannelPage,
});
