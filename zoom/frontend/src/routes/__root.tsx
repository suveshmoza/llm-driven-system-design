import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Header } from '../components/Header';
import { useAuthStore } from '../stores/authStore';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { checkAuth, loading } = useAuthStore();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/register') {
        navigate({ to: '/login' });
      }
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="h-screen bg-zoom-bg flex items-center justify-center">
        <div className="text-zoom-primary text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zoom-bg">
      <Header />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
