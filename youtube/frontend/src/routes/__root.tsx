import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useEffect } from 'react';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import { useAuthStore } from '../stores/authStore';

/**
 * Root route configuration for TanStack Router.
 * Defines the application's root layout that wraps all pages.
 */
export const Route = createRootRoute({
  component: RootLayout,
});

/**
 * Root layout component that wraps all pages.
 * Provides the consistent app shell with header, sidebar, and main
 * content area. Checks authentication status on mount to restore
 * user sessions from cookies/localStorage.
 */
function RootLayout() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <div className="min-h-screen bg-yt-dark text-white">
      <Header />
      <div className="flex pt-14">
        <Sidebar />
        <main className="flex-1 ml-60 min-h-[calc(100vh-3.5rem)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
