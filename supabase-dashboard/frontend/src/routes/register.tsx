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
      // error handled by store
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-supabase-dark-bg">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-supabase-primary rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-black font-bold text-xl">S</span>
          </div>
          <h1 className="text-2xl font-semibold text-supabase-text">Create an account</h1>
          <p className="text-supabase-secondary mt-1">Get started with Supabase Dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded text-sm">
              {error}
              <button onClick={clearError} className="float-right text-red-400 hover:text-red-300">&times;</button>
            </div>
          )}

          <div>
            <label className="block text-sm text-supabase-secondary mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-supabase-surface border border-supabase-border rounded-md px-3 py-2 text-supabase-text text-sm focus:outline-none focus:border-supabase-primary"
              placeholder="Choose a username"
              required
              minLength={3}
              maxLength={30}
            />
          </div>

          <div>
            <label className="block text-sm text-supabase-secondary mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-supabase-surface border border-supabase-border rounded-md px-3 py-2 text-supabase-text text-sm focus:outline-none focus:border-supabase-primary"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-supabase-secondary mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-supabase-surface border border-supabase-border rounded-md px-3 py-2 text-supabase-text text-sm focus:outline-none focus:border-supabase-primary"
              placeholder="At least 6 characters"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-supabase-primary hover:bg-supabase-hover text-black py-2 rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-supabase-secondary text-sm mt-6">
          Already have an account?{' '}
          <a href="/login" className="text-supabase-primary hover:text-supabase-hover">Sign in</a>
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});
