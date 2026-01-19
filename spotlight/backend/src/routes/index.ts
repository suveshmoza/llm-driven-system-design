import express, { Request, Response, Router } from 'express';
import { pool } from '../index.js';
import { indexDocument, deleteDocument } from '../services/elasticsearch.js';
import { indexRateLimiter, bulkRateLimiter } from '../shared/rateLimiter.js';
import { idempotencyMiddleware, withIdempotency, generateIdempotencyKey } from '../shared/idempotency.js';
import { createCircuitBreaker } from '../shared/circuitBreaker.js';
import { indexOperationLatency, indexOperationsTotal } from '../shared/metrics.js';
import { logIndexOperation } from '../shared/logger.js';

const router: Router = express.Router();

// Apply rate limiting to all index routes
router.use(indexRateLimiter);

// ============================================================================
// Types
// ============================================================================

interface IndexParams {
  id: string;
  document: Record<string, unknown>;
}

interface FileRequestBody {
  path: string;
  name: string;
  content?: string;
  type?: string;
  size?: number;
  modified_at?: string;
  metadata?: Record<string, unknown>;
}

interface AppRequestBody {
  bundle_id: string;
  name: string;
  path?: string;
  category?: string;
}

interface ContactRequestBody {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
}

interface WebRequestBody {
  url: string;
  title: string;
  description?: string;
  favicon_url?: string;
}

interface BulkFileRequestBody {
  files: FileRequestBody[];
}

// ============================================================================
// Circuit Breakers for Elasticsearch Operations
// ============================================================================

// Circuit breaker for file indexing
const fileIndexBreaker = createCircuitBreaker('es_index_files', async (params: unknown) => {
  const p = params as IndexParams;
  return indexDocument('files', p.id, p.document);
}, {
  timeout: 5000,
  errorThresholdPercentage: 30,
  resetTimeout: 30000
});

// Circuit breaker for app indexing
const appIndexBreaker = createCircuitBreaker('es_index_apps', async (params: unknown) => {
  const p = params as IndexParams;
  return indexDocument('apps', p.id, p.document);
});

// Circuit breaker for contact indexing
const contactIndexBreaker = createCircuitBreaker('es_index_contacts', async (params: unknown) => {
  const p = params as IndexParams;
  return indexDocument('contacts', p.id, p.document);
});

// Circuit breaker for web indexing
const webIndexBreaker = createCircuitBreaker('es_index_web', async (params: unknown) => {
  const p = params as IndexParams;
  return indexDocument('web', p.id, p.document);
});

// Type for circuit breaker
type CircuitBreakerType = typeof fileIndexBreaker;

// ============================================================================
// Index Operations Helper
// ============================================================================

async function executeIndexOperation(
  breaker: CircuitBreakerType,
  indexType: string,
  id: string,
  document: Record<string, unknown>,
  operation: string,
  idempotencyKey?: string
): Promise<{ success: boolean }> {
  const startTime = Date.now();

  try {
    // Execute with circuit breaker
    await breaker.fire({ id, document });

    // Record metrics
    const duration = (Date.now() - startTime) / 1000;
    indexOperationLatency.labels(operation, indexType).observe(duration);
    indexOperationsTotal.labels(operation, indexType, 'success').inc();

    // Log operation
    logIndexOperation({
      operation,
      documentType: indexType,
      documentId: id,
      latencyMs: Date.now() - startTime,
      success: true,
      idempotencyKey
    });

    return { success: true };
  } catch (err) {
    const error = err as Error;

    const duration = (Date.now() - startTime) / 1000;
    indexOperationLatency.labels(operation, indexType).observe(duration);
    indexOperationsTotal.labels(operation, indexType, 'error').inc();

    logIndexOperation({
      operation,
      documentType: indexType,
      documentId: id,
      latencyMs: Date.now() - startTime,
      success: false,
      error: error.message,
      idempotencyKey
    });

    throw err;
  }
}

// ============================================================================
// Index a File
// ============================================================================
router.post('/files', idempotencyMiddleware('index_file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { path, name, content, type = 'file', size, modified_at, metadata = {} } = req.body as FileRequestBody;

    if (!path || !name) {
      res.status(400).json({ error: 'Path and name are required' });
      return;
    }

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    // Use idempotency wrapper for the entire operation
    const result = await withIdempotency(
      idempotencyKey || generateIdempotencyKey('index_file', { path }),
      async () => {
        // Store in PostgreSQL
        await pool.query(`
          INSERT INTO indexed_files (path, name, type, size, modified_at, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (path) DO UPDATE SET
            name = $2, type = $3, size = $4, modified_at = $5, metadata = $6, indexed_at = NOW()
        `, [path, name, type, size, modified_at, JSON.stringify(metadata)]);

        // Index in Elasticsearch with circuit breaker
        await executeIndexOperation(
          fileIndexBreaker,
          'files',
          path,
          {
            path,
            name,
            content: content || '',
            type,
            size,
            modified_at,
            indexed_at: new Date().toISOString(),
            metadata
          },
          'add',
          idempotencyKey
        );

        return { success: true, path };
      },
      'index_file'
    );

    if (result.replayed) {
      indexOperationsTotal.labels('add', 'files', 'idempotent_hit').inc();
    }

    res.json(result);
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'EOPENBREAKER') {
      res.status(503).json({
        error: 'Index service temporarily unavailable',
        code: 'CIRCUIT_BREAKER_OPEN'
      });
      return;
    }
    console.error('Index file error:', error);
    res.status(500).json({ error: 'Failed to index file' });
  }
});

// ============================================================================
// Delete a File from Index
// ============================================================================
router.delete('/files/:path(*)', async (req: Request, res: Response): Promise<void> => {
  try {
    const filePath = req.params.path as string;
    const startTime = Date.now();

    // Remove from PostgreSQL
    await pool.query('DELETE FROM indexed_files WHERE path = $1', [filePath]);

    // Remove from Elasticsearch
    await deleteDocument('files', filePath);

    indexOperationLatency.labels('delete', 'files').observe((Date.now() - startTime) / 1000);
    indexOperationsTotal.labels('delete', 'files', 'success').inc();

    logIndexOperation({
      operation: 'delete',
      documentType: 'files',
      documentId: filePath,
      latencyMs: Date.now() - startTime,
      success: true
    });

    res.json({ success: true });
  } catch (error) {
    indexOperationsTotal.labels('delete', 'files', 'error').inc();
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ============================================================================
// Index an Application
// ============================================================================
router.post('/apps', idempotencyMiddleware('index_app'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { bundle_id, name, path, category } = req.body as AppRequestBody;

    if (!bundle_id || !name) {
      res.status(400).json({ error: 'Bundle ID and name are required' });
      return;
    }

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const result = await withIdempotency(
      idempotencyKey || generateIdempotencyKey('index_app', { bundle_id }),
      async () => {
        // Store in PostgreSQL
        const dbResult = await pool.query(`
          INSERT INTO applications (bundle_id, name, path, category)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (bundle_id) DO UPDATE SET
            name = $2, path = $3, category = $4
          RETURNING id
        `, [bundle_id, name, path, category]);

        // Index in Elasticsearch with circuit breaker
        await executeIndexOperation(
          appIndexBreaker,
          'apps',
          bundle_id,
          {
            bundle_id,
            name,
            path,
            category,
            usage_count: 0,
            last_used: null
          },
          'add',
          idempotencyKey
        );

        return { success: true, id: dbResult.rows[0].id };
      },
      'index_app'
    );

    if (result.replayed) {
      indexOperationsTotal.labels('add', 'apps', 'idempotent_hit').inc();
    }

    res.json(result);
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'EOPENBREAKER') {
      res.status(503).json({
        error: 'Index service temporarily unavailable',
        code: 'CIRCUIT_BREAKER_OPEN'
      });
      return;
    }
    console.error('Index app error:', error);
    res.status(500).json({ error: 'Failed to index app' });
  }
});

// ============================================================================
// Index a Contact
// ============================================================================
router.post('/contacts', idempotencyMiddleware('index_contact'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phone, company, notes } = req.body as ContactRequestBody;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const result = await withIdempotency(
      idempotencyKey || generateIdempotencyKey('index_contact', { name, email }),
      async () => {
        // Store in PostgreSQL
        const dbResult = await pool.query(`
          INSERT INTO contacts (name, email, phone, company, notes)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `, [name, email, phone, company, notes]);

        const id = dbResult.rows[0].id;

        // Index in Elasticsearch with circuit breaker
        await executeIndexOperation(
          contactIndexBreaker,
          'contacts',
          id.toString(),
          {
            name,
            email,
            phone,
            company,
            notes
          },
          'add',
          idempotencyKey
        );

        return { success: true, id };
      },
      'index_contact'
    );

    if (result.replayed) {
      indexOperationsTotal.labels('add', 'contacts', 'idempotent_hit').inc();
    }

    res.json(result);
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'EOPENBREAKER') {
      res.status(503).json({
        error: 'Index service temporarily unavailable',
        code: 'CIRCUIT_BREAKER_OPEN'
      });
      return;
    }
    console.error('Index contact error:', error);
    res.status(500).json({ error: 'Failed to index contact' });
  }
});

// ============================================================================
// Index a Web Item (bookmark/history)
// ============================================================================
router.post('/web', idempotencyMiddleware('index_web'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, title, description, favicon_url } = req.body as WebRequestBody;

    if (!url || !title) {
      res.status(400).json({ error: 'URL and title are required' });
      return;
    }

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const result = await withIdempotency(
      idempotencyKey || generateIdempotencyKey('index_web', { url }),
      async () => {
        // Store in PostgreSQL
        const dbResult = await pool.query(`
          INSERT INTO web_items (url, title, description, favicon_url)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (url) DO UPDATE SET
            title = $2, description = $3, favicon_url = $4,
            visited_count = web_items.visited_count + 1,
            last_visited = NOW()
          RETURNING id, visited_count
        `, [url, title, description, favicon_url]);

        // Index in Elasticsearch with circuit breaker
        await executeIndexOperation(
          webIndexBreaker,
          'web',
          url,
          {
            url,
            title,
            description,
            visited_count: dbResult.rows[0].visited_count,
            last_visited: new Date().toISOString()
          },
          'add',
          idempotencyKey
        );

        return { success: true, id: dbResult.rows[0].id };
      },
      'index_web'
    );

    if (result.replayed) {
      indexOperationsTotal.labels('add', 'web', 'idempotent_hit').inc();
    }

    res.json(result);
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === 'EOPENBREAKER') {
      res.status(503).json({
        error: 'Index service temporarily unavailable',
        code: 'CIRCUIT_BREAKER_OPEN'
      });
      return;
    }
    console.error('Index web error:', error);
    res.status(500).json({ error: 'Failed to index web item' });
  }
});

// ============================================================================
// Bulk Index Files
// ============================================================================
router.post('/bulk/files', bulkRateLimiter, idempotencyMiddleware('bulk_index'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { files } = req.body as BulkFileRequestBody;

    if (!Array.isArray(files)) {
      res.status(400).json({ error: 'Files array is required' });
      return;
    }

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const startTime = Date.now();

    const result = await withIdempotency(
      idempotencyKey,
      async () => {
        let indexed = 0;
        let failed = 0;
        let skipped = 0;

        for (const file of files) {
          try {
            // Check circuit breaker state before processing
            if (fileIndexBreaker.opened) {
              skipped++;
              continue;
            }

            await pool.query(`
              INSERT INTO indexed_files (path, name, type, size, modified_at, metadata)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (path) DO UPDATE SET
                name = $2, type = $3, size = $4, modified_at = $5, metadata = $6, indexed_at = NOW()
            `, [file.path, file.name, file.type || 'file', file.size, file.modified_at, JSON.stringify(file.metadata || {})]);

            await fileIndexBreaker.fire({
              id: file.path,
              document: {
                path: file.path,
                name: file.name,
                content: file.content || '',
                type: file.type || 'file',
                size: file.size,
                modified_at: file.modified_at,
                indexed_at: new Date().toISOString(),
                metadata: file.metadata || {}
              }
            });

            indexed++;
          } catch (err) {
            const e = err as { code?: string };
            if (e.code === 'EOPENBREAKER') {
              skipped++;
            } else {
              failed++;
            }
          }
        }

        const duration = (Date.now() - startTime) / 1000;
        indexOperationLatency.labels('bulk', 'files').observe(duration);
        indexOperationsTotal.labels('bulk', 'files', 'success').inc();

        logIndexOperation({
          operation: 'bulk',
          documentType: 'files',
          documentId: `bulk_${files.length}`,
          latencyMs: Date.now() - startTime,
          success: true
        });

        return { success: true, indexed, failed, skipped };
      },
      'bulk_index'
    );

    if (result.replayed) {
      indexOperationsTotal.labels('bulk', 'files', 'idempotent_hit').inc();
    }

    res.json(result);
  } catch (error) {
    indexOperationsTotal.labels('bulk', 'files', 'error').inc();
    console.error('Bulk index error:', error);
    res.status(500).json({ error: 'Bulk indexing failed' });
  }
});

export default router;
