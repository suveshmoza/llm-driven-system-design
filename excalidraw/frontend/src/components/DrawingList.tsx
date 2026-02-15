import { useState, useEffect } from 'react';
import { drawingApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type { Drawing } from '../types';

interface DrawingListProps {
  onSelectDrawing: (drawingId: string) => void;
}

export function DrawingList({ onSelectDrawing }: DrawingListProps) {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [publicDrawings, setPublicDrawings] = useState<Drawing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPublic, setShowPublic] = useState(false);
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    loadDrawings();
  }, [isAuthenticated]);

  const loadDrawings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (isAuthenticated) {
        const response = await drawingApi.list();
        setDrawings(response.drawings);
      }
      const publicResponse = await drawingApi.listPublic();
      setPublicDrawings(publicResponse.drawings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      const title = window.prompt('Drawing title:', 'Untitled');
      if (!title) return;

      const response = await drawingApi.create({ title });
      onSelectDrawing(response.drawing.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (drawingId: string) => {
    if (!window.confirm('Are you sure you want to delete this drawing?')) return;
    try {
      await drawingApi.delete(drawingId);
      setDrawings(drawings.filter((d) => d.id !== drawingId));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const displayDrawings = showPublic ? publicDrawings : drawings;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex gap-4">
          {isAuthenticated && (
            <button
              onClick={() => setShowPublic(false)}
              className={`text-lg font-semibold pb-1 ${
                !showPublic ? 'text-primary border-b-2 border-primary' : 'text-text-secondary'
              }`}
            >
              My Drawings
            </button>
          )}
          <button
            onClick={() => setShowPublic(true)}
            className={`text-lg font-semibold pb-1 ${
              showPublic ? 'text-primary border-b-2 border-primary' : 'text-text-secondary'
            }`}
          >
            Public Drawings
          </button>
        </div>
        {isAuthenticated && (
          <button
            onClick={handleCreate}
            className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-hover transition-colors font-medium"
          >
            + New Drawing
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Drawing cards */}
      {displayDrawings.length === 0 ? (
        <div className="text-center py-20 text-text-secondary">
          <div className="text-4xl mb-4">
            {showPublic ? '🌍' : '📝'}
          </div>
          <p className="text-lg">
            {showPublic
              ? 'No public drawings yet'
              : 'No drawings yet. Create your first one!'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayDrawings.map((drawing) => (
            <div
              key={drawing.id}
              className="bg-white rounded-xl border border-panel-border hover:border-primary hover:shadow-md transition-all cursor-pointer group"
              onClick={() => onSelectDrawing(drawing.id)}
            >
              {/* Preview area */}
              <div className="h-40 bg-gray-50 rounded-t-xl flex items-center justify-center border-b border-panel-border">
                <div className="text-text-muted text-sm">
                  {drawing.elementCount || 0} elements
                </div>
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-medium text-text-primary truncate">
                    {drawing.title}
                  </h3>
                  {drawing.isPublic && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      Public
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-secondary">
                  {showPublic && drawing.ownerUsername && (
                    <span>by {drawing.ownerDisplayName || drawing.ownerUsername} · </span>
                  )}
                  {drawing.permission && !showPublic && (
                    <span className="capitalize">{drawing.permission} · </span>
                  )}
                  {formatDate(drawing.updatedAt)}
                </div>

                {/* Actions */}
                {!showPublic && isAuthenticated && (
                  <div className="mt-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(drawing.id);
                      }}
                      className="text-xs text-danger hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
