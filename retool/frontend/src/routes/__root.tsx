import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Header } from '../components/Header';

function RootComponent() {
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <div className="min-h-screen bg-retool-bg">
      <Header />
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
