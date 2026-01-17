import { create } from 'zustand';
import type { Photo, Album } from '../types';
import { api } from '../services/api';
import { wsService, isPhotoEvent } from '../services/websocket';

/**
 * Photo store interface defining state and actions for iCloud Photos.
 *
 * Manages the photo gallery experience including browsing, uploads,
 * albums, favorites, and real-time sync.
 */
interface PhotoStore {
  /** Array of photos in the current view */
  photos: Photo[];
  /** User's photo albums */
  albums: Album[];
  /** Set of selected photo IDs for batch operations */
  selectedPhotos: Set<string>;
  /** Whether photos are currently loading */
  isLoading: boolean;
  /** Whether more photos are available for pagination */
  hasMore: boolean;
  /** Error message from the most recent operation */
  error: string | null;
  /** Current display mode for the gallery */
  viewMode: 'grid' | 'list';
  /** Active filter for photo listing */
  filter: 'all' | 'favorites';

  /** Loads photos with optional reset for pagination */
  loadPhotos: (options?: { reset?: boolean; albumId?: string }) => Promise<void>;
  /** Loads the next page of photos for infinite scroll */
  loadMore: () => Promise<void>;
  /** Uploads a single photo */
  uploadPhoto: (file: File) => Promise<void>;
  /** Uploads multiple photos */
  uploadPhotos: (files: File[]) => Promise<void>;
  /** Toggles a photo's favorite status */
  toggleFavorite: (photoId: string) => Promise<void>;
  /** Soft-deletes a photo */
  deletePhoto: (photoId: string) => Promise<void>;
  /** Deletes all selected photos */
  deleteSelectedPhotos: () => Promise<void>;
  /** Adds a photo to the selection */
  selectPhoto: (photoId: string) => void;
  /** Removes a photo from the selection */
  deselectPhoto: (photoId: string) => void;
  /** Toggles a photo's selection state */
  toggleSelection: (photoId: string) => void;
  /** Clears all selected photos */
  clearSelection: () => void;
  /** Sets the gallery display mode */
  setViewMode: (mode: 'grid' | 'list') => void;
  /** Sets the active filter and reloads photos */
  setFilter: (filter: 'all' | 'favorites') => void;
  /** Loads user's photo albums */
  loadAlbums: () => Promise<void>;
  /** Creates a new album with selected photos */
  createAlbum: (name: string) => Promise<void>;
  /** Adds selected photos to an existing album */
  addToAlbum: (albumId: string) => Promise<void>;
  /** Clears the current error message */
  clearError: () => void;
  /** Subscribes to WebSocket photo change events */
  subscribeToChanges: () => void;
}

/**
 * Number of photos to fetch per page for pagination.
 */
const PAGE_SIZE = 50;

/**
 * Global photo store for iCloud Photos functionality.
 *
 * This Zustand store manages all state related to photo browsing and
 * organization in iCloud Photos. It handles:
 *
 * - **Photo Loading**: Paginated fetching with infinite scroll support
 * - **Uploads**: Photo upload with automatic thumbnail generation on server
 * - **Albums**: Create albums and add photos to them
 * - **Favorites**: Mark photos as favorites for quick access
 * - **Selection**: Multi-select for batch operations (delete, add to album)
 * - **Real-time Updates**: WebSocket subscription for cross-device sync
 * - **Filtering**: View all photos or favorites only
 *
 * Photos are stored with three derivatives (thumbnail, preview, full-res)
 * on the server. The store fetches thumbnail URLs for the grid view and
 * preview URLs for the lightbox viewer.
 */
export const usePhotoStore = create<PhotoStore>((set, get) => ({
  photos: [],
  albums: [],
  selectedPhotos: new Set(),
  isLoading: false,
  hasMore: true,
  error: null,
  viewMode: 'grid',
  filter: 'all',

  loadPhotos: async (options = {}) => {
    const { reset = true, albumId } = options;
    const { filter } = get();

    set({ isLoading: true, error: null });

    if (reset) {
      set({ photos: [], hasMore: true });
    }

    try {
      const result = await api.listPhotos({
        limit: PAGE_SIZE,
        offset: reset ? 0 : get().photos.length,
        favorite: filter === 'favorites',
        albumId,
      });

      set({
        photos: reset ? result.photos : [...get().photos, ...result.photos],
        hasMore: result.hasMore,
        isLoading: false,
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load photos',
      });
    }
  },

  loadMore: async () => {
    if (get().isLoading || !get().hasMore) return;
    await get().loadPhotos({ reset: false });
  },

  uploadPhoto: async (file) => {
    try {
      const newPhoto = await api.uploadPhoto(file);
      set({ photos: [newPhoto, ...get().photos] });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to upload photo' });
      throw error;
    }
  },

  uploadPhotos: async (files) => {
    for (const file of files) {
      await get().uploadPhoto(file);
    }
  },

  toggleFavorite: async (photoId) => {
    try {
      const result = await api.toggleFavorite(photoId);
      set({
        photos: get().photos.map((p) =>
          p.id === photoId ? { ...p, isFavorite: result.isFavorite } : p
        ),
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update favorite' });
    }
  },

  deletePhoto: async (photoId) => {
    try {
      await api.deletePhoto(photoId);
      set({ photos: get().photos.filter((p) => p.id !== photoId) });
      get().deselectPhoto(photoId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete photo' });
      throw error;
    }
  },

  deleteSelectedPhotos: async () => {
    const { selectedPhotos } = get();
    for (const photoId of selectedPhotos) {
      await get().deletePhoto(photoId);
    }
  },

  selectPhoto: (photoId) => {
    const newSelection = new Set(get().selectedPhotos);
    newSelection.add(photoId);
    set({ selectedPhotos: newSelection });
  },

  deselectPhoto: (photoId) => {
    const newSelection = new Set(get().selectedPhotos);
    newSelection.delete(photoId);
    set({ selectedPhotos: newSelection });
  },

  toggleSelection: (photoId) => {
    const { selectedPhotos } = get();
    if (selectedPhotos.has(photoId)) {
      get().deselectPhoto(photoId);
    } else {
      get().selectPhoto(photoId);
    }
  },

  clearSelection: () => {
    set({ selectedPhotos: new Set() });
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  setFilter: (filter) => {
    set({ filter });
    get().loadPhotos({ reset: true });
  },

  loadAlbums: async () => {
    try {
      const result = await api.listAlbums();
      set({ albums: result.albums });
    } catch (error) {
      console.error('Failed to load albums:', error);
    }
  },

  createAlbum: async (name) => {
    try {
      const selectedIds = Array.from(get().selectedPhotos);
      const album = await api.createAlbum(name, selectedIds);
      set({ albums: [...get().albums, album] });
      get().clearSelection();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to create album' });
      throw error;
    }
  },

  addToAlbum: async (albumId) => {
    try {
      const selectedIds = Array.from(get().selectedPhotos);
      await api.addPhotosToAlbum(albumId, selectedIds);
      get().clearSelection();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to add to album' });
      throw error;
    }
  },

  clearError: () => set({ error: null }),

  subscribeToChanges: () => {
    wsService.on('*', (message) => {
      if (isPhotoEvent(message)) {
        get().loadPhotos({ reset: true });
      }
    });
  },
}));
