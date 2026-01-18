/**
 * Job scheduler for queuing scrape jobs.
 * Runs as a separate process and periodically queries for products
 * that need scraping, then publishes them to the RabbitMQ queue.
 * @module job-scheduler
 */
import cron from 'node-cron';
import dotenv from 'dotenv';

import { getProductsToScrape } from './services/productService.js';
import { connectQueue, publishScrapeJob, closeQueue, getQueueStats, QUEUE_SCRAPE_JOBS } from './shared/queue.js';
import { getCircuitBreakerStates } from './shared/resilience.js';
import { extractDomain } from './utils/helpers.js';
import logger from './utils/logger.js';

dotenv.config();

/** Interval between scheduled queue population runs in minutes */
const SCHEDULE_INTERVAL_MINUTES = parseInt(process.env.SCHEDULE_INTERVAL_MINUTES || '5', 10);

/** Maximum number of products to queue at once */
const BATCH_SIZE = parseInt(process.env.SCHEDULER_BATCH_SIZE || '100', 10);

/** Maximum queue depth before pausing job scheduling */
const MAX_QUEUE_DEPTH = parseInt(process.env.MAX_QUEUE_DEPTH || '1000', 10);

/** Flag to track if a scheduling run is in progress */
let isScheduling = false;

/**
 * Queries products due for scraping and publishes them to the queue.
 * Filters out products from domains with open circuit breakers.
 * Respects maximum queue depth to avoid memory issues.
 */
async function scheduleJobs(): Promise<void> {
  if (isScheduling) {
    logger.warn({ action: 'scheduler_skip' }, 'Previous scheduling run still in progress');
    return;
  }

  isScheduling = true;
  const startTime = Date.now();

  try {
    // Check current queue depth
    const stats = await getQueueStats(QUEUE_SCRAPE_JOBS);
    if (stats.messageCount >= MAX_QUEUE_DEPTH) {
      logger.warn(
        { action: 'scheduler_queue_full', messageCount: stats.messageCount, maxDepth: MAX_QUEUE_DEPTH },
        `Queue depth ${stats.messageCount} exceeds max ${MAX_QUEUE_DEPTH}, skipping scheduling`
      );
      return;
    }

    // Calculate how many jobs we can add
    const availableSlots = MAX_QUEUE_DEPTH - stats.messageCount;
    const batchSize = Math.min(BATCH_SIZE, availableSlots);

    logger.info(
      { action: 'scheduler_start', batchSize, queueDepth: stats.messageCount },
      `Starting job scheduling (batch size: ${batchSize})`
    );

    // Get products that need scraping
    const products = await getProductsToScrape(batchSize);

    if (products.length === 0) {
      logger.info({ action: 'scheduler_no_products' }, 'No products need scraping');
      return;
    }

    // Get circuit breaker states to filter out problematic domains
    const circuitStates = getCircuitBreakerStates();
    const openDomains = new Set(
      Object.entries(circuitStates)
        .filter(([_, state]) => state === 'open')
        .map(([domain]) => domain)
    );

    // Publish jobs to queue
    let scheduled = 0;
    let skipped = 0;

    for (const product of products) {
      const domain = extractDomain(product.url);

      if (openDomains.has(domain)) {
        logger.debug(
          { action: 'scheduler_skip_circuit', productId: product.id, domain },
          `Skipping product ${product.id} - circuit open for ${domain}`
        );
        skipped++;
        continue;
      }

      await publishScrapeJob(product.id, product.url, product.scrape_priority);
      scheduled++;
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        action: 'scheduler_complete',
        scheduled,
        skipped,
        total: products.length,
        durationMs,
      },
      `Scheduled ${scheduled} jobs (${skipped} skipped) in ${durationMs}ms`
    );

  } catch (error) {
    logger.error({ error, action: 'scheduler_error' }, 'Error during job scheduling');
  } finally {
    isScheduling = false;
  }
}

/**
 * Graceful shutdown handler.
 */
async function shutdown(): Promise<void> {
  logger.info({ action: 'scheduler_shutdown' }, 'Shutting down job scheduler...');

  try {
    await closeQueue();
  } catch (error) {
    logger.error({ error, action: 'scheduler_shutdown_error' }, 'Error during shutdown');
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/**
 * Main entry point for the job scheduler.
 */
async function main(): Promise<void> {
  logger.info(
    {
      action: 'scheduler_starting',
      intervalMinutes: SCHEDULE_INTERVAL_MINUTES,
      batchSize: BATCH_SIZE,
      maxQueueDepth: MAX_QUEUE_DEPTH,
    },
    'Job Scheduler starting...'
  );

  // Connect to RabbitMQ
  await connectQueue();

  // Run immediately on startup
  await scheduleJobs();

  // Schedule periodic runs
  cron.schedule(`*/${SCHEDULE_INTERVAL_MINUTES} * * * *`, async () => {
    logger.info({ action: 'scheduler_cron_trigger' }, 'Scheduled job run triggered');
    await scheduleJobs();
  });

  logger.info({ action: 'scheduler_ready' }, 'Job Scheduler running. Press Ctrl+C to stop.');
}

main().catch((error) => {
  logger.error({ error, action: 'scheduler_fatal' }, 'Fatal error in job scheduler');
  process.exit(1);
});
