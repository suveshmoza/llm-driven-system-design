/**
 * Application Entry Point
 *
 * Creates the React root and mounts the application with TanStack Router.
 * The router is created from the generated route tree and provides
 * client-side navigation throughout the application.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import './index.css';

// Create the router instance
const router = createRouter({ routeTree });

// Type registration for TypeScript
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
