import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';
import { useEditorStore } from '../stores/editorStore';

export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const routerState = useRouterState();
  const app = useEditorStore((s) => s.app);
  const isDirty = useEditorStore((s) => s.isDirty);
  const saveApp = useEditorStore((s) => s.saveApp);
  const publishApp = useEditorStore((s) => s.publishApp);

  const isEditor = routerState.location.pathname.includes('/edit');

  const handleSave = async () => {
    try {
      await saveApp();
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const handlePublish = async () => {
    try {
      await publishApp();
      alert('App published successfully!');
    } catch (err) {
      console.error('Publish failed:', err);
    }
  };

  return (
    <header className="bg-retool-sidebar text-white h-12 flex items-center px-4 justify-between">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate({ to: '/' })}
          className="text-lg font-bold text-retool-primary hover:text-white transition-colors"
        >
          Retool
        </button>

        {isEditor && app && (
          <>
            <span className="text-gray-500">/</span>
            <span className="text-sm text-gray-300">{app.name}</span>
            {isDirty && (
              <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded">
                Unsaved
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {isEditor && app && (
          <>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="px-3 py-1 text-sm bg-gray-700 text-gray-200 rounded hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={() =>
                navigate({ to: '/app/$appId/preview', params: { appId: app.id } })
              }
              className="px-3 py-1 text-sm bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
            >
              Preview
            </button>
            <button
              onClick={handlePublish}
              className="px-3 py-1 text-sm bg-retool-primary text-white rounded hover:bg-retool-hover"
            >
              Publish
            </button>
          </>
        )}

        {user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{user.username}</span>
            <button
              onClick={async () => {
                await logout();
                navigate({ to: '/login' });
              }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
