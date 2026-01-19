import 'dotenv/config';
import { pool } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import {
  connectQueue,
  closeQueue,
  consumeQueue,
  QUEUES,
  QueueMessage,
} from '../utils/queue.js';
import {
  elasticsearch,
  initElasticsearch,
  indexBusiness,
  updateBusinessIndex,
  deleteBusinessIndex,
} from '../utils/elasticsearch.js';

/**
 * Elasticsearch Index Worker
 *
 * Consumes messages from the business_index queue and updates Elasticsearch.
 * This decouples index updates from API responses for better performance.
 *
 * Message types:
 * - update: Partial update of business fields (rating, review_count)
 * - reindex: Full reindex of a business from PostgreSQL
 * - delete: Remove business from Elasticsearch index
 */

// Business row interface for PostgreSQL result
interface BusinessForIndex {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  website: string | null;
  email: string | null;
  price_level: number | null;
  rating: number;
  review_count: number;
  photo_count: number;
  is_claimed: boolean;
  is_verified: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  categories: string[] | null;
  category_names: string[] | null;
}

// Elasticsearch error interface
interface ElasticsearchError extends Error {
  meta?: {
    statusCode?: number;
  };
}

/**
 * Fetch full business data from PostgreSQL for indexing.
 */
async function fetchBusinessForIndex(
  businessId: string
): Promise<BusinessForIndex | null> {
  const result = await pool.query<BusinessForIndex>(
    `SELECT b.*,
            array_agg(DISTINCT bc.category_id) FILTER (WHERE bc.category_id IS NOT NULL) as categories,
            array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as category_names
     FROM businesses b
     LEFT JOIN business_categories bc ON b.id = bc.business_id
     LEFT JOIN categories c ON bc.category_id = c.id
     WHERE b.id = $1
     GROUP BY b.id`,
    [businessId]
  );

  return result.rows[0] || null;
}

/**
 * Handle incoming index messages.
 */
async function handleIndexMessage(message: QueueMessage): Promise<void> {
  const { type, businessId, updates, timestamp } = message;

  // Validate message type
  if (type !== 'update' && type !== 'reindex' && type !== 'delete') {
    logger.warn(
      {
        component: 'indexWorker',
        type,
        businessId,
      },
      'Unknown message type'
    );
    return;
  }

  if (!businessId) {
    logger.warn(
      {
        component: 'indexWorker',
        type,
      },
      'Missing businessId in message'
    );
    return;
  }

  logger.debug(
    {
      component: 'indexWorker',
      type,
      businessId,
      timestamp,
    },
    'Processing index message'
  );

  switch (type) {
    case 'update': {
      // Partial update (e.g., rating/review_count changes)
      if (updates) {
        await updateBusinessIndex(businessId, updates);
        logger.info(
          {
            component: 'indexWorker',
            businessId,
            updates: Object.keys(updates),
          },
          'Business index updated'
        );
      }
      break;
    }

    case 'reindex': {
      // Full reindex from PostgreSQL
      const business = await fetchBusinessForIndex(businessId);
      if (business) {
        await indexBusiness(business);
        logger.info(
          {
            component: 'indexWorker',
            businessId,
          },
          'Business reindexed'
        );
      } else {
        logger.warn(
          {
            component: 'indexWorker',
            businessId,
          },
          'Business not found for reindex'
        );
      }
      break;
    }

    case 'delete': {
      // Remove from Elasticsearch
      try {
        await deleteBusinessIndex(businessId);
        logger.info(
          {
            component: 'indexWorker',
            businessId,
          },
          'Business removed from index'
        );
      } catch (err) {
        // Ignore 404 errors (already deleted)
        const esError = err as ElasticsearchError;
        if (esError.meta?.statusCode !== 404) {
          throw err;
        }
      }
      break;
    }
  }
}

/**
 * Start the worker.
 */
async function start(): Promise<void> {
  try {
    // Connect to PostgreSQL
    await pool.query('SELECT NOW()');
    logger.info({ component: 'indexWorker' }, 'PostgreSQL connected');

    // Connect to Elasticsearch
    await elasticsearch.ping();
    await initElasticsearch();
    logger.info({ component: 'indexWorker' }, 'Elasticsearch connected');

    // Connect to RabbitMQ
    await connectQueue();
    logger.info({ component: 'indexWorker' }, 'RabbitMQ connected');

    // Start consuming
    await consumeQueue(QUEUES.BUSINESS_INDEX, handleIndexMessage, {
      prefetch: 10,
    });

    logger.info({ component: 'indexWorker' }, 'Index worker started');
  } catch (err) {
    logger.fatal(
      { err, component: 'indexWorker' },
      'Failed to start index worker'
    );
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info({ component: 'indexWorker' }, 'Shutting down...');
  await closeQueue();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
