/**
 * Cancel payment intent handler
 * POST /v1/payment_intents/:id/cancel
 */

import { Response } from 'express';
import { query } from '../../db/pool.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { sendWebhook } from '../../services/webhooks.js';
import logger from '../../shared/logger.js';
import { activePaymentIntents } from '../../shared/metrics.js';
import type { PaymentIntentRow, CancelPaymentIntentBody } from './types.js';
import { formatPaymentIntent, CANCELABLE_STATUSES } from './utils.js';

export async function cancelPaymentIntent(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { cancellation_reason } = req.body as CancelPaymentIntentBody;

    // Get payment intent
    const intentResult = await query<PaymentIntentRow>(
      `
      SELECT * FROM payment_intents
      WHERE id = $1 AND merchant_id = $2
    `,
      [req.params.id, req.merchantId]
    );

    if (intentResult.rows.length === 0) {
      res.status(404).json({
        error: {
          type: 'invalid_request_error',
          message: 'Payment intent not found',
        },
      });
      return;
    }

    const intent = intentResult.rows[0];
    const previousStatus = intent.status;

    // Validate state
    if (!CANCELABLE_STATUSES.includes(intent.status)) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: `Cannot cancel payment intent in status: ${intent.status}`,
        },
      });
      return;
    }

    // Update intent
    await query(
      `
      UPDATE payment_intents
      SET status = 'canceled', metadata = metadata || $2
      WHERE id = $1
    `,
      [intent.id, JSON.stringify({ cancellation_reason: cancellation_reason || 'requested' })]
    );

    // Update metrics
    activePaymentIntents.dec({ status: previousStatus });
    activePaymentIntents.inc({ status: 'canceled' });

    // Send webhook
    await sendWebhook(req.merchantId!, 'payment_intent.canceled', {
      id: intent.id,
      cancellation_reason,
    });

    logger.info({
      event: 'payment_canceled',
      intent_id: intent.id,
      previous_status: previousStatus,
      reason: cancellation_reason,
    });

    // Get updated intent
    const updatedResult = await query<PaymentIntentRow>(
      `SELECT * FROM payment_intents WHERE id = $1`,
      [intent.id]
    );
    res.json(formatPaymentIntent(updatedResult.rows[0]));
  } catch (error) {
    const err = error as Error;
    logger.error({
      event: 'payment_intent_cancel_error',
      intent_id: req.params.id,
      error_message: err.message,
    });
    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to cancel payment intent',
      },
    });
  }
}
