/**
 * File and folder sharing service.
 * Supports two sharing models:
 * 1. Shared links - public URLs with optional password, expiration, and download limits
 * 2. Folder shares - direct sharing with specific users by email
 * @module services/sharingService
 */

import { query, queryOne } from '../utils/database.js';
import { SharedLink, FolderShare, FileItem, User } from '../types/index.js';
import { generateToken } from '../utils/chunking.js';
import bcrypt from 'bcrypt';

/**
 * Creates a shareable link for a file.
 * Links can be password-protected, time-limited, and download-limited.
 * @param userId - ID of user creating the link (must own the file)
 * @param fileId - ID of file to share
 * @param options - Optional sharing restrictions
 * @param options.accessLevel - Permission level (view, download, or edit)
 * @param options.password - Password to protect the link
 * @param options.expiresInHours - Hours until link expires
 * @param options.maxDownloads - Maximum number of downloads allowed
 * @returns Created shared link with URL token
 * @throws Error if file not found or not owned by user
 */
export async function createSharedLink(
  userId: string,
  fileId: string,
  options: {
    accessLevel?: 'view' | 'download' | 'edit';
    password?: string;
    expiresInHours?: number;
    maxDownloads?: number;
  } = {}
): Promise<SharedLink> {
  // Verify file exists and user owns it
  const file = await queryOne<FileItem>(
    `SELECT id, user_id as "userId" FROM files WHERE id = $1 AND deleted_at IS NULL`,
    [fileId]
  );

  if (!file || file.userId !== userId) {
    throw new Error('File not found');
  }

  const urlToken = generateToken(32);
  const accessLevel = options.accessLevel || 'view';
  const passwordHash = options.password ? await bcrypt.hash(options.password, 10) : null;
  const expiresAt = options.expiresInHours
    ? new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000)
    : null;

  const result = await query<SharedLink>(
    `INSERT INTO shared_links (file_id, created_by, url_token, password_hash, expires_at, max_downloads, access_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, file_id as "fileId", created_by as "createdBy", url_token as "urlToken",
               expires_at as "expiresAt", download_count as "downloadCount",
               max_downloads as "maxDownloads", access_level as "accessLevel", created_at as "createdAt"`,
    [fileId, userId, urlToken, passwordHash, expiresAt, options.maxDownloads, accessLevel]
  );

  return result[0];
}

/**
 * Retrieves a shared link by its public URL token.
 * @param urlToken - The unique token from the shared URL
 * @returns Shared link details or null if not found
 */
export async function getSharedLinkByToken(urlToken: string): Promise<SharedLink | null> {
  return queryOne<SharedLink>(
    `SELECT id, file_id as "fileId", created_by as "createdBy", url_token as "urlToken",
            password_hash as "passwordHash", expires_at as "expiresAt",
            download_count as "downloadCount", max_downloads as "maxDownloads",
            access_level as "accessLevel", created_at as "createdAt"
     FROM shared_links WHERE url_token = $1`,
    [urlToken]
  );
}

/**
 * Validates access to a shared link.
 * Checks expiration, download limits, and password if required.
 * @param urlToken - The shared link token to validate
 * @param password - Password attempt if the link is protected
 * @returns Validation result with file on success or error message on failure
 */
export async function validateSharedLink(
  urlToken: string,
  password?: string
): Promise<{ valid: boolean; file?: FileItem; error?: string }> {
  const link = await getSharedLinkByToken(urlToken);

  if (!link) {
    return { valid: false, error: 'Link not found' };
  }

  // Check expiration
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return { valid: false, error: 'Link has expired' };
  }

  // Check download limit
  if (link.maxDownloads && link.downloadCount >= link.maxDownloads) {
    return { valid: false, error: 'Download limit reached' };
  }

  // Check password
  if (link.passwordHash) {
    if (!password) {
      return { valid: false, error: 'Password required' };
    }
    const passwordMatch = await bcrypt.compare(password, link.passwordHash);
    if (!passwordMatch) {
      return { valid: false, error: 'Invalid password' };
    }
  }

  // Get file
  const file = await queryOne<FileItem>(
    `SELECT id, user_id as "userId", parent_id as "parentId", name, is_folder as "isFolder",
            size, mime_type as "mimeType", content_hash as "contentHash", version,
            sync_status as "syncStatus", created_at as "createdAt", updated_at as "updatedAt"
     FROM files WHERE id = $1 AND deleted_at IS NULL`,
    [link.fileId]
  );

  if (!file) {
    return { valid: false, error: 'File no longer exists' };
  }

  return { valid: true, file };
}

/**
 * Increments the download counter for a shared link.
 * Called when a file is downloaded via shared link.
 * @param urlToken - The shared link token
 */
export async function incrementDownloadCount(urlToken: string): Promise<void> {
  await query(
    `UPDATE shared_links SET download_count = download_count + 1 WHERE url_token = $1`,
    [urlToken]
  );
}

/**
 * Retrieves all shared links created by a user.
 * Used for the sharing management interface.
 * @param userId - ID of user whose links to retrieve
 * @returns Array of shared links with file names
 */
export async function getUserSharedLinks(userId: string): Promise<SharedLink[]> {
  return query<SharedLink>(
    `SELECT sl.id, sl.file_id as "fileId", sl.created_by as "createdBy",
            sl.url_token as "urlToken", sl.expires_at as "expiresAt",
            sl.download_count as "downloadCount", sl.max_downloads as "maxDownloads",
            sl.access_level as "accessLevel", sl.created_at as "createdAt",
            f.name as "fileName"
     FROM shared_links sl
     JOIN files f ON sl.file_id = f.id
     WHERE sl.created_by = $1
     ORDER BY sl.created_at DESC`,
    [userId]
  );
}

/**
 * Deletes a shared link.
 * @param userId - ID of user (must own the link)
 * @param linkId - ID of link to delete
 * @throws Error if link not found
 */
export async function deleteSharedLink(userId: string, linkId: string): Promise<void> {
  const result = await query(
    `DELETE FROM shared_links WHERE id = $1 AND created_by = $2`,
    [linkId, userId]
  );

  if (!result) {
    throw new Error('Link not found');
  }
}

/**
 * Shares a folder with another user by email.
 * Creates or updates the share with the specified access level.
 * @param ownerId - ID of folder owner
 * @param folderId - ID of folder to share
 * @param email - Email of user to share with
 * @param accessLevel - Permission level (view or edit)
 * @returns Created folder share
 * @throws Error if folder not found, target user not found, or sharing with self
 */
export async function shareFolderWithUser(
  ownerId: string,
  folderId: string,
  email: string,
  accessLevel: 'view' | 'edit'
): Promise<FolderShare> {
  // Verify folder exists and user owns it
  const folder = await queryOne<FileItem>(
    `SELECT id, user_id as "userId", is_folder as "isFolder"
     FROM files WHERE id = $1 AND deleted_at IS NULL`,
    [folderId]
  );

  if (!folder || folder.userId !== ownerId) {
    throw new Error('Folder not found');
  }

  if (!folder.isFolder) {
    throw new Error('Only folders can be shared with specific users');
  }

  // Find user to share with
  const sharedWithUser = await queryOne<User>(
    `SELECT id FROM users WHERE email = $1`,
    [email]
  );

  if (!sharedWithUser) {
    throw new Error('User not found');
  }

  if (sharedWithUser.id === ownerId) {
    throw new Error('Cannot share folder with yourself');
  }

  // Create or update share
  const result = await query<FolderShare>(
    `INSERT INTO folder_shares (folder_id, shared_with, access_level)
     VALUES ($1, $2, $3)
     ON CONFLICT (folder_id, shared_with)
     DO UPDATE SET access_level = $3
     RETURNING id, folder_id as "folderId", shared_with as "sharedWith",
               access_level as "accessLevel", created_at as "createdAt"`,
    [folderId, sharedWithUser.id, accessLevel]
  );

  return result[0];
}

/**
 * Retrieves all folders shared with a user.
 * Used for the "Shared with me" view in the file browser.
 * @param userId - ID of user to get shared folders for
 * @returns Array of folders with owner information and access level
 */
export async function getSharedWithMe(userId: string): Promise<FileItem[]> {
  return query<FileItem>(
    `SELECT f.id, f.user_id as "userId", f.parent_id as "parentId", f.name, f.is_folder as "isFolder",
            f.size, f.mime_type as "mimeType", f.content_hash as "contentHash", f.version,
            f.sync_status as "syncStatus", f.created_at as "createdAt", f.updated_at as "updatedAt",
            fs.access_level as "shareAccessLevel",
            u.name as "ownerName"
     FROM folder_shares fs
     JOIN files f ON fs.folder_id = f.id
     JOIN users u ON f.user_id = u.id
     WHERE fs.shared_with = $1 AND f.deleted_at IS NULL`,
    [userId]
  );
}

/**
 * Checks if a user has access to a file or folder.
 * Walks up the folder hierarchy checking for share permissions.
 * @param userId - ID of user to check access for
 * @param fileId - ID of file/folder to check
 * @param requiredLevel - Minimum permission level needed (view or edit)
 * @returns true if user has sufficient access, false otherwise
 */
export async function checkAccess(
  userId: string,
  fileId: string,
  requiredLevel: 'view' | 'edit'
): Promise<boolean> {
  // Check if owner
  const file = await queryOne<FileItem>(
    `SELECT id, user_id as "userId", parent_id as "parentId"
     FROM files WHERE id = $1 AND deleted_at IS NULL`,
    [fileId]
  );

  if (!file) {
    return false;
  }

  if (file.userId === userId) {
    return true;
  }

  // Check folder shares up the hierarchy
  let currentId: string | null = file.isFolder ? fileId : file.parentId;

  while (currentId) {
    const share = await queryOne<FolderShare>(
      `SELECT access_level as "accessLevel"
       FROM folder_shares WHERE folder_id = $1 AND shared_with = $2`,
      [currentId, userId]
    );

    if (share) {
      if (requiredLevel === 'view') {
        return true;
      }
      if (requiredLevel === 'edit' && share.accessLevel === 'edit') {
        return true;
      }
    }

    const parent = await queryOne<{ parent_id: string | null }>(
      `SELECT parent_id FROM files WHERE id = $1`,
      [currentId]
    );

    currentId = parent?.parent_id || null;
  }

  return false;
}

/**
 * Removes a folder share.
 * @param ownerId - ID of folder owner
 * @param folderId - ID of folder
 * @param sharedWithId - ID of user to remove from share
 * @throws Error if folder not found
 */
export async function removeFolderShare(
  ownerId: string,
  folderId: string,
  sharedWithId: string
): Promise<void> {
  // Verify ownership
  const folder = await queryOne<FileItem>(
    `SELECT user_id as "userId" FROM files WHERE id = $1`,
    [folderId]
  );

  if (!folder || folder.userId !== ownerId) {
    throw new Error('Folder not found');
  }

  await query(
    `DELETE FROM folder_shares WHERE folder_id = $1 AND shared_with = $2`,
    [folderId, sharedWithId]
  );
}

/**
 * Retrieves all users a folder is shared with.
 * @param userId - ID of folder owner
 * @param folderId - ID of folder
 * @returns Array of shares with user email and name
 * @throws Error if folder not found
 */
export async function getFolderShares(userId: string, folderId: string): Promise<Array<FolderShare & { email: string; name: string }>> {
  // Verify ownership
  const folder = await queryOne<FileItem>(
    `SELECT user_id as "userId" FROM files WHERE id = $1`,
    [folderId]
  );

  if (!folder || folder.userId !== userId) {
    throw new Error('Folder not found');
  }

  return query(
    `SELECT fs.id, fs.folder_id as "folderId", fs.shared_with as "sharedWith",
            fs.access_level as "accessLevel", fs.created_at as "createdAt",
            u.email, u.name
     FROM folder_shares fs
     JOIN users u ON fs.shared_with = u.id
     WHERE fs.folder_id = $1`,
    [folderId]
  );
}
