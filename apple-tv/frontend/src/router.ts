import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/**
 * Application router instance created from the generated route tree.
 * Tanstack Router provides type-safe routing with code splitting support.
 *
 * The route tree is auto-generated from files in the routes/ directory
 * by the @tanstack/router-vite-plugin during build.
 */
export const router = createRouter({ routeTree });

/**
 * Module augmentation for type-safe route navigation.
 * Registers the router type globally so Link and useNavigate
 * have full TypeScript support for route params and search.
 */
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
