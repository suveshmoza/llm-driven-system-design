import { pool } from './db.js';
import { v4 as uuidv4 } from 'uuid';

export interface AppRow {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  components: unknown[];
  layout: Record<string, unknown>;
  queries: unknown[];
  global_settings: Record<string, unknown>;
  status: string;
  published_version: number | null;
  created_at: string;
  updated_at: string;
}

/** Service for CRUD operations on low-code applications and their components. */
export const appService = {
  async listByOwner(ownerId: string): Promise<AppRow[]> {
    const result = await pool.query(
      'SELECT * FROM apps WHERE owner_id = $1 ORDER BY updated_at DESC',
      [ownerId],
    );
    return result.rows;
  },

  async getById(id: string): Promise<AppRow | null> {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(
    name: string,
    description: string | null,
    ownerId: string,
  ): Promise<AppRow> {
    const result = await pool.query(
      `INSERT INTO apps (name, description, owner_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, description, ownerId],
    );
    return result.rows[0];
  },

  async update(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      components?: unknown[];
      layout?: Record<string, unknown>;
      queries?: unknown[];
      global_settings?: Record<string, unknown>;
    },
  ): Promise<AppRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.components !== undefined) {
      fields.push(`components = $${paramIndex++}`);
      values.push(JSON.stringify(data.components));
    }
    if (data.layout !== undefined) {
      fields.push(`layout = $${paramIndex++}`);
      values.push(JSON.stringify(data.layout));
    }
    if (data.queries !== undefined) {
      fields.push(`queries = $${paramIndex++}`);
      values.push(JSON.stringify(data.queries));
    }
    if (data.global_settings !== undefined) {
      fields.push(`global_settings = $${paramIndex++}`);
      values.push(JSON.stringify(data.global_settings));
    }

    if (fields.length === 0) return this.getById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE apps SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );
    return result.rows[0] || null;
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM apps WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },

  async publish(appId: string, userId: string): Promise<{ version: number }> {
    const app = await this.getById(appId);
    if (!app) throw new Error('App not found');

    // Get the next version number
    const versionResult = await pool.query(
      'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM app_versions WHERE app_id = $1',
      [appId],
    );
    const nextVersion = versionResult.rows[0].next_version;

    const versionId = uuidv4();

    await pool.query(
      `INSERT INTO app_versions (id, app_id, version_number, components, layout, queries, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        versionId,
        appId,
        nextVersion,
        JSON.stringify(app.components),
        JSON.stringify(app.layout),
        JSON.stringify(app.queries),
        userId,
      ],
    );

    await pool.query(
      `UPDATE apps SET status = 'published', published_version = $1, updated_at = NOW() WHERE id = $2`,
      [nextVersion, appId],
    );

    return { version: nextVersion };
  },

  async getPublishedVersion(
    appId: string,
  ): Promise<{ components: unknown[]; layout: Record<string, unknown>; queries: unknown[] } | null> {
    const app = await this.getById(appId);
    if (!app || !app.published_version) return null;

    const result = await pool.query(
      'SELECT components, layout, queries FROM app_versions WHERE app_id = $1 AND version_number = $2',
      [appId, app.published_version],
    );
    return result.rows[0] || null;
  },

  async getVersions(appId: string) {
    const result = await pool.query(
      `SELECT av.*, u.username AS published_by_username
       FROM app_versions av
       JOIN users u ON av.published_by = u.id
       WHERE av.app_id = $1
       ORDER BY av.version_number DESC`,
      [appId],
    );
    return result.rows;
  },
};
