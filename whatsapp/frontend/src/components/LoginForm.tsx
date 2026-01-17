/**
 * Login Form Component
 *
 * Provides user authentication interface with username/password fields.
 * Displays error messages and loading states during authentication.
 * Includes demo account hints for development convenience.
 */

import { useState, FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Props for the LoginForm component.
 */
interface LoginFormProps {
  /** Callback to switch to the registration form */
  onSwitchToRegister: () => void;
}

/**
 * Login form with username and password authentication.
 * @param props - Component props including form switch callback
 */
export function LoginForm({ onSwitchToRegister }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
    } catch {
      // Error is handled in store
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-whatsapp-header">WhatsApp</h1>
          <p className="text-whatsapp-text-secondary mt-2">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
              <button
                type="button"
                onClick={clearError}
                className="float-right font-bold"
              >
                x
              </button>
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-whatsapp-text-primary">
              Username
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full px-3 py-2.5 border border-whatsapp-divider rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-header focus:border-whatsapp-header text-whatsapp-text-primary"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-whatsapp-text-primary">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2.5 border border-whatsapp-divider rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-header focus:border-whatsapp-header text-whatsapp-text-primary"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-whatsapp-header hover:bg-whatsapp-teal focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-whatsapp-header disabled:opacity-50 transition-colors"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-whatsapp-text-secondary">
            Don't have an account?{' '}
            <button
              onClick={onSwitchToRegister}
              className="font-medium text-whatsapp-header hover:text-whatsapp-teal transition-colors"
            >
              Sign up
            </button>
          </p>
        </div>

        <div className="mt-4 text-center text-xs text-whatsapp-text-secondary">
          <p>Demo accounts: alice / bob / charlie</p>
          <p>Password: password123</p>
        </div>
      </div>
    </div>
  );
}
