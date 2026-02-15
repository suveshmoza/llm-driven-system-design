import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await register(username, email, password, displayName || undefined);
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
          <h1 className="text-2xl font-bold text-center mb-2">Create your account</h1>
          <p className="text-cb-text-secondary text-center mb-8">
            Start trading crypto in minutes
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
                placeholder="Choose a username"
                required
                minLength={3}
                maxLength={30}
              />
            </div>
            <div>
              <label className="block text-sm text-cb-text-secondary mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError();
                }}
                className="w-full bg-cb-surface border border-cb-border rounded-lg px-4 py-3 text-cb-text focus:outline-none focus:border-cb-primary"
                placeholder="Enter your email"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-cb-text-secondary mb-1">
                Display Name (optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-cb-surface border border-cb-border rounded-lg px-4 py-3 text-cb-text focus:outline-none focus:border-cb-primary"
                placeholder="Your display name"
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
                placeholder="Create a password (min 8 chars)"
                required
                minLength={8}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-cb-primary hover:bg-cb-primary-hover text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-cb-text-secondary text-sm mt-6">
            Already have an account?{' '}
            <a href="/login" className="text-cb-primary hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Route definition for the account registration page. */
export const Route = createFileRoute('/register')({
  component: RegisterPage,
});
