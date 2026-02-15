import type { Activity } from '../types';
import { StatusBadge } from './StatusBadge';

interface ActivityTimelineProps {
  activities: Activity[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const typeIcons: Record<string, string> = {
  call: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  email: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  meeting: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  note: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
};

/** Renders a chronological timeline of activities with type icons, status, and completion state. */
export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <p className="text-salesforce-secondary text-center py-4">No activities recorded</p>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className={`flex gap-3 p-3 rounded-lg border ${
            activity.completed ? 'border-gray-200 bg-gray-50' : 'border-salesforce-border bg-white'
          }`}
        >
          <div className="shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-salesforce-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={typeIcons[activity.type] || typeIcons.note} />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={activity.type} type="activity" />
              <span className={`text-sm font-medium ${activity.completed ? 'line-through text-salesforce-secondary' : 'text-salesforce-text'}`}>
                {activity.subject}
              </span>
            </div>
            {activity.description && (
              <p className="text-sm text-salesforce-secondary mt-1">{activity.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-xs text-salesforce-secondary">
              {activity.due_date && (
                <span>Due: {formatDate(activity.due_date)}</span>
              )}
              <span>{formatDate(activity.created_at)}</span>
              {activity.owner_name && <span>by {activity.owner_name}</span>}
            </div>
          </div>
          <div className="shrink-0">
            {activity.completed ? (
              <span className="text-xs text-salesforce-success font-medium">Completed</span>
            ) : (
              <span className="text-xs text-salesforce-warning font-medium">Open</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
