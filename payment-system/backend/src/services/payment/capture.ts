/**
 * Payment capture module.
 * Handles capturing authorized payments and recording ledger entries.
 */

import { withTransaction } from '../../db/connection.js';
import {
  logger,
  paymentTransactionsTotal,
  paymentProcessingDuration,
  auditPaymentCaptured,
  publishWebhook,
} from '../../shared/index.js';
import { LedgerService } from '../ledger.service.js';
import { MerchantService } from '../merchant.service.js';
import { validateForCapture } from './validation.js';
import type { Transaction, ClientInfo, PoolClient } from './types.js';

// Service instances
const ledgerService = new LedgerService();
const merchantService = new MerchantService();

/**
 * Captures funds from an authorized payment, making them available for settlement.
 * Records double-entry ledger entries for the captured amount and platform fee.
 * Publishes a webhook event to notify the merchant of the capture.
 *
 * IDEMPOTENCY: Capture operations use transaction-level idempotency.
 * Capturing an already-captured transaction returns the existing state.
 *
 * @param transactionId - UUID of the authorized transaction to capture
 * @param merchantAccountId - UUID of the merchant's ledger account
 * @param transaction - Transaction object (pre-fetched)
 * @param getTransactionFn - Function to fetch the transaction
 * @param clientInfo - Optional client info for audit logging
 * @returns Updated transaction with 'captured' status
 * @throws Error if transaction not found or not in 'authorized' status
 */
export async function capturePayment(
  transactionId: string,
  merchantAccountId: string,
  transaction: Transaction,
  getTransactionFn: (id: string) => Promise<Transaction | null>,
  clientInfo?: ClientInfo
): Promise<Transaction> {
  const startTime = Date.now();

  // Validate transaction state
  const validation = validateForCapture(transaction);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  // If already captured, return current state (idempotent)
  if (transaction.status === 'captured') {
    logger.info({ transactionId }, 'Transaction already captured, returning current state');
    return transaction;
  }

  // Create ledger entries within a transaction
  await withTransaction(async (client: PoolClient) => {
    // Record the double-entry bookkeeping
    await ledgerService.recordPaymentCapture(
      client,
      transactionId,
      merchantAccountId,
      transaction.amount,
      transaction.fee_amount,
      transaction.currency
    );

    // Update transaction status
    await client.query(
      `UPDATE transactions
       SET status = 'captured', captured_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $1`,
      [transactionId]
    );
  });

  // Audit log: payment captured
  await auditPaymentCaptured(
    transactionId,
    transaction.merchant_id,
    transaction.amount,
    clientInfo?.ipAddress,
    clientInfo?.userAgent
  );

  // Record metrics
  const duration = (Date.now() - startTime) / 1000;
  paymentProcessingDuration.labels('capture', 'captured').observe(duration);
  paymentTransactionsTotal.labels('captured', transaction.currency).inc();

  // Publish webhook to notify merchant of successful capture
  await publishMerchantWebhook(
    transaction.merchant_id,
    'payment.captured',
    {
      transaction_id: transactionId,
      amount: transaction.amount,
      currency: transaction.currency,
      fee_amount: transaction.fee_amount,
      net_amount: transaction.net_amount,
      captured_at: new Date().toISOString(),
    }
  );

  return (await getTransactionFn(transactionId))!;
}

/**
 * Publishes a webhook event to notify the merchant of a payment event.
 * Uses RabbitMQ for reliable delivery with retries.
 *
 * @param merchantId - UUID of the merchant to notify
 * @param eventType - Type of webhook event (e.g., 'payment.captured')
 * @param data - Event payload data
 */
async function publishMerchantWebhook(
  merchantId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    // Get merchant's webhook configuration
    const merchant = await merchantService.getMerchant(merchantId);

    if (!merchant?.webhook_url) {
      logger.debug(
        { merchantId, eventType },
        'Merchant has no webhook URL configured, skipping webhook'
      );
      return;
    }

    await publishWebhook(
      eventType,
      merchantId,
      data,
      merchant.webhook_url,
      merchant.webhook_secret
    );

    logger.debug(
      { merchantId, eventType },
      'Published webhook event to queue'
    );
  } catch (error) {
    // Log but don't fail the operation if webhook publish fails
    logger.error(
      { error, merchantId, eventType },
      'Failed to publish webhook to queue'
    );
  }
}

// Export for use by other modules
export { publishMerchantWebhook };
