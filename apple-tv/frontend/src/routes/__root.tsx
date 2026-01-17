import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Header } from '../components';
import { useAuthStore } from '../stores/authStore';

/**
 * Root layout component that wraps all routes.
 * Handles authentication state initialization and provides
 * the base layout structure for the application.
 *
 * Features:
 * - Validates existing session on mount
 * - Shows loading spinner during auth check
 * - Provides dark theme container for child routes
 */
function RootComponent() {
  const { checkAuth, isLoading } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Outlet />
    </div>
  );
}

/**
 * Root route configuration for Tanstack Router.
 * Defines the top-level layout that all child routes inherit.
 */
export const Route = createRootRoute({
  component: RootComponent,
});
