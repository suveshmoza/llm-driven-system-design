declare module 'opossum' {
  interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    volumeThreshold?: number;
    rollingCountBuckets?: number;
    rollingCountTimeout?: number;
    rollingPercentilesEnabled?: boolean;
    cache?: boolean;
    cacheTTL?: number;
    errorFilter?: (error: Error) => boolean;
    allowWarmUp?: boolean;
    [key: string]: unknown;
  }

  interface CircuitBreakerStats {
    fires?: number;
    successes?: number;
    failures?: number;
    rejects?: number;
    timeouts?: number;
    fallbacks?: number;
    cacheHits?: number;
    cacheMisses?: number;
    [key: string]: number | undefined;
  }

  interface CircuitBreakerStatus {
    stats: CircuitBreakerStats;
    state: 'OPENED' | 'CLOSED' | 'HALF_OPEN';
    [key: string]: unknown;
  }

  class CircuitBreaker<T extends unknown[] = unknown[], R = unknown> {
    constructor(action: (...args: T) => Promise<R>, options?: CircuitBreakerOptions);

    fire(...args: T): Promise<R>;
    fallback(fn: (...args: T) => R | Promise<R>): this;

    open(): void;
    close(): void;
    toHalfOpen(): void;

    get opened(): boolean;
    get halfOpen(): boolean;
    get closed(): boolean;
    get status(): CircuitBreakerStatus;
    get stats(): CircuitBreakerStats;
    get enabled(): boolean;
    get warmUp(): boolean;

    enable(): void;
    disable(): void;

    on(event: 'open' | 'close' | 'halfOpen' | 'fallback' | 'success' | 'failure' | 'reject' | 'timeout', listener: (...args: unknown[]) => void): this;
    off(event: string, listener: (...args: unknown[]) => void): this;
    removeAllListeners(event?: string): this;

    clearCache(): void;
  }

  export = CircuitBreaker;
}
