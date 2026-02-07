import { createFileRoute, Outlet, Navigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore, useProjectStore } from '../stores';
import { Layout } from '../components/Layout';

export const Route = createFileRoute('/projects')({
  component: ProjectsLayout,
});

function ProjectsLayout() {
  const { isAuthenticated } = useAuthStore();
  const { fetchProjects } = useProjectStore();

  useEffect(() => {
    if (isAuthenticated) {
      fetchProjects();
    }
  }, [isAuthenticated, fetchProjects]);

  if (!isAuthenticated) {
    return <Navigate to="/" />;
  }

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
