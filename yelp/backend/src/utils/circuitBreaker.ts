import CircuitBreaker from 'opossum';
import { logger, logCircuitBreaker } from './logger.js';
import {
  circuitBreakerFailures,
  circuitBreakerSuccesses,
  updateCircuitBreakerState,
} from './metrics.js';

/**
 * Circuit Breaker Module
 *
 * Implements the circuit breaker pattern for external service calls:
 * - Elasticsearch search and geo operations
 * - PostgreSQL geo queries (heavy operations)
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

// Circuit breaker options interface
interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
  name?: string;
}

// Circuit breaker status interface
interface CircuitBreakerStatusEntry {
  state: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
  stats: unknown;
}

// Default circuit breaker options
const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 5000, // 5 second timeout
  errorThresholdPercentage: 50, // Open circuit if 50% of requests fail
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 5, // Minimum requests before circuit can open
};

// Store all circuit breakers for health checks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const circuitBreakers: Map<string, CircuitBreaker<any[], any>> = new Map();

/**
 * Create a circuit breaker for a given function
 * Note: TReturn should be the Promise type (e.g., Promise<SearchResult>), not the unwrapped type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCircuitBreaker<TArgs extends any[], TReturn>(
  name: string,
  fn: (...args: TArgs) => TReturn,
  options: CircuitBreakerOptions = {}
): CircuitBreaker<TArgs, Awaited<TReturn>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const breaker = new CircuitBreaker<TArgs, Awaited<TReturn>>(fn as any, {
    ...DEFAULT_OPTIONS,
    ...options,
    name,
  });

  // Log state changes
  breaker.on('open', () => {
    logCircuitBreaker(name, 'OPEN', { reason: 'failure threshold exceeded' });
    updateCircuitBreakerState(name, 'OPEN');
  });

  breaker.on('halfOpen', () => {
    logCircuitBreaker(name, 'HALF_OPEN', { reason: 'reset timeout elapsed' });
    updateCircuitBreakerState(name, 'HALF_OPEN');
  });

  breaker.on('close', () => {
    logCircuitBreaker(name, 'CLOSED', { reason: 'service recovered' });
    updateCircuitBreakerState(name, 'CLOSED');
  });

  // Track failures and successes
  breaker.on('failure', (error: Error) => {
    circuitBreakerFailures.inc({ name });
    logger.warn(
      { component: 'circuit_breaker', name, error: error.message },
      'Circuit breaker failure'
    );
  });

  breaker.on('success', () => {
    circuitBreakerSuccesses.inc({ name });
  });

  // Log when requests are rejected due to open circuit
  breaker.on('reject', () => {
    logger.warn(
      { component: 'circuit_breaker', name },
      'Request rejected - circuit is open'
    );
  });

  // Log timeouts
  breaker.on('timeout', () => {
    logger.warn(
      { component: 'circuit_breaker', name },
      'Request timed out'
    );
  });

  // Initialize state metric
  updateCircuitBreakerState(name, 'CLOSED');

  // Store for health checks
  circuitBreakers.set(name, breaker);

  return breaker;
}

/**
 * Get all circuit breaker statuses for health check
 */
export function getCircuitBreakerStatus(): Record<string, CircuitBreakerStatusEntry> {
  const status: Record<string, CircuitBreakerStatusEntry> = {};
  for (const [name, breaker] of circuitBreakers) {
    status[name] = {
      state: breaker.opened
        ? 'OPEN'
        : breaker.halfOpen
          ? 'HALF_OPEN'
          : 'CLOSED',
      stats: breaker.stats,
    };
  }
  return status;
}

/**
 * Create Elasticsearch search circuit breaker
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let esSearchBreaker: CircuitBreaker<any[], any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getElasticsearchSearchBreaker<TArgs extends any[], TReturn>(
  searchFn: (...args: TArgs) => TReturn
): CircuitBreaker<TArgs, Awaited<TReturn>> {
  if (!esSearchBreaker) {
    esSearchBreaker = createCircuitBreaker('elasticsearch_search', searchFn, {
      timeout: 3000, // 3 second timeout for search
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
    });
  }
  return esSearchBreaker as CircuitBreaker<TArgs, Awaited<TReturn>>;
}

/**
 * Create Elasticsearch autocomplete circuit breaker
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let esAutocompleteBreaker: CircuitBreaker<any[], any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getElasticsearchAutocompleteBreaker<TArgs extends any[], TReturn>(
  autocompleteFn: (...args: TArgs) => TReturn
): CircuitBreaker<TArgs, Awaited<TReturn>> {
  if (!esAutocompleteBreaker) {
    esAutocompleteBreaker = createCircuitBreaker(
      'elasticsearch_autocomplete',
      autocompleteFn,
      {
        timeout: 2000, // 2 second timeout for autocomplete
        errorThresholdPercentage: 60,
        resetTimeout: 20000,
      }
    );
  }
  return esAutocompleteBreaker as CircuitBreaker<TArgs, Awaited<TReturn>>;
}

/**
 * Create PostgreSQL geo query circuit breaker
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pgGeoBreaker: CircuitBreaker<any[], any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPostgresGeoBreaker<TArgs extends any[], TReturn>(
  geoQueryFn: (...args: TArgs) => TReturn
): CircuitBreaker<TArgs, Awaited<TReturn>> {
  if (!pgGeoBreaker) {
    pgGeoBreaker = createCircuitBreaker('postgres_geo', geoQueryFn, {
      timeout: 5000, // 5 second timeout for geo queries
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
    });
  }
  return pgGeoBreaker as CircuitBreaker<TArgs, Awaited<TReturn>>;
}

/**
 * Wrap a function with circuit breaker protection
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withCircuitBreaker<TArgs extends any[], TReturn>(
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
  options: CircuitBreakerOptions = {}
): (...args: TArgs) => Promise<TReturn> {
  const breaker = createCircuitBreaker(name, fn, options);

  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return (await breaker.fire(...args)) as TReturn;
    } catch (error) {
      if ((error as Error).message === 'Breaker is open') {
        // Circuit is open, provide fallback behavior
        throw new Error(`Service unavailable: ${name} circuit is open`);
      }
      throw error;
    }
  };
}

/**
 * Create a fallback handler for circuit breaker
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setFallback<TArgs extends any[], TReturn>(
  breaker: CircuitBreaker<TArgs, TReturn>,
  fallbackFn: (...args: TArgs) => TReturn | Promise<TReturn>
): void {
  breaker.fallback(fallbackFn);
}

export default {
  createCircuitBreaker,
  getCircuitBreakerStatus,
  getElasticsearchSearchBreaker,
  getElasticsearchAutocompleteBreaker,
  getPostgresGeoBreaker,
  withCircuitBreaker,
  setFallback,
};
