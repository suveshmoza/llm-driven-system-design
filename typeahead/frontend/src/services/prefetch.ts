/**
 * Prefetch service for predictive suggestion loading.
 * Uses keyboard adjacency and common patterns to prefetch likely next queries.
 */
import { api } from './api.js';

// Keyboard adjacency map for QWERTY layout
const ADJACENT_KEYS: Record<string, string[]> = {
  a: ['q', 'w', 's', 'z'],
  b: ['v', 'g', 'h', 'n'],
  c: ['x', 'd', 'f', 'v'],
  d: ['s', 'e', 'r', 'f', 'c', 'x'],
  e: ['w', 's', 'd', 'r'],
  f: ['d', 'r', 't', 'g', 'v', 'c'],
  g: ['f', 't', 'y', 'h', 'b', 'v'],
  h: ['g', 'y', 'u', 'j', 'n', 'b'],
  i: ['u', 'j', 'k', 'o'],
  j: ['h', 'u', 'i', 'k', 'm', 'n'],
  k: ['j', 'i', 'o', 'l', 'm'],
  l: ['k', 'o', 'p'],
  m: ['n', 'j', 'k'],
  n: ['b', 'h', 'j', 'm'],
  o: ['i', 'k', 'l', 'p'],
  p: ['o', 'l'],
  q: ['w', 'a'],
  r: ['e', 'd', 'f', 't'],
  s: ['a', 'w', 'e', 'd', 'x', 'z'],
  t: ['r', 'f', 'g', 'y'],
  u: ['y', 'h', 'j', 'i'],
  v: ['c', 'f', 'g', 'b'],
  w: ['q', 'a', 's', 'e'],
  x: ['z', 's', 'd', 'c'],
  y: ['t', 'g', 'h', 'u'],
  z: ['a', 's', 'x'],
};

// Common prefixes that are likely to be searched
const POPULAR_PREFIXES = [
  'how',
  'what',
  'why',
  'when',
  'where',
  'who',
  'best',
  'top',
  'new',
  'free',
];

interface PrefetchOptions {
  maxPrefetches?: number;
  userId?: string;
  limit?: number;
}

class PrefetchService {
  private prefetchedPrefixes = new Set<string>();
  private pendingPrefetches = new Set<string>();
  private idleCallbackId: number | null = null;

  /**
   * Prefetch suggestions for adjacent keys from current query.
   */
  prefetchAdjacent(query: string, options: PrefetchOptions = {}): void {
    const { maxPrefetches = 3, userId, limit = 5 } = options;

    if (!query || query.length === 0) return;

    const lastChar = query.slice(-1).toLowerCase();
    const adjacentKeys = ADJACENT_KEYS[lastChar] || [];
    const basePrefix = query.slice(0, -1);

    // Get adjacent prefixes
    const prefixesToFetch = adjacentKeys
      .map((key) => basePrefix + key)
      .filter((prefix) => !this.prefetchedPrefixes.has(prefix))
      .slice(0, maxPrefetches);

    this.schedulePrefetch(prefixesToFetch, { userId, limit });
  }

  /**
   * Prefetch popular/common prefixes on page load.
   */
  warmCache(options: PrefetchOptions = {}): void {
    const { userId, limit = 5 } = options;

    const prefixesToFetch = POPULAR_PREFIXES.filter(
      (prefix) => !this.prefetchedPrefixes.has(prefix)
    );

    this.schedulePrefetch(prefixesToFetch, { userId, limit });
  }

  /**
   * Prefetch next character variations (a-z).
   */
  prefetchNextChars(query: string, options: PrefetchOptions = {}): void {
    const { maxPrefetches = 5, userId, limit = 5 } = options;

    if (!query) return;

    // Most common next characters based on English letter frequency
    const commonChars = ['e', 't', 'a', 'o', 'i', 'n', 's', 'h', 'r'];
    const prefixesToFetch = commonChars
      .map((char) => query + char)
      .filter((prefix) => !this.prefetchedPrefixes.has(prefix))
      .slice(0, maxPrefetches);

    this.schedulePrefetch(prefixesToFetch, { userId, limit });
  }

  /**
   * Schedule prefetch during browser idle time.
   */
  private schedulePrefetch(
    prefixes: string[],
    options: { userId?: string; limit: number }
  ): void {
    if (prefixes.length === 0) return;

    // Filter out already pending prefetches
    const newPrefixes = prefixes.filter((p) => !this.pendingPrefetches.has(p));
    if (newPrefixes.length === 0) return;

    newPrefixes.forEach((p) => this.pendingPrefetches.add(p));

    // Use requestIdleCallback if available, otherwise setTimeout
    if ('requestIdleCallback' in window) {
      this.idleCallbackId = window.requestIdleCallback(
        (deadline) => {
          this.executePrefetch(newPrefixes, options, deadline);
        },
        { timeout: 2000 }
      );
    } else {
      setTimeout(() => {
        this.executePrefetch(newPrefixes, options);
      }, 100);
    }
  }

  /**
   * Execute prefetch requests.
   */
  private async executePrefetch(
    prefixes: string[],
    options: { userId?: string; limit: number },
    deadline?: IdleDeadline
  ): Promise<void> {
    for (const prefix of prefixes) {
      // Check if we still have idle time (for requestIdleCallback)
      if (deadline && deadline.timeRemaining() < 10) {
        // Reschedule remaining prefetches
        const remaining = prefixes.slice(prefixes.indexOf(prefix));
        this.schedulePrefetch(remaining, options);
        return;
      }

      try {
        // Fire-and-forget - the response will be cached by api.ts
        await api.getSuggestions(prefix, {
          limit: options.limit,
          userId: options.userId,
        });

        this.prefetchedPrefixes.add(prefix);
        this.pendingPrefetches.delete(prefix);
      } catch {
        // Silently fail - prefetch is best-effort
        this.pendingPrefetches.delete(prefix);
      }
    }
  }

  /**
   * Cancel any pending prefetch operations.
   */
  cancel(): void {
    if (this.idleCallbackId !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
    this.pendingPrefetches.clear();
  }

  /**
   * Clear prefetch tracking (useful for cache invalidation).
   */
  reset(): void {
    this.cancel();
    this.prefetchedPrefixes.clear();
  }

  /**
   * Get stats about prefetch activity.
   */
  getStats(): { prefetched: number; pending: number } {
    return {
      prefetched: this.prefetchedPrefixes.size,
      pending: this.pendingPrefetches.size,
    };
  }
}

// Singleton instance
export const prefetchService = new PrefetchService();

// Convenience functions
export const prefetchAdjacent = prefetchService.prefetchAdjacent.bind(prefetchService);
export const warmCache = prefetchService.warmCache.bind(prefetchService);
export const prefetchNextChars = prefetchService.prefetchNextChars.bind(prefetchService);
