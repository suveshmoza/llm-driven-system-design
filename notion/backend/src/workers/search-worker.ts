/**
 * Search index worker for Notion
 * Processes notion.search queue to maintain full-text search index.
 */
import { queueManager, QUEUES, SearchIndexMessage } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import pool from '../models/db.js';

interface BlockRow {
  id: string;
  page_id: string;
  type: string;
  content: Record<string, unknown>;
}

interface PageRow {
  id: string;
  workspace_id: string;
  title: string;
}

/**
 * Extract searchable text from block content.
 */
function extractText(content: Record<string, unknown>): string {
  const text = content.text as string | undefined;
  return text || '';
}

/**
 * Process search index updates.
 * Updates PostgreSQL full-text search vectors (or Elasticsearch in production).
 */
async function processSearchIndex(message: SearchIndexMessage): Promise<void> {
  const { type, blockId, pageId, workspaceId } = message;

  logger.info({ type, blockId, pageId }, 'Processing search index update');

  switch (type) {
    case 'index_block': {
      if (!blockId) {
        logger.warn({ type }, 'Missing blockId for index_block');
        return;
      }

      // Get block content
      const blockResult = await pool.query<BlockRow>(`
        SELECT id, page_id, type, content
        FROM blocks
        WHERE id = $1
      `, [blockId]);

      if (blockResult.rows.length === 0) {
        logger.warn({ blockId }, 'Block not found for indexing');
        return;
      }

      const block = blockResult.rows[0];
      const text = extractText(block.content);

      if (text) {
        // Update search index (using PostgreSQL tsvector)
        await pool.query(`
          INSERT INTO search_index (block_id, page_id, workspace_id, content, search_vector, updated_at)
          VALUES ($1, $2, $3, $4, to_tsvector('english', $4), NOW())
          ON CONFLICT (block_id)
          DO UPDATE SET
            content = EXCLUDED.content,
            search_vector = to_tsvector('english', EXCLUDED.content),
            updated_at = NOW()
        `, [blockId, block.page_id, workspaceId, text]);
      }

      logger.info({ blockId }, 'Block indexed');
      break;
    }

    case 'delete_block': {
      if (!blockId) {
        logger.warn({ type }, 'Missing blockId for delete_block');
        return;
      }

      await pool.query(`
        DELETE FROM search_index WHERE block_id = $1
      `, [blockId]);

      logger.info({ blockId }, 'Block removed from search index');
      break;
    }

    case 'reindex_page': {
      // Get page info
      const pageResult = await pool.query<PageRow>(`
        SELECT id, workspace_id, title
        FROM pages
        WHERE id = $1
      `, [pageId]);

      if (pageResult.rows.length === 0) {
        logger.warn({ pageId }, 'Page not found for reindexing');
        return;
      }

      const page = pageResult.rows[0];

      // Get all blocks for the page
      const blocksResult = await pool.query<BlockRow>(`
        SELECT id, page_id, type, content
        FROM blocks
        WHERE page_id = $1
      `, [pageId]);

      // Clear existing index entries for this page
      await pool.query(`
        DELETE FROM search_index WHERE page_id = $1
      `, [pageId]);

      // Reindex all blocks
      for (const block of blocksResult.rows) {
        const text = extractText(block.content);
        if (text) {
          await pool.query(`
            INSERT INTO search_index (block_id, page_id, workspace_id, content, search_vector, updated_at)
            VALUES ($1, $2, $3, $4, to_tsvector('english', $4), NOW())
          `, [block.id, pageId, page.workspace_id, text]);
        }
      }

      // Index page title
      await pool.query(`
        INSERT INTO search_index (block_id, page_id, workspace_id, content, search_vector, is_title, updated_at)
        VALUES ($1, $2, $3, $4, to_tsvector('english', $4), true, NOW())
        ON CONFLICT (block_id)
        DO UPDATE SET
          content = EXCLUDED.content,
          search_vector = to_tsvector('english', EXCLUDED.content),
          is_title = true,
          updated_at = NOW()
      `, [`title_${pageId}`, pageId, page.workspace_id, page.title]);

      logger.info({ pageId, blockCount: blocksResult.rows.length }, 'Page reindexed');
      break;
    }

    default:
      logger.warn({ type }, 'Unknown search index operation type');
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Notion search index worker...');

  try {
    await queueManager.connect();

    await queueManager.consume('search', async (message: SearchIndexMessage) => {
      await processSearchIndex(message);
    });

    logger.info('Notion search index worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down search index worker...');
      await queueManager.close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start search index worker');
    process.exit(1);
  }
}

main();
