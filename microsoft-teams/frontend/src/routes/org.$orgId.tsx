import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { ChannelList } from '../components/ChannelList';

function OrgPage() {
  const { orgId } = Route.useParams();
  const { teams, channels, loadTeams, loadChannels, currentTeamId } = useChatStore();
  const navigate = useNavigate();

  useEffect(() => {
    loadTeams(orgId);
  }, [orgId, loadTeams]);

  useEffect(() => {
    if (teams.length > 0 && !currentTeamId) {
      loadChannels(teams[0].id);
    }
  }, [teams, currentTeamId, loadChannels]);

  useEffect(() => {
    if (channels.length > 0 && currentTeamId) {
      navigate({
        to: '/org/$orgId/team/$teamId/channel/$channelId',
        params: { orgId, teamId: currentTeamId, channelId: channels[0].id },
      });
    }
  }, [channels, orgId, currentTeamId, navigate]);

  return (
    <>
      <ChannelList orgId={orgId} />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/org/$orgId')({
  component: OrgPage,
});
