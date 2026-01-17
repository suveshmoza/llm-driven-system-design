import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Header } from '../components/Header';

/**
 * Root route definition for the application.
 *
 * Provides the base layout structure that wraps all pages:
 * - Sticky header with navigation
 * - Main content area (Outlet for child routes)
 * - Footer with branding
 *
 * This is the entry point for TanStack Router's route tree.
 */
export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-gray-800 text-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-gray-400">
            AuctionHub - Online Auction Platform
          </p>
        </div>
      </footer>
    </div>
  ),
});
