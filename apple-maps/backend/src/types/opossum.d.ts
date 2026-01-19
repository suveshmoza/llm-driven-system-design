declare module 'opossum' {
  import { EventEmitter } from 'events';

  interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    volumeThreshold?: number;
    rollingCountTimeout?: number;
    rollingCountBuckets?: number;
    name?: string;
    group?: string;
    rollingPercentilesEnabled?: boolean;
    capacity?: number;
    errorFilter?: (error: Error) => boolean;
    cache?: boolean;
    cacheTTL?: number;
    cacheGetKey?: (...args: unknown[]) => string;
    cacheTransport?: object;
    abortController?: AbortController;
    enableSnapshots?: boolean;
    rotateBucketController?: object;
  }

  interface CircuitBreakerStats {
    successes: number;
    failures: number;
    fallbacks: number;
    rejects: number;
    fires: number;
    timeouts: number;
    cacheHits: number;
    cacheMisses: number;
    semaphoreRejections: number;
    percentiles: Record<string, number>;
    latencyTimes: number[];
    latencyMean: number;
  }

  class CircuitBreaker<TArgs extends unknown[] = unknown[], TResult = unknown> extends EventEmitter {
    constructor(action: (...args: TArgs) => Promise<TResult>, options?: CircuitBreakerOptions);

    readonly name: string;
    readonly group: string;
    readonly enabled: boolean;
    readonly pendingClose: boolean;
    readonly closed: boolean;
    readonly opened: boolean;
    readonly halfOpen: boolean;
    readonly isShutdown: boolean;
    readonly status: object;
    readonly stats: CircuitBreakerStats;
    readonly warmUp: boolean;
    readonly volumeThreshold: number;

    fire(...args: TArgs): Promise<TResult>;
    call(context: unknown, ...args: TArgs): Promise<TResult>;
    open(): void;
    close(): void;
    disable(): void;
    enable(): void;
    shutdown(): void;
    clearCache(): void;
    healthCheck(func: () => Promise<unknown>, interval?: number): void;
    fallback(func: (...args: TArgs) => Promise<TResult> | TResult): CircuitBreaker<TArgs, TResult>;

    on(event: 'success', listener: (result: TResult, latencyMs: number) => void): this;
    on(event: 'timeout', listener: (error: Error, latencyMs: number, ...args: TArgs) => void): this;
    on(event: 'reject', listener: (error: Error) => void): this;
    on(event: 'open', listener: () => void): this;
    on(event: 'halfOpen', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'fallback', listener: (result: TResult, ...args: TArgs) => void): this;
    on(event: 'failure', listener: (error: Error, latencyMs: number, ...args: TArgs) => void): this;
    on(event: 'semaphoreLocked', listener: (error: Error, ...args: TArgs) => void): this;
    on(event: 'healthCheckFailed', listener: (error: Error) => void): this;
    on(event: 'shutdown', listener: () => void): this;
    on(event: 'cacheHit', listener: () => void): this;
    on(event: 'cacheMiss', listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export default CircuitBreaker;
  export { CircuitBreaker, CircuitBreakerOptions, CircuitBreakerStats };
}
