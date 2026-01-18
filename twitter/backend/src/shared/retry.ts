import logger from './logger.js';

/**
 * Retry Configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  context?: string;
  isRetryable?: (error: RetryableError) => boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => Promise<void>;
}

interface RetryableError extends Error {
  code?: string;
  status?: number;
  statusCode?: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  jitterFactor: 0.2, // Add up to 20% random jitter
};

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: RetryableError): boolean {
  // Network errors
  if (error.code) {
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EPIPE',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN',
      'ENOTFOUND',
    ];
    if (retryableCodes.includes(error.code)) {
      return true;
    }
  }

  // HTTP status codes
  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode;
    // Retry on 429 (rate limited) and 5xx (server errors)
    if (status === 429 || (status && status >= 500 && status < 600)) {
      return true;
    }
    // Don't retry on other 4xx errors
    if (status && status >= 400 && status < 500) {
      return false;
    }
  }

  // PostgreSQL connection errors
  if (error.message?.includes('connection') || error.message?.includes('timeout')) {
    return true;
  }

  // Redis errors
  if (error.message?.includes('READONLY') || error.message?.includes('CLUSTERDOWN')) {
    return true;
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(attempt: number, config: RetryConfig = DEFAULT_CONFIG): number {
  // Exponential backoff
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter to prevent thundering herd
  const jitter = cappedDelay * config.jitterFactor * Math.random();

  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryConfig> = {}
): Promise<T> {
  const config: RetryConfig = {
    ...DEFAULT_CONFIG,
    ...options,
  };

  const context = options.context || 'operation';
  const checkRetryable = options.isRetryable || isRetryableError;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (attempt === config.maxAttempts) {
        logger.error(
          {
            context,
            attempt,
            maxAttempts: config.maxAttempts,
            error: (error as Error).message,
          },
          `${context} failed after ${config.maxAttempts} attempts`,
        );
        throw error;
      }

      if (!checkRetryable(error as RetryableError)) {
        logger.warn(
          {
            context,
            attempt,
            error: (error as Error).message,
            retryable: false,
          },
          `${context} failed with non-retryable error`,
        );
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, config);

      logger.warn(
        {
          context,
          attempt,
          maxAttempts: config.maxAttempts,
          delayMs: delay,
          error: (error as Error).message,
        },
        `${context} failed, retrying in ${delay}ms`,
      );

      // Call onRetry callback if provided
      if (options.onRetry) {
        await options.onRetry(error as Error, attempt, delay);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retryable version of a function
 */
export function retryable<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: Partial<RetryConfig> = {}
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return withRetry(() => fn(...args), options) as Promise<ReturnType<T>>;
  };
}

/**
 * Predefined retry configurations for common use cases
 */

/**
 * Configuration for database operations
 */
export const DATABASE_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  context: 'database_operation',
};

/**
 * Configuration for Redis operations
 */
export const REDIS_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 2,
  baseDelayMs: 50,
  maxDelayMs: 1000,
  context: 'redis_operation',
};

/**
 * Configuration for external API calls
 */
export const EXTERNAL_API_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  context: 'external_api_call',
};

/**
 * Configuration for fanout operations
 */
export const FANOUT_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 5,
  baseDelayMs: 200,
  maxDelayMs: 15000,
  context: 'fanout_operation',
};

export default {
  withRetry,
  retryable,
  isRetryableError,
  calculateDelay,
  sleep,
  DATABASE_RETRY_CONFIG,
  REDIS_RETRY_CONFIG,
  EXTERNAL_API_RETRY_CONFIG,
  FANOUT_RETRY_CONFIG,
};
