/**
 * Index Route Component
 *
 * Main entry point route that handles the root URL (/).
 * Displays the chat interface for authenticated users,
 * or login/registration forms for unauthenticated visitors.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { LoginForm } from '../components/LoginForm';
import { RegisterForm } from '../components/RegisterForm';
import { ChatLayout } from '../components/ChatLayout';

/**
 * Index page component that conditionally renders based on auth state.
 */
function IndexPage() {
  const { user } = useAuthStore();
  const [isRegistering, setIsRegistering] = useState(false);

  // If logged in, show chat
  if (user) {
    return <ChatLayout />;
  }

  // Otherwise show login/register
  return (
    <div className="min-h-screen bg-whatsapp-header flex flex-col">
      {/* Top banner like WhatsApp Web */}
      <div className="h-52 bg-whatsapp-header"></div>
      <div className="flex-1 bg-whatsapp-chat-bg -mt-8 flex items-start justify-center pt-0">
        <div className="-mt-44">
          {isRegistering ? (
            <RegisterForm onSwitchToLogin={() => setIsRegistering(false)} />
          ) : (
            <LoginForm onSwitchToRegister={() => setIsRegistering(true)} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Route configuration for the index/home page.
 * Maps to the root URL path (/).
 */
export const Route = createFileRoute('/')({
  component: IndexPage,
});
