import CircuitBreaker from 'opossum';
import { logger } from './logger.js';

const defaultOptions: CircuitBreaker.Options = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

export function createCircuitBreaker<T>(
  fn: (...args: unknown[]) => Promise<T>,
  name: string,
  options?: Partial<CircuitBreaker.Options>
): CircuitBreaker<unknown[], T> {
  const breaker = new CircuitBreaker(fn, {
    ...defaultOptions,
    ...options,
    name,
  });

  breaker.on('open', () => {
    logger.warn({ circuit: name }, 'Circuit breaker opened');
  });

  breaker.on('halfOpen', () => {
    logger.info({ circuit: name }, 'Circuit breaker half-open');
  });

  breaker.on('close', () => {
    logger.info({ circuit: name }, 'Circuit breaker closed');
  });

  return breaker;
}
