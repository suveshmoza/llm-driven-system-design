/**
 * Retry Utility with Exponential Backoff
 *
 * Provides automatic retry logic for transient failures with:
 * - Configurable exponential backoff
 * - Jitter to prevent thundering herd
 * - Customizable retry conditions
 * - Logging of retry attempts
 */
import logger from './logger.js';

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: boolean;
  jitterFactor: number;
  retryOn: ((error: RetryableError) => boolean) | null;
}

interface RetryableError extends Error {
  code?: string;
  status?: number;
  meta?: {
    statusCode?: number;
  };
}

// Default retry options
const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,          // Maximum number of retry attempts
  baseDelayMs: 100,        // Initial delay in milliseconds
  maxDelayMs: 10000,       // Maximum delay cap
  factor: 2,               // Exponential factor
  jitter: true,            // Add random jitter to prevent thundering herd
  jitterFactor: 0.5,       // Jitter range (0.5 = delay * [0.5, 1.5])
  retryOn: null            // Custom function to determine if error is retryable
};

// Common retryable error conditions
const isRetryableError = (error: RetryableError): boolean => {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
    return true;
  }

  // HTTP 5xx errors
  if (error.status !== undefined && error.status >= 500 && error.status < 600) {
    return true;
  }

  // Rate limiting (429)
  if (error.status === 429) {
    return true;
  }

  // PostgreSQL transient errors
  if (error.code === '40001' || error.code === '40P01') { // serialization_failure, deadlock_detected
    return true;
  }

  // Redis connection errors
  if (error.code === 'NR_CLOSED' || error.code === 'CONNECTION_BROKEN') {
    return true;
  }

  return false;
};

// Errors that should never be retried
const isNonRetryableError = (error: RetryableError): boolean => {
  // Validation errors
  if (error.name === 'ValidationError') {
    return true;
  }

  // Authentication errors
  if (error.status === 401 || error.status === 403) {
    return true;
  }

  // Not found
  if (error.status === 404) {
    return true;
  }

  // Bad request
  if (error.status === 400) {
    return true;
  }

  return false;
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  // Calculate base exponential delay
  let delay = options.baseDelayMs * Math.pow(options.factor, attempt - 1);

  // Cap at maximum delay
  delay = Math.min(delay, options.maxDelayMs);

  // Add jitter if enabled
  if (options.jitter) {
    const jitterRange = delay * options.jitterFactor;
    delay = delay - jitterRange + (Math.random() * jitterRange * 2);
  }

  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const retryOn = opts.retryOn || isRetryableError;

  let lastError: RetryableError;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as RetryableError;

      // Don't retry non-retryable errors
      if (isNonRetryableError(lastError)) {
        throw lastError;
      }

      // Check if we've exhausted attempts
      if (attempt === opts.maxAttempts) {
        logger.error({
          attempt,
          maxAttempts: opts.maxAttempts,
          error: lastError.message
        }, 'All retry attempts exhausted');
        throw lastError;
      }

      // Check if error is retryable
      if (!retryOn(lastError)) {
        logger.warn({
          attempt,
          error: lastError.message
        }, 'Error is not retryable, failing immediately');
        throw lastError;
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(attempt, opts);

      logger.warn({
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: delay,
        error: lastError.message
      }, 'Retrying after transient error');

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Create a retry wrapper for a specific function
 */
export function createRetryWrapper<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  options: Partial<RetryOptions> = {}
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    return withRetry(() => fn(...args), options);
  };
}

// ============================================================
// Pre-configured Retry Strategies
// ============================================================

/**
 * Retry strategy for database operations
 */
export const databaseRetryOptions: Partial<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 50,
  maxDelayMs: 1000,
  factor: 2,
  jitter: true,
  retryOn: (error: RetryableError): boolean => {
    // PostgreSQL transient errors
    return error.code === '40001' ||  // serialization_failure
           error.code === '40P01' ||  // deadlock_detected
           error.code === '53300' ||  // too_many_connections
           error.code === 'ECONNRESET';
  }
};

/**
 * Retry strategy for payment operations
 * More conservative - fewer retries, longer delays
 */
export const paymentRetryOptions: Partial<RetryOptions> = {
  maxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  factor: 2,
  jitter: true,
  retryOn: (error: RetryableError): boolean => {
    // Only retry on network issues, not on payment-specific errors
    return error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT' ||
           error.status === 502 ||
           error.status === 503 ||
           error.status === 504;
  }
};

/**
 * Retry strategy for external API calls
 */
export const externalApiRetryOptions: Partial<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 5000,
  factor: 2,
  jitter: true,
  retryOn: (error: RetryableError): boolean => {
    return error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT' ||
           error.status === 429 ||  // Rate limited
           (error.status !== undefined && error.status >= 500);
  }
};

/**
 * Retry strategy for cache operations (Redis)
 */
export const cacheRetryOptions: Partial<RetryOptions> = {
  maxAttempts: 2,
  baseDelayMs: 50,
  maxDelayMs: 500,
  factor: 2,
  jitter: true,
  retryOn: (error: RetryableError): boolean => {
    return error.code === 'NR_CLOSED' ||
           error.code === 'CONNECTION_BROKEN' ||
           error.code === 'ECONNRESET';
  }
};

/**
 * Retry strategy for Elasticsearch operations
 */
export const searchRetryOptions: Partial<RetryOptions> = {
  maxAttempts: 2,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  factor: 2,
  jitter: true,
  retryOn: (error: RetryableError): boolean => {
    return error.code === 'ECONNRESET' ||
           error.name === 'ConnectionError' ||
           (error.meta?.statusCode !== undefined && error.meta.statusCode >= 500);
  }
};

/**
 * Execute database operation with retry
 */
export async function withDatabaseRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, databaseRetryOptions);
}

/**
 * Execute payment operation with retry
 */
export async function withPaymentRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, paymentRetryOptions);
}

/**
 * Execute external API call with retry
 */
export async function withApiRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, externalApiRetryOptions);
}

/**
 * Execute cache operation with retry
 */
export async function withCacheRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, cacheRetryOptions);
}

/**
 * Execute search operation with retry
 */
export async function withSearchRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, searchRetryOptions);
}

export default {
  withRetry,
  createRetryWrapper,
  withDatabaseRetry,
  withPaymentRetry,
  withApiRetry,
  withCacheRetry,
  withSearchRetry,
  databaseRetryOptions,
  paymentRetryOptions,
  externalApiRetryOptions,
  cacheRetryOptions,
  searchRetryOptions
};
