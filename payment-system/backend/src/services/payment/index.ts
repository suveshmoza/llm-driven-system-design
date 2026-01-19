/**
 * Core payment processing service.
 * Handles the full lifecycle of payments: creation, authorization, capture, and void.
 *
 * CRITICAL FEATURES:
 * - Idempotency: Prevents double-charging on network retries
 * - Circuit Breaker: Protects against payment processor outages
 * - Audit Logging: Required for PCI-DSS compliance
 * - Metrics: Enables fraud detection and SLO monitoring
 * - Async Webhooks: Notifies merchants of payment events via RabbitMQ
 */

import { query, queryOne } from '../../db/connection.js';
import type {
  Transaction,
  TransactionStatus,
  CreatePaymentRequest,
  CreatePaymentResponse,
  TransactionListParams,
  LedgerEntry,
  ClientInfo,
} from './types.js';
import { calculateFee, checkIdempotency, getDefaultFeeConfig } from './validation.js';
import { createPayment as createPaymentInternal } from './authorize.js';
import { capturePayment as capturePaymentInternal } from './capture.js';
import { voidPayment as voidPaymentInternal } from './refund.js';

/**
 * PaymentService class that provides the public API for payment operations.
 */
export class PaymentService {
  private feeConfig = getDefaultFeeConfig();

  /** Calculates the platform fee for a given transaction amount. */
  calculateFee(amount: number): number {
    return calculateFee(amount, this.feeConfig).feeAmount;
  }

  /** @deprecated Use withIdempotency from shared/idempotency.ts instead */
  async checkIdempotency(key: string): Promise<Transaction | null> {
    return checkIdempotency(key);
  }

  /** Creates a new payment transaction with fraud detection and optional capture. */
  async createPayment(
    merchantId: string,
    merchantAccountId: string,
    request: CreatePaymentRequest,
    clientInfo?: ClientInfo
  ): Promise<CreatePaymentResponse> {
    return createPaymentInternal(
      merchantId, merchantAccountId, request, clientInfo,
      (txId, acctId, info) => this.capturePayment(txId, acctId, info)
    );
  }

  /** Captures funds from an authorized payment. */
  async capturePayment(
    transactionId: string,
    merchantAccountId: string,
    clientInfo?: ClientInfo
  ): Promise<Transaction> {
    const transaction = await this.getTransaction(transactionId);
    if (!transaction) throw new Error('Transaction not found');
    return capturePaymentInternal(
      transactionId, merchantAccountId, transaction,
      (id) => this.getTransaction(id), clientInfo
    );
  }

  /** Cancels an authorized payment before capture. */
  async voidPayment(transactionId: string, clientInfo?: ClientInfo): Promise<Transaction> {
    const transaction = await this.getTransaction(transactionId);
    if (!transaction) throw new Error('Transaction not found');
    return voidPaymentInternal(
      transactionId, transaction, (id) => this.getTransaction(id), clientInfo
    );
  }

  /** Retrieves a single transaction by ID. */
  async getTransaction(id: string): Promise<Transaction | null> {
    return queryOne<Transaction>('SELECT * FROM transactions WHERE id = $1', [id]);
  }

  /** Retrieves a paginated list of transactions for a merchant. */
  async listTransactions(
    merchantId: string,
    params: TransactionListParams = {}
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const { limit = 50, offset = 0, status, from_date, to_date } = params;
    const queryParams: unknown[] = [merchantId];
    let whereClause = 'WHERE merchant_id = $1';
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND status = $${paramIdx++}`;
      queryParams.push(status);
    }
    if (from_date) {
      whereClause += ` AND created_at >= $${paramIdx++}`;
      queryParams.push(from_date);
    }
    if (to_date) {
      whereClause += ` AND created_at <= $${paramIdx++}`;
      queryParams.push(to_date);
    }

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM transactions ${whereClause}`, queryParams
    );
    const transactions = await query<Transaction>(
      `SELECT * FROM transactions ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...queryParams, limit, offset]
    );

    return { transactions, total: parseInt(countResult?.count || '0', 10) };
  }

  /** Retrieves all ledger entries for a transaction. */
  async getTransactionLedgerEntries(transactionId: string): Promise<LedgerEntry[]> {
    return query<LedgerEntry>(
      'SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY created_at',
      [transactionId]
    );
  }
}

// Re-export types
export type {
  Transaction, TransactionStatus, CreatePaymentRequest, CreatePaymentResponse,
  TransactionListParams, LedgerEntry, ClientInfo,
};

// Export submodule functions
export { calculateFee, checkIdempotency } from './validation.js';
export { authorizeWithProcessor } from './processor.js';
