/** Base URL for all API requests */
const API_BASE = '/api/v1';

/**
 * Generic HTTP request function for API calls.
 * Wraps the Fetch API with consistent error handling, JSON parsing,
 * and credential inclusion for session-based auth.
 *
 * @param endpoint - API endpoint path (appended to API_BASE)
 * @param options - Fetch options (method, headers, body, etc.)
 * @returns Promise resolving to the typed JSON response
 * @throws Error with message from API response on failure
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

/**
 * API client object providing HTTP methods for backend communication.
 * Includes standard REST methods (GET, POST, PATCH, DELETE) plus
 * specialized methods for video uploads (chunked and simple).
 */
export const api = {
  /**
   * Perform a GET request.
   * @param endpoint - API endpoint path
   * @returns Promise resolving to the typed response
   */
  get: <T>(endpoint: string) => request<T>(endpoint),

  /**
   * Perform a POST request with optional JSON body.
   * @param endpoint - API endpoint path
   * @param data - Optional request body (will be JSON stringified)
   * @returns Promise resolving to the typed response
   */
  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  /**
   * Perform a PATCH request with JSON body.
   * @param endpoint - API endpoint path
   * @param data - Request body (will be JSON stringified)
   * @returns Promise resolving to the typed response
   */
  patch: <T>(endpoint: string, data: unknown) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  /**
   * Perform a DELETE request.
   * @param endpoint - API endpoint path
   * @returns Promise resolving to the typed response
   */
  delete: <T>(endpoint: string) =>
    request<T>(endpoint, {
      method: 'DELETE',
    }),

  /**
   * Upload a single chunk of a video file for chunked uploads.
   * Used for large files (>50MB) to enable reliable, resumable uploads.
   *
   * @param uploadId - Upload session identifier
   * @param chunkNumber - Zero-based chunk index
   * @param chunk - Blob containing the chunk data
   * @returns Promise with upload progress information
   */
  uploadChunk: async (uploadId: string, chunkNumber: number, chunk: Blob): Promise<{
    chunkNumber: number;
    uploadedChunks: number;
    totalChunks: number;
    complete: boolean;
  }> => {
    const formData = new FormData();
    formData.append('chunk', chunk);

    const response = await fetch(
      `${API_BASE}/uploads/${uploadId}/chunks/${chunkNumber}`,
      {
        method: 'PUT',
        body: formData,
        credentials: 'include',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  },

  /**
   * Upload a small video file in a single request.
   * Used for files under 50MB for simplicity. Larger files
   * should use the chunked upload API instead.
   *
   * @param file - The video file to upload
   * @param title - Video title
   * @param description - Video description
   * @param categories - Array of category names
   * @param tags - Array of tags for discoverability
   * @returns Promise with the created video ID and status
   */
  simpleUpload: async (file: File, title: string, description: string, categories: string[], tags: string[]): Promise<{
    videoId: string;
    status: string;
    message: string;
  }> => {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', title);
    formData.append('description', description);
    formData.append('categories', JSON.stringify(categories));
    formData.append('tags', JSON.stringify(tags));

    const response = await fetch(`${API_BASE}/uploads/simple`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  },
};
