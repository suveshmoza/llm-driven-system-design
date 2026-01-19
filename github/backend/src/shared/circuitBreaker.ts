import CircuitBreaker, { Options } from 'opossum';
import logger from './logger.js';
import { circuitBreakerState, circuitBreakerTrips, gitOperationDuration, gitOperationsTotal } from './metrics.js';

/**
 * Circuit Breaker for Git Operations
 *
 * Protects the system when git operations are failing:
 * - Opens circuit after consecutive failures
 * - Rejects requests immediately when open
 * - Periodically tests if service recovered
 *
 * Benefits:
 * - Prevents cascade failures
 * - Allows git storage to recover
 * - Provides fast failure for users
 */

// Circuit breaker configuration
const CIRCUIT_OPTIONS: Options = {
  timeout: 30000,           // 30 seconds - git operations can be slow
  errorThresholdPercentage: 50,  // Open circuit if 50% of requests fail
  resetTimeout: 30000,      // Try again after 30 seconds
  volumeThreshold: 5,       // Minimum requests before calculating error percentage
};

// Map of circuit breakers by operation type
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Create a circuit breaker for a specific operation
 */
function createCircuitBreaker<T>(name: string, operation: () => Promise<T>): CircuitBreaker<[], T> {
  const breaker = new CircuitBreaker(operation, {
    ...CIRCUIT_OPTIONS,
    name,
  });

  // Update metrics on state changes
  breaker.on('open', () => {
    logger.warn({ service: name }, 'Circuit breaker opened');
    circuitBreakerState.set({ service: name }, 1);
    circuitBreakerTrips.inc({ service: name });
  });

  breaker.on('halfOpen', () => {
    logger.info({ service: name }, 'Circuit breaker half-open');
    circuitBreakerState.set({ service: name }, 2);
  });

  breaker.on('close', () => {
    logger.info({ service: name }, 'Circuit breaker closed');
    circuitBreakerState.set({ service: name }, 0);
  });

  breaker.on('success', (result: T, latency: number) => {
    void result; // Unused but required by type
    const duration = latency / 1000;
    gitOperationDuration.observe({ operation: name }, duration);
    gitOperationsTotal.inc({ operation: name, status: 'success' });
  });

  breaker.on('failure', (err: Error, latency: number) => {
    const duration = latency / 1000;
    gitOperationDuration.observe({ operation: name }, duration);
    gitOperationsTotal.inc({ operation: name, status: 'failure' });
    logger.error({ err, service: name, latency }, 'Git operation failed');
  });

  breaker.on('timeout', () => {
    gitOperationsTotal.inc({ operation: name, status: 'timeout' });
    logger.warn({ service: name }, 'Git operation timed out');
  });

  breaker.on('reject', () => {
    gitOperationsTotal.inc({ operation: name, status: 'rejected' });
    logger.warn({ service: name }, 'Git operation rejected - circuit open');
  });

  // Initialize state metric
  circuitBreakerState.set({ service: name }, 0);

  circuitBreakers.set(name, breaker);
  return breaker;
}

/**
 * Get or create a circuit breaker for an operation
 */
function getCircuitBreaker<T>(name: string, operation: () => Promise<T>): CircuitBreaker<[], T> {
  if (!circuitBreakers.has(name)) {
    return createCircuitBreaker(name, operation);
  }

  return circuitBreakers.get(name) as CircuitBreaker<[], T>;
}

/**
 * Wrap a git operation with circuit breaker protection
 */
export async function withCircuitBreaker<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
  const breaker = getCircuitBreaker(operationName, operation);

  try {
    return await breaker.fire() as T;
  } catch (err) {
    if ((err as Error).message === 'Breaker is open') {
      throw new Error(`Git service temporarily unavailable: ${operationName}`);
    }
    throw err;
  }
}

/**
 * Protected git operations
 */
export const protectedGitOps = {
  /**
   * Clone repository with circuit breaker
   */
  async clone<T>(cloneOperation: () => Promise<T>): Promise<T> {
    return withCircuitBreaker('git_clone', cloneOperation);
  },

  /**
   * Get branches with circuit breaker
   */
  async branches<T>(branchesOperation: () => Promise<T>): Promise<T> {
    return withCircuitBreaker('git_branches', branchesOperation);
  },

  /**
   * Get commits with circuit breaker
   */
  async commits<T>(commitsOperation: () => Promise<T>): Promise<T> {
    return withCircuitBreaker('git_commits', commitsOperation);
  },

  /**
   * Get tree with circuit breaker
   */
  async tree<T>(treeOperation: () => Promise<T>): Promise<T> {
    return withCircuitBreaker('git_tree', treeOperation);
  },

  /**
   * Get diff with circuit breaker
   */
  async diff<T>(diffOperation: () => Promise<T>): Promise<T> {
    return withCircuitBreaker('git_diff', diffOperation);
  },

  /**
   * Merge branches with circuit breaker
   */
  async merge<T>(mergeOperation: () => Promise<T>): Promise<T> {
    return withCircuitBreaker('git_merge', mergeOperation);
  },

  /**
   * Push to repository with circuit breaker
   */
  async push<T>(pushOperation: () => Promise<T>): Promise<T> {
    return withCircuitBreaker('git_push', pushOperation);
  },
};

interface CircuitBreakerStatus {
  state: 'open' | 'half-open' | 'closed';
  stats: CircuitBreaker.Stats;
}

/**
 * Get the status of all circuit breakers
 */
export function getCircuitBreakerStatus(): Record<string, CircuitBreakerStatus> {
  const status: Record<string, CircuitBreakerStatus> = {};
  for (const [name, breaker] of circuitBreakers) {
    status[name] = {
      state: breaker.opened ? 'open' : (breaker.halfOpen ? 'half-open' : 'closed'),
      stats: breaker.stats,
    };
  }
  return status;
}

/**
 * Force reset a specific circuit breaker (for admin use)
 */
export function resetCircuitBreaker(name: string): boolean {
  const breaker = circuitBreakers.get(name);
  if (breaker) {
    breaker.close();
    logger.info({ service: name }, 'Circuit breaker manually reset');
    return true;
  }
  return false;
}

export default {
  withCircuitBreaker,
  protectedGitOps,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
};
