/**
 * API Service Module
 *
 * Provides HTTP client functions for communicating with the backend REST API.
 * Used for initial data loading and HTTP fallback operations.
 * Real-time operations should use WebSocket instead.
 *
 * @module services/api
 */

import { Stream, User, Comment } from '../types';

/** Base URL for API endpoints (uses Vite proxy in development) */
const API_BASE = '/api';

/**
 * Fetches all streams from the backend.
 *
 * @returns Array of all streams
 * @throws Error if request fails
 */
export async function fetchStreams(): Promise<Stream[]> {
  const response = await fetch(`${API_BASE}/streams`);
  if (!response.ok) throw new Error('Failed to fetch streams');
  return response.json();
}

/**
 * Fetches a single stream by ID.
 *
 * @param streamId - ID of the stream to fetch
 * @returns Stream object
 * @throws Error if request fails or stream not found
 */
export async function fetchStream(streamId: string): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams/${streamId}`);
  if (!response.ok) throw new Error('Failed to fetch stream');
  return response.json();
}

/**
 * Fetches recent comments for a stream.
 *
 * @param streamId - ID of the stream
 * @param limit - Maximum number of comments to fetch (default: 50)
 * @returns Array of comments with user information
 * @throws Error if request fails
 */
export async function fetchComments(streamId: string, limit = 50): Promise<Comment[]> {
  const response = await fetch(`${API_BASE}/streams/${streamId}/comments?limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch comments');
  return response.json();
}

/**
 * Fetches all users from the backend.
 * Used for user selection in the demo UI.
 *
 * @returns Array of all users
 * @throws Error if request fails
 */
export async function fetchUsers(): Promise<User[]> {
  const response = await fetch(`${API_BASE}/users`);
  if (!response.ok) throw new Error('Failed to fetch users');
  return response.json();
}

/**
 * Fetches a single user by ID.
 *
 * @param userId - ID of the user to fetch
 * @returns User object
 * @throws Error if request fails or user not found
 */
export async function fetchUser(userId: string): Promise<User> {
  const response = await fetch(`${API_BASE}/users/${userId}`);
  if (!response.ok) throw new Error('Failed to fetch user');
  return response.json();
}

/**
 * Creates a new live stream.
 *
 * @param title - Display title for the stream
 * @param creatorId - User ID of the stream creator
 * @param description - Optional stream description
 * @param videoUrl - Optional URL to video source
 * @returns Newly created stream
 * @throws Error if request fails
 */
export async function createStream(
  title: string,
  creatorId: string,
  description?: string,
  videoUrl?: string
): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      creator_id: creatorId,
      description,
      video_url: videoUrl,
    }),
  });
  if (!response.ok) throw new Error('Failed to create stream');
  return response.json();
}

/**
 * Ends a live stream.
 *
 * @param streamId - ID of the stream to end
 * @returns Updated stream with status 'ended'
 * @throws Error if request fails
 */
export async function endStream(streamId: string): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams/${streamId}/end`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to end stream');
  return response.json();
}
