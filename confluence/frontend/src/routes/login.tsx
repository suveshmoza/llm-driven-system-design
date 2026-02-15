import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(username, password);
      navigate({ to: '/' });
    } catch {
      // Error is handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-confluence-bg">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8 border border-confluence-border">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-confluence-text">Log in to Confluence</h1>
            <p className="text-sm text-confluence-text-subtle mt-1">
              Enter your credentials to continue
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
              <button onClick={clearError} className="ml-2 text-red-500 hover:text-red-700">
                x
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-confluence-text mb-1">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-confluence-border rounded focus:outline-none focus:ring-2 focus:ring-confluence-primary focus:border-transparent"
                placeholder="Enter username"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-confluence-text mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-confluence-border rounded focus:outline-none focus:ring-2 focus:ring-confluence-primary focus:border-transparent"
                placeholder="Enter password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2 px-4 bg-confluence-primary text-white rounded font-medium hover:bg-confluence-hover disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Logging in...' : 'Log in'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-confluence-text-subtle">
              Don't have an account?{' '}
              <Link to="/register" className="text-confluence-primary hover:underline">
                Sign up
              </Link>
            </p>
          </div>

          <div className="mt-4 p-3 bg-confluence-info rounded text-sm text-confluence-text">
            <strong>Demo accounts:</strong>
            <br />
            alice / password123 (admin)
            <br />
            bob / password123 (user)
          </div>
        </div>
      </div>
    </div>
  );
}
