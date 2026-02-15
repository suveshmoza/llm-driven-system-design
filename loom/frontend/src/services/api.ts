import type { User, Video, Comment, Share, Folder, AnalyticsSummary } from '../types';

const BASE_URL = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/** Authentication API client for login, register, logout, and session check. */
export const authApi = {
  login: (username: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (username: string, email: string, password: string, displayName?: string) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, displayName }),
    }),

  logout: () =>
    request<{ message: string }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: User }>('/auth/me'),
};

/** Video CRUD API client with pagination and folder filtering. */
export const videosApi = {
  list: (params?: { page?: number; limit?: number; search?: string; folderId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.search) searchParams.set('search', params.search);
    if (params?.folderId) searchParams.set('folderId', params.folderId);
    const qs = searchParams.toString();
    return request<{ videos: Video[]; total: number; page: number; limit: number }>(
      `/videos${qs ? `?${qs}` : ''}`,
    );
  },

  get: (id: string) =>
    request<{ video: Video }>(`/videos/${id}`),

  create: (title: string, description?: string) =>
    request<{ video: Video }>('/videos', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    }),

  update: (id: string, data: { title?: string; description?: string }) =>
    request<{ video: Video }>(`/videos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/videos/${id}`, { method: 'DELETE' }),
};

/** Upload API client for presigned URL generation, completion, and download URL retrieval. */
export const uploadApi = {
  getPresignedUrl: (videoId: string, fileType?: string) =>
    request<{ uploadUrl: string; objectName: string }>('/upload/presigned', {
      method: 'POST',
      body: JSON.stringify({ videoId, fileType }),
    }),

  complete: (videoId: string, durationSeconds?: number) =>
    request<{ video: Video }>('/upload/complete', {
      method: 'POST',
      body: JSON.stringify({ videoId, durationSeconds }),
    }),

  getDownloadUrl: (videoId: string) =>
    request<{ downloadUrl: string }>(`/upload/download/${videoId}`),
};

/** Comment API client for listing, creating, and deleting time-anchored comments. */
export const commentsApi = {
  list: (videoId: string) =>
    request<{ comments: Comment[] }>(`/videos/${videoId}/comments`),

  create: (videoId: string, content: string, timestampSeconds?: number | null, parentId?: string) =>
    request<{ comment: Comment }>(`/videos/${videoId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, timestampSeconds, parentId }),
    }),

  delete: (videoId: string, commentId: string) =>
    request<{ message: string }>(`/videos/${videoId}/comments/${commentId}`, { method: 'DELETE' }),
};

/** Share link API client for creating, validating, listing, and revoking share tokens. */
export const sharesApi = {
  create: (videoId: string, options?: { password?: string; expiresAt?: string; allowDownload?: boolean }) =>
    request<{ share: Share }>(`/share/${videoId}/share`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),

  validate: (token: string, password?: string) => {
    const qs = password ? `?password=${encodeURIComponent(password)}` : '';
    return request<{ video: Video & { downloadUrl: string | null; allowDownload: boolean } }>(
      `/share/${token}${qs}`,
    );
  },

  list: (videoId: string) =>
    request<{ shares: Share[] }>(`/share/${videoId}/shares`),

  delete: (videoId: string, shareId: string) =>
    request<{ message: string }>(`/share/${videoId}/shares/${shareId}`, { method: 'DELETE' }),
};

/** Analytics API client for recording view events and retrieving video analytics. */
export const analyticsApi = {
  recordView: (videoId: string, sessionId: string, watchDurationSeconds?: number, completed?: boolean) =>
    request<{ message: string }>('/analytics/view', {
      method: 'POST',
      body: JSON.stringify({ videoId, sessionId, watchDurationSeconds, completed }),
    }),

  get: (videoId: string, days?: number) => {
    const qs = days ? `?days=${days}` : '';
    return request<{ analytics: AnalyticsSummary }>(`/analytics/${videoId}/analytics${qs}`);
  },
};

/** Folder API client for organizing videos into hierarchical folders. */
export const foldersApi = {
  list: () =>
    request<{ folders: Folder[] }>('/folders'),

  create: (name: string, parentId?: string) =>
    request<{ folder: Folder }>('/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId }),
    }),

  update: (id: string, name: string) =>
    request<{ folder: Folder }>(`/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/folders/${id}`, { method: 'DELETE' }),

  addVideo: (folderId: string, videoId: string) =>
    request<{ message: string }>(`/folders/${folderId}/videos`, {
      method: 'POST',
      body: JSON.stringify({ videoId }),
    }),

  removeVideo: (folderId: string, videoId: string) =>
    request<{ message: string }>(`/folders/${folderId}/videos/${videoId}`, { method: 'DELETE' }),
};
