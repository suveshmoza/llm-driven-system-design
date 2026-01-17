/**
 * API Service Module
 *
 * Provides functions for communicating with the FaceTime backend REST API.
 * Handles user management, authentication, and call history retrieval.
 */

import type { User, TurnCredentials, CallHistoryItem } from '../types';

/** Base URL for API endpoints */
const API_BASE = '/api';

/**
 * Fetches all registered users from the backend.
 * Used to populate the contact list for initiating calls.
 *
 * @returns Promise resolving to array of User objects
 * @throws Error if the request fails
 */
export async function fetchUsers(): Promise<User[]> {
  const response = await fetch(`${API_BASE}/users`);
  if (!response.ok) throw new Error('Failed to fetch users');
  return response.json();
}

/**
 * Fetches a single user by their ID.
 *
 * @param id - The unique user ID to look up
 * @returns Promise resolving to the User object
 * @throws Error if the request fails or user not found
 */
export async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`${API_BASE}/users/${id}`);
  if (!response.ok) throw new Error('Failed to fetch user');
  return response.json();
}

/**
 * Authenticates a user by username.
 * This is a simplified demo login without real authentication.
 *
 * @param username - The username to log in as
 * @returns Promise resolving to success flag and user data
 * @throws Error if login fails or user not found
 */
export async function login(username: string): Promise<{ success: boolean; user: User }> {
  const response = await fetch(`${API_BASE}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!response.ok) throw new Error('Failed to login');
  return response.json();
}

/**
 * Fetches STUN/TURN server credentials for WebRTC.
 * These servers help establish peer connections through NATs.
 *
 * @returns Promise resolving to ICE server configuration
 * @throws Error if the request fails
 */
export async function fetchTurnCredentials(): Promise<TurnCredentials> {
  const response = await fetch('/turn-credentials');
  if (!response.ok) throw new Error('Failed to fetch TURN credentials');
  return response.json();
}

/**
 * Fetches call history for a specific user.
 * Returns past calls with participant information.
 *
 * @param userId - The user ID to fetch history for
 * @returns Promise resolving to array of call history items
 * @throws Error if the request fails
 */
export async function fetchCallHistory(userId: string): Promise<CallHistoryItem[]> {
  const response = await fetch(`${API_BASE}/calls/history/${userId}`);
  if (!response.ok) throw new Error('Failed to fetch call history');
  return response.json();
}
