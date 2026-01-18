import pool from '../db/pool.js';
import redis from '../db/redis.js';
import {
  consumeLocationReports,
  publishNotification,
  LocationReportMessage,
  closeConnection,
} from '../shared/queue.js';
import {
  createComponentLogger,
  cacheService,
  locationReportsTotal,
  dbQueryDuration,
} from '../shared/index.js';
import { KeyManager } from '../utils/crypto.js';

/**
 * Location Report Worker
 *
 * Consumes location reports from RabbitMQ and processes them asynchronously.
 * This decouples the ingestion of location reports from the processing,
 * allowing the API to respond quickly to finder devices while ensuring
 * reliable processing.
 *
 * RESPONSIBILITIES:
 * 1. Store encrypted location reports in PostgreSQL
 * 2. Check if the reported device is in lost mode
 * 3. Trigger notifications for found devices
 * 4. Invalidate relevant caches
 *
 * RELIABILITY:
 * - Manual acknowledgment ensures no message loss
 * - Failed messages are not requeued (logged for investigation)
 * - Graceful shutdown on SIGINT/SIGTERM
 */

const log = createComponentLogger('location-worker');

/**
 * Process a single location report message.
 * Stores the report and checks for lost mode notifications.
 */
async function processLocationReport(
  data: LocationReportMessage,
  ack: () => void,
  nack: (requeue?: boolean) => void
): Promise<void> {
  const { identifier_hash, encrypted_payload, reporter_region, received_at } = data;

  log.debug(
    { identifierHash: identifier_hash, region: reporter_region },
    'Processing location report'
  );

  const timer = dbQueryDuration.startTimer({ operation: 'insert', table: 'location_reports' });

  try {
    // Store the encrypted location report
    const result = await pool.query(
      `INSERT INTO location_reports (identifier_hash, encrypted_payload, reporter_region)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [identifier_hash, encrypted_payload, reporter_region]
    );
    timer();

    const reportId = result.rows[0].id;

    // Invalidate any cached location data for this identifier
    await cacheService.invalidateByIdentifierHash(identifier_hash);

    // Check if this device is in lost mode and notify owner
    await checkLostModeAndNotify(identifier_hash);

    log.info(
      {
        reportId,
        identifierHash: identifier_hash,
        region: reporter_region,
        processingTime: Date.now() - received_at,
      },
      'Location report processed successfully'
    );

    locationReportsTotal.inc({ region: reporter_region || 'unknown', status: 'created' });

    // Acknowledge the message
    ack();
  } catch (error) {
    timer();
    log.error(
      { error, identifierHash: identifier_hash },
      'Failed to process location report'
    );

    locationReportsTotal.inc({ region: reporter_region || 'unknown', status: 'error' });

    // Don't requeue - log for investigation
    nack(false);
  }
}

/**
 * Check if a reported device is in lost mode and queue a notification.
 * Called automatically when a new location report is processed.
 */
async function checkLostModeAndNotify(identifierHash: string): Promise<void> {
  const timer = dbQueryDuration.startTimer({ operation: 'select', table: 'lost_mode' });

  try {
    // Find devices in lost mode with notifications enabled
    const devicesResult = await pool.query(
      `SELECT d.*, lm.enabled, lm.notify_when_found
       FROM registered_devices d
       JOIN lost_mode lm ON d.id = lm.device_id
       WHERE lm.enabled = true AND lm.notify_when_found = true`
    );
    timer();

    for (const device of devicesResult.rows) {
      const keyManager = new KeyManager(device.master_secret);
      const currentHash = keyManager.getCurrentIdentifierHash();

      if (currentHash === identifierHash) {
        // Device found! Queue notification
        log.info(
          { deviceId: device.id, deviceName: device.name },
          'Lost device found, queueing notification'
        );

        await publishNotification({
          user_id: device.user_id,
          device_id: device.id,
          type: 'device_found',
          title: `${device.name} has been found!`,
          message: `Your lost ${device.device_type} "${device.name}" was detected by the Find My network.`,
          data: { device_id: device.id, device_name: device.name },
          created_at: Date.now(),
        });
      }
    }
  } catch (error) {
    timer();
    log.error({ error, identifierHash }, 'Failed to check lost mode');
  }
}

/**
 * Graceful shutdown handler.
 * Ensures clean disconnect from RabbitMQ and database.
 */
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Received shutdown signal, closing connections');

  try {
    await closeConnection();
    await pool.end();
    await redis.quit();
    log.info('Connections closed, exiting');
    process.exit(0);
  } catch (error) {
    log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

/**
 * Main entry point for the location worker.
 */
async function main(): Promise<void> {
  log.info('Starting location report worker');

  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // Start consuming location reports
    await consumeLocationReports(processLocationReport);
    log.info('Location worker is running, waiting for messages...');
  } catch (error) {
    log.error({ error }, 'Failed to start location worker');
    process.exit(1);
  }
}

// Start the worker
main().catch((error) => {
  log.error({ error }, 'Unhandled error in location worker');
  process.exit(1);
});
