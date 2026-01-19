import { Router } from 'express';
import createRouter from './create.js';
import getRouter from './get.js';
import statusRouter from './status.js';
import restaurantRouter from './restaurant.js';

const router = Router();

// Order creation - POST /orders
router.use('/', createRouter);

// Restaurant orders - GET /orders/restaurant/:restaurantId
// Must be before get router to avoid conflict with /:id route
router.use('/', restaurantRouter);

// Order status updates - PATCH /orders/:id/status
router.use('/', statusRouter);

// Order retrieval - GET /orders and GET /orders/:id
router.use('/', getRouter);

export default router;
