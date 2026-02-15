import { pool } from './db.js';
import { logger } from './logger.js';
import bcrypt from 'bcryptjs';

interface AuthUserInput {
  projectId: string;
  email: string;
  password?: string;
  role?: string;
  emailConfirmed?: boolean;
  rawUserMetadata?: Record<string, unknown>;
}

interface AuthUser {
  id: string;
  projectId: string;
  email: string;
  emailConfirmed: boolean;
  role: string;
  rawUserMetadata: Record<string, unknown>;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lists all auth users for a given project ordered by creation date. */
export async function listAuthUsers(projectId: string): Promise<AuthUser[]> {
  const result = await pool.query(
    `SELECT id, project_id, email, email_confirmed, role, raw_user_metadata,
            last_sign_in_at, created_at, updated_at
     FROM auth_users
     WHERE project_id = $1
     ORDER BY created_at DESC`,
    [projectId],
  );

  return result.rows.map(mapRow);
}

/** Retrieves a single auth user by ID and project scope. */
export async function getAuthUser(id: string, projectId: string): Promise<AuthUser | null> {
  const result = await pool.query(
    `SELECT id, project_id, email, email_confirmed, role, raw_user_metadata,
            last_sign_in_at, created_at, updated_at
     FROM auth_users
     WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );

  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

/** Creates a new auth user with optional password hashing and metadata. */
export async function createAuthUser(input: AuthUserInput): Promise<AuthUser> {
  const encryptedPassword = input.password
    ? await bcrypt.hash(input.password, 10)
    : null;

  const result = await pool.query(
    `INSERT INTO auth_users (project_id, email, encrypted_password, email_confirmed, role, raw_user_metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, project_id, email, email_confirmed, role, raw_user_metadata,
               last_sign_in_at, created_at, updated_at`,
    [
      input.projectId,
      input.email,
      encryptedPassword,
      input.emailConfirmed ?? false,
      input.role ?? 'authenticated',
      JSON.stringify(input.rawUserMetadata ?? {}),
    ],
  );

  logger.info({ projectId: input.projectId, email: input.email }, 'Auth user created');
  return mapRow(result.rows[0]);
}

/** Updates auth user fields dynamically, re-hashing password if changed. */
export async function updateAuthUser(
  id: string,
  projectId: string,
  updates: Partial<AuthUserInput>,
): Promise<AuthUser | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 3;

  if (updates.email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    values.push(updates.email);
  }
  if (updates.password !== undefined) {
    const hash = await bcrypt.hash(updates.password, 10);
    setClauses.push(`encrypted_password = $${paramIndex++}`);
    values.push(hash);
  }
  if (updates.emailConfirmed !== undefined) {
    setClauses.push(`email_confirmed = $${paramIndex++}`);
    values.push(updates.emailConfirmed);
  }
  if (updates.role !== undefined) {
    setClauses.push(`role = $${paramIndex++}`);
    values.push(updates.role);
  }
  if (updates.rawUserMetadata !== undefined) {
    setClauses.push(`raw_user_metadata = $${paramIndex++}`);
    values.push(JSON.stringify(updates.rawUserMetadata));
  }

  if (setClauses.length === 0) {
    return getAuthUser(id, projectId);
  }

  setClauses.push('updated_at = NOW()');

  const result = await pool.query(
    `UPDATE auth_users SET ${setClauses.join(', ')}
     WHERE id = $1 AND project_id = $2
     RETURNING id, project_id, email, email_confirmed, role, raw_user_metadata,
               last_sign_in_at, created_at, updated_at`,
    [id, projectId, ...values],
  );

  return result.rows.length > 0 ? mapRow(result.rows[0]) : null;
}

/** Deletes an auth user by ID within a project scope, returning true if found. */
export async function deleteAuthUser(id: string, projectId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM auth_users WHERE id = $1 AND project_id = $2',
    [id, projectId],
  );

  return (result.rowCount ?? 0) > 0;
}

function mapRow(row: {
  id: string;
  project_id: string;
  email: string;
  email_confirmed: boolean;
  role: string;
  raw_user_metadata: Record<string, unknown>;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string;
}): AuthUser {
  return {
    id: row.id,
    projectId: row.project_id,
    email: row.email,
    emailConfirmed: row.email_confirmed,
    role: row.role,
    rawUserMetadata: row.raw_user_metadata,
    lastSignInAt: row.last_sign_in_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
