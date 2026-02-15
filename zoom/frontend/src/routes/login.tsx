import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { login, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLoading(true);
    try {
      await login(username, password);
      navigate({ to: '/' });
    } catch {
      // error is set in store
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <svg width="40" height="40" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="6" fill="#2D8CFF" />
              <path
                d="M7 10.5C7 9.67 7.67 9 8.5 9H15.5C16.33 9 17 9.67 17 10.5V17.5C17 18.33 16.33 19 15.5 19H8.5C7.67 19 7 18.33 7 17.5V10.5Z"
                fill="white"
              />
              <path d="M18 12L21 9.5V18.5L18 16V12Z" fill="white" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zoom-text">Sign in to Zoom</h1>
          <p className="text-zoom-secondary text-sm mt-1">Enter your credentials to continue</p>
        </div>

        {error && (
          <div className="bg-zoom-red/20 border border-zoom-red text-zoom-red rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zoom-secondary mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice"
              className="w-full bg-zoom-surface border border-zoom-card rounded-lg px-4 py-2.5 text-zoom-text placeholder-zoom-secondary focus:outline-none focus:border-zoom-primary"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-zoom-secondary mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password123"
              className="w-full bg-zoom-surface border border-zoom-card rounded-lg px-4 py-2.5 text-zoom-text placeholder-zoom-secondary focus:outline-none focus:border-zoom-primary"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full bg-zoom-primary hover:bg-zoom-hover disabled:opacity-50 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-zoom-secondary mt-6">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-zoom-primary hover:underline">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}
