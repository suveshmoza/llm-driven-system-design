import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useProjectStore } from '../stores/projectStore';
import { ProjectSidebar } from '../components/ProjectSidebar';
import { Breadcrumb } from '../components/Breadcrumb';

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const { user, loading: authLoading } = useAuthStore();
  const { currentProject, loadProject } = useProjectStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && projectId) {
      loadProject(projectId);
    }
  }, [user, projectId, loadProject]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-supabase-secondary">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-supabase-bg overflow-hidden">
      <ProjectSidebar projectId={projectId} projectName={currentProject?.name || 'Project'} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Breadcrumb projectName={currentProject?.name || 'Project'} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectLayout,
});
