import { useState } from 'react';
import { useDataStore } from '../stores/dataStore';

interface DataSourceFormProps {
  onClose: () => void;
}

export function DataSourceForm({ onClose }: DataSourceFormProps) {
  const addDataSource = useDataStore((s) => s.addDataSource);

  const [name, setName] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('5433');
  const [database, setDatabase] = useState('sample_db');
  const [user, setUser] = useState('sample');
  const [password, setPassword] = useState('sample123');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await addDataSource(name, 'postgresql', {
        host,
        port: parseInt(port, 10),
        database,
        user,
        password,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create data source');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">Add PostgreSQL Data Source</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="bg-red-50 text-red-600 px-3 py-2 rounded text-sm">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-retool-border rounded focus:outline-none focus:ring-2 focus:ring-retool-primary text-sm"
              placeholder="My Database"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="w-full px-3 py-2 border border-retool-border rounded focus:outline-none focus:ring-2 focus:ring-retool-primary text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full px-3 py-2 border border-retool-border rounded focus:outline-none focus:ring-2 focus:ring-retool-primary text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Database</label>
            <input
              type="text"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              className="w-full px-3 py-2 border border-retool-border rounded focus:outline-none focus:ring-2 focus:ring-retool-primary text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <input
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="w-full px-3 py-2 border border-retool-border rounded focus:outline-none focus:ring-2 focus:ring-retool-primary text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-retool-border rounded focus:outline-none focus:ring-2 focus:ring-retool-primary text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-retool-primary text-white rounded hover:bg-retool-hover disabled:opacity-50 text-sm"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-retool-secondary border border-retool-border rounded hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
