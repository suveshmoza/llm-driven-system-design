/**
 * @fileoverview TanStack Router configuration.
 *
 * Uses the auto-generated route tree from TanStack Router Vite plugin.
 * Registers TypeScript types for router-aware components.
 */

import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/**
 * The application router instance.
 * Export for use in main.tsx and router-aware hooks.
 */
export const router = createRouter({ routeTree });

/**
 * Type registration for TanStack Router.
 * Enables type-safe navigation and route params throughout the app.
 */
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
