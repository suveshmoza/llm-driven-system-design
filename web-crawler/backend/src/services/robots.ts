/**
 * @fileoverview Robots.txt Service for respecting web crawling policies.
 *
 * This service implements the Robots Exclusion Protocol (robots.txt) which is
 * the standard way for websites to communicate their crawling preferences.
 * A well-behaved crawler must check and respect robots.txt before crawling any URL.
 *
 * Key responsibilities:
 * - Fetching robots.txt from domains (with HTTP fallback)
 * - Parsing robot directives using the robots-parser library
 * - Multi-level caching (in-memory, Redis, PostgreSQL)
 * - Extracting crawl delay and sitemap information
 * - Checking if specific URLs are allowed to be crawled
 *
 * Caching strategy:
 * 1. In-memory cache (fastest, process-local, lost on restart)
 * 2. Redis cache (fast, shared across workers, with TTL)
 * 3. PostgreSQL (durable, survives restarts, for historical reference)
 *
 * @module services/robots
 */

import axios from 'axios';
import robotsParser from 'robots-parser';
import { redis, REDIS_KEYS } from '../models/redis.js';
import { pool } from '../models/database.js';
import { config } from '../config.js';

/**
 * Robots.txt Service - fetches, parses, and caches robots.txt for domains.
 *
 * This service is critical for "crawl politeness" - ensuring the crawler
 * respects website owners' wishes about what should and shouldn't be crawled.
 * Ignoring robots.txt can lead to being blocked or legal issues.
 *
 * @example
 * ```typescript
 * import { robotsService } from './services/robots';
 *
 * // Check if a URL is allowed before crawling
 * const allowed = await robotsService.isAllowed('https://example.com/page', 'example.com');
 * if (allowed) {
 *   // Proceed with crawling
 * }
 *
 * // Get the crawl delay for a domain
 * const delay = await robotsService.getCrawlDelay('example.com');
 * ```
 */
export class RobotsService {
  /**
   * In-memory cache for robots.txt parsers.
   * Provides O(1) access for frequently accessed domains without any network/Redis calls.
   * Cache entries include the parser and fetch timestamp for TTL-based invalidation.
   */
  private cache: Map<
    string,
    {
      parser: ReturnType<typeof robotsParser>;
      fetchedAt: number;
    }
  > = new Map();

  /**
   * Fetches robots.txt content from a domain.
   *
   * Attempts HTTPS first, then falls back to HTTP if HTTPS fails.
   * This handles both modern HTTPS-only sites and legacy HTTP sites.
   *
   * @param domain - The domain hostname (e.g., 'example.com')
   * @returns The robots.txt content as a string, or null if not found/failed
   */
  async fetchRobotsTxt(domain: string): Promise<string | null> {
    try {
      const url = `https://${domain}/robots.txt`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': config.crawler.userAgent,
        },
        validateStatus: (status) => status < 500,
      });

      if (response.status === 200) {
        return response.data;
      }

      // Try HTTP if HTTPS fails
      try {
        const httpUrl = `http://${domain}/robots.txt`;
        const httpResponse = await axios.get(httpUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': config.crawler.userAgent,
          },
          validateStatus: (status) => status < 500,
        });

        if (httpResponse.status === 200) {
          return httpResponse.data;
        }
      } catch {
        // HTTP also failed, continue with null
      }

      return null;
    } catch (error) {
      console.error(`Failed to fetch robots.txt for ${domain}:`, error);
      return null;
    }
  }

  /**
   * Gets or fetches a robots.txt parser for a domain.
   *
   * Implements a three-level cache hierarchy:
   * 1. In-memory cache (checked first, fastest)
   * 2. Redis cache (shared across workers)
   * 3. Network fetch (only if both caches miss)
   *
   * After fetching, the robots.txt is:
   * - Parsed to create a reusable parser object
   * - Cached in memory and Redis with TTL
   * - Stored in PostgreSQL for durability
   * - Crawl delay is extracted and cached separately
   *
   * @param domain - The domain to get robots.txt parser for
   * @returns Robots parser instance, or null if fetch failed
   */
  async getParser(
    domain: string
  ): Promise<ReturnType<typeof robotsParser> | null> {
    const now = Date.now();

    // Check in-memory cache first
    const cached = this.cache.get(domain);
    if (cached && now - cached.fetchedAt < config.crawler.robotsTxtCacheTtl * 1000) {
      return cached.parser;
    }

    // Check Redis cache
    const redisCached = await redis.get(REDIS_KEYS.DOMAIN_ROBOTS(domain));
    if (redisCached) {
      const parser = robotsParser(`https://${domain}/robots.txt`, redisCached);
      this.cache.set(domain, { parser, fetchedAt: now });
      return parser;
    }

    // Fetch from network
    const robotsTxt = await this.fetchRobotsTxt(domain);
    const robotsContent = robotsTxt || '';

    const parser = robotsParser(
      `https://${domain}/robots.txt`,
      robotsContent
    );

    // Cache in Redis
    await redis.setex(
      REDIS_KEYS.DOMAIN_ROBOTS(domain),
      config.crawler.robotsTxtCacheTtl,
      robotsContent
    );

    // Cache in memory
    this.cache.set(domain, { parser, fetchedAt: now });

    // Extract crawl delay and store
    const crawlDelay = parser.getCrawlDelay(config.crawler.userAgent) || 1.0;
    await redis.set(REDIS_KEYS.DOMAIN_DELAY(domain), crawlDelay.toString());

    // Update database
    await pool.query(
      `INSERT INTO domains (domain, robots_txt, robots_fetched_at, crawl_delay)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (domain) DO UPDATE SET
         robots_txt = EXCLUDED.robots_txt,
         robots_fetched_at = NOW(),
         crawl_delay = EXCLUDED.crawl_delay,
         updated_at = NOW()`,
      [domain, robotsContent, crawlDelay]
    );

    return parser;
  }

  /**
   * Checks if a URL is allowed to be crawled according to robots.txt.
   *
   * This should be called for every URL before crawling. If robots.txt
   * cannot be fetched, we assume the URL is allowed (fail-open behavior).
   *
   * @param url - The full URL to check
   * @param domain - The domain hostname of the URL
   * @returns true if crawling is allowed, false if disallowed by robots.txt
   *
   * @example
   * ```typescript
   * const allowed = await robotsService.isAllowed(
   *   'https://example.com/private/data',
   *   'example.com'
   * );
   * if (!allowed) {
   *   console.log('Blocked by robots.txt');
   * }
   * ```
   */
  async isAllowed(url: string, domain: string): Promise<boolean> {
    try {
      const parser = await this.getParser(domain);
      if (!parser) {
        // If we can't get robots.txt, assume allowed
        return true;
      }

      return parser.isAllowed(url, config.crawler.userAgent) ?? true;
    } catch (error) {
      console.error(`Error checking robots.txt for ${url}:`, error);
      return true;
    }
  }

  /**
   * Gets the crawl delay for a domain.
   *
   * Crawl delay specifies the minimum time (in seconds) between requests
   * to the same domain. This is extracted from the robots.txt Crawl-delay
   * directive if present, otherwise the default delay is used.
   *
   * @param domain - The domain to get crawl delay for
   * @returns Crawl delay in seconds
   *
   * @example
   * ```typescript
   * const delay = await robotsService.getCrawlDelay('example.com');
   * console.log(`Wait ${delay} seconds between requests`);
   * ```
   */
  async getCrawlDelay(domain: string): Promise<number> {
    // Check Redis cache first
    const cached = await redis.get(REDIS_KEYS.DOMAIN_DELAY(domain));
    if (cached) {
      return parseFloat(cached);
    }

    // Fetch robots.txt if not cached
    const parser = await this.getParser(domain);
    if (parser) {
      const delay = parser.getCrawlDelay(config.crawler.userAgent);
      if (delay) {
        await redis.set(REDIS_KEYS.DOMAIN_DELAY(domain), delay.toString());
        return delay;
      }
    }

    return config.crawler.defaultDelay / 1000; // Convert ms to seconds
  }

  /**
   * Gets sitemap URLs declared in robots.txt.
   *
   * Many robots.txt files declare sitemap locations which provide a list
   * of all URLs on the site. This can be used to seed the crawler with
   * a complete list of pages without having to discover them through crawling.
   *
   * @param domain - The domain to get sitemaps for
   * @returns Array of sitemap URLs declared in robots.txt
   *
   * @example
   * ```typescript
   * const sitemaps = await robotsService.getSitemaps('example.com');
   * // Returns: ['https://example.com/sitemap.xml']
   * ```
   */
  async getSitemaps(domain: string): Promise<string[]> {
    const parser = await this.getParser(domain);
    if (!parser) {
      return [];
    }

    return parser.getSitemaps();
  }

  /**
   * Clears cached robots.txt data for a domain.
   *
   * Use this to force a fresh fetch of robots.txt, for example when:
   * - The site owner has updated their robots.txt
   * - Cache data appears stale or corrupt
   * - Debugging crawl permission issues
   *
   * @param domain - The domain to clear cache for
   */
  clearCache(domain: string): void {
    this.cache.delete(domain);
    redis.del(REDIS_KEYS.DOMAIN_ROBOTS(domain));
    redis.del(REDIS_KEYS.DOMAIN_DELAY(domain));
  }
}

/**
 * Singleton instance of the RobotsService.
 * Use this export for all robots.txt operations to share the in-memory cache.
 */
export const robotsService = new RobotsService();
