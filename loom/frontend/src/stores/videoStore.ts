import { create } from 'zustand';
import type { Video } from '../types';
import { videosApi, uploadApi } from '../services/api';

interface VideoState {
  videos: Video[];
  currentVideo: Video | null;
  total: number;
  page: number;
  loading: boolean;
  uploading: boolean;
  uploadProgress: number;
  recording: boolean;
  recordedBlob: Blob | null;
  error: string | null;
  fetchVideos: (params?: { page?: number; search?: string; folderId?: string }) => Promise<void>;
  fetchVideo: (id: string) => Promise<void>;
  createAndUpload: (title: string, blob: Blob, durationSeconds: number, description?: string) => Promise<Video>;
  deleteVideo: (id: string) => Promise<void>;
  updateVideo: (id: string, data: { title?: string; description?: string }) => Promise<void>;
  setRecording: (recording: boolean) => void;
  setRecordedBlob: (blob: Blob | null) => void;
  clearError: () => void;
}

/** Video library state with upload progress tracking, recording state, and CRUD operations. */
export const useVideoStore = create<VideoState>((set, get) => ({
  videos: [],
  currentVideo: null,
  total: 0,
  page: 1,
  loading: false,
  uploading: false,
  uploadProgress: 0,
  recording: false,
  recordedBlob: null,
  error: null,

  fetchVideos: async (params) => {
    set({ loading: true, error: null });
    try {
      const result = await videosApi.list(params);
      set({ videos: result.videos, total: result.total, page: result.page, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load videos';
      set({ error: message, loading: false });
    }
  },

  fetchVideo: async (id) => {
    set({ loading: true, error: null });
    try {
      const { video } = await videosApi.get(id);
      set({ currentVideo: video, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load video';
      set({ error: message, loading: false });
    }
  },

  createAndUpload: async (title, blob, durationSeconds, description) => {
    set({ uploading: true, uploadProgress: 0, error: null });
    try {
      // 1. Create video metadata
      const { video } = await videosApi.create(title, description);
      set({ uploadProgress: 10 });

      // 2. Get presigned upload URL
      const { uploadUrl } = await uploadApi.getPresignedUrl(video.id, 'video');
      set({ uploadProgress: 20 });

      // 3. Upload blob to MinIO via presigned URL
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = 20 + (e.loaded / e.total) * 60;
            set({ uploadProgress: Math.round(progress) });
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', 'video/webm');
        xhr.send(blob);
      });
      set({ uploadProgress: 85 });

      // 4. Mark video as complete
      const { video: completedVideo } = await uploadApi.complete(video.id, durationSeconds);
      set({ uploadProgress: 100, uploading: false });

      // Add to list
      const currentVideos = get().videos;
      set({ videos: [completedVideo, ...currentVideos] });

      return completedVideo;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      set({ error: message, uploading: false, uploadProgress: 0 });
      throw err;
    }
  },

  deleteVideo: async (id) => {
    try {
      await videosApi.delete(id);
      set({ videos: get().videos.filter((v) => v.id !== id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete video';
      set({ error: message });
    }
  },

  updateVideo: async (id, data) => {
    try {
      const { video } = await videosApi.update(id, data);
      set({
        videos: get().videos.map((v) => (v.id === id ? video : v)),
        currentVideo: get().currentVideo?.id === id ? video : get().currentVideo,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update video';
      set({ error: message });
    }
  },

  setRecording: (recording) => set({ recording }),
  setRecordedBlob: (blob) => set({ recordedBlob: blob }),
  clearError: () => set({ error: null }),
}));
