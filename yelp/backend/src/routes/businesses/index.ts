import { Router } from 'express';
import { router as getRouter } from './get.js';
import { router as nearbyRouter } from './nearby.js';
import { router as createRouter } from './create.js';
import { router as updateRouter } from './update.js';
import { router as actionsRouter } from './actions.js';
import { router as reviewsRouter } from './reviews.js';

const router = Router();

// Mount all business route handlers
// Order matters: more specific routes should come first

// GET /nearby - Get nearby businesses (must come before /:idOrSlug)
router.use('/', nearbyRouter);

// GET routes for listing and single business retrieval
// GET / - List businesses with pagination
// GET /:idOrSlug - Get single business by ID or slug
router.use('/', getRouter);

// POST / - Create a new business
router.use('/', createRouter);

// PATCH /:id - Update a business
router.use('/', updateRouter);

// POST /:id/hours - Add/update business hours
// POST /:id/photos - Add business photo
// POST /:id/claim - Claim a business
router.use('/', actionsRouter);

// GET /:id/reviews - Get reviews for a business
router.use('/', reviewsRouter);

export default router;
