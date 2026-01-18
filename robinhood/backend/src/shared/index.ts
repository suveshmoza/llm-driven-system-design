/**
 * Shared modules for the Robinhood Trading Platform.
 *
 * This barrel export provides access to all shared functionality:
 * - logger: Structured JSON logging with pino
 * - metrics: Prometheus metrics for monitoring
 * - circuitBreaker: Resilience patterns for external dependencies
 * - audit: SEC-compliant audit logging
 * - idempotency: Prevention of duplicate trade executions
 * - kafka: Event streaming for quotes, orders, and trades
 */

export { logger, createChildLogger, withContext, type LogContext } from './logger.js';

export {
  registry,
  httpRequestsTotal,
  httpRequestDurationMs,
  ordersPlacedTotal,
  ordersFilledTotal,
  ordersCancelledTotal,
  ordersRejectedTotal,
  orderExecutionDurationMs,
  ordersPendingGauge,
  executionValueTotal,
  executionSharesTotal,
  portfolioUpdatesTotal,
  quoteUpdatesTotal,
  websocketConnectionsGauge,
  dbPoolSizeGauge,
  dbQueryDurationMs,
  circuitBreakerStateGauge,
  circuitBreakerFailuresTotal,
  idempotencyHitsTotal,
  idempotencyMissesTotal,
  auditEntriesTotal,
} from './metrics.js';

export {
  createCircuitBreaker,
  CircuitBreakerState,
  getCircuitBreakerState,
  createFallback,
  type CircuitBreakerOptions,
} from './circuitBreaker.js';

export {
  auditLogger,
  type AuditAction,
  type AuditEntry,
} from './audit.js';

export {
  idempotencyService,
  generateIdempotencyKey,
  type IdempotencyStatus,
  type IdempotencyRecord,
} from './idempotency.js';

export {
  TOPICS,
  initKafkaProducer,
  disconnectKafkaProducer,
  publishQuote,
  publishQuotes,
  publishOrder,
  publishTrade,
  createConsumer,
  consumeQuotes,
  consumeOrders,
  consumeTrades,
  isProducerConnected,
  getKafkaClient,
  type OrderEventType,
  type OrderEvent,
  type TradeEvent,
  type QuoteHandler,
  type OrderHandler,
  type TradeHandler,
} from './kafka.js';
