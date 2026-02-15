import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

function RegisterPage() {
  const { register, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(username, email, password);
      navigate({ to: '/' });
    } catch {
      // error set in store
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-teams-bg">
      <div className="bg-teams-surface rounded-lg shadow-lg p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">💬</div>
          <h1 className="text-2xl font-bold text-teams-text">Create Account</h1>
          <p className="text-teams-secondary mt-1">Join your team on Microsoft Teams</p>
        </div>

        {error && (
          <div className="bg-red-50 text-teams-danger rounded-md p-3 mb-4 text-sm">
            {error}
            <button onClick={clearError} className="float-right font-bold">
              x
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-teams-text mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-teams-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teams-primary"
              required
              minLength={3}
              maxLength={30}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-teams-text mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-teams-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teams-primary"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-teams-text mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-teams-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teams-primary"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-teams-primary text-white py-2 rounded-md hover:bg-teams-hover transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-teams-secondary mt-4">
          Already have an account?{' '}
          <button
            onClick={() => navigate({ to: '/login' })}
            className="text-teams-primary hover:underline"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});
