import type { Drawing, User, Collaborator } from '../types';

const API_BASE = '/api/v1';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth API
export const authApi = {
  register: (data: { username: string; email: string; password: string; displayName?: string }) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { username: string; password: string }) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    request<{ message: string }>('/auth/logout', { method: 'POST' }),

  getMe: () =>
    request<{ user: User }>('/auth/me'),
};

// Drawing API
export const drawingApi = {
  list: () =>
    request<{ drawings: Drawing[] }>('/drawings'),

  listPublic: () =>
    request<{ drawings: Drawing[] }>('/drawings/public'),

  get: (drawingId: string) =>
    request<{ drawing: Drawing; collaborators: Collaborator[] }>(`/drawings/${drawingId}`),

  create: (data: { title?: string; elements?: unknown[]; isPublic?: boolean }) =>
    request<{ drawing: Drawing }>('/drawings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (drawingId: string, data: { title?: string; elements?: unknown[]; isPublic?: boolean }) =>
    request<{ drawing: Drawing }>(`/drawings/${drawingId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (drawingId: string) =>
    request<{ message: string }>(`/drawings/${drawingId}`, {
      method: 'DELETE',
    }),

  addCollaborator: (drawingId: string, data: { username: string; permission: string }) =>
    request<{ collaborator: Collaborator }>(`/drawings/${drawingId}/collaborators`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeCollaborator: (drawingId: string, userId: string) =>
    request<{ message: string }>(`/drawings/${drawingId}/collaborators/${userId}`, {
      method: 'DELETE',
    }),

  getCollaborators: (drawingId: string) =>
    request<{ collaborators: Collaborator[] }>(`/drawings/${drawingId}/collaborators`),
};
