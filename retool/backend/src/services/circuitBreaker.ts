import CircuitBreaker from 'opossum';
import { logger } from './logger.js';

export function createCircuitBreaker<T>(
  fn: (...args: unknown[]) => Promise<T>,
  name: string,
): CircuitBreaker<unknown[], T> {
  const breaker = new CircuitBreaker(fn, {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
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
