import { pool } from './db.js';
import { diffLines, Change } from 'diff';
import { logger } from './logger.js';

interface PageVersion {
  id: string;
  page_id: string;
  version_number: number;
  title: string;
  content_json: object;
  content_html: string;
  content_text: string;
  change_message: string;
  created_by: string;
  created_at: string;
  author_username?: string;
}

interface DiffResult {
  fromVersion: number;
  toVersion: number;
  changes: Change[];
  titleChanged: boolean;
  fromTitle: string;
  toTitle: string;
}

/** Retrieves all version records for a page ordered by version number descending. */
export async function getVersionHistory(pageId: string): Promise<PageVersion[]> {
  const result = await pool.query(
    `SELECT pv.*, u.username as author_username
     FROM page_versions pv
     JOIN users u ON u.id = pv.created_by
     WHERE pv.page_id = $1
     ORDER BY pv.version_number DESC`,
    [pageId],
  );
  return result.rows;
}

/** Retrieves a specific version of a page by version number. */
export async function getVersion(pageId: string, versionNumber: number): Promise<PageVersion | null> {
  const result = await pool.query(
    `SELECT pv.*, u.username as author_username
     FROM page_versions pv
     JOIN users u ON u.id = pv.created_by
     WHERE pv.page_id = $1 AND pv.version_number = $2`,
    [pageId, versionNumber],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/** Computes a line-by-line diff between two page versions for history display. */
export async function computeDiff(
  pageId: string,
  fromVersion: number,
  toVersion: number,
): Promise<DiffResult> {
  const [fromVer, toVer] = await Promise.all([
    getVersion(pageId, fromVersion),
    getVersion(pageId, toVersion),
  ]);

  if (!fromVer || !toVer) {
    throw new Error(`Version not found: from=${fromVersion}, to=${toVersion}`);
  }

  const changes = diffLines(fromVer.content_html, toVer.content_html);

  logger.debug(
    { pageId, fromVersion, toVersion, changeCount: changes.length },
    'Computed diff between versions',
  );

  return {
    fromVersion,
    toVersion,
    changes,
    titleChanged: fromVer.title !== toVer.title,
    fromTitle: fromVer.title,
    toTitle: toVer.title,
  };
}

/** Restores a page to a previous version, creating a new version record. */
export async function restoreVersion(
  pageId: string,
  versionNumber: number,
  restoredBy: string,
): Promise<void> {
  const version = await getVersion(pageId, versionNumber);
  if (!version) throw new Error('Version not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current version number
    const current = await client.query('SELECT version FROM pages WHERE id = $1', [pageId]);
    const newVersionNum = current.rows[0].version + 1;

    // Update page with restored content
    await client.query(
      `UPDATE pages
       SET title = $1, slug = $2, content_json = $3, content_html = $4, content_text = $5,
           version = $6, updated_by = $7, updated_at = NOW()
       WHERE id = $8`,
      [
        version.title,
        version.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'),
        JSON.stringify(version.content_json),
        version.content_html,
        version.content_text,
        newVersionNum,
        restoredBy,
        pageId,
      ],
    );

    // Create version record for the restoration
    await client.query(
      `INSERT INTO page_versions (page_id, version_number, title, content_json, content_html, content_text, change_message, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        pageId,
        newVersionNum,
        version.title,
        JSON.stringify(version.content_json),
        version.content_html,
        version.content_text,
        `Restored from version ${versionNumber}`,
        restoredBy,
      ],
    );

    await client.query('COMMIT');
    logger.info({ pageId, restoredFrom: versionNumber, newVersion: newVersionNum }, 'Page version restored');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
