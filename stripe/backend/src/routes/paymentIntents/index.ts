/**
 * Payment Intents Router
 * @module paymentIntents
 *
 * @description This module combines all payment intent handlers into a single Express router.
 * It provides a complete API for managing the payment intent lifecycle.
 *
 * Endpoints:
 *   POST   /v1/payment_intents           - Create a payment intent
 *   GET    /v1/payment_intents           - List payment intents
 *   GET    /v1/payment_intents/:id       - Get a payment intent
 *   POST   /v1/payment_intents/:id       - Update a payment intent
 *   POST   /v1/payment_intents/:id/confirm  - Confirm a payment intent
 *   POST   /v1/payment_intents/:id/capture  - Capture a payment intent
 *   POST   /v1/payment_intents/:id/cancel   - Cancel a payment intent
 */

import { Router } from 'express';
import { authenticateApiKey } from '../../middleware/auth.js';
import { idempotencyMiddleware } from '../../middleware/idempotency.js';

// Import handlers
import { createPaymentIntent } from './create.js';
import { getPaymentIntent, listPaymentIntents } from './retrieve.js';
import { confirmPaymentIntent } from './confirm.js';
import { capturePaymentIntent } from './capture.js';
import { cancelPaymentIntent } from './cancel.js';
import { updatePaymentIntent } from './update.js';

const router = Router();

// All routes require authentication
router.use(authenticateApiKey);

// Create a payment intent
router.post('/', idempotencyMiddleware, createPaymentIntent);

// List payment intents
router.get('/', listPaymentIntents);

// Get a payment intent
router.get('/:id', getPaymentIntent);

// Update a payment intent
router.post('/:id', updatePaymentIntent);

// Confirm a payment intent
router.post('/:id/confirm', idempotencyMiddleware, confirmPaymentIntent);

// Capture a payment intent
router.post('/:id/capture', idempotencyMiddleware, capturePaymentIntent);

// Cancel a payment intent
router.post('/:id/cancel', cancelPaymentIntent);

export default router;

// Re-export types for external use
export * from './types.js';
export * from './utils.js';
