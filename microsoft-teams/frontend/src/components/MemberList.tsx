import { useChatStore } from '../stores/chatStore';
import { PresenceIndicator } from './PresenceIndicator';

/** Displays channel members grouped by online/offline status with presence indicators. */
export function MemberList() {
  const { channelMembers, toggleMemberList } = useChatStore();

  const onlineMembers = channelMembers.filter((m) => m.isOnline);
  const offlineMembers = channelMembers.filter((m) => !m.isOnline);

  return (
    <div className="w-60 border-l border-teams-border bg-teams-surface flex flex-col">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-teams-border">
        <h3 className="font-semibold text-sm text-teams-text">Members</h3>
        <button
          onClick={toggleMemberList}
          className="text-teams-secondary hover:text-teams-text text-lg"
          title="Close"
        >
          x
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Online */}
        {onlineMembers.length > 0 && (
          <div className="mb-4">
            <div className="px-4 mb-1">
              <span className="text-xs font-semibold text-teams-secondary uppercase tracking-wider">
                Online - {onlineMembers.length}
              </span>
            </div>
            {onlineMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-2 px-4 py-1.5 hover:bg-teams-bg"
              >
                <div className="relative">
                  <div className="w-7 h-7 rounded-full bg-teams-primary text-white flex items-center justify-center text-xs font-bold">
                    {member.display_name.charAt(0).toUpperCase()}
                  </div>
                  <PresenceIndicator isOnline={true} />
                </div>
                <span className="text-sm text-teams-text truncate">{member.display_name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Offline */}
        {offlineMembers.length > 0 && (
          <div>
            <div className="px-4 mb-1">
              <span className="text-xs font-semibold text-teams-secondary uppercase tracking-wider">
                Offline - {offlineMembers.length}
              </span>
            </div>
            {offlineMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-2 px-4 py-1.5 hover:bg-teams-bg"
              >
                <div className="relative">
                  <div className="w-7 h-7 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs font-bold">
                    {member.display_name.charAt(0).toUpperCase()}
                  </div>
                  <PresenceIndicator isOnline={false} />
                </div>
                <span className="text-sm text-teams-secondary truncate">
                  {member.display_name}
                </span>
              </div>
            ))}
          </div>
        )}

        {channelMembers.length === 0 && (
          <p className="px-4 text-sm text-teams-secondary">No members</p>
        )}
      </div>
    </div>
  );
}
