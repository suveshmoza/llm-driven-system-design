import { useState } from 'react';
import type { AuthUser } from '../types';

interface AuthUserFormProps {
  initialData?: AuthUser;
  onSubmit: (data: { email: string; password?: string; role?: string; emailConfirmed?: boolean }) => Promise<void>;
  onCancel: () => void;
}

/** Form for creating or editing a Supabase auth user with email, password, role, and confirmation. */
export function AuthUserForm({ initialData, onSubmit, onCancel }: AuthUserFormProps) {
  const [email, setEmail] = useState(initialData?.email || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(initialData?.role || 'authenticated');
  const [emailConfirmed, setEmailConfirmed] = useState(initialData?.emailConfirmed || false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        email,
        password: password || undefined,
        role,
        emailConfirmed,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-supabase-dark-surface border border-supabase-dark-border rounded-lg p-4 space-y-3">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm text-supabase-secondary mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-supabase-surface border border-supabase-border rounded px-3 py-2 text-supabase-text text-sm focus:outline-none focus:border-supabase-primary"
          placeholder="user@example.com"
          required
        />
      </div>

      <div>
        <label className="block text-sm text-supabase-secondary mb-1">
          Password {initialData && '(leave blank to keep)'}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-supabase-surface border border-supabase-border rounded px-3 py-2 text-supabase-text text-sm focus:outline-none focus:border-supabase-primary"
          placeholder="Password"
          {...(!initialData ? { required: true } : {})}
        />
      </div>

      <div>
        <label className="block text-sm text-supabase-secondary mb-1">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full bg-supabase-surface border border-supabase-border rounded px-3 py-2 text-supabase-text text-sm focus:outline-none focus:border-supabase-primary"
        >
          <option value="authenticated">authenticated</option>
          <option value="anon">anon</option>
          <option value="service_role">service_role</option>
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-supabase-secondary">
        <input
          type="checkbox"
          checked={emailConfirmed}
          onChange={(e) => setEmailConfirmed(e.target.checked)}
          className="accent-supabase-primary"
        />
        Email confirmed
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-supabase-secondary hover:text-supabase-text"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-supabase-primary hover:bg-supabase-hover text-black px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Saving...' : initialData ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
}
