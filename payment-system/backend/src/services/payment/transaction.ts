/**
 * Transaction database operations module.
 * Handles low-level transaction creation and status updates.
 */

import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../db/connection.js';
import {
  logger,
  publishFraudCheck,
} from '../../shared/index.js';
import type {
  Transaction,
  TransactionStatus,
  CreatePaymentRequest,
  PoolClient,
} from './types.js';

/**
 * Creates a new transaction record in pending status.
 */
export async function createTransactionRecord(
  transactionId: string,
  merchantId: string,
  request: CreatePaymentRequest,
  feeAmount: number,
  netAmount: number
): Promise<Transaction> {
  const {
    amount,
    currency,
    payment_method,
    description,
    customer_email,
    idempotency_key,
    metadata = {},
  } = request;

  const transaction = await withTransaction(async (client: PoolClient) => {
    const result = await client.query<Transaction>(
      `INSERT INTO transactions (
        id, idempotency_key, merchant_id, amount, currency, status,
        payment_method, description, customer_email, fee_amount, net_amount, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        transactionId,
        idempotency_key,
        merchantId,
        amount,
        currency,
        'pending',
        JSON.stringify(payment_method),
        description,
        customer_email,
        feeAmount,
        netAmount,
        JSON.stringify(metadata),
      ]
    );
    return result.rows[0];
  });

  return transaction;
}

/**
 * Updates a transaction's status and any additional fields atomically.
 * Increments the version number for optimistic locking.
 */
export async function updateTransactionStatus(
  id: string,
  status: TransactionStatus,
  additionalFields: Record<string, unknown> = {}
): Promise<void> {
  const updates = ['status = $2', 'updated_at = NOW()', 'version = version + 1'];
  const params: unknown[] = [id, status];
  let paramIndex = 3;

  for (const [key, value] of Object.entries(additionalFields)) {
    updates.push(`${key} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

  await query(
    `UPDATE transactions SET ${updates.join(', ')} WHERE id = $1`,
    params
  );
}

/**
 * Publishes an async fraud check message to the fraud-scoring queue.
 * Fire and forget - does not block the payment flow.
 */
export function publishAsyncFraudCheck(
  transactionId: string,
  merchantId: string,
  amount: number,
  currency: string,
  paymentMethod: CreatePaymentRequest['payment_method'],
  customerEmail?: string,
  ipAddress?: string
): void {
  publishFraudCheck(transactionId, {
    merchantId,
    amount,
    currency,
    paymentMethod: {
      type: paymentMethod.type,
      last_four: paymentMethod.last_four,
      card_brand: paymentMethod.card_brand,
    },
    customerEmail,
    ipAddress,
  }).catch((error) => {
    logger.error(
      { error, transactionId, merchantId },
      'Failed to publish fraud check to queue'
    );
  });
}

/**
 * Generates a new transaction ID.
 */
export function generateTransactionId(): string {
  return uuidv4();
}
