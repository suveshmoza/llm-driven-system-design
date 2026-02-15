import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(username, password);
      navigate({ to: '/label/$labelName', params: { labelName: 'INBOX' } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gmail-bg">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-normal text-gmail-text">Sign in</h1>
          <p className="text-gmail-text-secondary mt-2">to continue to Gmail</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-gmail-danger text-sm p-3 rounded">
              {error}
            </div>
          )}

          <div>
            <input
              type="text"
              name="username"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 border border-gmail-border rounded-md focus:outline-none focus:border-gmail-blue focus:ring-1 focus:ring-gmail-blue"
              required
            />
          </div>

          <div>
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gmail-border rounded-md focus:outline-none focus:border-gmail-blue focus:ring-1 focus:ring-gmail-blue"
              required
            />
          </div>

          <div className="flex justify-between items-center pt-4">
            <a
              href="/register"
              onClick={(e) => {
                e.preventDefault();
                navigate({ to: '/register' });
              }}
              className="text-gmail-blue text-sm hover:underline"
            >
              Create account
            </a>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-gmail-blue text-white px-6 py-2 rounded-md hover:bg-gmail-blue-hover disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>

        <div className="mt-6 text-center text-sm text-gmail-text-secondary">
          <p>Demo: alice / password123</p>
        </div>
      </div>
    </div>
  );
}
