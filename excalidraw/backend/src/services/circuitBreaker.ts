import CircuitBreaker from 'opossum';
import logger from './logger.js';
import { circuitBreakerState, circuitBreakerEvents } from './metrics.js';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
  rollingCountTimeout?: number;
  rollingCountBuckets?: number;
}

const defaultOptions: CircuitBreakerOptions = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
  rollingCountTimeout: 10000,
  rollingCountBuckets: 10,
};

/** Creates a named circuit breaker with Prometheus metrics and state-change logging. */
export const createCircuitBreaker = <T extends unknown[], R>(
  name: string,
  fn: (...args: T) => Promise<R>,
  options: CircuitBreakerOptions = {}
): CircuitBreaker<T, R> => {
  const breaker = new CircuitBreaker<T, R>(fn, {
    ...defaultOptions,
    ...options,
    name,
  });

  const updateState = (state: number): void => {
    circuitBreakerState.labels(name).set(state);
  };

  breaker.on('success', () => {
    circuitBreakerEvents.labels(name, 'success').inc();
  });

  breaker.on('failure', (error: Error) => {
    circuitBreakerEvents.labels(name, 'failure').inc();
    logger.warn({ circuitBreaker: name, event: 'failure', error: error.message }, `Circuit breaker ${name}: failure`);
  });

  breaker.on('timeout', () => {
    circuitBreakerEvents.labels(name, 'timeout').inc();
    logger.warn({ circuitBreaker: name, event: 'timeout' }, `Circuit breaker ${name}: timeout`);
  });

  breaker.on('reject', () => {
    circuitBreakerEvents.labels(name, 'reject').inc();
    logger.warn({ circuitBreaker: name, event: 'reject' }, `Circuit breaker ${name}: rejected`);
  });

  breaker.on('open', () => {
    updateState(1);
    circuitBreakerEvents.labels(name, 'open').inc();
    logger.error({ circuitBreaker: name, event: 'open' }, `Circuit breaker ${name}: OPENED`);
  });

  breaker.on('close', () => {
    updateState(0);
    circuitBreakerEvents.labels(name, 'close').inc();
    logger.info({ circuitBreaker: name, event: 'close' }, `Circuit breaker ${name}: CLOSED`);
  });

  breaker.on('halfOpen', () => {
    updateState(2);
    circuitBreakerEvents.labels(name, 'halfOpen').inc();
    logger.info({ circuitBreaker: name, event: 'halfOpen' }, `Circuit breaker ${name}: HALF-OPEN`);
  });

  updateState(0);

  return breaker;
};

/** Returns a fallback function that provides a default value when the circuit is open. */
export const fallbackWithDefault = <T>(defaultValue: T): (() => T) => {
  return (): T => {
    logger.warn({ fallback: 'default_value' }, 'Using fallback default value');
    return defaultValue;
  };
};

/** Returns a fallback function that throws a 503 error when the circuit is open. */
export const fallbackWithError = (message: string): (() => never) => {
  return (): never => {
    const error = new Error(message);
    (error as Error & { statusCode: number }).statusCode = 503;
    throw error;
  };
};

export default createCircuitBreaker;
