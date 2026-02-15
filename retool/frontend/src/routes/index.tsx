import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { appsApi } from '../services/api';
import type { App } from '../types';
import { AppCard } from '../components/AppCard';

function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();
  const [apps, setApps] = useState<App[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newAppDesc, setNewAppDesc] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      loadApps();
    }
  }, [user]);

  const loadApps = async () => {
    setAppsLoading(true);
    try {
      const { apps: appList } = await appsApi.list();
      setApps(appList);
    } catch (err) {
      console.error('Failed to load apps:', err);
    }
    setAppsLoading(false);
  };

  const handleCreate = async () => {
    if (!newAppName.trim()) return;
    try {
      const { app } = await appsApi.create(newAppName.trim(), newAppDesc.trim() || undefined);
      setApps((prev) => [app, ...prev]);
      setNewAppName('');
      setNewAppDesc('');
      setShowCreate(false);
      navigate({ to: '/app/$appId/edit', params: { appId: app.id } });
    } catch (err) {
      console.error('Failed to create app:', err);
    }
  };

  const handleDelete = async (appId: string) => {
    if (!confirm('Are you sure you want to delete this app?')) return;
    try {
      await appsApi.delete(appId);
      setApps((prev) => prev.filter((a) => a.id !== appId));
    } catch (err) {
      console.error('Failed to delete app:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-retool-secondary">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-retool-text">My Apps</h1>
          <p className="text-retool-secondary mt-1">Build and manage your internal tools</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-retool-primary text-white rounded-lg hover:bg-retool-hover transition-colors font-medium"
        >
          + Create App
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-lg border border-retool-border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Create New App</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-retool-text mb-1">App Name</label>
              <input
                type="text"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                placeholder="My Internal Tool"
                className="w-full px-3 py-2 border border-retool-border rounded-lg focus:outline-none focus:ring-2 focus:ring-retool-primary"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-retool-text mb-1">Description (optional)</label>
              <input
                type="text"
                value={newAppDesc}
                onChange={(e) => setNewAppDesc(e.target.value)}
                placeholder="A brief description..."
                className="w-full px-3 py-2 border border-retool-border rounded-lg focus:outline-none focus:ring-2 focus:ring-retool-primary"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newAppName.trim()}
                className="px-4 py-2 bg-retool-primary text-white rounded-lg hover:bg-retool-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewAppName('');
                  setNewAppDesc('');
                }}
                className="px-4 py-2 text-retool-secondary border border-retool-border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {appsLoading ? (
        <div className="text-center py-12 text-retool-secondary">Loading apps...</div>
      ) : apps.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-retool-secondary mb-4">No apps yet. Create your first internal tool!</div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-retool-primary text-white rounded-lg hover:bg-retool-hover"
          >
            + Create App
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: Dashboard,
});
