/**
 * Circuit Breaker Module
 *
 * Provides circuit breaker pattern for node communication.
 * Prevents cascading failures when cache nodes become unhealthy.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Failing, requests are rejected immediately
 * - HALF-OPEN: Testing if service recovered
 */

import CircuitBreaker from 'opossum';
import {
  circuitBreakerState,
  circuitBreakerTrips,
} from './metrics.js';
import {
  logCircuitBreakerStateChange,
  circuitBreakerLogger,
} from './logger.js';

// Configuration from environment
const CIRCUIT_TIMEOUT = parseInt(process.env.CIRCUIT_TIMEOUT || '5000', 10);
const CIRCUIT_RESET_TIMEOUT = parseInt(
  process.env.CIRCUIT_RESET_TIMEOUT || '30000',
  10
);
const CIRCUIT_ERROR_THRESHOLD = parseInt(
  process.env.CIRCUIT_ERROR_THRESHOLD || '50',
  10
);
const CIRCUIT_VOLUME_THRESHOLD = parseInt(
  process.env.CIRCUIT_VOLUME_THRESHOLD || '5',
  10
);

// Store circuit breakers for each node
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Circuit breaker options
 */
const defaultOptions = {
  timeout: CIRCUIT_TIMEOUT, // Time in ms before a request is considered failed
  resetTimeout: CIRCUIT_RESET_TIMEOUT, // Time in ms to wait before testing if service is back
  errorThresholdPercentage: CIRCUIT_ERROR_THRESHOLD, // Error percentage to trip the circuit
  volumeThreshold: CIRCUIT_VOLUME_THRESHOLD, // Minimum requests before tripping
  rollingCountTimeout: 10000, // Time window for rolling error count
  rollingCountBuckets: 10, // Number of buckets for rolling count
};

/**
 * State value mapping for metrics
 */
const stateValues: Record<string, number> = {
  closed: 0,
  open: 1,
  halfOpen: 0.5,
};

interface CircuitBreakerOptions {
  timeout?: number;
  resetTimeout?: number;
  errorThresholdPercentage?: number;
  volumeThreshold?: number;
  [key: string]: unknown;
}

interface FetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  signal?: AbortSignal;
  [key: string]: unknown;
}

/**
 * Create a circuit breaker for a node
 */
export function createCircuitBreaker(
  nodeUrl: string,
  requestFn: (...args: unknown[]) => Promise<unknown>,
  options: CircuitBreakerOptions = {}
): CircuitBreaker {
  const breaker = new CircuitBreaker(requestFn, {
    ...defaultOptions,
    ...options,
    name: nodeUrl,
  });

  // Set up event handlers
  breaker.on('open', () => {
    logCircuitBreakerStateChange(nodeUrl, 'open');
    circuitBreakerState.labels(nodeUrl).set(stateValues.open);
    circuitBreakerTrips.labels(nodeUrl).inc();
  });

  breaker.on('close', () => {
    logCircuitBreakerStateChange(nodeUrl, 'closed');
    circuitBreakerState.labels(nodeUrl).set(stateValues.closed);
  });

  breaker.on('halfOpen', () => {
    logCircuitBreakerStateChange(nodeUrl, 'half-open');
    circuitBreakerState.labels(nodeUrl).set(stateValues.halfOpen);
  });

  breaker.on('success', (_result: unknown) => {
    circuitBreakerLogger.debug(
      { nodeUrl, success: true },
      'circuit_breaker_success'
    );
  });

  breaker.on('timeout', () => {
    circuitBreakerLogger.warn({ nodeUrl }, 'circuit_breaker_timeout');
  });

  breaker.on('reject', () => {
    circuitBreakerLogger.warn({ nodeUrl }, 'circuit_breaker_reject');
  });

  breaker.on('fallback', (_result: unknown) => {
    circuitBreakerLogger.debug({ nodeUrl }, 'circuit_breaker_fallback');
  });

  // Initialize metrics
  circuitBreakerState.labels(nodeUrl).set(stateValues.closed);

  // Store the breaker
  circuitBreakers.set(nodeUrl, breaker);

  return breaker;
}

/**
 * Get or create a circuit breaker for a node
 */
export function getCircuitBreaker(
  nodeUrl: string,
  requestFn: (...args: unknown[]) => Promise<unknown>
): CircuitBreaker {
  if (circuitBreakers.has(nodeUrl)) {
    return circuitBreakers.get(nodeUrl)!;
  }
  return createCircuitBreaker(nodeUrl, requestFn);
}

/**
 * Execute a request through the circuit breaker
 */
export async function executeWithCircuitBreaker(
  nodeUrl: string,
  requestFn: (...args: unknown[]) => Promise<unknown>,
  fallbackValue: unknown = null
): Promise<unknown> {
  let breaker = circuitBreakers.get(nodeUrl);

  if (!breaker) {
    breaker = createCircuitBreaker(nodeUrl, requestFn);
  }

  // Set fallback if provided
  if (fallbackValue !== null) {
    breaker.fallback(() => fallbackValue);
  }

  return breaker.fire();
}

/**
 * Remove circuit breaker for a node
 */
export function removeCircuitBreaker(nodeUrl: string): void {
  const breaker = circuitBreakers.get(nodeUrl);
  if (breaker) {
    breaker.shutdown();
    circuitBreakers.delete(nodeUrl);
    circuitBreakerLogger.info({ nodeUrl }, 'circuit_breaker_removed');
  }
}

/**
 * Get status of all circuit breakers
 */
export function getAllCircuitBreakerStatus(): Record<string, unknown> {
  const status: Record<string, unknown> = {};

  for (const [nodeUrl, breaker] of circuitBreakers) {
    const stats = breaker.stats;
    status[nodeUrl] = {
      state: breaker.opened
        ? 'open'
        : breaker.halfOpen
          ? 'half-open'
          : 'closed',
      stats: {
        successes: stats.successes,
        failures: stats.failures,
        timeouts: stats.timeouts,
        rejects: stats.rejects,
        fallbacks: stats.fallbacks,
        latencyMean: stats.latencyMean,
        latencyP95: stats.percentiles[95],
        latencyP99: stats.percentiles[99],
      },
    };
  }

  return status;
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.close();
  }
  circuitBreakerLogger.info({}, 'all_circuit_breakers_reset');
}

/**
 * Create a wrapped fetch function with circuit breaker
 * This is a convenience function for HTTP requests to cache nodes
 */
export function createNodeClient(nodeUrl: string) {
  const requestFn = async (path: string, options: FetchOptions = {}) => {
    const url = `${nodeUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeout || CIRCUIT_TIMEOUT
    );

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: 'Unknown error',
        })) as { error?: string };
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  };

  const breaker = createCircuitBreaker(nodeUrl, requestFn as (...args: unknown[]) => Promise<unknown>);

  return async (path: string, options: FetchOptions = {}) => {
    try {
      return await breaker.fire(path, options);
    } catch (error) {
      if ((error as Error).message === 'Breaker is open') {
        return { success: false, circuitOpen: true, error: 'Circuit is open' };
      }
      return { success: false, error: (error as Error).message };
    }
  };
}

/**
 * Health check function for circuit breaker
 * Can be used to manually test if a node is healthy
 */
export async function healthCheck(nodeUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${nodeUrl}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    return response.ok;
  } catch {
    return false;
  }
}

export default {
  createCircuitBreaker,
  getCircuitBreaker,
  executeWithCircuitBreaker,
  removeCircuitBreaker,
  getAllCircuitBreakerStatus,
  resetAllCircuitBreakers,
  createNodeClient,
  healthCheck,
};
