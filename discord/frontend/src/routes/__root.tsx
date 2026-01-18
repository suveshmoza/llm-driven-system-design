/**
 * Root Route Layout
 *
 * The root layout component that wraps all routes. Provides the base HTML
 * structure and renders child routes via Outlet. Includes TanStack Router
 * Devtools in development mode for debugging.
 */

import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </>
  );
}
