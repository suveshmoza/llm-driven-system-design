import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { appsApi } from '../services/api';
import type { App } from '../types';
import { PreviewRenderer } from '../components/preview/PreviewRenderer';

function AppPreview() {
  const { appId } = Route.useParams();
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPreview();
  }, [appId]);

  const loadPreview = async () => {
    setLoading(true);
    try {
      // Try published version first, fall back to draft
      try {
        const { app: published } = await appsApi.preview(appId);
        setApp(published);
      } catch {
        const { app: draft } = await appsApi.get(appId);
        setApp(draft);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load app');
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="text-retool-secondary">Loading app...</div>
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="text-red-500">{error || 'App not found'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-retool-text mb-6">{app.name}</h1>
      <PreviewRenderer app={app} />
    </div>
  );
}

export const Route = createFileRoute('/app/$appId/preview')({
  component: AppPreview,
});
