import type { User, Pin, Board, Comment } from '../types';

const BASE_URL = '/api';

/** Sends an authenticated fetch request to the backend API with credential forwarding. */
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

/** POST /api/v1/auth/register - Creates a new user account and establishes a session. */
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

/** POST /api/v1/auth/login - Authenticates a user and creates a session. */
export async function login(data: { username: string; password: string }): Promise<{ user: User }> {
  return request('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** POST /api/v1/auth/logout - Destroys the current session. */
export async function logout(): Promise<void> {
  await request('/v1/auth/logout', { method: 'POST' });
}

/** GET /api/v1/auth/me - Returns the currently authenticated user. */
export async function getMe(): Promise<{ user: User }> {
  return request('/v1/auth/me');
}

/** GET /api/v1/feed - Fetches the personalized feed with cursor-based pagination. */
export async function getFeed(cursor?: string): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/feed?${params}`);
}

/** GET /api/v1/feed/discover - Fetches the public discover feed sorted by popularity. */
export async function getDiscoverFeed(cursor?: string): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/feed/discover?${params}`);
}

/** GET /api/v1/pins/:pinId - Fetches a single pin with comments and save status. */
export async function getPin(pinId: string): Promise<{ pin: Pin }> {
  return request(`/v1/pins/${pinId}`);
}

/** POST /api/v1/pins - Creates a new pin with image upload via FormData. */
export async function createPin(data: FormData): Promise<{ pin: Pin }> {
  return request('/v1/pins', {
    method: 'POST',
    body: data,
  });
}

/** DELETE /api/v1/pins/:pinId - Deletes a pin owned by the current user. */
export async function deletePin(pinId: string): Promise<void> {
  await request(`/v1/pins/${pinId}`, { method: 'DELETE' });
}

/** POST /api/v1/pins/:pinId/save - Saves a pin to a user's board. */
export async function savePin(pinId: string, boardId: string): Promise<void> {
  await request(`/v1/pins/${pinId}/save`, {
    method: 'POST',
    body: JSON.stringify({ boardId }),
  });
}

/** DELETE /api/v1/pins/:pinId/save - Removes a pin save from a board. */
export async function unsavePin(pinId: string, boardId: string): Promise<void> {
  await request(`/v1/pins/${pinId}/save`, {
    method: 'DELETE',
    body: JSON.stringify({ boardId }),
  });
}

/** GET /api/v1/pins/:pinId/comments - Fetches paginated comments for a pin. */
export async function getPinComments(
  pinId: string,
  cursor?: string,
): Promise<{ comments: Comment[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/pins/${pinId}/comments?${params}`);
}

/** POST /api/v1/pins/:pinId/comments - Creates a comment on a pin. */
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

/** GET /api/v1/boards/:boardId - Fetches a single board with metadata. */
export async function getBoard(boardId: string): Promise<{ board: Board }> {
  return request(`/v1/boards/${boardId}`);
}

/** GET /api/v1/boards/:boardId/pins - Fetches paginated pins in a board. */
export async function getBoardPins(
  boardId: string,
  cursor?: string,
): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/boards/${boardId}/pins?${params}`);
}

/** POST /api/v1/boards - Creates a new board for the current user. */
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

/** DELETE /api/v1/boards/:boardId - Deletes a board owned by the current user. */
export async function deleteBoard(boardId: string): Promise<void> {
  await request(`/v1/boards/${boardId}`, { method: 'DELETE' });
}

/** GET /api/v1/users/:username - Fetches a user profile by username. */
export async function getUser(username: string): Promise<{ user: User }> {
  return request(`/v1/users/${username}`);
}

/** GET /api/v1/users/:username/pins - Fetches paginated pins created by a user. */
export async function getUserPins(
  username: string,
  cursor?: string,
): Promise<{ pins: Pin[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  return request(`/v1/users/${username}/pins?${params}`);
}

/** GET /api/v1/users/:username/boards - Fetches all boards for a user. */
export async function getUserBoards(username: string): Promise<{ boards: Board[] }> {
  return request(`/v1/users/${username}/boards`);
}

/** POST /api/v1/users/:userId/follow - Follows a user. */
export async function followUser(userId: string): Promise<void> {
  await request(`/v1/users/${userId}/follow`, { method: 'POST' });
}

/** DELETE /api/v1/users/:userId/follow - Unfollows a user. */
export async function unfollowUser(userId: string): Promise<void> {
  await request(`/v1/users/${userId}/follow`, { method: 'DELETE' });
}

/** GET /api/v1/search/pins - Searches pins by title and description. */
export async function searchPins(q: string): Promise<{ pins: Pin[] }> {
  return request(`/v1/search/pins?q=${encodeURIComponent(q)}`);
}

/** GET /api/v1/search/users - Searches users by username and display name. */
export async function searchUsers(q: string): Promise<{ users: User[] }> {
  return request(`/v1/search/users?q=${encodeURIComponent(q)}`);
}

/** GET /api/v1/search/boards - Searches public boards by name and description. */
export async function searchBoards(q: string): Promise<{ boards: Board[] }> {
  return request(`/v1/search/boards?q=${encodeURIComponent(q)}`);
}
