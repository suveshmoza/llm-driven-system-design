/**
 * Circuit Breaker Implementation using Opossum
 *
 * Provides resilience for external service calls (payment, inventory, search).
 * Prevents cascade failures by "opening" the circuit when failures exceed threshold.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests fail fast without calling service
 * - HALF-OPEN: Testing if service recovered, limited requests allowed
 */
import CircuitBreaker from 'opossum';
import logger, { LogEvents } from './logger.js';
import { circuitBreakerState, circuitBreakerTripsTotal } from './metrics.js';

interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
  rollingCountTimeout?: number;
  rollingCountBuckets?: number;
  name?: string;
}

export interface CircuitBreakerStats {
  name: string;
  state: 'open' | 'halfOpen' | 'closed';
  stats: unknown;
  options: {
    timeout: number;
    errorThresholdPercentage: number;
    resetTimeout: number;
  };
}

type AsyncFunction<T extends unknown[], R> = (...args: T) => Promise<R>;

// Default circuit breaker options
const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 10000,           // 10 seconds - if function takes longer, trip
  errorThresholdPercentage: 50,  // Trip when 50% of requests fail
  resetTimeout: 30000,      // Try again after 30 seconds
  volumeThreshold: 5,       // Minimum requests before tripping
  rollingCountTimeout: 10000,  // Window for counting failures
  rollingCountBuckets: 10   // Number of buckets in the window
};

// Store circuit breakers by name
const breakers = new Map<string, CircuitBreaker<unknown[], unknown>>();

// Map opossum state to metric value
const stateToMetricValue: Record<string, number> = {
  closed: 0,
  halfOpen: 1,
  open: 2
};

/**
 * Create or get a circuit breaker for a service
 */
export function createCircuitBreaker<T extends unknown[], R>(
  name: string,
  fn: AsyncFunction<T, R>,
  options: CircuitBreakerOptions = {}
): CircuitBreaker<T, R> {
  if (breakers.has(name)) {
    return breakers.get(name) as CircuitBreaker<T, R>;
  }

  const breaker = new CircuitBreaker(fn, {
    ...DEFAULT_OPTIONS,
    ...options,
    name
  });

  // Event handlers for logging and metrics
  breaker.on('open', () => {
    logger.warn({ service: name, event: LogEvents.CIRCUIT_OPENED }, `Circuit breaker OPENED for ${name}`);
    circuitBreakerState.set({ service: name }, stateToMetricValue.open);
    circuitBreakerTripsTotal.inc({ service: name });
  });

  breaker.on('close', () => {
    logger.info({ service: name, event: LogEvents.CIRCUIT_CLOSED }, `Circuit breaker CLOSED for ${name}`);
    circuitBreakerState.set({ service: name }, stateToMetricValue.closed);
  });

  breaker.on('halfOpen', () => {
    logger.info({ service: name, event: LogEvents.CIRCUIT_HALF_OPEN }, `Circuit breaker HALF-OPEN for ${name}`);
    circuitBreakerState.set({ service: name }, stateToMetricValue.halfOpen);
  });

  breaker.on('fallback', (result: unknown) => {
    logger.debug({ service: name, result }, `Circuit breaker fallback executed for ${name}`);
  });

  breaker.on('timeout', () => {
    logger.warn({ service: name }, `Circuit breaker timeout for ${name}`);
  });

  breaker.on('reject', () => {
    logger.warn({ service: name }, `Circuit breaker rejected request for ${name}`);
  });

  breaker.on('failure', (error: Error) => {
    logger.error({ service: name, error: error.message }, `Circuit breaker recorded failure for ${name}`);
  });

  // Initialize metric
  circuitBreakerState.set({ service: name }, stateToMetricValue.closed);

  breakers.set(name, breaker as CircuitBreaker<unknown[], unknown>);
  return breaker;
}

/**
 * Get circuit breaker stats
 */
export function getCircuitBreakerStats(name: string): CircuitBreakerStats | null {
  const breaker = breakers.get(name);
  if (!breaker) {
    return null;
  }

  return {
    name,
    state: breaker.opened ? 'open' : (breaker.halfOpen ? 'halfOpen' : 'closed'),
    stats: breaker.stats,
    options: {
      timeout: breaker.options.timeout,
      errorThresholdPercentage: breaker.options.errorThresholdPercentage,
      resetTimeout: breaker.options.resetTimeout
    }
  };
}

/**
 * Get all circuit breaker stats
 */
export function getAllCircuitBreakerStats(): CircuitBreakerStats[] {
  const stats: CircuitBreakerStats[] = [];
  for (const [name] of breakers) {
    const stat = getCircuitBreakerStats(name);
    if (stat) {
      stats.push(stat);
    }
  }
  return stats;
}

// ============================================================
// Pre-configured Circuit Breakers for Common Services
// ============================================================

/**
 * Payment Gateway Circuit Breaker
 * More conservative settings - payment is critical
 */
export const paymentCircuitBreakerOptions: CircuitBreakerOptions = {
  timeout: 30000,           // Payment can take longer
  errorThresholdPercentage: 30,  // Trip faster for payment
  resetTimeout: 60000,      // Wait longer before retrying
  volumeThreshold: 3        // Trip after fewer failures
};

/**
 * Inventory Service Circuit Breaker
 */
export const inventoryCircuitBreakerOptions: CircuitBreakerOptions = {
  timeout: 5000,            // Inventory should be fast
  errorThresholdPercentage: 50,
  resetTimeout: 15000,
  volumeThreshold: 5
};

/**
 * Elasticsearch Circuit Breaker
 * Less critical - can fallback to PostgreSQL
 */
export const searchCircuitBreakerOptions: CircuitBreakerOptions = {
  timeout: 5000,
  errorThresholdPercentage: 60,  // More tolerant
  resetTimeout: 10000,
  volumeThreshold: 10
};

/**
 * Create a payment circuit breaker wrapper
 */
export function createPaymentCircuitBreaker<T extends unknown[], R>(
  paymentFn: AsyncFunction<T, R>,
  fallbackFn: AsyncFunction<T, R> | null = null
): CircuitBreaker<T, R> {
  const breaker = createCircuitBreaker('payment-gateway', paymentFn, paymentCircuitBreakerOptions);

  if (fallbackFn) {
    breaker.fallback(fallbackFn);
  }

  return breaker;
}

/**
 * Create an inventory circuit breaker wrapper
 */
export function createInventoryCircuitBreaker<T extends unknown[], R>(
  inventoryFn: AsyncFunction<T, R>,
  fallbackFn: AsyncFunction<T, R> | null = null
): CircuitBreaker<T, R> {
  const breaker = createCircuitBreaker('inventory-service', inventoryFn, inventoryCircuitBreakerOptions);

  if (fallbackFn) {
    breaker.fallback(fallbackFn);
  }

  return breaker;
}

/**
 * Create a search circuit breaker wrapper
 */
export function createSearchCircuitBreaker<T extends unknown[], R>(
  searchFn: AsyncFunction<T, R>,
  fallbackFn: AsyncFunction<T, R> | null = null
): CircuitBreaker<T, R> {
  const breaker = createCircuitBreaker('elasticsearch', searchFn, searchCircuitBreakerOptions);

  if (fallbackFn) {
    breaker.fallback(fallbackFn);
  }

  return breaker;
}

/**
 * Check if a circuit breaker is open
 */
export function isCircuitOpen(name: string): boolean {
  const breaker = breakers.get(name);
  return breaker ? breaker.opened : false;
}

/**
 * Force close a circuit breaker (for testing/recovery)
 */
export function forceCloseCircuit(name: string): void {
  const breaker = breakers.get(name);
  if (breaker) {
    breaker.close();
    logger.info({ service: name }, `Circuit breaker force closed for ${name}`);
  }
}

/**
 * Force open a circuit breaker (for testing/maintenance)
 */
export function forceOpenCircuit(name: string): void {
  const breaker = breakers.get(name);
  if (breaker) {
    breaker.open();
    logger.info({ service: name }, `Circuit breaker force opened for ${name}`);
  }
}

export default {
  createCircuitBreaker,
  createPaymentCircuitBreaker,
  createInventoryCircuitBreaker,
  createSearchCircuitBreaker,
  getCircuitBreakerStats,
  getAllCircuitBreakerStats,
  isCircuitOpen,
  forceCloseCircuit,
  forceOpenCircuit
};
