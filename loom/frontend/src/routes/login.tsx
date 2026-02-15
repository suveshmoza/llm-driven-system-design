import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await login(username, password);
      navigate({ to: '/' });
    } catch {
      // error is set in store
    }
    setSubmitting(false);
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-loom-primary">Loom</h1>
          <p className="text-loom-secondary mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-loom-text mb-1">Username</label>
            <input
              type="text"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-loom-border rounded-lg focus:outline-none focus:ring-2 focus:ring-loom-primary"
              placeholder="alice"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-loom-text mb-1">Password</label>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-loom-border rounded-lg focus:outline-none focus:ring-2 focus:ring-loom-primary"
              placeholder="password123"
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 bg-loom-primary text-white rounded-lg hover:bg-loom-hover font-medium disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-loom-secondary">
          Don't have an account?{' '}
          <button
            onClick={() => navigate({ to: '/register' })}
            className="text-loom-primary hover:underline"
          >
            Register
          </button>
        </div>

        <div className="mt-4 text-center text-xs text-loom-secondary">
          Demo credentials: alice / password123
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/login')({
  component: LoginPage,
});
