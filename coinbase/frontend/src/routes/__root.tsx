import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Header } from '../components/Header';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useWebSocket } from '../hooks/useWebSocket';

function RootComponent() {
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useWebSocket();

  return (
    <div className="min-h-screen bg-cb-bg">
      <Header />
      <main>
        <Outlet />
      </main>
    </div>
  );
}

/** Root route definition for the application shell with header and WebSocket connection. */
export const Route = createRootRoute({
  component: RootComponent,
});
