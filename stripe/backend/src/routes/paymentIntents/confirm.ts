/**
 * Confirm payment intent handler
 * POST /v1/payment_intents/:id/confirm
 */

import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../../db/pool.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { assessRisk } from '../../services/fraud.js';
import { createChargeEntries, calculateFee } from '../../services/ledger.js';
import { authorize, AuthorizeParams } from '../../services/cardNetwork.js';
import { sendWebhook } from '../../services/webhooks.js';
import logger from '../../shared/logger.js';
import { auditLogger, PaymentIntentRow as AuditPaymentIntentRow } from '../../shared/audit.js';
import { activePaymentIntents, fraudBlockedTotal, recordFraudCheck } from '../../shared/metrics.js';
import type { PoolClient } from 'pg';
import type {
  PaymentIntentRow,
  PaymentMethodRow,
  ConfirmPaymentIntentBody,
  CardNetworkError,
} from './types.js';
import { formatPaymentIntent, getDeclineMessage, CONFIRMABLE_STATUSES } from './utils.js';

export async function confirmPaymentIntent(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const startTime = process.hrtime();

  try {
    const { payment_method } = req.body as ConfirmPaymentIntentBody;

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
    if (!CONFIRMABLE_STATUSES.includes(intent.status)) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: `Cannot confirm payment intent in status: ${intent.status}`,
        },
      });
      return;
    }

    // Get payment method
    const paymentMethodId = payment_method || intent.payment_method_id;

    if (!paymentMethodId) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Payment method is required',
          param: 'payment_method',
        },
      });
      return;
    }

    const pmResult = await query<PaymentMethodRow>(
      `
      SELECT * FROM payment_methods
      WHERE id = $1 AND merchant_id = $2
    `,
      [paymentMethodId, req.merchantId]
    );

    if (pmResult.rows.length === 0) {
      res.status(400).json({
        error: {
          type: 'invalid_request_error',
          message: 'Payment method not found',
          param: 'payment_method',
        },
      });
      return;
    }

    const paymentMethod = pmResult.rows[0];

    // Assess fraud risk
    const riskResult = await assessRisk({
      paymentIntent: intent,
      paymentMethod,
      merchantId: req.merchantId!,
      ipAddress: req.ip,
    });

    // Record fraud metrics
    recordFraudCheck(riskResult.riskScore, riskResult.decision);

    // Audit log: Fraud check
    await auditLogger.logFraudCheck(
      intent.id,
      riskResult.riskScore,
      riskResult.decision,
      riskResult.signals.map((s) => s.rule),
      {
        ipAddress: req.ip,
        traceId: req.headers['x-trace-id'] as string,
      }
    );

    // Block high-risk payments
    if (riskResult.decision === 'block') {
      await handleBlockedPayment(req, res, intent, previousStatus, riskResult);
      return;
    }

    // Require 3DS for review decisions
    if (riskResult.decision === 'review') {
      await handleReviewPayment(req, res, intent, previousStatus, paymentMethodId, riskResult);
      return;
    }

    // Authorize with card network (protected by circuit breaker)
    const authParams: AuthorizeParams = {
      amount: intent.amount,
      currency: intent.currency,
      cardToken: paymentMethod.card_token,
      merchantId: req.merchantId!,
    };
    const authResult = await authorize(authParams);

    if (!authResult.approved) {
      await handleDeclinedPayment(req, res, intent, previousStatus, paymentMethodId, authResult);
      return;
    }

    // Process successful authorization
    if (intent.capture_method === 'automatic') {
      await handleAutomaticCapture(
        req,
        res,
        intent,
        previousStatus,
        paymentMethodId,
        authResult,
        startTime
      );
    } else {
      await handleManualCapture(req, res, intent, previousStatus, paymentMethodId, authResult);
    }
  } catch (error) {
    const err = error as CardNetworkError;
    // Check for circuit breaker errors
    if (err.name === 'CardNetworkUnavailableError') {
      logger.warn({
        event: 'payment_processor_unavailable',
        intent_id: req.params.id,
        error_message: err.message,
      });

      res.status(503).json({
        error: {
          type: 'api_error',
          code: 'payment_processor_unavailable',
          message: 'Payment processor is temporarily unavailable. Please try again.',
        },
      });
      return;
    }

    logger.error({
      event: 'payment_intent_confirm_error',
      intent_id: req.params.id,
      error_message: err.message,
    });

    res.status(500).json({
      error: {
        type: 'api_error',
        message: 'Failed to confirm payment intent',
      },
    });
  }
}

// Helper functions for different confirmation outcomes

async function handleBlockedPayment(
  req: AuthenticatedRequest,
  res: Response,
  intent: PaymentIntentRow,
  previousStatus: string,
  riskResult: { riskScore: number; decision: string }
): Promise<void> {
  await query(
    `
    UPDATE payment_intents
    SET status = 'failed', decline_code = 'fraudulent', error_message = $2
    WHERE id = $1
  `,
    [intent.id, 'Transaction blocked due to high fraud risk']
  );

  // Update metrics
  activePaymentIntents.dec({ status: previousStatus });
  activePaymentIntents.inc({ status: 'failed' });
  fraudBlockedTotal.inc({ rule: 'aggregate', risk_level: 'high' });

  // Audit log: Payment blocked
  await auditLogger.logPaymentIntentFailed(intent as AuditPaymentIntentRow, 'fraudulent', {
    ipAddress: req.ip,
    traceId: req.headers['x-trace-id'] as string,
    metadata: { fraud_score: riskResult.riskScore },
  });

  logger.warn({
    event: 'payment_blocked_fraud',
    intent_id: intent.id,
    risk_score: riskResult.riskScore,
  });

  res.status(402).json({
    error: {
      type: 'card_error',
      code: 'fraudulent',
      message: 'Transaction blocked due to suspected fraud',
      decline_code: 'fraudulent',
    },
  });
}

async function handleReviewPayment(
  req: AuthenticatedRequest,
  res: Response,
  intent: PaymentIntentRow,
  previousStatus: string,
  paymentMethodId: string,
  riskResult: { riskScore: number }
): Promise<void> {
  await query(
    `
    UPDATE payment_intents
    SET status = 'requires_action', payment_method_id = $2
    WHERE id = $1
  `,
    [intent.id, paymentMethodId]
  );

  activePaymentIntents.dec({ status: previousStatus });
  activePaymentIntents.inc({ status: 'requires_action' });

  const updatedIntent = await query<PaymentIntentRow>(
    `SELECT * FROM payment_intents WHERE id = $1`,
    [intent.id]
  );
  const formatted = formatPaymentIntent(updatedIntent.rows[0]);
  formatted.next_action = {
    type: 'redirect_to_3ds',
    redirect_url: `http://localhost:3001/v1/payment_intents/${intent.id}/3ds`,
  };

  logger.info({
    event: 'payment_requires_3ds',
    intent_id: intent.id,
    risk_score: riskResult.riskScore,
  });

  res.json(formatted);
}

async function handleDeclinedPayment(
  req: AuthenticatedRequest,
  res: Response,
  intent: PaymentIntentRow,
  previousStatus: string,
  paymentMethodId: string,
  authResult: { declineCode?: string }
): Promise<void> {
  await query(
    `
    UPDATE payment_intents
    SET status = 'failed', decline_code = $2, payment_method_id = $3
    WHERE id = $1
  `,
    [intent.id, authResult.declineCode, paymentMethodId]
  );

  // Update metrics
  activePaymentIntents.dec({ status: previousStatus });
  activePaymentIntents.inc({ status: 'failed' });

  // Audit log: Payment failed
  await auditLogger.logPaymentIntentFailed(intent as AuditPaymentIntentRow, authResult.declineCode || 'card_declined', {
    ipAddress: req.ip,
    traceId: req.headers['x-trace-id'] as string,
  });

  // Send webhook
  await sendWebhook(req.merchantId!, 'payment_intent.payment_failed', {
    id: intent.id,
    decline_code: authResult.declineCode,
  });

  logger.info({
    event: 'payment_declined',
    intent_id: intent.id,
    decline_code: authResult.declineCode,
  });

  res.status(402).json({
    error: {
      type: 'card_error',
      code: authResult.declineCode,
      message: getDeclineMessage(authResult.declineCode || 'card_declined'),
      decline_code: authResult.declineCode,
    },
  });
}

async function handleAutomaticCapture(
  req: AuthenticatedRequest,
  res: Response,
  intent: PaymentIntentRow,
  previousStatus: string,
  paymentMethodId: string,
  authResult: { authCode?: string },
  startTime: [number, number]
): Promise<void> {
  // Automatic capture - create charge and ledger entries
  const result = await transaction(async (client: PoolClient) => {
    // Update intent to succeeded
    await client.query(
      `
      UPDATE payment_intents
      SET status = 'succeeded', auth_code = $2, payment_method_id = $3
      WHERE id = $1
    `,
      [intent.id, authResult.authCode, paymentMethodId]
    );

    // Create charge
    const fee = calculateFee(intent.amount);
    const chargeId = uuidv4();

    await client.query(
      `
      INSERT INTO charges
        (id, payment_intent_id, merchant_id, amount, currency, status, payment_method_id, fee, net)
      VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, $8)
    `,
      [
        chargeId,
        intent.id,
        req.merchantId,
        intent.amount,
        intent.currency,
        paymentMethodId,
        fee,
        intent.amount - fee,
      ]
    );

    // Create ledger entries
    await createChargeEntries(client, {
      chargeId,
      paymentIntentId: intent.id,
      amount: intent.amount,
      merchantId: req.merchantId!,
    });

    return { chargeId, fee };
  });

  // Update metrics
  activePaymentIntents.dec({ status: previousStatus });
  activePaymentIntents.inc({ status: 'succeeded' });

  // Audit log: Payment confirmed and succeeded
  await auditLogger.logPaymentIntentConfirmed(
    {
      ...intent,
      status: 'succeeded',
      auth_code: authResult.authCode,
      payment_method_id: paymentMethodId,
    } as AuditPaymentIntentRow,
    previousStatus,
    {
      ipAddress: req.ip,
      traceId: req.headers['x-trace-id'] as string,
      metadata: { charge_id: result.chargeId, fee: result.fee },
    }
  );

  // Send webhook
  await sendWebhook(req.merchantId!, 'payment_intent.succeeded', {
    id: intent.id,
    amount: intent.amount,
    currency: intent.currency,
  });

  const [s, ns] = process.hrtime(startTime);
  logger.info({
    event: 'payment_succeeded',
    intent_id: intent.id,
    amount: intent.amount,
    currency: intent.currency,
    charge_id: result.chargeId,
    duration_ms: (s * 1000 + ns / 1e6).toFixed(2),
  });

  // Get updated intent
  const updatedResult = await query<PaymentIntentRow>(
    `SELECT * FROM payment_intents WHERE id = $1`,
    [intent.id]
  );
  const paymentIntent = formatPaymentIntent(updatedResult.rows[0]);

  res.json(paymentIntent);
}

async function handleManualCapture(
  req: AuthenticatedRequest,
  res: Response,
  intent: PaymentIntentRow,
  previousStatus: string,
  paymentMethodId: string,
  authResult: { authCode?: string }
): Promise<void> {
  // Manual capture - just update to requires_capture
  await query(
    `
    UPDATE payment_intents
    SET status = 'requires_capture', auth_code = $2, payment_method_id = $3
    WHERE id = $1
  `,
    [intent.id, authResult.authCode, paymentMethodId]
  );

  activePaymentIntents.dec({ status: previousStatus });
  activePaymentIntents.inc({ status: 'requires_capture' });

  logger.info({
    event: 'payment_authorized',
    intent_id: intent.id,
    amount: intent.amount,
    status: 'requires_capture',
  });

  // Get updated intent
  const updatedResult = await query<PaymentIntentRow>(
    `SELECT * FROM payment_intents WHERE id = $1`,
    [intent.id]
  );
  const paymentIntent = formatPaymentIntent(updatedResult.rows[0]);

  res.json(paymentIntent);
}
