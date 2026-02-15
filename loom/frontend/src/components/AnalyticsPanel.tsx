import { useEffect, useState } from 'react';
import type { AnalyticsSummary } from '../types';
import { analyticsApi } from '../services/api';
import { ViewsChart } from './ViewsChart';

interface AnalyticsPanelProps {
  videoId: string;
}

/** Displays video analytics with stat cards for views, unique viewers, watch duration, and completion rate. */
export function AnalyticsPanel({ videoId }: AnalyticsPanelProps) {
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const { analytics: data } = await analyticsApi.get(videoId);
      setAnalytics(data);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  if (loading) {
    return <div className="text-sm text-loom-secondary py-4">Loading analytics...</div>;
  }

  if (!analytics) {
    return <div className="text-sm text-loom-secondary py-4 text-center">No analytics data</div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Views" value={analytics.totalViews.toString()} />
        <StatCard label="Unique Viewers" value={analytics.uniqueViewers.toString()} />
        <StatCard
          label="Avg Watch Time"
          value={formatDuration(analytics.avgWatchDurationSeconds)}
        />
        <StatCard
          label="Completion Rate"
          value={`${analytics.completionRate.toFixed(0)}%`}
        />
      </div>

      {/* Views chart */}
      {analytics.viewsByDay.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-loom-text mb-2">Views over time</h3>
          <ViewsChart data={analytics.viewsByDay} />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-loom-secondary">{label}</div>
      <div className="text-lg font-bold text-loom-text mt-1">{value}</div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}
