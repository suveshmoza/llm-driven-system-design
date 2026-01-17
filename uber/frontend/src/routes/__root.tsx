/**
 * Root route component that wraps all other routes.
 * Handles application-wide concerns like authentication check on startup.
 */
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Root layout component rendered on every page.
 * Checks authentication status on mount to restore sessions from localStorage.
 *
 * @returns Root layout with Outlet for child routes
 */
function RootComponent() {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Outlet />
    </div>
  );
}

/**
 * TanStack Router root route definition.
 * All other routes are children of this route.
 */
export const Route = createRootRoute({
  component: RootComponent,
});
