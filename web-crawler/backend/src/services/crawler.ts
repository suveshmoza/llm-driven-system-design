/**
 * @fileoverview Crawler Worker Service for fetching and processing web pages.
 *
 * This service contains the core crawling logic for a distributed web crawler worker.
 * Each worker runs independently, fetching URLs from the frontier, downloading pages,
 * extracting content and links, and storing results.
 *
 * Key responsibilities:
 * - Main crawl loop with error recovery
 * - HTTP request handling with timeouts and size limits
 * - HTML parsing and link extraction using Cheerio
 * - Content hashing for duplicate detection
 * - Worker registration and heartbeat for health monitoring
 * - Statistics tracking via Redis counters
 *
 * A typical crawl cycle:
 * 1. Get next URL from frontier (respects priority and rate limits)
 * 2. Check robots.txt permissions
 * 3. Fetch page content via HTTP
 * 4. Parse HTML and extract metadata (title, description)
 * 5. Extract and normalize links for the frontier
 * 6. Store results in PostgreSQL
 * 7. Mark URL as completed and update stats
 *
 * @module services/crawler
 */

import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { pool } from '../models/database.js';
import { redis, REDIS_KEYS } from '../models/redis.js';
import { frontierService, FrontierUrl } from './frontier.js';
import { robotsService } from './robots.js';
import {
  extractDomain,
  resolveUrl,
  shouldCrawl,
  normalizeUrl,
  hashUrl,
  hashContent,
} from '../utils/url.js';
import { config } from '../config.js';

/**
 * Result of crawling a single URL.
 * Contains all extracted data and metadata about the crawl operation.
 */
export interface CrawlResult {
  /** The original URL that was crawled */
  url: string;
  /** SHA-256 hash of the normalized URL */
  urlHash: string;
  /** HTTP status code (0 if request failed) */
  statusCode: number;
  /** Content-Type header value */
  contentType: string;
  /** Size of the content in bytes */
  contentLength: number;
  /** SHA-256 hash of the content for duplicate detection */
  contentHash: string;
  /** Extracted page title */
  title: string;
  /** Extracted meta description */
  description: string;
  /** Array of normalized URLs extracted from the page */
  linksFound: string[];
  /** Time taken to crawl in milliseconds */
  crawlDurationMs: number;
  /** Error message if crawl failed */
  error?: string;
}

/**
 * Crawler Worker Service - the workhorse of the distributed web crawler.
 *
 * Each CrawlerService instance represents a single worker process that:
 * - Runs continuously, fetching and processing URLs
 * - Registers itself with Redis for monitoring
 * - Sends periodic heartbeats to indicate health
 * - Respects politeness rules (robots.txt, rate limiting)
 *
 * Workers are stateless and horizontally scalable - you can run as many
 * as needed to increase crawl throughput.
 *
 * @example
 * ```typescript
 * import { CrawlerService } from './services/crawler';
 *
 * const crawler = new CrawlerService('worker-1');
 * await crawler.start();
 *
 * // On shutdown
 * await crawler.stop();
 * ```
 */
export class CrawlerService {
  /** Unique identifier for this worker instance */
  private workerId: string;
  /** Whether the crawl loop is running */
  private isRunning: boolean = false;
  /** Total number of pages crawled by this worker */
  private crawlCount: number = 0;
  /** Unix timestamp when worker started */
  private startTime: number = 0;

  /**
   * Creates a new CrawlerService instance.
   *
   * @param workerId - Unique identifier for this worker (e.g., 'worker-1')
   */
  constructor(workerId: string) {
    this.workerId = workerId;
  }

  /**
   * Starts the crawler worker.
   *
   * This method:
   * 1. Registers the worker in Redis
   * 2. Starts the heartbeat interval
   * 3. Enters the main crawl loop
   *
   * The crawl loop runs until stop() is called, continuously fetching
   * and processing URLs from the frontier.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.startTime = Date.now();
    console.log(`Crawler worker ${this.workerId} starting...`);

    // Register worker
    await this.registerWorker();

    // Start heartbeat
    this.startHeartbeat();

    // Main crawl loop
    while (this.isRunning) {
      try {
        await this.crawlNext();
      } catch (error) {
        console.error(`Crawler ${this.workerId} error:`, error);
        await this.sleep(1000);
      }
    }
  }

  /**
   * Stops the crawler worker gracefully.
   *
   * This sets the running flag to false, allowing the current crawl
   * operation to complete before the loop exits. Also unregisters
   * the worker from Redis.
   */
  async stop(): Promise<void> {
    console.log(`Crawler worker ${this.workerId} stopping...`);
    this.isRunning = false;
    await this.unregisterWorker();
  }

  /**
   * Registers this worker as active in Redis.
   *
   * Adds the worker ID to the active workers set and sets the initial
   * heartbeat timestamp. This allows the dashboard to track active workers.
   */
  private async registerWorker(): Promise<void> {
    await redis.sadd(REDIS_KEYS.ACTIVE_WORKERS, this.workerId);
    await redis.set(
      REDIS_KEYS.WORKER_HEARTBEAT(this.workerId),
      Date.now().toString()
    );
  }

  /**
   * Unregisters this worker from Redis.
   *
   * Removes the worker from the active set and deletes the heartbeat key.
   * Called during graceful shutdown.
   */
  private async unregisterWorker(): Promise<void> {
    await redis.srem(REDIS_KEYS.ACTIVE_WORKERS, this.workerId);
    await redis.del(REDIS_KEYS.WORKER_HEARTBEAT(this.workerId));
  }

  /**
   * Starts the periodic heartbeat interval.
   *
   * Updates the heartbeat timestamp every 5 seconds to indicate the worker
   * is alive. The dashboard uses heartbeats to detect stale workers.
   */
  private startHeartbeat(): void {
    setInterval(async () => {
      if (this.isRunning) {
        await redis.set(
          REDIS_KEYS.WORKER_HEARTBEAT(this.workerId),
          Date.now().toString()
        );
      }
    }, 5000);
  }

  /**
   * Main crawl cycle - fetches and processes the next available URL.
   *
   * This method is called in a loop and handles:
   * 1. Getting the next URL from the frontier
   * 2. Crawling the URL
   * 3. Storing results and adding discovered links
   * 4. Updating status and statistics
   *
   * If no URLs are available, sleeps briefly before retrying.
   */
  async crawlNext(): Promise<void> {
    // Get next URL from frontier
    const frontierUrl = await frontierService.getNextUrl(this.workerId);

    if (!frontierUrl) {
      // No URLs available, wait a bit
      await this.sleep(500);
      return;
    }

    try {
      const result = await this.crawlUrl(frontierUrl);

      // Store results
      await this.storeCrawlResult(result);

      // Add discovered links to frontier
      if (result.linksFound.length > 0) {
        await frontierService.addUrls(result.linksFound, {
          depth: (frontierUrl.depth || 0) + 1,
        });
      }

      // Mark as completed
      await frontierService.markCompleted(frontierUrl.urlHash);

      // Update stats
      await redis.incr(REDIS_KEYS.STATS_PAGES_CRAWLED);
      await redis.incrby(REDIS_KEYS.STATS_BYTES_DOWNLOADED, result.contentLength);

      this.crawlCount++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to crawl ${frontierUrl.url}:`, errorMessage);

      await frontierService.markFailed(frontierUrl.urlHash, errorMessage);
      await redis.incr(REDIS_KEYS.STATS_PAGES_FAILED);
    }
  }

  /**
   * Crawls a single URL and extracts content.
   *
   * This method handles the complete crawl lifecycle:
   * 1. Check robots.txt permissions
   * 2. Make HTTP request with proper headers and timeouts
   * 3. Validate response (HTML content only)
   * 4. Parse HTML and extract metadata
   * 5. Extract and normalize all links
   *
   * @param frontierUrl - The URL entry from the frontier to crawl
   * @returns CrawlResult with all extracted data and metadata
   */
  async crawlUrl(frontierUrl: FrontierUrl): Promise<CrawlResult> {
    const { url, urlHash, domain } = frontierUrl;
    const startTime = Date.now();

    // Check robots.txt
    const isAllowed = await robotsService.isAllowed(url, domain);
    if (!isAllowed) {
      return {
        url,
        urlHash,
        statusCode: 0,
        contentType: '',
        contentLength: 0,
        contentHash: '',
        title: '',
        description: '',
        linksFound: [],
        crawlDurationMs: Date.now() - startTime,
        error: 'Blocked by robots.txt',
      };
    }

    // Fetch the page
    let response: AxiosResponse;
    try {
      response = await axios.get(url, {
        timeout: config.crawler.requestTimeout,
        maxContentLength: config.crawler.maxPageSize,
        headers: {
          'User-Agent': config.crawler.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          Connection: 'keep-alive',
        },
        responseType: 'text',
        validateStatus: () => true, // Accept all status codes
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Request failed';
      return {
        url,
        urlHash,
        statusCode: 0,
        contentType: '',
        contentLength: 0,
        contentHash: '',
        title: '',
        description: '',
        linksFound: [],
        crawlDurationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }

    const statusCode = response.status;
    const contentType = response.headers['content-type'] || '';

    // Only process HTML content
    if (!contentType.includes('text/html')) {
      return {
        url,
        urlHash,
        statusCode,
        contentType,
        contentLength: 0,
        contentHash: '',
        title: '',
        description: '',
        linksFound: [],
        crawlDurationMs: Date.now() - startTime,
        error: 'Not HTML content',
      };
    }

    const html = typeof response.data === 'string' ? response.data : '';
    const contentLength = Buffer.byteLength(html, 'utf8');
    const contentHash = hashContent(html);

    // Parse HTML
    const $ = cheerio.load(html);

    // Extract metadata
    const title =
      $('title').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') ||
      '';
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';

    // Extract links
    const linksFound: string[] = [];
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        const absoluteUrl = resolveUrl(url, href);
        if (absoluteUrl && shouldCrawl(absoluteUrl)) {
          const normalized = normalizeUrl(absoluteUrl);
          if (!linksFound.includes(normalized)) {
            linksFound.push(normalized);
          }
        }
      }
    });

    return {
      url,
      urlHash,
      statusCode,
      contentType,
      contentLength,
      contentHash,
      title: title.substring(0, 500),
      description: description.substring(0, 1000),
      linksFound,
      crawlDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Stores crawl results in the PostgreSQL database.
   *
   * Inserts or updates the crawled_pages table with all extracted metadata.
   * Uses ON CONFLICT to handle re-crawls of the same URL.
   * Also increments the domain's page count.
   *
   * @param result - The CrawlResult to store
   */
  async storeCrawlResult(result: CrawlResult): Promise<void> {
    const domain = extractDomain(result.url);

    await pool.query(
      `INSERT INTO crawled_pages
       (url, url_hash, domain, status_code, content_type, content_length, content_hash, title, description, links_count, crawl_duration_ms, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (url_hash) DO UPDATE SET
         status_code = EXCLUDED.status_code,
         content_type = EXCLUDED.content_type,
         content_length = EXCLUDED.content_length,
         content_hash = EXCLUDED.content_hash,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         links_count = EXCLUDED.links_count,
         crawled_at = NOW(),
         crawl_duration_ms = EXCLUDED.crawl_duration_ms,
         error_message = EXCLUDED.error_message`,
      [
        result.url,
        result.urlHash,
        domain,
        result.statusCode,
        result.contentType,
        result.contentLength,
        result.contentHash,
        result.title,
        result.description,
        result.linksFound.length,
        result.crawlDurationMs,
        result.error || null,
      ]
    );

    // Update domain page count
    await pool.query(
      `UPDATE domains SET page_count = page_count + 1, updated_at = NOW() WHERE domain = $1`,
      [domain]
    );
  }

  /**
   * Gets current statistics for this worker.
   *
   * Returns performance metrics useful for monitoring and debugging.
   *
   * @returns Worker statistics including crawl count, uptime, and throughput
   */
  getStats(): {
    workerId: string;
    isRunning: boolean;
    crawlCount: number;
    uptimeMs: number;
    crawlsPerSecond: number;
  } {
    const uptimeMs = this.startTime ? Date.now() - this.startTime : 0;
    const crawlsPerSecond =
      uptimeMs > 0 ? (this.crawlCount / uptimeMs) * 1000 : 0;

    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      crawlCount: this.crawlCount,
      uptimeMs,
      crawlsPerSecond,
    };
  }

  /**
   * Utility function for async sleep.
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
