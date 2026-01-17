import { createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/**
 * TanStack Router instance configured with the auto-generated route tree.
 * The route tree is generated from file-based routing in the routes/ directory.
 */
const router = createRouter({ routeTree });

/**
 * TypeScript module augmentation to register router types.
 * Enables type-safe navigation throughout the application.
 */
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/**
 * Root application component.
 * Provides the TanStack Router context to the component tree,
 * enabling client-side routing throughout the application.
 */
function App() {
  return <RouterProvider router={router} />;
}

export default App;
