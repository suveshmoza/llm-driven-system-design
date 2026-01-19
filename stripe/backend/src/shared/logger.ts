import pino, { Logger, LoggerOptions } from 'pino';
import crypto from 'crypto';
import type { Request } from 'express';

/**
 * Structured JSON Logger using Pino
 *
 * Provides consistent logging format across all services with:
 * - Request tracing via trace_id and span_id
 * - Structured fields for easy querying in log aggregation
 * - Privacy-aware IP hashing
 * - Log levels: trace, debug, info, warn, error, fatal
 */

const isDevelopment = process.env.NODE_ENV === 'development';

// Extend Request type to include custom properties
export interface ExtendedRequest extends Request {
  merchantId?: string;
  logger?: Logger;
  merchant?: {
    id: string;
    name: string;
    email: string;
    status: string;
    webhook_url: string | null;
    webhook_secret: string | null;
  };
}

// Log data interfaces
export interface PaymentRequestLogData {
  intentId?: string;
  id?: string;
  status?: string;
}

// Base logger configuration
const loggerConfig: LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  base: {
    service: 'stripe-payment-api',
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Use pino-pretty in development for readable logs
const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

const logger: Logger = pino(
  transport ? { ...loggerConfig, transport } : loggerConfig
);

/**
 * Generate a unique span ID for tracing
 */
export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Hash IP address for privacy compliance
 */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

/**
 * Create a child logger with request context
 */
export function createRequestLogger(req: ExtendedRequest): Logger {
  const traceId = (req.headers['x-trace-id'] as string) || crypto.randomBytes(16).toString('hex');
  const spanId = generateSpanId();

  return logger.child({
    trace_id: traceId,
    span_id: spanId,
    merchant_id: req.merchantId,
    ip_address: hashIp(req.ip),
    user_agent: req.headers['user-agent'],
    request_id: (req.headers['x-request-id'] as string) || crypto.randomBytes(8).toString('hex'),
  });
}

/**
 * Log a payment request with standardized fields
 */
export function logPaymentRequest(
  reqLogger: Logger,
  req: ExtendedRequest,
  result: PaymentRequestLogData | null,
  durationMs: number
): void {
  reqLogger.info({
    event: 'payment_request',
    method: req.method,
    path: req.path,
    intent_id: result?.intentId || result?.id,
    amount: req.body?.amount,
    currency: req.body?.currency,
    status: result?.status,
    duration_ms: durationMs,
    idempotency_key: req.headers['idempotency-key'],
  });
}

/**
 * Log a payment error with full context
 */
export function logPaymentError(
  reqLogger: Logger,
  req: ExtendedRequest,
  error: Error & { code?: string },
  context: Record<string, unknown> = {}
): void {
  reqLogger.error({
    event: 'payment_error',
    method: req.method,
    path: req.path,
    error_type: error.constructor.name,
    error_message: error.message,
    error_code: error.code,
    stack: isDevelopment ? error.stack : undefined,
    context,
  });
}

/**
 * Log webhook delivery attempt
 */
export function logWebhookDelivery(
  merchantId: string,
  eventType: string,
  status: string,
  durationMs: number,
  error: Error | null = null
): void {
  const logData: Record<string, unknown> = {
    event: 'webhook_delivery',
    merchant_id: merchantId,
    event_type: eventType,
    status,
    duration_ms: durationMs,
  };

  if (error) {
    logData.error_message = error.message;
    logger.warn(logData);
  } else {
    logger.info(logData);
  }
}

/**
 * Log fraud check result
 */
export function logFraudCheck(
  intentId: string,
  riskScore: number,
  decision: string,
  rules: string[] = []
): void {
  logger.info({
    event: 'fraud_check',
    intent_id: intentId,
    risk_score: riskScore,
    decision,
    rules_triggered: rules,
  });
}

/**
 * Log circuit breaker state change
 */
export function logCircuitBreakerStateChange(
  service: string,
  oldState: string,
  newState: string
): void {
  logger.warn({
    event: 'circuit_breaker_state_change',
    service,
    old_state: oldState,
    new_state: newState,
  });
}

/**
 * Log ledger entry creation
 */
export function logLedgerEntry(
  transactionId: string,
  entries: Array<{ account: string; debit: number; credit: number }>,
  balanced: boolean
): void {
  if (!balanced) {
    logger.error({
      event: 'ledger_imbalance',
      transaction_id: transactionId,
      entries,
    });
  } else {
    logger.info({
      event: 'ledger_entry',
      transaction_id: transactionId,
      entry_count: entries.length,
    });
  }
}

export default logger;
