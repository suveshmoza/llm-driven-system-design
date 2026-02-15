import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useEditorStore } from '../stores/editorStore';
import { useDataStore } from '../stores/dataStore';
import { EditorLayout } from '../components/editor/EditorLayout';

function AppEditor() {
  const { appId } = Route.useParams();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();
  const loadApp = useEditorStore((s) => s.loadApp);
  const loadComponentDefinitions = useEditorStore((s) => s.loadComponentDefinitions);
  const loadDataSources = useDataStore((s) => s.loadDataSources);
  const app = useEditorStore((s) => s.app);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user && appId) {
      loadApp(appId);
      loadComponentDefinitions();
      loadDataSources();
    }
  }, [user, appId, loadApp, loadComponentDefinitions, loadDataSources]);

  if (loading || !app) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="text-retool-secondary">Loading editor...</div>
      </div>
    );
  }

  return <EditorLayout />;
}

export const Route = createFileRoute('/app/$appId/edit')({
  component: AppEditor,
});
