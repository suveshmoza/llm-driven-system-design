/**
 * Registration Form Component
 *
 * Provides new user account creation interface.
 * Validates password confirmation and displays error messages.
 */

import { useState, FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Props for the RegisterForm component.
 */
interface RegisterFormProps {
  /** Callback to switch to the login form */
  onSwitchToLogin: () => void;
}

/**
 * Registration form with username, display name, and password fields.
 * @param props - Component props including form switch callback
 */
export function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const { register, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    try {
      await register(username, displayName, password);
    } catch {
      // Error is handled in store
    }
  };

  const displayError = localError || error;

  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-whatsapp-header">WhatsApp</h1>
          <p className="text-whatsapp-text-secondary mt-2">Create a new account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {displayError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {displayError}
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  clearError();
                }}
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
              minLength={3}
            />
          </div>

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-whatsapp-text-primary">
              Display Name
            </label>
            <input
              type="text"
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-whatsapp-text-primary">
              Confirm Password
            </label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2.5 border border-whatsapp-divider rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-header focus:border-whatsapp-header text-whatsapp-text-primary"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-whatsapp-header hover:bg-whatsapp-teal focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-whatsapp-header disabled:opacity-50 transition-colors"
          >
            {isLoading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-whatsapp-text-secondary">
            Already have an account?{' '}
            <button
              onClick={onSwitchToLogin}
              className="font-medium text-whatsapp-header hover:text-whatsapp-teal transition-colors"
            >
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
