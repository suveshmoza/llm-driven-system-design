import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrmStore } from '../stores/crmStore';
import { DashboardMetrics } from '../components/DashboardMetrics';
import { PipelineChart } from '../components/PipelineChart';

function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { kpis, kpisLoading, fetchKPIs, pipeline, fetchPipelineReport } = useCrmStore();

  useEffect(() => {
    if (!user) {
      navigate({ to: '/login' });
      return;
    }
    fetchKPIs();
    fetchPipelineReport();
  }, [user, navigate, fetchKPIs, fetchPipelineReport]);

  if (!user) return null;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-salesforce-text">Welcome back, {user.username}</h1>
        <p className="text-salesforce-secondary">Your sales performance overview</p>
      </div>

      {kpisLoading ? (
        <div className="text-center py-8 text-salesforce-secondary">Loading dashboard...</div>
      ) : kpis ? (
        <div className="space-y-6">
          <DashboardMetrics kpis={kpis} />
          <PipelineChart pipeline={pipeline} />
        </div>
      ) : (
        <div className="text-center py-8 text-salesforce-secondary">
          No data available. Start by creating accounts and opportunities.
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: DashboardPage,
});
