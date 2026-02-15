import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';

function TeamPage() {
  const { orgId, teamId } = Route.useParams();
  const { channels, loadChannels } = useChatStore();
  const navigate = useNavigate();

  useEffect(() => {
    loadChannels(teamId);
  }, [teamId, loadChannels]);

  useEffect(() => {
    if (channels.length > 0) {
      navigate({
        to: '/org/$orgId/team/$teamId/channel/$channelId',
        params: { orgId, teamId, channelId: channels[0].id },
      });
    }
  }, [channels, orgId, teamId, navigate]);

  return <Outlet />;
}

export const Route = createFileRoute('/org/$orgId/team/$teamId')({
  component: TeamPage,
});
