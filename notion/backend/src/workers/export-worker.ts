/**
 * Export worker for Notion
 * Processes notion.export queue for PDF, Markdown, HTML exports.
 */
import { queueManager, QUEUES, ExportMessage } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import pool from '../models/db.js';

interface BlockRow {
  id: string;
  type: string;
  content: Record<string, unknown>;
  position: string;
}

interface PageRow {
  id: string;
  title: string;
  icon: string | null;
  cover_image: string | null;
}

/**
 * Convert blocks to Markdown format.
 */
function blocksToMarkdown(blocks: BlockRow[]): string {
  return blocks
    .sort((a, b) => a.position.localeCompare(b.position))
    .map((block) => {
      const content = block.content as { text?: string; level?: number; language?: string; checked?: boolean };

      switch (block.type) {
        case 'heading_1':
          return `# ${content.text || ''}\n`;
        case 'heading_2':
          return `## ${content.text || ''}\n`;
        case 'heading_3':
          return `### ${content.text || ''}\n`;
        case 'paragraph':
          return `${content.text || ''}\n`;
        case 'bulleted_list':
          return `- ${content.text || ''}\n`;
        case 'numbered_list':
          return `1. ${content.text || ''}\n`;
        case 'to_do':
          return `- [${content.checked ? 'x' : ' '}] ${content.text || ''}\n`;
        case 'code':
          return `\`\`\`${content.language || ''}\n${content.text || ''}\n\`\`\`\n`;
        case 'quote':
          return `> ${content.text || ''}\n`;
        case 'divider':
          return '---\n';
        case 'callout':
          return `> **Note:** ${content.text || ''}\n`;
        default:
          return `${content.text || ''}\n`;
      }
    })
    .join('\n');
}

/**
 * Convert blocks to HTML format.
 */
function blocksToHtml(page: PageRow, blocks: BlockRow[]): string {
  const blockHtml = blocks
    .sort((a, b) => a.position.localeCompare(b.position))
    .map((block) => {
      const content = block.content as { text?: string; level?: number; language?: string; checked?: boolean };
      const text = content.text || '';

      switch (block.type) {
        case 'heading_1':
          return `<h1>${text}</h1>`;
        case 'heading_2':
          return `<h2>${text}</h2>`;
        case 'heading_3':
          return `<h3>${text}</h3>`;
        case 'paragraph':
          return `<p>${text}</p>`;
        case 'bulleted_list':
          return `<ul><li>${text}</li></ul>`;
        case 'numbered_list':
          return `<ol><li>${text}</li></ol>`;
        case 'to_do':
          return `<div><input type="checkbox" ${content.checked ? 'checked' : ''} disabled/> ${text}</div>`;
        case 'code':
          return `<pre><code class="${content.language || ''}">${text}</code></pre>`;
        case 'quote':
          return `<blockquote>${text}</blockquote>`;
        case 'divider':
          return '<hr/>';
        case 'callout':
          return `<aside class="callout">${text}</aside>`;
        default:
          return `<div>${text}</div>`;
      }
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${page.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1, h2, h3 { margin-top: 1.5rem; }
    blockquote { border-left: 3px solid #ccc; padding-left: 1rem; color: #666; }
    pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; }
    .callout { background: #fff3cd; padding: 1rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${page.icon ? page.icon + ' ' : ''}${page.title}</h1>
  ${blockHtml}
</body>
</html>`;
}

/**
 * Process export jobs.
 * Generates exports in the requested format.
 */
async function processExport(message: ExportMessage): Promise<void> {
  const { type, pageId, userId, options } = message;

  logger.info({ type, pageId, userId }, 'Processing export');

  // Get page data
  const pageResult = await pool.query<PageRow>(`
    SELECT id, title, icon, cover_image
    FROM pages
    WHERE id = $1
  `, [pageId]);

  if (pageResult.rows.length === 0) {
    logger.warn({ pageId }, 'Page not found for export');
    return;
  }

  const page = pageResult.rows[0];

  // Get blocks
  const blocksResult = await pool.query<BlockRow>(`
    SELECT id, type, content, position
    FROM blocks
    WHERE page_id = $1
    ORDER BY position
  `, [pageId]);

  const blocks = blocksResult.rows;

  let content: string;
  let mimeType: string;
  let extension: string;

  switch (type) {
    case 'markdown':
      content = `# ${page.icon ? page.icon + ' ' : ''}${page.title}\n\n${blocksToMarkdown(blocks)}`;
      mimeType = 'text/markdown';
      extension = 'md';
      break;

    case 'html':
      content = blocksToHtml(page, blocks);
      mimeType = 'text/html';
      extension = 'html';
      break;

    case 'pdf':
      // PDF generation would require a library like puppeteer or pdfkit
      // For now, we'll generate HTML and note that PDF conversion is simulated
      content = blocksToHtml(page, blocks);
      mimeType = 'application/pdf';
      extension = 'pdf';
      logger.info({ pageId }, 'PDF export simulated - would use puppeteer in production');
      break;

    default:
      logger.warn({ type }, 'Unknown export type');
      return;
  }

  // Store export result
  await pool.query(`
    INSERT INTO exports (page_id, user_id, type, filename, content, status, created_at)
    VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
  `, [pageId, userId, type, `${page.title}.${extension}`, content]);

  logger.info({ type, pageId, userId }, 'Export completed');
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Notion export worker...');

  try {
    await queueManager.connect();

    await queueManager.consume('export', async (message: ExportMessage) => {
      await processExport(message);
    });

    logger.info('Notion export worker started, waiting for messages...');

    const shutdown = async () => {
      logger.info('Shutting down export worker...');
      await queueManager.close();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start export worker');
    process.exit(1);
  }
}

main();
