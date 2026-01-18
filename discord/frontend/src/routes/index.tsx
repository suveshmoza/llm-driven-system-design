/**
 * Index Route
 *
 * Root path handler that redirects users based on authentication state.
 * Unauthenticated users are sent to /login, authenticated users go to /channels/@me.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useChatStore } from '../stores/chatStore';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const session = useChatStore.getState().session;
    if (!session) {
      throw redirect({ to: '/login' });
    }
    throw redirect({ to: '/channels/@me' });
  },
});
