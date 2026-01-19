import CircuitBreakerLib from 'opossum';
import config from '../config/index.js';
import { CircuitOpenError } from '../utils/index.js';
import { metricsService } from './metrics.js';
import logger from './logger.js';
import type { Logger } from 'pino';

interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenRequests?: number;
}

interface CircuitBreakerStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  stateChanges: Array<{
    from: string;
    to: string;
    timestamp: string;
  }>;
}

interface CircuitBreakerState {
  name: string;
  state: string;
  failures: number;
  lastFailure: number | null;
  stats: CircuitBreakerStats;
}

/**
 * Circuit Breaker implementation for protecting against cascading failures
 *
 * WHY circuit breakers prevent cascade failures:
 * - When a downstream service fails, requests pile up waiting for timeouts
 * - This exhausts connection pools and threads in the calling service
 * - The calling service then fails, cascading to its callers
 * - Circuit breakers "fail fast" when a service is down, preventing resource exhaustion
 * - Half-open state allows gradual recovery testing without overwhelming the recovering service
 *
 * This implementation wraps the opossum library for production-grade circuit breaking
 * while maintaining backward compatibility with our simpler implementation.
 */
export class CircuitBreaker {
  public name: string;
  public state: string;
  private failureThreshold: number;
  private resetTimeout: number;
  private halfOpenRequests: number;
  private failures: number;
  private successes: number;
  private lastFailure: number | null;
  private halfOpenCount: number;
  private log: Logger;
  private stats: CircuitBreakerStats;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || config.circuitBreaker.failureThreshold;
    this.resetTimeout = options.resetTimeout || config.circuitBreaker.resetTimeout;
    this.halfOpenRequests = options.halfOpenRequests || config.circuitBreaker.halfOpenRequests;

    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = null;
    this.halfOpenCount = 0;
    this.log = logger.child({ circuitBreaker: name });

    // Statistics
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      stateChanges: [],
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.stats.totalCalls++;

    if (this.state === 'open') {
      if (this.lastFailure !== null && Date.now() - this.lastFailure >= this.resetTimeout) {
        this.transitionTo('half-open');
        this.halfOpenCount = 0;
      } else {
        this.stats.rejectedCalls++;
        throw new CircuitOpenError(`Circuit breaker ${this.name} is open`);
      }
    }

    if (this.state === 'half-open') {
      this.halfOpenCount++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess(): void {
    this.stats.successfulCalls++;

    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.halfOpenRequests) {
        this.transitionTo('closed');
        this.failures = 0;
        this.successes = 0;
      }
    } else {
      // Gradually reduce failure count on success
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  /**
   * Handle failed execution
   */
  onFailure(error: Error): void {
    this.stats.failedCalls++;
    this.failures++;
    this.lastFailure = Date.now();

    this.log.warn({ failures: this.failures, error: error.message }, 'Circuit breaker failure');

    if (this.state === 'half-open') {
      this.transitionTo('open');
    } else if (this.failures >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /**
   * Transition to a new state
   */
  transitionTo(newState: string): void {
    const oldState = this.state;
    this.state = newState;

    this.stats.stateChanges.push({
      from: oldState,
      to: newState,
      timestamp: new Date().toISOString(),
    });

    this.log.info({ from: oldState, to: newState }, 'Circuit breaker state change');

    // Record state change in metrics
    metricsService.recordCircuitBreakerState(this.name, newState, this.stats as unknown as Record<string, unknown>);
  }

  /**
   * Get current state and statistics
   */
  getState(): CircuitBreakerState {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
      stats: this.stats,
    };
  }

  /**
   * Force the circuit to open
   */
  open(): void {
    this.transitionTo('open');
    this.lastFailure = Date.now();
  }

  /**
   * Force the circuit to close
   */
  close(): void {
    this.transitionTo('closed');
    this.failures = 0;
    this.successes = 0;
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      stateChanges: [],
    };
  }
}

/**
 * Circuit Breaker Registry for managing multiple breakers
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker>;

  constructor() {
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker
   */
  get(name: string, options: CircuitBreakerOptions = {}): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, options));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breaker states
   */
  getAll(): Record<string, CircuitBreakerState> {
    const states: Record<string, CircuitBreakerState> = {};
    for (const [name, breaker] of this.breakers) {
      states[name] = breaker.getState();
    }
    return states;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.close();
      breaker.resetStats();
    }
  }
}

// Singleton instance
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

interface OpossumOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

interface OpossumStats {
  fires?: number;
  successes?: number;
  failures?: number;
  rejects?: number;
  timeouts?: number;
  fallbacks?: number;
}

/**
 * Production-grade circuit breaker using opossum library
 *
 * Use this for downstream service calls that need more sophisticated
 * circuit breaking features like:
 * - Configurable timeout
 * - Fallback functions
 * - Volume threshold (min requests before opening)
 * - Error percentage threshold
 */
export class OpossumCircuitBreaker<T extends unknown[], R> {
  public name: string;
  private log: Logger;
  private breaker: CircuitBreakerLib<T, R>;

  constructor(name: string, action: (...args: T) => Promise<R>, options: OpossumOptions = {}) {
    this.name = name;
    this.log = logger.child({ circuitBreaker: name });

    const defaultOptions = {
      timeout: options.timeout || 10000, // 10 seconds
      errorThresholdPercentage: options.errorThresholdPercentage || 50,
      resetTimeout: options.resetTimeout || config.circuitBreaker.resetTimeout,
      volumeThreshold: options.volumeThreshold || 5, // Min requests before opening
    };

    this.breaker = new CircuitBreakerLib(action, defaultOptions);

    // Set up event handlers
    this.breaker.on('open', () => {
      this.log.warn('Circuit opened');
      metricsService.recordCircuitBreakerState(name, 'open', this.getStats() as unknown as Record<string, unknown>);
    });

    this.breaker.on('halfOpen', () => {
      this.log.info('Circuit half-open');
      metricsService.recordCircuitBreakerState(name, 'half-open', this.getStats() as unknown as Record<string, unknown>);
    });

    this.breaker.on('close', () => {
      this.log.info('Circuit closed');
      metricsService.recordCircuitBreakerState(name, 'closed', this.getStats() as unknown as Record<string, unknown>);
    });

    this.breaker.on('fallback', () => {
      this.log.debug('Fallback executed');
      metricsService.increment('circuit_breaker_fallbacks_total', { name });
    });

    this.breaker.on('reject', () => {
      this.log.warn('Request rejected (circuit open)');
      metricsService.increment('circuit_breaker_rejects_total', { name });
    });

    this.breaker.on('timeout', () => {
      this.log.warn('Request timed out');
      metricsService.increment('circuit_breaker_timeouts_total', { name });
    });
  }

  /**
   * Execute the protected action
   */
  async fire(...args: T): Promise<R> {
    return this.breaker.fire(...args);
  }

  /**
   * Set fallback function
   */
  fallback(fn: (...args: T) => R | Promise<R>): this {
    this.breaker.fallback(fn);
    return this;
  }

  /**
   * Get current state
   */
  get state(): string {
    if (this.breaker.opened) return 'open';
    if (this.breaker.halfOpen) return 'half-open';
    return 'closed';
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    rejectedCalls: number;
    timeouts: number;
    fallbacks: number;
  } {
    const stats = this.breaker.stats as OpossumStats;
    return {
      totalCalls: stats.fires || 0,
      successfulCalls: stats.successes || 0,
      failedCalls: stats.failures || 0,
      rejectedCalls: stats.rejects || 0,
      timeouts: stats.timeouts || 0,
      fallbacks: stats.fallbacks || 0,
    };
  }

  /**
   * Get full state for monitoring
   */
  getState(): {
    name: string;
    state: string;
    stats: {
      totalCalls: number;
      successfulCalls: number;
      failedCalls: number;
      rejectedCalls: number;
      timeouts: number;
      fallbacks: number;
    };
    status: unknown;
  } {
    return {
      name: this.name,
      state: this.state,
      stats: this.getStats(),
      status: this.breaker.status,
    };
  }

  /**
   * Force open
   */
  open(): void {
    this.breaker.open();
  }

  /**
   * Force close
   */
  close(): void {
    this.breaker.close();
  }
}

export default CircuitBreaker;
