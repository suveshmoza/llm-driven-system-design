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
