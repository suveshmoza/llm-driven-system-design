/**
 * Access control and permissions for collaborative documents.
 * Handles checking document permissions before allowing collaboration.
 */

import pool from '../../utils/db.js';

/**
 * Result of a document permission check.
 */
export interface PermissionCheckResult {
  found: boolean;
  ownerId?: string;
  currentVersion?: number;
  content?: unknown;
  permissionLevel?: string;
}

/**
 * Checks if a user has permission to access a document.
 * Returns document details if access is granted.
 */
export async function checkDocumentPermission(
  documentId: string,
  userId: string
): Promise<PermissionCheckResult> {
  const permCheck = await pool.query(
    `SELECT d.owner_id, d.current_version, d.content, dp.permission_level
     FROM documents d
     LEFT JOIN document_permissions dp ON d.id = dp.document_id AND dp.user_id = $2
     WHERE d.id = $1 AND d.is_deleted = false`,
    [documentId, userId]
  );

  if (permCheck.rows.length === 0) {
    return { found: false };
  }

  const { owner_id, current_version, content, permission_level } = permCheck.rows[0];

  return {
    found: true,
    ownerId: owner_id,
    currentVersion: current_version,
    content,
    permissionLevel: permission_level,
  };
}

/**
 * Determines if a user has access to a document based on ownership or permission.
 */
export function hasAccess(userId: string, ownerId: string, permissionLevel: string | null): boolean {
  return ownerId === userId || !!permissionLevel;
}

/**
 * Gets the effective permission level for a user on a document.
 * Owners always have 'edit' permission.
 */
export function getEffectivePermission(
  userId: string,
  ownerId: string,
  permissionLevel: string | null
): string {
  return ownerId === userId ? 'edit' : (permissionLevel || 'none');
}
