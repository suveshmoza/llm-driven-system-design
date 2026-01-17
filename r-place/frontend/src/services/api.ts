/**
 * API client for communicating with the r/place backend.
 *
 * Provides type-safe methods for authentication and canvas operations.
 * All requests include credentials for session-based authentication.
 */

/** Base URL for API endpoints. */
const API_BASE = '/api';

/**
 * Generic fetch wrapper with error handling and type safety.
 *
 * @template T - Expected response type.
 * @param endpoint - API endpoint path (without base URL).
 * @param options - Fetch options (method, body, headers, etc.).
 * @returns Promise resolving to the typed response data.
 * @throws Error if the response is not OK.
 */
export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'API request failed');
  }

  return data;
}

/**
 * Authentication API methods.
 * Handles user registration, login, logout, and session management.
 */
export const authApi = {
  /**
   * Authenticates a user with username and password.
   * Sets a session cookie on success.
   */
  login: (username: string, password: string) =>
    fetchApi<{ user: { id: string; username: string; role: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  /**
   * Registers a new user account.
   * Automatically logs in the user on success.
   */
  register: (username: string, password: string) =>
    fetchApi<{ user: { id: string; username: string; role: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  /**
   * Ends the current user session.
   */
  logout: () =>
    fetchApi<{ success: boolean }>('/auth/logout', {
      method: 'POST',
    }),

  /**
   * Gets the currently authenticated user's information.
   */
  me: () =>
    fetchApi<{ user: { id: string; username: string; role: string } }>('/auth/me'),

  /**
   * Creates an anonymous guest session for quick access.
   */
  anonymous: () =>
    fetchApi<{ user: { id: string; username: string; role: string } }>('/auth/anonymous', {
      method: 'POST',
    }),
};

/**
 * Canvas API methods.
 * Handles canvas state retrieval, pixel placement, and history.
 */
export const canvasApi = {
  /**
   * Gets the canvas configuration (dimensions, colors, cooldown).
   */
  getConfig: () =>
    fetchApi<{
      width: number;
      height: number;
      colors: string[];
      cooldownSeconds: number;
    }>('/canvas/config'),

  /**
   * Gets the current canvas state as base64-encoded data.
   */
  getCanvas: () =>
    fetchApi<{ canvas: string }>('/canvas'),

  /**
   * Places a pixel at the specified coordinates.
   *
   * @param x - X coordinate.
   * @param y - Y coordinate.
   * @param color - Color index from the palette.
   */
  placePixel: (x: number, y: number, color: number) =>
    fetchApi<{ success: boolean; nextPlacement?: number; error?: string }>(
      '/canvas/pixel',
      {
        method: 'POST',
        body: JSON.stringify({ x, y, color }),
      }
    ),

  /**
   * Gets the user's current cooldown status.
   */
  getCooldown: () =>
    fetchApi<{
      canPlace: boolean;
      remainingSeconds: number;
      nextPlacement: number;
    }>('/canvas/cooldown'),

  /**
   * Gets the placement history for a specific pixel.
   *
   * @param x - X coordinate.
   * @param y - Y coordinate.
   */
  getPixelHistory: (x: number, y: number) =>
    fetchApi<{
      history: Array<{
        x: number;
        y: number;
        color: number;
        userId: string;
        timestamp: number;
      }>;
    }>(`/canvas/pixel/${x}/${y}/history`),

  /**
   * Gets recent pixel placement events.
   *
   * @param limit - Maximum number of events to return.
   */
  getRecentEvents: (limit = 100) =>
    fetchApi<{
      events: Array<{
        x: number;
        y: number;
        color: number;
        userId: string;
        timestamp: number;
      }>;
    }>(`/canvas/events?limit=${limit}`),
};
