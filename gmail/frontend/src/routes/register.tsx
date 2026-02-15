import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});

function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await register(username, email, password, displayName);
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
          <h1 className="text-2xl font-normal text-gmail-text">
            Create your Account
          </h1>
          <p className="text-gmail-text-secondary mt-2">to use Gmail</p>
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
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-4 py-3 border border-gmail-border rounded-md focus:outline-none focus:border-gmail-blue focus:ring-1 focus:ring-gmail-blue"
            />
          </div>

          <div>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 border border-gmail-border rounded-md focus:outline-none focus:border-gmail-blue focus:ring-1 focus:ring-gmail-blue"
              required
            />
          </div>

          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gmail-border rounded-md focus:outline-none focus:border-gmail-blue focus:ring-1 focus:ring-gmail-blue"
              required
            />
          </div>

          <div>
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gmail-border rounded-md focus:outline-none focus:border-gmail-blue focus:ring-1 focus:ring-gmail-blue"
              required
              minLength={6}
            />
          </div>

          <div className="flex justify-between items-center pt-4">
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                navigate({ to: '/login' });
              }}
              className="text-gmail-blue text-sm hover:underline"
            >
              Sign in instead
            </a>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-gmail-blue text-white px-6 py-2 rounded-md hover:bg-gmail-blue-hover disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
