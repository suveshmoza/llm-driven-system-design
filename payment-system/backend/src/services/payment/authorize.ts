/**
 * Payment authorization module.
 * Handles the creation and authorization of new payment transactions.
 */

import {
  logger,
  withIdempotency,
  paymentTransactionsTotal,
  paymentProcessingDuration,
  paymentAmountHistogram,
  fraudScoreHistogram,
  fraudDecisionsTotal,
  auditPaymentCreated,
  auditPaymentAuthorized,
  auditPaymentFailed,
} from '../../shared/index.js';
import { FraudService } from '../fraud.service.js';
import { calculateFee } from './validation.js';
import { authorizeWithProcessor } from './processor.js';
import {
  createTransactionRecord,
  updateTransactionStatus,
  publishAsyncFraudCheck,
  generateTransactionId,
} from './transaction.js';
import type {
  Transaction,
  CreatePaymentRequest,
  CreatePaymentResponse,
  ClientInfo,
} from './types.js';

const fraudService = new FraudService();

/**
 * Creates a new payment with idempotency support.
 *
 * @description Entry point for creating a new payment transaction. Wraps the core
 * payment processing logic with idempotency protection to prevent duplicate charges
 * when clients retry failed network requests. Cached responses are returned for
 * duplicate idempotency keys.
 *
 * @param merchantId - UUID of the merchant creating the payment
 * @param merchantAccountId - UUID of the merchant's ledger account for settlements
 * @param request - Payment request containing amount, currency, payment method, etc.
 * @param clientInfo - Optional client info for audit logging (IP, user agent)
 * @param capturePaymentFn - Function to capture the payment if capture=true
 * @returns Payment response with transaction ID, status, amounts, and timestamps
 *
 * @example
 * const response = await createPayment(
 *   'merchant_123',
 *   'acct_xyz789',
 *   {
 *     amount: 10000,
 *     currency: 'USD',
 *     payment_method: { type: 'card', last_four: '4242', card_brand: 'visa' },
 *     idempotency_key: 'order-12345',
 *     capture: true
 *   },
 *   { ipAddress: '192.168.1.1' },
 *   capturePaymentFn
 * );
 */
export async function createPayment(
  merchantId: string,
  merchantAccountId: string,
  request: CreatePaymentRequest,
  clientInfo: ClientInfo | undefined,
  capturePaymentFn: (id: string, acctId: string, info?: ClientInfo) => Promise<Transaction>
): Promise<CreatePaymentResponse> {
  const startTime = Date.now();

  const { result, fromCache } = await withIdempotency<CreatePaymentResponse>(
    'payment',
    merchantId,
    request.idempotency_key,
    () => processPayment(merchantId, merchantAccountId, request, clientInfo, capturePaymentFn)
  );

  const duration = (Date.now() - startTime) / 1000;
  paymentProcessingDuration.labels('create', result.status).observe(duration);

  if (fromCache) {
    logger.info(
      { merchantId, idempotencyKey: request.idempotency_key, transactionId: result.id },
      'Returned cached payment response'
    );
  }

  return result;
}

/**
 * Core payment processing logic.
 *
 * @description Executes the full payment flow:
 * 1. Calculates fees and generates transaction ID
 * 2. Creates transaction record in database
 * 3. Runs synchronous fraud scoring
 * 4. Authorizes with payment processor
 * 5. Optionally captures if capture=true
 * 6. Publishes async fraud check for deep analysis
 *
 * @param merchantId - UUID of the merchant
 * @param merchantAccountId - UUID of merchant's ledger account
 * @param request - Payment request details
 * @param clientInfo - Optional client info for audit
 * @param capturePaymentFn - Function to capture if auto-capture enabled
 * @returns Payment response with final status
 */
async function processPayment(
  merchantId: string,
  merchantAccountId: string,
  request: CreatePaymentRequest,
  clientInfo: ClientInfo | undefined,
  capturePaymentFn: (id: string, acctId: string, info?: ClientInfo) => Promise<Transaction>
): Promise<CreatePaymentResponse> {
  const { amount, currency, payment_method, customer_email, capture = true } = request;
  const { feeAmount, netAmount } = calculateFee(amount);
  const transactionId = generateTransactionId();

  paymentAmountHistogram.labels(currency).observe(amount);

  const transaction = await createTransactionRecord(
    transactionId, merchantId, request, feeAmount, netAmount
  );

  await auditPaymentCreated(
    transactionId, merchantId, amount, currency,
    clientInfo?.ipAddress, clientInfo?.userAgent
  );

  // Fraud check
  const riskScore = await fraudService.evaluate({
    amount, currency, payment_method, merchantId, customerEmail: customer_email,
  });

  fraudScoreHistogram.labels(riskScore > 90 ? 'decline' : 'approve').observe(riskScore);

  // High fraud score - decline
  if (riskScore > 90) {
    return handleFraudDecline(transactionId, merchantId, transaction, riskScore, clientInfo);
  }

  fraudDecisionsTotal.labels('approve').inc();

  // Processor authorization
  const authResult = await authorizeWithProcessor(amount, payment_method);

  if (!authResult.success) {
    return handleProcessorDecline(
      transactionId, merchantId, transaction, riskScore,
      authResult.declineReason || 'Processor declined', clientInfo
    );
  }

  // Success - update to authorized
  await updateTransactionStatus(transactionId, 'authorized', {
    risk_score: riskScore,
    processor_ref: authResult.processorRef,
  });

  await auditPaymentAuthorized(
    transactionId, merchantId, authResult.processorRef!,
    clientInfo?.ipAddress, clientInfo?.userAgent
  );

  paymentTransactionsTotal.labels('authorized', currency).inc();

  // Async fraud check for deep analysis
  publishAsyncFraudCheck(
    transactionId, merchantId, amount, currency, payment_method,
    customer_email, clientInfo?.ipAddress
  );

  // Capture if requested
  if (capture) {
    await capturePaymentFn(transactionId, merchantAccountId, clientInfo);
    return buildResponse(transactionId, 'captured', transaction, feeAmount, netAmount);
  }

  return buildResponse(transactionId, 'authorized', transaction, feeAmount, netAmount);
}

/**
 * Handles payment decline due to high fraud risk score.
 *
 * @description Updates transaction to 'failed' status, records audit log,
 * and increments fraud decline metrics.
 *
 * @param transactionId - UUID of the transaction
 * @param merchantId - UUID of the merchant
 * @param transaction - Transaction object
 * @param riskScore - Fraud risk score (0-100)
 * @param clientInfo - Optional client info for audit
 * @returns Failed payment response
 */
async function handleFraudDecline(
  transactionId: string,
  merchantId: string,
  transaction: Transaction,
  riskScore: number,
  clientInfo?: ClientInfo
): Promise<CreatePaymentResponse> {
  fraudDecisionsTotal.labels('decline').inc();
  await updateTransactionStatus(transactionId, 'failed', { risk_score: riskScore });
  await auditPaymentFailed(
    transactionId, merchantId, 'High fraud risk score',
    clientInfo?.ipAddress, clientInfo?.userAgent
  );
  paymentTransactionsTotal.labels('failed', transaction.currency).inc();
  return buildResponse(transactionId, 'failed', transaction, transaction.fee_amount, transaction.net_amount);
}

/**
 * Handles payment decline from the payment processor.
 *
 * @description Updates transaction to 'failed' status with the processor's
 * decline reason, records audit log, and increments failure metrics.
 *
 * @param transactionId - UUID of the transaction
 * @param merchantId - UUID of the merchant
 * @param transaction - Transaction object
 * @param riskScore - Fraud risk score (for record keeping)
 * @param reason - Decline reason from processor
 * @param clientInfo - Optional client info for audit
 * @returns Failed payment response
 */
async function handleProcessorDecline(
  transactionId: string,
  merchantId: string,
  transaction: Transaction,
  riskScore: number,
  reason: string,
  clientInfo?: ClientInfo
): Promise<CreatePaymentResponse> {
  await updateTransactionStatus(transactionId, 'failed', { risk_score: riskScore });
  await auditPaymentFailed(transactionId, merchantId, reason, clientInfo?.ipAddress, clientInfo?.userAgent);
  paymentTransactionsTotal.labels('failed', transaction.currency).inc();
  return buildResponse(transactionId, 'failed', transaction, transaction.fee_amount, transaction.net_amount);
}

/**
 * Builds a standardized payment response object.
 *
 * @description Constructs the CreatePaymentResponse object returned to clients.
 * Extracts relevant fields from the transaction and includes calculated amounts.
 *
 * @param id - Transaction UUID
 * @param status - Final transaction status
 * @param transaction - Transaction object for amount/currency
 * @param fee_amount - Calculated fee amount in cents
 * @param net_amount - Net amount for merchant in cents
 * @returns Standardized payment response
 */
function buildResponse(
  id: string,
  status: CreatePaymentResponse['status'],
  transaction: Transaction,
  fee_amount: number,
  net_amount: number
): CreatePaymentResponse {
  return {
    id,
    status,
    amount: transaction.amount,
    currency: transaction.currency,
    fee_amount,
    net_amount,
    created_at: transaction.created_at,
  };
}

// Re-export for other modules
export { updateTransactionStatus } from './transaction.js';
