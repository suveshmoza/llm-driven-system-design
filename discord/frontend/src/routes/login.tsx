/**
 * Login Route
 *
 * Displays the login form for unauthenticated users. Redirects to
 * /channels/@me if the user is already logged in.
 */

import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    const session = useChatStore.getState().session;
    if (session) {
      throw redirect({ to: '/channels/@me' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const [nickname, setNickname] = useState('');
  const { connect, isConnecting, connectionError, session } = useChatStore();
  const navigate = useNavigate();

  // Redirect after successful login
  useEffect(() => {
    if (session) {
      navigate({ to: '/channels/@me' });
    }
  }, [session, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nickname.trim()) {
      await connect(nickname.trim());
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-discord-darker">
      <div className="bg-discord-channel p-8 rounded-lg shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-bold text-white text-center mb-2">
          Welcome to Baby Discord
        </h1>
        <p className="text-discord-muted text-center mb-6">
          Enter a nickname to get started
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="nickname"
              className="block text-discord-text text-sm font-medium mb-2"
            >
              NICKNAME
            </label>
            <input
              type="text"
              id="nickname"
              name="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full px-3 py-2 bg-discord-input text-white rounded
                       focus:outline-none focus:ring-2 focus:ring-discord-link"
              placeholder="Enter your nickname"
              minLength={2}
              maxLength={50}
              required
              disabled={isConnecting}
              autoFocus
            />
          </div>

          {connectionError && (
            <p className="text-red-500 text-sm mb-4">{connectionError}</p>
          )}

          <button
            type="submit"
            disabled={isConnecting || !nickname.trim()}
            className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700
                     disabled:bg-indigo-800 disabled:cursor-not-allowed
                     text-white font-medium rounded transition-colors"
          >
            {isConnecting ? 'Connecting...' : 'Continue'}
          </button>
        </form>

        <p className="text-discord-muted text-xs text-center mt-6">
          A simplified chat application for learning distributed systems
        </p>
      </div>
    </div>
  );
}
