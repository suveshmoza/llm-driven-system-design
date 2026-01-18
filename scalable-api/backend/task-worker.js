import queue, { QUEUES } from './shared/services/queue.js';
import db from './shared/services/database.js';
import config from './shared/config/index.js';

const workerId = process.env.WORKER_ID || 'worker-1';

console.log(`Task Worker [${workerId}] starting...`);

/**
 * Task handlers by type
 */
const taskHandlers = {
  /**
   * Send email notification
   */
  async email(payload) {
    console.log(`[${workerId}] Processing email task:`, payload);
    // Simulate email sending
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`[${workerId}] Email sent to ${payload.to}: ${payload.subject}`);
    return { sent: true, to: payload.to };
  },

  /**
   * Generate report
   */
  async report(payload) {
    console.log(`[${workerId}] Generating report:`, payload.reportType);
    // Simulate report generation
    await new Promise((resolve) => setTimeout(resolve, 500));
    const reportId = `report-${Date.now()}`;
    console.log(`[${workerId}] Report generated: ${reportId}`);
    return { reportId, type: payload.reportType };
  },

  /**
   * Data cleanup task
   */
  async cleanup(payload) {
    console.log(`[${workerId}] Running cleanup:`, payload.target);

    if (payload.target === 'expired_sessions') {
      // Clean up expired sessions from database
      const result = await db.query(
        `DELETE FROM request_logs WHERE created_at < NOW() - INTERVAL '7 days' RETURNING id`
      );
      console.log(`[${workerId}] Cleaned up ${result.rowCount} old request logs`);
      return { deleted: result.rowCount };
    }

    return { status: 'completed' };
  },

  /**
   * Process webhook delivery
   */
  async webhook(payload) {
    console.log(`[${workerId}] Delivering webhook to ${payload.url}`);
    // Simulate webhook delivery
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log(`[${workerId}] Webhook delivered`);
    return { delivered: true, url: payload.url };
  },

  /**
   * Cache warmup task
   */
  async cache_warmup(payload) {
    console.log(`[${workerId}] Warming up cache for:`, payload.keys);
    // Simulate cache population
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { warmed: payload.keys?.length || 0 };
  },
};

/**
 * Handle incoming task message
 */
async function handleTask(task) {
  const { id, type, payload, retryCount, maxRetries } = task;

  console.log(`[${workerId}] Received task ${id} (type: ${type})`);

  const handler = taskHandlers[type];
  if (!handler) {
    console.error(`[${workerId}] Unknown task type: ${type}`);
    // Update task status as failed
    await updateTaskStatus(id, 'failed', { error: 'Unknown task type' });
    return;
  }

  try {
    const startTime = Date.now();
    const result = await handler(payload);
    const duration = Date.now() - startTime;

    console.log(`[${workerId}] Task ${id} completed in ${duration}ms`);
    await updateTaskStatus(id, 'completed', { result, duration });
  } catch (error) {
    console.error(`[${workerId}] Task ${id} failed:`, error.message);

    if (retryCount < maxRetries) {
      console.log(`[${workerId}] Will retry task ${id} (${retryCount + 1}/${maxRetries})`);
      // Requeue with incremented retry count
      await queue.publishTask(type, payload, {
        ...task,
        retryCount: retryCount + 1,
      });
    } else {
      await updateTaskStatus(id, 'failed', { error: error.message });
    }
  }
}

/**
 * Update task status in database (for tracking)
 */
async function updateTaskStatus(taskId, status, metadata = {}) {
  try {
    await db.query(
      `INSERT INTO task_status (task_id, status, metadata, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (task_id) DO UPDATE SET status = $2, metadata = $3, updated_at = NOW()`,
      [taskId, status, JSON.stringify(metadata)]
    );
  } catch (error) {
    // Table might not exist yet, log but don't fail
    console.warn(`[${workerId}] Could not update task status:`, error.message);
  }
}

/**
 * Start the worker
 */
async function start() {
  try {
    // Connect to RabbitMQ
    await queue.connect();

    // Start consuming tasks
    await queue.consume(QUEUES.ASYNC_TASKS, handleTask, {
      prefetch: 5, // Process up to 5 tasks concurrently
    });

    console.log(`Task Worker [${workerId}] is now consuming from ${QUEUES.ASYNC_TASKS}`);
    console.log(`Environment: ${config.env}`);
  } catch (error) {
    console.error(`[${workerId}] Failed to start:`, error.message);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log(`[${workerId}] Shutting down...`);
  await queue.close();
  await db.closePool();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the worker
start();
