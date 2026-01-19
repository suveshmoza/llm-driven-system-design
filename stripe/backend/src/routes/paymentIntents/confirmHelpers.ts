/**
 * Helper functions for confirm payment intent handler
 * Handles different confirmation outcomes: blocked, review, declined, automatic capture, manual capture
 */

import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../../db/pool.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { createChargeEntries, calculateFee } from '../../services/ledger.js';
import { sendWebhook } from '../../services/webhooks.js';
import logger from '../../shared/logger.js';
import { auditLogger, PaymentIntentRow as AuditPaymentIntentRow } from '../../shared/audit.js';
import { activePaymentIntents, fraudBlockedTotal } from '../../shared/metrics.js';
import type { PoolClient } from 'pg';
import type { PaymentIntentRow } from './types.js';
import { formatPaymentIntent, getDeclineMessage } from './utils.js';

/**
 * Handle blocked payment due to high fraud risk
 */
export async function handleBlockedPayment(
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

/**
 * Handle payment requiring 3DS review
 */
export async function handleReviewPayment(
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

/**
 * Handle declined payment from card network
 */
export async function handleDeclinedPayment(
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
  await auditLogger.logPaymentIntentFailed(
    intent as AuditPaymentIntentRow,
    authResult.declineCode || 'card_declined',
    {
      ipAddress: req.ip,
      traceId: req.headers['x-trace-id'] as string,
    }
  );

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

/**
 * Handle automatic capture - create charge and ledger entries immediately
 */
export async function handleAutomaticCapture(
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

/**
 * Handle manual capture - just authorize, capture later
 */
export async function handleManualCapture(
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
