import { formatDateTime, timeUntil, formatMeetingCode } from '../utils/format';

interface MeetingCardProps {
  title: string;
  meetingCode: string;
  scheduledStart: string | null;
  status: string;
  onJoin: () => void;
}

export function MeetingCard({ title, meetingCode, scheduledStart, status, onJoin }: MeetingCardProps) {
  const statusColors: Record<string, string> = {
    scheduled: 'text-zoom-primary',
    active: 'text-zoom-green',
    ended: 'text-zoom-secondary',
    cancelled: 'text-zoom-red',
  };

  return (
    <div className="bg-zoom-card rounded-lg p-5 border border-zoom-surface hover:border-zoom-primary transition-colors">
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-lg font-semibold text-zoom-text truncate flex-1">{title}</h3>
        <span className={`text-xs font-medium uppercase ml-2 ${statusColors[status] || 'text-zoom-secondary'}`}>
          {status}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-zoom-secondary">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V3a1 1 0 00-1-1H4zm1 2h6v2H5V4z" />
          </svg>
          <span className="font-mono">{formatMeetingCode(meetingCode)}</span>
        </div>
        {scheduledStart && (
          <div className="flex items-center gap-2 text-sm text-zoom-secondary">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 1113.5 8 5.51 5.51 0 018 13.5zM8.5 4H7v5l4.28 2.54.72-1.21-3.5-2.08V4z" />
            </svg>
            <span>{formatDateTime(scheduledStart)}</span>
            <span className="text-zoom-primary text-xs">{timeUntil(scheduledStart)}</span>
          </div>
        )}
      </div>

      {(status === 'scheduled' || status === 'active') && (
        <button
          onClick={onJoin}
          className="w-full bg-zoom-primary hover:bg-zoom-hover text-white py-2 px-4 rounded-lg font-medium transition-colors"
        >
          {status === 'active' ? 'Join Now' : 'Join Meeting'}
        </button>
      )}
    </div>
  );
}
