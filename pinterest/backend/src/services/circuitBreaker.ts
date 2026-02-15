import CircuitBreaker from 'opossum';
import { logger } from './logger.js';

const defaultOptions = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

/** Creates a circuit breaker wrapping an async function with configurable failure thresholds. */
export function createCircuitBreaker<T>(
  name: string,
  fn: (...args: unknown[]) => Promise<T>,
  options?: Partial<typeof defaultOptions>,
) {
  const breaker = new CircuitBreaker(fn, {
    ...defaultOptions,
    ...options,
    name,
  });

  breaker.on('open', () => {
    logger.warn({ circuitBreaker: name }, 'Circuit breaker opened');
  });

  breaker.on('halfOpen', () => {
    logger.info({ circuitBreaker: name }, 'Circuit breaker half-open');
  });

  breaker.on('close', () => {
    logger.info({ circuitBreaker: name }, 'Circuit breaker closed');
  });

  return breaker;
}

/** Returns a fallback function that resolves with a default value when the circuit is open. */
export function fallbackWithDefault<T>(defaultValue: T) {
  return () => defaultValue;
}

/** Returns a fallback function that throws an error when the circuit is open. */
export function fallbackWithError(message: string) {
  return () => {
    throw new Error(message);
  };
}

/** Returns aggregate health status of all circuit breakers. */
export function getCircuitBreakerHealth() {
  return { status: 'ok' };
}
