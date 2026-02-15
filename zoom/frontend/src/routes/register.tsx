import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const { register, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setLoading(true);
    try {
      await register(username, email, password, displayName || undefined);
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
          <h1 className="text-2xl font-bold text-zoom-text">Create Account</h1>
          <p className="text-zoom-secondary text-sm mt-1">Sign up for Zoom</p>
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
            <label className="block text-sm text-zoom-secondary mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@example.com"
              className="w-full bg-zoom-surface border border-zoom-card rounded-lg px-4 py-2.5 text-zoom-text placeholder-zoom-secondary focus:outline-none focus:border-zoom-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-zoom-secondary mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alice Johnson"
              className="w-full bg-zoom-surface border border-zoom-card rounded-lg px-4 py-2.5 text-zoom-text placeholder-zoom-secondary focus:outline-none focus:border-zoom-primary"
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
            disabled={loading || !username || !email || !password}
            className="w-full bg-zoom-primary hover:bg-zoom-hover disabled:opacity-50 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-sm text-zoom-secondary mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-zoom-primary hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
