import { useEffect, useState, useCallback } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Canvas } from '../components/Canvas';
import { Toolbar } from '../components/Toolbar';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { CollaboratorCursors } from '../components/CollaboratorCursors';
import { ShareDialog } from '../components/ShareDialog';
import { useCanvasStore } from '../stores/canvasStore';
import { useAuthStore } from '../stores/authStore';
import { drawingApi } from '../services/api';
import { wsClient } from '../services/websocket';
import type { ExcalidrawElement, Collaborator, Cursor } from '../types';

export const Route = createFileRoute('/draw/$drawingId')({
  component: DrawingPage,
});

function DrawingPage() {
  const { drawingId } = Route.useParams();
  const { user, isAuthenticated } = useAuthStore();
  const {
    elements,
    viewState,
    cursors,
    setElements,
    addElement,
    updateElement,
    deleteElement,
    updateCursor,
    removeCursor,
  } = useCanvasStore();

  const [title, setTitle] = useState('Untitled');
  const [isPublic, setIsPublic] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load drawing data
  useEffect(() => {
    const loadDrawing = async () => {
      try {
        setIsLoading(true);
        const response = await drawingApi.get(drawingId);
        setElements(response.drawing.elements || []);
        setTitle(response.drawing.title);
        setIsPublic(response.drawing.isPublic);
        setIsOwner(response.drawing.ownerId === user?.id);
        setCollaborators(response.collaborators || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    loadDrawing();
  }, [drawingId, user, setElements]);

  // WebSocket connection
  useEffect(() => {
    if (!user) return;

    wsClient.connect();
    wsClient.joinRoom(drawingId, user.id, user.username);

    // Listen for room state (initial sync)
    const unsubRoomState = wsClient.on('room-state', (msg) => {
      if (msg.elements) {
        setElements(msg.elements as ExcalidrawElement[]);
      }
    });

    // Listen for shape operations from other users
    const unsubAdd = wsClient.on('shape-add', (msg) => {
      if (msg.elementData && msg.userId !== user.id) {
        addElement(msg.elementData);
      }
    });

    const unsubUpdate = wsClient.on('shape-update', (msg) => {
      if (msg.elementData && msg.userId !== user.id) {
        updateElement(msg.elementData.id, msg.elementData);
      }
    });

    const unsubDelete = wsClient.on('shape-delete', (msg) => {
      if (msg.elementId && msg.userId !== user.id) {
        deleteElement(msg.elementId);
      }
    });

    const unsubMove = wsClient.on('shape-move', (msg) => {
      if (msg.elementData && msg.userId !== user.id) {
        updateElement(msg.elementData.id, { x: msg.elementData.x, y: msg.elementData.y });
      }
    });

    const unsubSync = wsClient.on('elements-sync', (msg) => {
      if (msg.elements && msg.userId !== user.id) {
        setElements(msg.elements as ExcalidrawElement[]);
      }
    });

    // Listen for cursor moves
    const unsubCursor = wsClient.on('cursor-move', (msg) => {
      if (msg.userId && msg.userId !== user.id && msg.x !== undefined && msg.y !== undefined) {
        updateCursor({
          userId: msg.userId,
          username: msg.username || 'Anonymous',
          x: msg.x,
          y: msg.y,
          color: msg.color || '#6965db',
        } as Cursor);
      }
    });

    // Listen for user join/leave
    const unsubJoin = wsClient.on('user-joined', () => {
      // Could show a notification
    });

    const unsubLeave = wsClient.on('user-left', (msg) => {
      if (msg.userId) {
        removeCursor(msg.userId);
      }
    });

    return () => {
      unsubRoomState();
      unsubAdd();
      unsubUpdate();
      unsubDelete();
      unsubMove();
      unsubSync();
      unsubCursor();
      unsubJoin();
      unsubLeave();
      wsClient.leaveRoom();
    };
  }, [drawingId, user, setElements, addElement, updateElement, deleteElement, updateCursor, removeCursor]);

  // Save drawing
  const handleSave = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setIsSaving(true);
      const visibleElements = elements.filter((el) => !el.isDeleted);
      await drawingApi.update(drawingId, {
        title,
        elements: visibleElements,
        isPublic,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [drawingId, elements, title, isPublic, isAuthenticated]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-canvas-bg">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-canvas-bg gap-4">
        <div className="text-red-500 text-lg">{error}</div>
        <Link to="/" className="text-primary hover:underline">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-panel-border z-50">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-text-secondary hover:text-text-primary transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 18l-8-8 8-8 1.4 1.4L5.8 9H18v2H5.8l5.6 5.6L10 18z" />
            </svg>
          </Link>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-sm font-medium text-text-primary bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary rounded px-2 py-1"
            placeholder="Untitled"
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Connected users indicator */}
          {cursors.length > 0 && (
            <div className="flex -space-x-2">
              {cursors.slice(0, 5).map((cursor) => (
                <div
                  key={cursor.userId}
                  className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-medium"
                  style={{ backgroundColor: cursor.color }}
                  title={cursor.username}
                >
                  {cursor.username.charAt(0).toUpperCase()}
                </div>
              ))}
              {cursors.length > 5 && (
                <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-400 flex items-center justify-center text-white text-xs">
                  +{cursors.length - 5}
                </div>
              )}
            </div>
          )}

          {isAuthenticated && (
            <>
              <button
                onClick={() => setShowShareDialog(true)}
                className="text-sm text-primary hover:underline"
              >
                Share
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="text-sm bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative">
        <Toolbar />
        <PropertiesPanel />
        <Canvas />
        <CollaboratorCursors
          cursors={cursors}
          scrollX={viewState.scrollX}
          scrollY={viewState.scrollY}
          zoom={viewState.zoom}
        />
      </div>

      {/* Share dialog */}
      {showShareDialog && (
        <ShareDialog
          drawingId={drawingId}
          collaborators={collaborators}
          isOwner={isOwner}
          onClose={() => setShowShareDialog(false)}
          onCollaboratorsChange={setCollaborators}
        />
      )}
    </div>
  );
}
