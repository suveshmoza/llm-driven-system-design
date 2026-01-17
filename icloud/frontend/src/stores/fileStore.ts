import { create } from 'zustand';
import type { FileItem, SyncStatus, Conflict } from '../types';
import { api } from '../services/api';
import { wsService, isFileEvent } from '../services/websocket';

/**
 * File store interface defining state and actions for iCloud Drive.
 *
 * Manages the complete file browsing experience including navigation,
 * file operations, upload tracking, and conflict resolution.
 */
interface FileStore {
  /** Files in the current directory */
  files: FileItem[];
  /** Current directory path being viewed */
  currentPath: string;
  /** Set of selected file IDs for batch operations */
  selectedFiles: Set<string>;
  /** Whether files are currently loading */
  isLoading: boolean;
  /** Error message from the most recent operation */
  error: string | null;
  /** Unresolved sync conflicts requiring user action */
  conflicts: Conflict[];
  /** Upload progress by filename (0-100) */
  uploadProgress: Map<string, number>;

  /** Navigates to a new directory path */
  setCurrentPath: (path: string) => void;
  /** Fetches files for the current or specified path */
  loadFiles: (path?: string) => Promise<void>;
  /** Creates a new folder in the current directory */
  createFolder: (name: string) => Promise<void>;
  /** Uploads a single file to the current directory */
  uploadFile: (file: File) => Promise<void>;
  /** Uploads multiple files to the current directory */
  uploadFiles: (files: File[]) => Promise<void>;
  /** Downloads a file to the user's device */
  downloadFile: (fileId: string, fileName: string) => Promise<void>;
  /** Soft-deletes a file */
  deleteFile: (fileId: string) => Promise<void>;
  /** Renames a file */
  renameFile: (fileId: string, newName: string) => Promise<void>;
  /** Adds a file to the selection */
  selectFile: (fileId: string) => void;
  /** Removes a file from the selection */
  deselectFile: (fileId: string) => void;
  /** Toggles a file's selection state */
  toggleSelection: (fileId: string) => void;
  /** Clears all selected files */
  clearSelection: () => void;
  /** Fetches unresolved sync conflicts */
  loadConflicts: () => Promise<void>;
  /** Resolves a sync conflict with the specified strategy */
  resolveConflict: (fileId: string, resolution: 'use-local' | 'use-server', keepBoth?: boolean) => Promise<void>;
  /** Clears the current error message */
  clearError: () => void;
  /** Subscribes to WebSocket file change events */
  subscribeToChanges: () => void;
}

/**
 * Global file store for iCloud Drive functionality.
 *
 * This Zustand store manages all state related to file browsing and operations
 * in iCloud Drive. It handles:
 *
 * - **Navigation**: Tracks current path and file listing
 * - **File Operations**: Upload, download, rename, delete with optimistic updates
 * - **Selection**: Multi-select for batch operations
 * - **Sync Conflicts**: Detection and resolution of version conflicts
 * - **Real-time Updates**: WebSocket subscription for cross-device sync
 * - **Upload Progress**: Tracking for user feedback during uploads
 *
 * Files are fetched from the API and cached in the store. The store subscribes
 * to WebSocket events to refresh when changes occur on other devices.
 */
export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  currentPath: '/',
  selectedFiles: new Set(),
  isLoading: false,
  error: null,
  conflicts: [],
  uploadProgress: new Map(),

  setCurrentPath: (path) => {
    set({ currentPath: path });
    get().loadFiles(path);
  },

  loadFiles: async (path) => {
    const targetPath = path || get().currentPath;
    set({ isLoading: true, error: null });
    try {
      const result = await api.listFiles(targetPath);
      set({ files: result.files, isLoading: false });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load files',
      });
    }
  },

  createFolder: async (name) => {
    try {
      await api.createFolder(name, get().currentPath);
      await get().loadFiles();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create folder' });
      throw error;
    }
  },

  uploadFile: async (file) => {
    const progressMap = new Map(get().uploadProgress);
    progressMap.set(file.name, 0);
    set({ uploadProgress: progressMap });

    try {
      await api.uploadFile(file, get().currentPath);
      progressMap.set(file.name, 100);
      set({ uploadProgress: new Map(progressMap) });
      await get().loadFiles();
    } catch (error) {
      progressMap.delete(file.name);
      set({
        uploadProgress: new Map(progressMap),
        error: error instanceof Error ? error.message : 'Failed to upload file',
      });
      throw error;
    } finally {
      // Remove from progress after a delay
      setTimeout(() => {
        const newMap = new Map(get().uploadProgress);
        newMap.delete(file.name);
        set({ uploadProgress: newMap });
      }, 2000);
    }
  },

  uploadFiles: async (files) => {
    for (const file of files) {
      await get().uploadFile(file);
    }
  },

  downloadFile: async (fileId, fileName) => {
    try {
      const blob = await api.downloadFile(fileId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to download file' });
      throw error;
    }
  },

  deleteFile: async (fileId) => {
    try {
      await api.deleteFile(fileId);
      set({ files: get().files.filter((f) => f.id !== fileId) });
      get().deselectFile(fileId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete file' });
      throw error;
    }
  },

  renameFile: async (fileId, newName) => {
    try {
      const updated = await api.renameFile(fileId, newName);
      set({
        files: get().files.map((f) => (f.id === fileId ? { ...f, name: updated.name } : f)),
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to rename file' });
      throw error;
    }
  },

  selectFile: (fileId) => {
    const newSelection = new Set(get().selectedFiles);
    newSelection.add(fileId);
    set({ selectedFiles: newSelection });
  },

  deselectFile: (fileId) => {
    const newSelection = new Set(get().selectedFiles);
    newSelection.delete(fileId);
    set({ selectedFiles: newSelection });
  },

  toggleSelection: (fileId) => {
    const { selectedFiles } = get();
    if (selectedFiles.has(fileId)) {
      get().deselectFile(fileId);
    } else {
      get().selectFile(fileId);
    }
  },

  clearSelection: () => {
    set({ selectedFiles: new Set() });
  },

  loadConflicts: async () => {
    try {
      const result = await api.getConflicts();
      set({ conflicts: result.conflicts });
    } catch (error) {
      console.error('Failed to load conflicts:', error);
    }
  },

  resolveConflict: async (fileId, resolution, keepBoth = false) => {
    try {
      await api.resolveConflict(fileId, resolution, keepBoth);
      set({ conflicts: get().conflicts.filter((c) => c.fileId !== fileId) });
      await get().loadFiles();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to resolve conflict' });
      throw error;
    }
  },

  clearError: () => set({ error: null }),

  subscribeToChanges: () => {
    wsService.on('*', (message) => {
      if (isFileEvent(message)) {
        // Reload files when changes come from another device
        get().loadFiles();
      }
    });
  },
}));
