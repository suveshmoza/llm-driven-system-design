import { useNavigate } from '@tanstack/react-router';
import type { App } from '../types';

interface AppCardProps {
  app: App;
  onDelete: (id: string) => void;
}

export function AppCard({ app, onDelete }: AppCardProps) {
  const navigate = useNavigate();

  const updatedAt = new Date(app.updatedAt || app.createdAt).toLocaleDateString();

  return (
    <div className="bg-white rounded-lg border border-retool-border hover:border-retool-primary/30 transition-colors overflow-hidden">
      <div
        className="p-5 cursor-pointer"
        onClick={() => navigate({ to: '/app/$appId/edit', params: { appId: app.id } })}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-retool-text truncate">{app.name}</h3>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              app.status === 'published'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {app.status}
          </span>
        </div>

        {app.description && (
          <p className="text-sm text-retool-secondary mb-3 line-clamp-2">
            {app.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-xs text-retool-secondary">
          <span>
            {((app.components as unknown[]) || []).length} component{((app.components as unknown[]) || []).length !== 1 ? 's' : ''}
          </span>
          <span>
            {((app.queries as unknown[]) || []).length} quer{((app.queries as unknown[]) || []).length !== 1 ? 'ies' : 'y'}
          </span>
          <span>Updated {updatedAt}</span>
        </div>
      </div>

      <div className="border-t border-retool-border px-5 py-2 flex justify-between items-center bg-gray-50">
        <button
          onClick={() => navigate({ to: '/app/$appId/edit', params: { appId: app.id } })}
          className="text-sm text-retool-primary hover:text-retool-hover font-medium"
        >
          Edit
        </button>
        <div className="flex gap-3">
          {app.status === 'published' && (
            <button
              onClick={() => navigate({ to: '/app/$appId/preview', params: { appId: app.id } })}
              className="text-sm text-retool-secondary hover:text-retool-text"
            >
              Preview
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(app.id);
            }}
            className="text-sm text-red-500 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
