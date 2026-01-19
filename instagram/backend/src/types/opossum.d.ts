/**
 * Type declarations for 'opossum' module.
 * This provides minimal types until @types/opossum is installed via npm install.
 */
declare module 'opossum' {
  import { EventEmitter } from 'events';

  export interface CircuitBreakerOptions {
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
    abortController?: AbortController;
    enableSnapshots?: boolean;
    rotateBucketController?: AbortController;
  }

  export interface Stats {
    failures: number;
    fallbacks: number;
    successes: number;
    rejects: number;
    fires: number;
    timeouts: number;
    cacheHits: number;
    cacheMisses: number;
    semaphoreRejections: number;
    percentiles: Record<number, number>;
    latencyTimes: number[];
    latencyMean?: number;
  }

  class CircuitBreaker<TI extends unknown[] = unknown[], TO = unknown> extends EventEmitter {
    constructor(action: (...args: TI) => Promise<TO>, options?: CircuitBreakerOptions);

    readonly name: string;
    readonly group: string;
    readonly enabled: boolean;
    readonly pendingClose: boolean;
    readonly closed: boolean;
    readonly opened: boolean;
    readonly halfOpen: boolean;
    readonly isShutdown: boolean;
    readonly status: Status;
    readonly stats: Stats;
    readonly warmUp: boolean;
    readonly volumeThreshold: number;

    fire(...args: TI): Promise<TO>;
    call(...args: TI): Promise<TO>;
    clearCache(): void;
    open(): void;
    close(): void;
    disable(): void;
    enable(): void;
    shutdown(): void;
    fallback(func: (...args: TI) => TO | Promise<TO>): this;
    healthCheck(func: () => Promise<void>, interval?: number): void;

    on(event: 'success', listener: (result: TO, latencyMs: number) => void): this;
    on(event: 'timeout', listener: (error: Error) => void): this;
    on(event: 'reject', listener: (error: Error) => void): this;
    on(event: 'open', listener: () => void): this;
    on(event: 'halfOpen', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'shutdown', listener: () => void): this;
    on(event: 'fire', listener: (args: TI) => void): this;
    on(event: 'cacheHit', listener: () => void): this;
    on(event: 'cacheMiss', listener: () => void): this;
    on(event: 'semaphoreLocked', listener: (error: Error) => void): this;
    on(event: 'healthCheckFailed', listener: (error: Error) => void): this;
    on(event: 'fallback', listener: (result: TO, error: Error) => void): this;
    on(event: 'failure', listener: (error: Error, latencyMs: number, args: TI) => void): this;
  }

  export interface Status extends EventEmitter {
    stats: Stats;
    window: Window;
  }

  export interface Window {
    buckets: Bucket[];
    length: number;
  }

  export interface Bucket {
    failures: number;
    successes: number;
    rejects: number;
    fires: number;
    timeouts: number;
    cacheHits: number;
    cacheMisses: number;
    semaphoreRejections: number;
    percentiles: Record<number, number>;
    latencyTimes: number[];
  }

  export default CircuitBreaker;
}
