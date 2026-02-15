import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(username, password);
      navigate({ to: '/' });
    } catch (_e) {
      // Error handled by store
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-cb-card rounded-xl p-8 border border-cb-border">
          <h1 className="text-2xl font-bold text-center mb-2">Sign in to Coinbase</h1>
          <p className="text-cb-text-secondary text-center mb-8">
            Trade crypto 24/7 on the most trusted exchange
          </p>

          {error && (
            <div className="bg-cb-red/10 border border-cb-red/20 rounded-lg p-3 mb-4">
              <p className="text-cb-red text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-cb-text-secondary mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearError();
                }}
                className="w-full bg-cb-surface border border-cb-border rounded-lg px-4 py-3 text-cb-text focus:outline-none focus:border-cb-primary"
                placeholder="Enter your username"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-cb-text-secondary mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError();
                }}
                className="w-full bg-cb-surface border border-cb-border rounded-lg px-4 py-3 text-cb-text focus:outline-none focus:border-cb-primary"
                placeholder="Enter your password"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-cb-primary hover:bg-cb-primary-hover text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-cb-text-secondary text-sm mt-6">
            Don't have an account?{' '}
            <a href="/register" className="text-cb-primary hover:underline">
              Sign up
            </a>
          </p>

          <div className="mt-6 p-3 bg-cb-surface rounded-lg">
            <p className="text-xs text-cb-text-secondary text-center">
              Demo accounts: alice / password123 or bob / password123
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Route definition for the sign-in page. */
export const Route = createFileRoute('/login')({
  component: LoginPage,
});
