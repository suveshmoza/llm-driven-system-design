import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrmStore } from '../stores/crmStore';
import { ReportChart } from '../components/ReportChart';

function ReportsPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const {
    pipeline, revenue, leadsBySource, reportsLoading,
    fetchPipelineReport, fetchRevenueReport, fetchLeadsReport,
  } = useCrmStore();

  useEffect(() => {
    if (!user) {
      navigate({ to: '/login' });
      return;
    }
    fetchPipelineReport(true);
    fetchRevenueReport(12, true);
    fetchLeadsReport(true);
  }, [user, navigate, fetchPipelineReport, fetchRevenueReport, fetchLeadsReport]);

  if (!user) return null;

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-salesforce-text mb-4">Reports</h2>

      {reportsLoading ? (
        <div className="text-center py-8 text-salesforce-secondary">Loading reports...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ReportChart type="pipeline" pipelineData={pipeline} />
          <ReportChart type="revenue" revenueData={revenue} />
          <ReportChart type="leads" leadsData={leadsBySource} />
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/reports')({
  component: ReportsPage,
});
