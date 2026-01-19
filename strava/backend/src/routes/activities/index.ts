import { Router } from 'express';
import uploadRouter from './upload.js';
import simulateRouter from './simulate.js';
import getRouter from './get.js';
import updateRouter from './update.js';
import analysisRouter from './analysis.js';
import syncRouter from './sync.js';

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
