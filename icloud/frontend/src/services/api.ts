/**
 * Base URL for all API requests.
 * Points to the versioned API endpoint to ensure backward compatibility.
 */
const API_BASE = '/api/v1';

/**
 * Centralized HTTP client for all iCloud API interactions.
 *
 * This class provides a unified interface for communicating with the backend,
 * handling authentication, error parsing, and consistent request formatting.
 * It abstracts away fetch boilerplate and ensures all requests include proper
 * credentials and headers for session-based authentication.
 */
class ApiClient {
  /**
   * Executes an HTTP request to the API with standardized error handling.
   *
   * All requests automatically include JSON content type headers and credentials
   * for cookie-based session authentication. Errors from the server are parsed
   * and thrown as Error objects for consistent handling upstream.
   *
   * @template T - The expected response type
   * @param endpoint - API endpoint path (appended to API_BASE)
   * @param options - Standard fetch RequestInit options
   * @returns Promise resolving to the parsed JSON response
   * @throws Error with server error message or generic failure message
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
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

  // Auth

  /**
   * Authenticates a user with email and password credentials.
   *
   * Creates a new session and optionally registers the current browser as a device.
   * The device registration enables multi-device sync tracking for conflict detection.
   *
   * @param email - User's email address
   * @param password - User's password
   * @param deviceName - Optional friendly name for this device (defaults to browser info)
   * @returns User info, device ID, and session token for WebSocket authentication
   */
  async login(email: string, password: string, deviceName?: string) {
    return this.request<{
      user: { id: string; email: string; role: string; storageQuota: number; storageUsed: number };
      deviceId: string;
      token: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, deviceName, deviceType: 'web' }),
    });
  }

  /**
   * Creates a new user account and establishes a session.
   *
   * Registers the user with the provided credentials and automatically logs them in.
   * Also registers the current browser as the user's first device for sync tracking.
   *
   * @param email - Email address for the new account
   * @param password - Password for the new account
   * @param deviceName - Optional friendly name for this device
   * @returns User info, device ID, and session token
   */
  async register(email: string, password: string, deviceName?: string) {
    return this.request<{
      user: { id: string; email: string; role: string; storageQuota: number; storageUsed: number };
      deviceId: string;
      token: string;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, deviceName, deviceType: 'web' }),
    });
  }

  /**
   * Terminates the current user session.
   *
   * Invalidates the session cookie and cleans up server-side session data.
   * The WebSocket connection should be closed separately.
   *
   * @returns Confirmation of logout
   */
  async logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  /**
   * Retrieves the currently authenticated user's information.
   *
   * Used to restore session state on page reload by checking if a valid
   * session cookie exists. Returns user profile and current device ID.
   *
   * @returns Current user info and device ID, or throws if not authenticated
   */
  async getCurrentUser() {
    return this.request<{
      user: { id: string; email: string; role: string; storageQuota: number; storageUsed: number };
      deviceId: string;
    }>('/auth/me');
  }

  // Files

  /**
   * Lists files and folders in a specified directory.
   *
   * Returns the contents of a directory in the user's iCloud Drive.
   * Optionally includes soft-deleted files for recovery purposes.
   *
   * @param path - Directory path to list (defaults to root '/')
   * @param includeDeleted - Whether to include soft-deleted files
   * @returns The path and array of file/folder items
   */
  async listFiles(path: string = '/', includeDeleted: boolean = false) {
    const params = new URLSearchParams({ path, includeDeleted: String(includeDeleted) });
    return this.request<{ path: string; files: import('../types').FileItem[] }>(
      `/files?${params}`
    );
  }

  /**
   * Retrieves metadata for a specific file.
   *
   * @param fileId - Unique identifier of the file
   * @returns File metadata including sync status and version info
   */
  async getFile(fileId: string) {
    return this.request<import('../types').FileItem>(`/files/${fileId}`);
  }

  /**
   * Creates a new folder in the user's iCloud Drive.
   *
   * @param name - Name of the new folder
   * @param parentPath - Path where the folder should be created (defaults to root)
   * @returns The created folder's metadata
   */
  async createFolder(name: string, parentPath: string = '/') {
    return this.request<import('../types').FileItem>('/files/folder', {
      method: 'POST',
      body: JSON.stringify({ name, parentPath }),
    });
  }

  /**
   * Uploads a file to iCloud Drive.
   *
   * Uses multipart form data for file upload. The file is chunked and
   * deduplicated on the server for efficient storage and delta sync.
   *
   * @param file - File object to upload
   * @param parentPath - Directory path where the file should be stored
   * @returns The created file's metadata
   */
  async uploadFile(file: File, parentPath: string = '/') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('parentPath', parentPath);

    const response = await fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  }

  /**
   * Downloads a file's content as a binary blob.
   *
   * Reconstructs the file from its stored chunks and returns the complete
   * file content for saving to the local filesystem.
   *
   * @param fileId - Unique identifier of the file to download
   * @returns Binary blob of the file content
   * @throws Error if download fails
   */
  async downloadFile(fileId: string): Promise<Blob> {
    const response = await fetch(`${API_BASE}/files/${fileId}/download`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    return response.blob();
  }

  /**
   * Soft-deletes a file or folder.
   *
   * Marks the file as deleted but retains it for recovery. Files are
   * permanently purged after a retention period (typically 30 days).
   *
   * @param fileId - Unique identifier of the file to delete
   * @returns Confirmation message and file ID
   */
  async deleteFile(fileId: string) {
    return this.request<{ message: string; id: string }>(`/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Renames a file or folder.
   *
   * Updates the file's name while preserving its location and version history.
   *
   * @param fileId - Unique identifier of the file
   * @param name - New name for the file
   * @returns Updated file metadata
   */
  async renameFile(fileId: string, name: string) {
    return this.request<import('../types').FileItem>(`/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  /**
   * Moves a file or folder to a new location.
   *
   * @param fileId - Unique identifier of the file
   * @param newPath - Destination directory path
   * @returns Updated file metadata with new path
   */
  async moveFile(fileId: string, newPath: string) {
    return this.request<import('../types').FileItem>(`/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ newPath }),
    });
  }

  /**
   * Retrieves the version history of a file.
   *
   * Returns all stored versions of the file, including conflict copies.
   * Useful for reviewing changes or restoring previous versions.
   *
   * @param fileId - Unique identifier of the file
   * @returns File ID and array of version metadata
   */
  async getFileVersions(fileId: string) {
    return this.request<{ fileId: string; versions: import('../types').FileVersion[] }>(
      `/files/${fileId}/versions`
    );
  }

  // Sync

  /**
   * Retrieves the current sync state for this device.
   *
   * Returns the device's sync cursor and last sync timestamp, which are
   * used to determine what changes need to be fetched from the server.
   *
   * @returns Current device sync state including cursor position
   */
  async getSyncState() {
    return this.request<import('../types').SyncState>('/sync/state');
  }

  /**
   * Fetches changes from the server since a given cursor.
   *
   * Used for incremental sync to efficiently download only changes that
   * occurred since the last sync. Returns categorized changes (created,
   * updated, deleted) for easy processing.
   *
   * @param since - Cursor from previous sync (omit for full sync)
   * @returns Categorized changes, new cursor, and hasMore flag for pagination
   */
  async getChanges(since?: string) {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.request<{
      changes: { created: import('../types').FileItem[]; updated: import('../types').FileItem[]; deleted: import('../types').FileItem[] };
      cursor: string;
      hasMore: boolean;
    }>(`/sync/changes${params}`);
  }

  /**
   * Pushes local changes to the server.
   *
   * Uploads a batch of local file operations to the server. The server
   * validates changes against current state and may report conflicts
   * if concurrent modifications occurred on other devices.
   *
   * @param changes - Array of local changes to push
   * @returns Applied changes, detected conflicts, and any errors
   */
  async pushChanges(changes: import('../types').SyncChange[]) {
    return this.request<import('../types').SyncResult>('/sync/push', {
      method: 'POST',
      body: JSON.stringify({ changes }),
    });
  }

  /**
   * Retrieves unresolved sync conflicts for the current user.
   *
   * Conflicts occur when the same file is modified on multiple devices
   * without syncing in between. Users must manually resolve these.
   *
   * @returns Array of unresolved file conflicts
   */
  async getConflicts() {
    return this.request<{ conflicts: import('../types').Conflict[] }>('/sync/conflicts');
  }

  /**
   * Resolves a sync conflict with a specified resolution strategy.
   *
   * Allows users to choose which version to keep when concurrent
   * modifications create a conflict. Can optionally keep both versions.
   *
   * @param fileId - ID of the conflicted file
   * @param resolution - Which version to keep ('use-local' or 'use-server')
   * @param keepBoth - If true, keep both versions with renamed conflict copy
   * @returns Confirmation of resolution
   */
  async resolveConflict(fileId: string, resolution: 'use-local' | 'use-server', keepBoth: boolean = false) {
    return this.request('/sync/resolve-conflict', {
      method: 'POST',
      body: JSON.stringify({ fileId, resolution, keepBoth }),
    });
  }

  /**
   * Performs delta sync calculation for a specific file.
   *
   * Compares local chunk hashes with server state to determine which
   * chunks need to be downloaded. Enables efficient partial file sync
   * for large files with small changes.
   *
   * @param fileId - ID of the file to sync
   * @param localChunkHashes - SHA-256 hashes of locally stored chunks
   * @returns Delta sync info with chunks to download vs keep
   */
  async getDeltaSync(fileId: string, localChunkHashes: string[]) {
    return this.request<import('../types').DeltaSync>('/sync/delta', {
      method: 'POST',
      body: JSON.stringify({ fileId, localChunkHashes }),
    });
  }

  // Photos

  /**
   * Lists photos in the user's photo library.
   *
   * Supports pagination, filtering by favorites, and filtering by album.
   * Returns photos sorted by creation date (newest first).
   *
   * @param options - Pagination and filter options
   * @param options.limit - Maximum number of photos to return
   * @param options.offset - Number of photos to skip (for pagination)
   * @param options.favorite - If true, only return favorited photos
   * @param options.albumId - Filter to photos in a specific album
   * @returns Array of photos and hasMore flag for pagination
   */
  async listPhotos(options: { limit?: number; offset?: number; favorite?: boolean; albumId?: string } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.favorite) params.set('favorite', 'true');
    if (options.albumId) params.set('albumId', options.albumId);

    return this.request<{ photos: import('../types').Photo[]; hasMore: boolean }>(
      `/photos?${params}`
    );
  }

  /**
   * Uploads a photo to the user's photo library.
   *
   * The server automatically generates thumbnail and preview derivatives
   * for efficient display. EXIF metadata is extracted for date/location info.
   *
   * @param file - Image file to upload
   * @returns The created photo's metadata including thumbnail URLs
   */
  async uploadPhoto(file: File) {
    const formData = new FormData();
    formData.append('photo', file);

    const response = await fetch(`${API_BASE}/photos/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  }

  /**
   * Toggles the favorite status of a photo.
   *
   * Favorited photos appear in the Favorites filter and are prioritized
   * for local caching on devices with limited storage.
   *
   * @param photoId - ID of the photo to toggle
   * @returns Updated photo ID and new favorite status
   */
  async toggleFavorite(photoId: string) {
    return this.request<{ id: string; isFavorite: boolean }>(`/photos/${photoId}/favorite`, {
      method: 'POST',
    });
  }

  /**
   * Soft-deletes a photo from the library.
   *
   * The photo is moved to a "Recently Deleted" state and will be
   * permanently purged after a retention period.
   *
   * @param photoId - ID of the photo to delete
   * @returns Confirmation message and photo ID
   */
  async deletePhoto(photoId: string) {
    return this.request<{ message: string; id: string }>(`/photos/${photoId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Lists all photo albums for the current user.
   *
   * @returns Array of album metadata including cover photos
   */
  async listAlbums() {
    return this.request<{ albums: import('../types').Album[] }>('/photos/albums');
  }

  /**
   * Creates a new photo album.
   *
   * Optionally adds photos to the album at creation time.
   *
   * @param name - Name for the new album
   * @param photoIds - Optional array of photo IDs to include
   * @returns The created album's metadata
   */
  async createAlbum(name: string, photoIds?: string[]) {
    return this.request<import('../types').Album>('/photos/albums', {
      method: 'POST',
      body: JSON.stringify({ name, photoIds }),
    });
  }

  /**
   * Adds photos to an existing album.
   *
   * @param albumId - ID of the target album
   * @param photoIds - Array of photo IDs to add
   * @returns Confirmation of the operation
   */
  async addPhotosToAlbum(albumId: string, photoIds: string[]) {
    return this.request(`/photos/albums/${albumId}/photos`, {
      method: 'POST',
      body: JSON.stringify({ photoIds }),
    });
  }

  // Devices

  /**
   * Lists all registered devices for the current user.
   *
   * Each device represents a client (browser, phone, computer) that
   * participates in file synchronization.
   *
   * @returns Array of device metadata including sync status
   */
  async listDevices() {
    return this.request<{ devices: import('../types').Device[] }>('/devices');
  }

  /**
   * Registers a new device for the current user.
   *
   * Creates a device entry for sync tracking. Each device gets a unique
   * ID used in version vectors for conflict detection.
   *
   * @param name - Friendly name for the device
   * @param deviceType - Device category (e.g., 'web', 'iphone', 'mac')
   * @returns The registered device's metadata
   */
  async registerDevice(name: string, deviceType: string = 'web') {
    return this.request<import('../types').Device>('/devices', {
      method: 'POST',
      body: JSON.stringify({ name, deviceType }),
    });
  }

  /**
   * Unregisters a device from the user's account.
   *
   * The device will no longer participate in sync and its version
   * vector entries may be cleaned up.
   *
   * @param deviceId - ID of the device to remove
   * @returns Confirmation message and device ID
   */
  async deleteDevice(deviceId: string) {
    return this.request<{ message: string; id: string }>(`/devices/${deviceId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Retrieves sync operation history for a specific device.
   *
   * Useful for debugging sync issues or auditing device activity.
   *
   * @param deviceId - ID of the device
   * @param limit - Maximum number of operations to return (default 50)
   * @returns Device ID and array of sync operations
   */
  async getDeviceSyncHistory(deviceId: string, limit: number = 50) {
    return this.request<{ deviceId: string; operations: import('../types').SyncOperation[] }>(
      `/devices/${deviceId}/sync-history?limit=${limit}`
    );
  }

  // Admin

  /**
   * Retrieves system-wide statistics for the admin dashboard.
   *
   * Provides metrics on users, files, photos, devices, sync operations,
   * and storage optimization (chunk deduplication savings).
   *
   * @returns Aggregated system statistics
   */
  async getStats() {
    return this.request<import('../types').SystemStats>('/admin/stats');
  }

  /**
   * Lists all users in the system (admin only).
   *
   * Supports pagination and search filtering by email.
   *
   * @param options - Pagination and search options
   * @returns Array of user profiles with storage usage info
   */
  async listUsers(options: { limit?: number; offset?: number; search?: string } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.search) params.set('search', options.search);

    return this.request<{
      users: Array<{
        id: string;
        email: string;
        role: string;
        storageQuota: number;
        storageUsed: number;
        deviceCount: number;
        createdAt: string;
      }>;
    }>(`/admin/users?${params}`);
  }

  /**
   * Retrieves detailed information about a specific user.
   *
   * @param userId - ID of the user to look up
   * @returns Full user profile and activity details
   */
  async getUserDetails(userId: string) {
    return this.request(`/admin/users/${userId}`);
  }

  /**
   * Updates a user's role or storage quota.
   *
   * @param userId - ID of the user to update
   * @param updates - Fields to update (role and/or storageQuota)
   * @returns Updated user profile
   */
  async updateUser(userId: string, updates: { role?: string; storageQuota?: number }) {
    return this.request(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  /**
   * Lists recent sync operations across all users.
   *
   * Supports filtering by status and user ID for debugging and monitoring.
   *
   * @param options - Filter options
   * @returns Array of sync operations with user and file context
   */
  async getSyncOperations(options: { limit?: number; status?: string; userId?: string } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.status) params.set('status', options.status);
    if (options.userId) params.set('userId', options.userId);

    return this.request<{ operations: import('../types').SyncOperation[] }>(
      `/admin/sync-operations?${params}`
    );
  }

  /**
   * Lists all unresolved conflicts across all users (admin view).
   *
   * Provides visibility into sync conflicts system-wide for support purposes.
   *
   * @returns Array of all unresolved conflicts with user context
   */
  async getAdminConflicts() {
    return this.request<{ conflicts: import('../types').Conflict[] }>('/admin/conflicts');
  }

  /**
   * Cleans up orphaned chunks from the storage system.
   *
   * Removes chunks that are no longer referenced by any file. This can
   * happen when files are deleted but cleanup wasn't completed.
   *
   * @returns Number of chunks removed
   */
  async cleanupChunks() {
    return this.request<{ message: string; chunksRemoved: number }>('/admin/cleanup-chunks', {
      method: 'POST',
    });
  }

  /**
   * Permanently purges soft-deleted files older than a specified age.
   *
   * Removes files from the "Recently Deleted" state and their associated
   * chunks (if not shared with other files via deduplication).
   *
   * @param olderThanDays - Minimum age in days for files to purge (default 30)
   * @returns Count of files and chunks removed
   */
  async purgeDeleted(olderThanDays: number = 30) {
    return this.request<{ message: string; filesDeleted: number; chunksRemoved: number }>(
      '/admin/purge-deleted',
      {
        method: 'POST',
        body: JSON.stringify({ olderThanDays }),
      }
    );
  }
}

/**
 * Singleton API client instance.
 *
 * Use this exported instance for all API calls throughout the application
 * to ensure consistent configuration and session handling.
 */
export const api = new ApiClient();
