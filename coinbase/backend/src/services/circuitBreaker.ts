import CircuitBreaker from 'opossum';

const defaultOptions = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

/**
 * Creates an Opossum circuit breaker wrapping an async function.
 * @param fn - The async function to protect with circuit breaking.
 * @param name - Descriptive name for logging and identification.
 * @param options - Override default circuit breaker thresholds.
 * @returns Configured CircuitBreaker instance.
 */
export function createCircuitBreaker<T>(
  fn: (...args: unknown[]) => Promise<T>,
  name: string,
  options: Partial<typeof defaultOptions> = {}
): CircuitBreaker {
  const breaker = new CircuitBreaker(fn, {
    ...defaultOptions,
    ...options,
    name,
  });

  breaker.on('open', () => {
    console.warn(`Circuit breaker [${name}] opened`);
  });

  breaker.on('halfOpen', () => {
    console.info(`Circuit breaker [${name}] half-open`);
  });

  breaker.on('close', () => {
    console.info(`Circuit breaker [${name}] closed`);
  });

  return breaker;
}
