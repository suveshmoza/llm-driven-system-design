/**
 * Performance monitoring service for typeahead metrics.
 * Tracks latency, interaction timing, and cache effectiveness.
 */

export interface TypeaheadMetrics {
  // Latency metrics
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;

  // Request metrics
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;

  // Interaction metrics
  avgKeyToSuggestionMs: number;
  avgSelectionTimeMs: number;
  selectionsCount: number;

  // Error metrics
  errorCount: number;
  errorRate: number;
}

interface LatencySample {
  timestamp: number;
  durationMs: number;
  cached: boolean;
}

interface InteractionSample {
  keyPressTime: number;
  suggestionTime?: number;
  selectionTime?: number;
}

class PerformanceMonitor {
  private latencySamples: LatencySample[] = [];
  private interactions: InteractionSample[] = [];
  private errorCount = 0;
  private maxSamples = 1000;
  private currentInteraction: InteractionSample | null = null;

  /**
   * Record a suggestion request latency.
   */
  recordLatency(durationMs: number, cached: boolean = false): void {
    this.latencySamples.push({
      timestamp: Date.now(),
      durationMs,
      cached,
    });

    // Trim old samples
    if (this.latencySamples.length > this.maxSamples) {
      this.latencySamples = this.latencySamples.slice(-this.maxSamples);
    }
  }

  /**
   * Record when user starts typing (key press).
   */
  recordKeyPress(): void {
    this.currentInteraction = {
      keyPressTime: performance.now(),
    };
  }

  /**
   * Record when suggestions are displayed.
   */
  recordSuggestionsDisplayed(): void {
    if (this.currentInteraction) {
      this.currentInteraction.suggestionTime = performance.now();
    }
  }

  /**
   * Record when user selects a suggestion.
   */
  recordSelection(): void {
    if (this.currentInteraction) {
      this.currentInteraction.selectionTime = performance.now();
      this.interactions.push(this.currentInteraction);
      this.currentInteraction = null;

      // Trim old interactions
      if (this.interactions.length > this.maxSamples) {
        this.interactions = this.interactions.slice(-this.maxSamples);
      }
    }
  }

  /**
   * Record an error.
   */
  recordError(): void {
    this.errorCount++;
  }

  /**
   * Get comprehensive metrics.
   */
  getMetrics(): TypeaheadMetrics {
    const latencies = this.latencySamples.map((s) => s.durationMs).sort((a, b) => a - b);
    const cacheHits = this.latencySamples.filter((s) => s.cached).length;
    const cacheMisses = this.latencySamples.filter((s) => !s.cached).length;
    const totalRequests = this.latencySamples.length;

    // Latency percentiles
    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, index)];
    };

    // Key-to-suggestion timing
    const keyToSuggestionTimes = this.interactions
      .filter((i) => i.suggestionTime !== undefined)
      .map((i) => i.suggestionTime! - i.keyPressTime);

    // Selection timing (from key press to selection)
    const selectionTimes = this.interactions
      .filter((i) => i.selectionTime !== undefined)
      .map((i) => i.selectionTime! - i.keyPressTime);

    const avg = (arr: number[]): number => {
      if (arr.length === 0) return 0;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };

    return {
      avgLatencyMs: avg(latencies),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      p99LatencyMs: percentile(latencies, 99),

      totalRequests,
      cacheHits,
      cacheMisses,
      cacheHitRate: totalRequests > 0 ? cacheHits / totalRequests : 0,

      avgKeyToSuggestionMs: avg(keyToSuggestionTimes),
      avgSelectionTimeMs: avg(selectionTimes),
      selectionsCount: selectionTimes.length,

      errorCount: this.errorCount,
      errorRate: totalRequests > 0 ? this.errorCount / totalRequests : 0,
    };
  }

  /**
   * Get metrics for the last N minutes.
   */
  getRecentMetrics(minutes: number = 5): TypeaheadMetrics {
    const cutoff = Date.now() - minutes * 60 * 1000;
    const originalSamples = this.latencySamples;

    // Temporarily filter to recent samples
    this.latencySamples = this.latencySamples.filter((s) => s.timestamp >= cutoff);
    const metrics = this.getMetrics();

    // Restore original samples
    this.latencySamples = originalSamples;

    return metrics;
  }

  /**
   * Set up PerformanceObserver for resource timing.
   */
  observeResourceTiming(): void {
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'resource') {
            const resourceEntry = entry as PerformanceResourceTiming;
            // Track API requests
            if (resourceEntry.name.includes('/api/v1/suggestions')) {
              const duration = resourceEntry.responseEnd - resourceEntry.requestStart;
              // Check if it was served from cache (transferSize === 0)
              const cached = resourceEntry.transferSize === 0;
              this.recordLatency(duration, cached);
            }
          }
        }
      });

      observer.observe({ entryTypes: ['resource'] });
    } catch {
      // PerformanceObserver not supported or failed
      console.warn('[PerfMonitor] PerformanceObserver not available');
    }
  }

  /**
   * Clear all metrics.
   */
  reset(): void {
    this.latencySamples = [];
    this.interactions = [];
    this.errorCount = 0;
    this.currentInteraction = null;
  }

  /**
   * Export metrics as JSON for debugging or analytics.
   */
  exportMetrics(): string {
    return JSON.stringify(
      {
        metrics: this.getMetrics(),
        recentMetrics: this.getRecentMetrics(5),
        sampleCount: this.latencySamples.length,
        interactionCount: this.interactions.length,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Convenience functions
export const recordLatency = performanceMonitor.recordLatency.bind(performanceMonitor);
export const recordKeyPress = performanceMonitor.recordKeyPress.bind(performanceMonitor);
export const recordSuggestionsDisplayed =
  performanceMonitor.recordSuggestionsDisplayed.bind(performanceMonitor);
export const recordSelection = performanceMonitor.recordSelection.bind(performanceMonitor);
export const recordError = performanceMonitor.recordError.bind(performanceMonitor);
export const getMetrics = performanceMonitor.getMetrics.bind(performanceMonitor);
