import type { User, Pin, Board, Comment } from '../types';

const BASE_URL = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth
export async function register(data: {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ user: User }> {
  return request('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function login(data: { username: string; password: string }): Promise<{ user: User }> {
  return request('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function logout(): Promise<void> {
  await request('/v1/auth/logout', { method: 'POST' });
}

export async function getMe(): Promise<{ user: User }> {
  return request('/v1/auth/me');
}

// Feed
export async function getFeed(cursor?: string): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/feed?${params}`);
}

export async function getDiscoverFeed(cursor?: string): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/feed/discover?${params}`);
}

// Pins
export async function getPin(pinId: string): Promise<{ pin: Pin }> {
  return request(`/v1/pins/${pinId}`);
}

export async function createPin(data: FormData): Promise<{ pin: Pin }> {
  return request('/v1/pins', {
    method: 'POST',
    body: data,
  });
}

export async function deletePin(pinId: string): Promise<void> {
  await request(`/v1/pins/${pinId}`, { method: 'DELETE' });
}

export async function savePin(pinId: string, boardId: string): Promise<void> {
  await request(`/v1/pins/${pinId}/save`, {
    method: 'POST',
    body: JSON.stringify({ boardId }),
  });
}

export async function unsavePin(pinId: string, boardId: string): Promise<void> {
  await request(`/v1/pins/${pinId}/save`, {
    method: 'DELETE',
    body: JSON.stringify({ boardId }),
  });
}

export async function getPinComments(
  pinId: string,
  cursor?: string,
): Promise<{ comments: Comment[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/pins/${pinId}/comments?${params}`);
}

export async function createComment(
  pinId: string,
  content: string,
  parentCommentId?: string,
): Promise<{ comment: Comment }> {
  return request(`/v1/pins/${pinId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, parentCommentId }),
  });
}

// Boards
export async function getBoard(boardId: string): Promise<{ board: Board }> {
  return request(`/v1/boards/${boardId}`);
}

export async function getBoardPins(
  boardId: string,
  cursor?: string,
): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/boards/${boardId}/pins?${params}`);
}

export async function createBoard(data: {
  name: string;
  description?: string;
  isPrivate?: boolean;
}): Promise<{ board: Board }> {
  return request('/v1/boards', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteBoard(boardId: string): Promise<void> {
  await request(`/v1/boards/${boardId}`, { method: 'DELETE' });
}

// Users
export async function getUser(username: string): Promise<{ user: User }> {
  return request(`/v1/users/${username}`);
}

export async function getUserPins(
  username: string,
  cursor?: string,
): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/users/${username}/pins?${params}`);
}

export async function getUserBoards(username: string): Promise<{ boards: Board[] }> {
  return request(`/v1/users/${username}/boards`);
}

export async function followUser(userId: string): Promise<void> {
  await request(`/v1/users/${userId}/follow`, { method: 'POST' });
}

export async function unfollowUser(userId: string): Promise<void> {
  await request(`/v1/users/${userId}/follow`, { method: 'DELETE' });
}

// Search
export async function searchPins(q: string): Promise<{ pins: Pin[] }> {
  return request(`/v1/search/pins?q=${encodeURIComponent(q)}`);
}

export async function searchUsers(q: string): Promise<{ users: User[] }> {
  return request(`/v1/search/users?q=${encodeURIComponent(q)}`);
}

export async function searchBoards(q: string): Promise<{ boards: Board[] }> {
  return request(`/v1/search/boards?q=${encodeURIComponent(q)}`);
}
