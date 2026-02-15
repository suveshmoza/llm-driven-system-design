import { pool } from './db.js';
import { cacheGet, cacheSet, cacheDelPattern } from './redis.js';
import { publishToQueue } from './queue.js';
import { config } from '../config/index.js';
import { pageOperations } from './metrics.js';
import { logger } from './logger.js';

interface Page {
  id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  content_json: object;
  content_html: string;
  content_text: string;
  version: number;
  status: string;
  position: number;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface PageTreeNode extends Page {
  children: PageTreeNode[];
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export async function createPage(
  spaceId: string,
  title: string,
  contentJson: object,
  contentHtml: string,
  contentText: string,
  createdBy: string,
  parentId: string | null = null,
  status: string = 'published',
): Promise<Page> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const slug = slugify(title);

    // Get next position for this parent
    const posResult = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 as next_pos
       FROM pages WHERE space_id = $1 AND parent_id ${parentId ? '= $2' : 'IS NULL'}`,
      parentId ? [spaceId, parentId] : [spaceId],
    );
    const position = posResult.rows[0].next_pos;

    const result = await client.query(
      `INSERT INTO pages (space_id, parent_id, title, slug, content_json, content_html, content_text, status, position, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING *`,
      [spaceId, parentId, title, slug, JSON.stringify(contentJson), contentHtml, contentText, status, position, createdBy],
    );

    const page = result.rows[0];

    // Create initial version
    await client.query(
      `INSERT INTO page_versions (page_id, version_number, title, content_json, content_html, content_text, change_message, created_by)
       VALUES ($1, 1, $2, $3, $4, $5, 'Initial version', $6)`,
      [page.id, title, JSON.stringify(contentJson), contentHtml, contentText, createdBy],
    );

    await client.query('COMMIT');

    // Invalidate cache
    await cacheDelPattern(`space:${spaceId}:*`);

    // Publish to search index queue
    await publishToQueue(config.rabbitmq.pageIndexQueue, {
      action: 'index',
      pageId: page.id,
      spaceId,
    });

    pageOperations.inc({ operation: 'create' });
    logger.info({ pageId: page.id, spaceId }, 'Page created');

    return page;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updatePage(
  pageId: string,
  title: string,
  contentJson: object,
  contentHtml: string,
  contentText: string,
  updatedBy: string,
  changeMessage?: string,
): Promise<Page> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current version
    const current = await client.query('SELECT * FROM pages WHERE id = $1', [pageId]);
    if (current.rows.length === 0) throw new Error('Page not found');

    const page = current.rows[0];
    const newVersion = page.version + 1;
    const newSlug = slugify(title);

    // Update the page
    const result = await client.query(
      `UPDATE pages
       SET title = $1, slug = $2, content_json = $3, content_html = $4, content_text = $5,
           version = $6, updated_by = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [title, newSlug, JSON.stringify(contentJson), contentHtml, contentText, newVersion, updatedBy, pageId],
    );

    // Create version record
    await client.query(
      `INSERT INTO page_versions (page_id, version_number, title, content_json, content_html, content_text, change_message, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [pageId, newVersion, title, JSON.stringify(contentJson), contentHtml, contentText, changeMessage || `Version ${newVersion}`, updatedBy],
    );

    await client.query('COMMIT');

    const updated = result.rows[0];

    // Invalidate cache
    await cacheDelPattern(`space:${updated.space_id}:*`);
    await cacheDelPattern(`page:${pageId}:*`);

    // Publish to search index queue
    await publishToQueue(config.rabbitmq.pageIndexQueue, {
      action: 'index',
      pageId,
      spaceId: updated.space_id,
    });

    pageOperations.inc({ operation: 'update' });
    logger.info({ pageId, version: newVersion }, 'Page updated');

    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePage(pageId: string): Promise<void> {
  const page = await getPageById(pageId);
  if (!page) throw new Error('Page not found');

  await pool.query('DELETE FROM pages WHERE id = $1', [pageId]);

  await cacheDelPattern(`space:${page.space_id}:*`);
  await cacheDelPattern(`page:${pageId}:*`);

  await publishToQueue(config.rabbitmq.pageIndexQueue, {
    action: 'delete',
    pageId,
    spaceId: page.space_id,
  });

  pageOperations.inc({ operation: 'delete' });
  logger.info({ pageId }, 'Page deleted');
}

export async function getPageById(pageId: string): Promise<Page | null> {
  const cacheKey = `page:${pageId}:data`;
  const cached = await cacheGet<Page>(cacheKey);
  if (cached) return cached;

  const result = await pool.query('SELECT * FROM pages WHERE id = $1', [pageId]);
  if (result.rows.length === 0) return null;

  const page = result.rows[0];
  await cacheSet(cacheKey, page, 120);
  return page;
}

export async function getPageBySlug(spaceId: string, slug: string): Promise<Page | null> {
  const cacheKey = `space:${spaceId}:slug:${slug}`;
  const cached = await cacheGet<Page>(cacheKey);
  if (cached) return cached;

  const result = await pool.query(
    'SELECT * FROM pages WHERE space_id = $1 AND slug = $2',
    [spaceId, slug],
  );
  if (result.rows.length === 0) return null;

  const page = result.rows[0];
  await cacheSet(cacheKey, page, 120);
  return page;
}

export async function getPageTree(spaceId: string): Promise<PageTreeNode[]> {
  const cacheKey = `space:${spaceId}:tree`;
  const cached = await cacheGet<PageTreeNode[]>(cacheKey);
  if (cached) return cached;

  const result = await pool.query(
    `SELECT * FROM pages WHERE space_id = $1 ORDER BY position ASC, created_at ASC`,
    [spaceId],
  );

  const pages = result.rows as Page[];
  const tree = buildTree(pages);

  await cacheSet(cacheKey, tree, 120);
  return tree;
}

function buildTree(pages: Page[]): PageTreeNode[] {
  const map = new Map<string, PageTreeNode>();
  const roots: PageTreeNode[] = [];

  // Create nodes
  for (const page of pages) {
    map.set(page.id, { ...page, children: [] });
  }

  // Build tree
  for (const page of pages) {
    const node = map.get(page.id)!;
    if (page.parent_id && map.has(page.parent_id)) {
      map.get(page.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function movePage(
  pageId: string,
  newParentId: string | null,
  newPosition: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const page = await getPageById(pageId);
    if (!page) throw new Error('Page not found');

    // Reorder siblings at old parent
    await client.query(
      `UPDATE pages SET position = position - 1
       WHERE space_id = $1 AND parent_id ${page.parent_id ? '= $2' : 'IS NULL'} AND position > $3`,
      page.parent_id
        ? [page.space_id, page.parent_id, page.position]
        : [page.space_id, page.position],
    );

    // Make room at new parent
    await client.query(
      `UPDATE pages SET position = position + 1
       WHERE space_id = $1 AND parent_id ${newParentId ? '= $2' : 'IS NULL'} AND position >= $3`,
      newParentId
        ? [page.space_id, newParentId, newPosition]
        : [page.space_id, newPosition],
    );

    // Move the page
    await client.query(
      'UPDATE pages SET parent_id = $1, position = $2, updated_at = NOW() WHERE id = $3',
      [newParentId, newPosition, pageId],
    );

    await client.query('COMMIT');

    await cacheDelPattern(`space:${page.space_id}:*`);
    await cacheDelPattern(`page:${pageId}:*`);

    pageOperations.inc({ operation: 'move' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getRecentPages(limit: number = 10): Promise<Page[]> {
  const result = await pool.query(
    `SELECT p.*, s.key as space_key, s.name as space_name, u.username as author_username
     FROM pages p
     JOIN spaces s ON s.id = p.space_id
     JOIN users u ON u.id = p.created_by
     WHERE p.status = 'published'
     ORDER BY p.updated_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function getPagesByLabel(label: string): Promise<Page[]> {
  const result = await pool.query(
    `SELECT p.* FROM pages p
     JOIN page_labels pl ON pl.page_id = p.id
     WHERE pl.label = $1
     ORDER BY p.updated_at DESC`,
    [label],
  );
  return result.rows;
}

export async function addLabel(pageId: string, label: string): Promise<void> {
  await pool.query(
    'INSERT INTO page_labels (page_id, label) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [pageId, label],
  );
  await cacheDelPattern(`page:${pageId}:*`);
}

export async function removeLabel(pageId: string, label: string): Promise<void> {
  await pool.query('DELETE FROM page_labels WHERE page_id = $1 AND label = $2', [pageId, label]);
  await cacheDelPattern(`page:${pageId}:*`);
}

export async function getLabels(pageId: string): Promise<string[]> {
  const result = await pool.query(
    'SELECT label FROM page_labels WHERE page_id = $1 ORDER BY label',
    [pageId],
  );
  return result.rows.map((r: { label: string }) => r.label);
}

export async function getPageBreadcrumbs(pageId: string): Promise<Array<{ id: string; title: string; slug: string }>> {
  const result = await pool.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, title, slug, 0 as depth
       FROM pages WHERE id = $1
       UNION ALL
       SELECT p.id, p.parent_id, p.title, p.slug, a.depth + 1
       FROM pages p
       JOIN ancestors a ON p.id = a.parent_id
     )
     SELECT id, title, slug FROM ancestors ORDER BY depth DESC`,
    [pageId],
  );
  return result.rows;
}
