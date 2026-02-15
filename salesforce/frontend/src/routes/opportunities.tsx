import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrmStore } from '../stores/crmStore';
import { KanbanBoard } from '../components/KanbanBoard';

function OpportunitiesPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { opportunities, opportunitiesLoading, fetchOpportunities, updateOpportunityStage } = useCrmStore();

  const loadOpportunities = useCallback(() => {
    fetchOpportunities({ limit: 200 });
  }, [fetchOpportunities]);

  useEffect(() => {
    if (!user) {
      navigate({ to: '/login' });
      return;
    }
    loadOpportunities();
  }, [user, navigate, loadOpportunities]);

  if (!user) return null;

  const handleStageChange = async (id: string, stage: string) => {
    await updateOpportunityStage(id, stage);
    loadOpportunities();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-salesforce-text">Opportunities Pipeline</h2>
        <div className="text-sm text-salesforce-secondary">
          Drag and drop to change stages
        </div>
      </div>

      {opportunitiesLoading ? (
        <div className="text-center py-8 text-salesforce-secondary">Loading pipeline...</div>
      ) : (
        <KanbanBoard
          opportunities={opportunities}
          onStageChange={handleStageChange}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/opportunities')({
  component: OpportunitiesPage,
});
