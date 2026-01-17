/**
 * Application entry point for the Uber clone frontend.
 * Sets up the TanStack Router with the generated route tree.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import './index.css';

/**
 * TanStack Router instance configured with the generated route tree.
 * Routes are file-based and auto-generated from the routes/ directory.
 */
const router = createRouter({ routeTree });

// Type registration for TanStack Router to enable type-safe navigation
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
