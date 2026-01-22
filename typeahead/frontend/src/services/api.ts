import type {
  SuggestionsResponse,
  TrendingResponse,
  HistoryResponse,
  AnalyticsSummary,
  HourlyStats,
  TopPhrase,
  SystemStatus,
} from '../types';
import { memoryCache } from './cache.js';

const API_BASE = '/api/v1';
const DEFAULT_TIMEOUT = 5000; // 5 seconds

class ApiService {
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * Make an HTTP request with automatic timeout and abort handling.
   */
  private async request<T>(
    endpoint: string,
    options?: RequestInit & { signal?: AbortSignal }
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Cancel any pending requests for a given request group.
   * Used to abort previous suggestion requests when user types new characters.
   */
  private cancelPendingRequests(requestGroup: string): void {
    for (const [key, controller] of this.abortControllers.entries()) {
      if (key.startsWith(requestGroup)) {
        controller.abort();
        this.abortControllers.delete(key);
      }
    }
  }

  /**
   * Create a combined abort signal with timeout.
   */
  private createSignalWithTimeout(
    controller: AbortController,
    timeoutMs: number = DEFAULT_TIMEOUT
  ): AbortSignal {
    // Use AbortSignal.any if available (modern browsers)
    if ('any' in AbortSignal) {
      return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    }

    // Fallback for older browsers: manual timeout
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    controller.signal.addEventListener('abort', () => clearTimeout(timeoutId));
    return controller.signal;
  }

  // Suggestions
  async getSuggestions(
    prefix: string,
    options: { limit?: number; userId?: string; fuzzy?: boolean } = {}
  ): Promise<SuggestionsResponse> {
    const cacheKey = `suggestions:${prefix}:${options.limit || 5}:${options.fuzzy || false}`;

    // Check memory cache first
    const cached = memoryCache.get<SuggestionsResponse>(cacheKey);
    if (cached) {
      return { ...cached, meta: { ...cached.meta, cached: true } };
    }

    // Cancel any pending suggestion requests
    this.cancelPendingRequests('suggestions:');

    // Create new abort controller for this request
    const controller = new AbortController();
    const requestKey = `suggestions:${prefix}`;
    this.abortControllers.set(requestKey, controller);

    try {
      const params = new URLSearchParams({
        q: prefix,
        limit: String(options.limit || 5),
      });

      if (options.userId) {
        params.append('userId', options.userId);
      }

      if (options.fuzzy) {
        params.append('fuzzy', 'true');
      }

      const signal = this.createSignalWithTimeout(controller);

      const response = await this.request<SuggestionsResponse>(`/suggestions?${params}`, {
        signal,
      });

      // Cache the response
      memoryCache.set(cacheKey, response, 60_000); // 60s TTL

      return response;
    } catch (error) {
      // Don't throw on intentional abort
      if ((error as Error).name === 'AbortError') {
        throw error; // Let caller handle abort
      }
      throw error;
    } finally {
      this.abortControllers.delete(requestKey);
    }
  }

  async logSearch(query: string, userId?: string, sessionId?: string): Promise<void> {
    // Invalidate cache for this query's prefix
    memoryCache.invalidatePrefix(`suggestions:${query.substring(0, 3)}`);

    await this.request('/suggestions/log', {
      method: 'POST',
      body: JSON.stringify({ query, userId, sessionId }),
    });
  }

  async getTrending(limit = 10): Promise<TrendingResponse> {
    const cacheKey = `trending:${limit}`;

    // Check memory cache
    const cached = memoryCache.get<TrendingResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.request<TrendingResponse>(`/suggestions/trending?limit=${limit}`);

    // Cache with shorter TTL for trending (30s)
    memoryCache.set(cacheKey, response, 30_000);

    return response;
  }

  async getHistory(userId: string, limit = 10): Promise<HistoryResponse> {
    // User-specific data - don't cache in shared memory
    return this.request<HistoryResponse>(`/suggestions/history?userId=${userId}&limit=${limit}`);
  }

  // Analytics
  async getAnalyticsSummary(): Promise<AnalyticsSummary> {
    const cacheKey = 'analytics:summary';
    const cached = memoryCache.get<AnalyticsSummary>(cacheKey);
    if (cached) return cached;

    const response = await this.request<AnalyticsSummary>('/analytics/summary');
    memoryCache.set(cacheKey, response, 30_000); // 30s TTL
    return response;
  }

  async getHourlyStats(): Promise<{ hourly: HourlyStats[] }> {
    const cacheKey = 'analytics:hourly';
    const cached = memoryCache.get<{ hourly: HourlyStats[] }>(cacheKey);
    if (cached) return cached;

    const response = await this.request<{ hourly: HourlyStats[] }>('/analytics/hourly');
    memoryCache.set(cacheKey, response, 60_000); // 60s TTL
    return response;
  }

  async getTopPhrases(limit = 50): Promise<{ phrases: TopPhrase[]; meta: { count: number } }> {
    const cacheKey = `analytics:top-phrases:${limit}`;
    const cached = memoryCache.get<{ phrases: TopPhrase[]; meta: { count: number } }>(cacheKey);
    if (cached) return cached;

    const response = await this.request<{ phrases: TopPhrase[]; meta: { count: number } }>(
      `/analytics/top-phrases?limit=${limit}`
    );
    memoryCache.set(cacheKey, response, 60_000);
    return response;
  }

  // Admin
  async getSystemStatus(): Promise<SystemStatus> {
    // Don't cache admin status - always fresh
    return this.request<SystemStatus>('/admin/status');
  }

  async rebuildTrie(): Promise<{ success: boolean; message: string; stats: unknown }> {
    // Clear all suggestion caches when trie is rebuilt
    memoryCache.invalidatePrefix('suggestions:');

    return this.request('/admin/trie/rebuild', { method: 'POST' });
  }

  async clearCache(): Promise<{ success: boolean; message: string }> {
    // Clear local cache too
    memoryCache.clear();

    return this.request('/admin/cache/clear', { method: 'POST' });
  }

  async addPhrase(
    phrase: string,
    count = 1
  ): Promise<{ success: boolean; phrase: string; count: number }> {
    // Invalidate related caches
    memoryCache.invalidatePrefix(`suggestions:${phrase.substring(0, 3)}`);

    return this.request('/admin/phrases', {
      method: 'POST',
      body: JSON.stringify({ phrase, count }),
    });
  }

  async filterPhrase(phrase: string, reason = 'manual'): Promise<{ success: boolean; phrase: string }> {
    // Invalidate related caches
    memoryCache.invalidatePrefix(`suggestions:${phrase.substring(0, 3)}`);

    return this.request('/admin/filter', {
      method: 'POST',
      body: JSON.stringify({ phrase, reason }),
    });
  }

  async getFilteredPhrases(limit = 100): Promise<{
    filtered: Array<{ phrase: string; reason: string; added_at: string }>;
    meta: { count: number };
  }> {
    return this.request(`/admin/filtered?limit=${limit}`);
  }

  /**
   * Clear the in-memory cache.
   */
  clearLocalCache(): void {
    memoryCache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number; maxSize: number; defaultTtl: number } {
    return memoryCache.getStats();
  }
}

export const api = new ApiService();
