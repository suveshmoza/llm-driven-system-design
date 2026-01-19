import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { locationService } from '../services/locationService.js';
import { SimulatedLocation } from '../types/index.js';
import {
  publishLocationReport,
  createComponentLogger,
  locationReportsTotal as _locationReportsTotal,
} from '../shared/index.js';

/**
 * Location routes for retrieving and simulating device location reports.
 * All routes require authentication and are prefixed with /api/locations.
 */
const router = Router();
const log = createComponentLogger('locations-route');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/locations/:deviceId
 * Get decrypted location history for a device.
 * Supports optional query params: startTime, endTime, limit.
 */
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { startTime, endTime, limit } = req.query;

    const options: { startTime?: number; endTime?: number; limit?: number } = {};

    if (startTime) {
      options.startTime = parseInt(startTime as string);
    }
    if (endTime) {
      options.endTime = parseInt(endTime as string);
    }
    if (limit) {
      options.limit = parseInt(limit as string);
    }

    const locations = await locationService.getDeviceLocations(
      deviceId,
      req.session.userId!,
      options
    );

    res.json(locations);
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/locations/:deviceId/latest
 * Get only the most recent location for a device.
 */
router.get('/:deviceId/latest', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const location = await locationService.getLatestLocation(
      deviceId,
      req.session.userId!
    );

    if (!location) {
      return res.status(404).json({ error: 'No location found' });
    }

    res.json(location);
  } catch (error) {
    console.error('Get latest location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/locations/:deviceId/simulate
 * Simulate a location report for testing purposes.
 * Creates an encrypted report as if another device detected this tracker.
 */
router.post('/:deviceId/simulate', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const location: SimulatedLocation = req.body;

    if (!location.latitude || !location.longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const report = await locationService.simulateLocationReport(
      deviceId,
      req.session.userId!,
      location
    );

    if (!report) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.status(201).json({
      message: 'Location simulated successfully',
      report_id: report.id,
    });
  } catch (error) {
    console.error('Simulate location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/locations/report
 * Submit an encrypted location report from a finder device.
 * This endpoint simulates the crowd-sourced Find My network where
 * any device can report sightings of nearby trackers.
 *
 * ASYNC PROCESSING:
 * - Publishes the report to RabbitMQ for async processing
 * - Returns immediately to minimize latency for the reporting device
 * - Worker processes the report, stores it, and triggers notifications
 */
router.post('/report', async (req, res) => {
  try {
    const { identifier_hash, encrypted_payload, reporter_region } = req.body;

    if (!identifier_hash || !encrypted_payload) {
      return res.status(400).json({ error: 'Identifier hash and encrypted payload are required' });
    }

    // Publish to queue for async processing
    const published = await publishLocationReport({
      identifier_hash,
      encrypted_payload,
      reporter_region,
      received_at: Date.now(),
    });

    if (!published) {
      log.warn({ identifierHash: identifier_hash }, 'Queue backpressure, report buffered');
    }

    log.info(
      { identifierHash: identifier_hash, region: reporter_region },
      'Location report queued for processing'
    );

    // Return immediately - processing happens asynchronously
    res.status(202).json({
      message: 'Report accepted for processing',
      status: 'queued',
    });
  } catch (error) {
    log.error({ error }, 'Failed to queue location report');

    // Fallback to synchronous processing if queue is unavailable
    try {
      const { identifier_hash, encrypted_payload, reporter_region } = req.body;

      log.warn('Queue unavailable, falling back to synchronous processing');

      const report = await locationService.submitReport({
        identifier_hash,
        encrypted_payload,
        reporter_region,
      });

      res.status(201).json({
        message: 'Report submitted successfully',
        report_id: report.id,
      });
    } catch (fallbackError) {
      log.error({ error: fallbackError }, 'Fallback processing also failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
