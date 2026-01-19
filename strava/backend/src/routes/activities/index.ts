/**
 * @fileoverview Activities router aggregator.
 * Combines all activity-related sub-routers into a single router for mounting at /activities.
 * @module routes/activities
 */

import { Router } from 'express';
import uploadRouter from './upload.js';
import simulateRouter from './simulate.js';
import getRouter from './get.js';
import updateRouter from './update.js';
import analysisRouter from './analysis.js';
import syncRouter from './sync.js';

/**
 * @description Main activities router that aggregates all activity-related endpoints.
 * Mount this router at /activities to expose the complete activity API.
 *
 * Included routes:
 * - POST /upload - Upload activity from GPX file
 * - POST /simulate - Create simulated activity for testing
 * - GET / - List activities (paginated)
 * - GET /:id - Get single activity
 * - GET /:id/gps - Get GPS points for activity
 * - GET /:id/comments - Get comments for activity
 * - POST /:id/kudos - Give kudos to activity
 * - DELETE /:id/kudos - Remove kudos from activity
 * - POST /:id/comments - Add comment to activity
 * - DELETE /:id - Delete activity (owner only)
 * - GET /:id/analysis - Get activity analysis (stats, zones)
 * - POST /sync/:service - Initiate sync with external service
 * - GET /sync/status - Get sync status
 * - DELETE /sync/:service - Disconnect external service
 */
const router = Router();

// Mount upload routes (POST /upload)
router.use('/', uploadRouter);

// Mount simulate routes (POST /simulate)
router.use('/', simulateRouter);

// Mount get routes (GET /, GET /:id, GET /:id/gps, GET /:id/comments)
router.use('/', getRouter);

// Mount update routes (POST /:id/kudos, DELETE /:id/kudos, POST /:id/comments, DELETE /:id)
router.use('/', updateRouter);

// Mount analysis routes (GET /:id/analysis)
router.use('/', analysisRouter);

// Mount sync routes (POST /sync/:service, GET /sync/status, DELETE /sync/:service)
router.use('/', syncRouter);

export default router;
