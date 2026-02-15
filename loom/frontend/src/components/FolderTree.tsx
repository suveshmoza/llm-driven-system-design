import { useEffect, useState } from 'react';
import type { Folder } from '../types';
import { foldersApi } from '../services/api';

interface FolderTreeProps {
  selectedFolderId: string | undefined;
  onSelectFolder: (folderId: string | undefined) => void;
}

/** Renders a hierarchical folder tree with selection, creation, and deletion support. */
export function FolderTree({ selectedFolderId, onSelectFolder }: FolderTreeProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    try {
      const { folders: list } = await foldersApi.list();
      setFolders(list);
    } catch {
      // ignore
    }
  };

  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    try {
      const { folder } = await foldersApi.create(newFolderName.trim());
      setFolders((prev) => [...prev, folder]);
      setNewFolderName('');
      setShowCreate(false);
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this folder?')) return;
    try {
      await foldersApi.delete(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      if (selectedFolderId === id) {
        onSelectFolder(undefined);
      }
    } catch {
      // ignore
    }
  };

  const topLevel = folders.filter((f) => !f.parentId);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-loom-text">Folders</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs text-loom-primary hover:text-loom-hover"
        >
          + New
        </button>
      </div>

      {showCreate && (
        <div className="mb-3 flex gap-1">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 px-2 py-1 text-sm border border-loom-border rounded focus:outline-none focus:ring-1 focus:ring-loom-primary"
            placeholder="Folder name"
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="px-2 py-1 text-xs bg-loom-primary text-white rounded hover:bg-loom-hover"
          >
            Add
          </button>
        </div>
      )}

      {/* All Videos */}
      <button
        onClick={() => onSelectFolder(undefined)}
        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
          selectedFolderId === undefined
            ? 'bg-loom-primary/10 text-loom-primary font-medium'
            : 'text-loom-text hover:bg-gray-100'
        }`}
      >
        All Videos
      </button>

      {/* Folder list */}
      <div className="mt-1 space-y-0.5">
        {topLevel.map((folder) => (
          <div key={folder.id} className="group flex items-center">
            <button
              onClick={() => onSelectFolder(folder.id)}
              className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedFolderId === folder.id
                  ? 'bg-loom-primary/10 text-loom-primary font-medium'
                  : 'text-loom-text hover:bg-gray-100'
              }`}
            >
              {folder.name}
            </button>
            <button
              onClick={(e) => handleDelete(folder.id, e)}
              className="opacity-0 group-hover:opacity-100 text-xs text-loom-secondary hover:text-loom-danger px-1 transition-all"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
