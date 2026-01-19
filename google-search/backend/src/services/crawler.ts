import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { db } from '../models/db.js';
import { redis, CACHE_KEYS, CACHE_TTL } from '../models/redis.js';
import { config } from '../config/index.js';
import {
  hashUrl,
  hashContent,
  extractDomain,
  normalizeUrl,
  toAbsoluteUrl,
  isValidUrl,
  sleep,
} from '../utils/helpers.js';

interface UrlRecord {
  id: number;
  url: string;
  domain: string;
  priority: number;
}

interface ParsedPage {
  title: string;
  description: string;
  content: string;
  links: { url: string; anchorText: string }[];
}

interface CrawlResult {
  urlId: number;
  url: string;
  title: string;
  linksFound: number;
  newLinksAdded: number;
}

interface CrawlStats {
  crawled: number;
  errors: number;
}

/**
 * URL Frontier - manages URLs to be crawled
 */
class URLFrontier {
  hostLastFetch: Map<string, number>;

  constructor() {
    this.hostLastFetch = new Map();
  }

  /**
   * Add a URL to the frontier
   */
  async addUrl(url: string, priority = 0.5, sourceUrlId: number | null = null): Promise<number | null> {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || !isValidUrl(normalizedUrl)) {
      return null;
    }

    const urlHash = hashUrl(normalizedUrl);
    const domain = extractDomain(normalizedUrl);

    try {
      // Check if URL already exists
      const existing = await db.query<{ id: number }>(
        'SELECT id FROM urls WHERE url_hash = $1',
        [urlHash]
      );

      if (existing.rows.length > 0) {
        // Update priority if higher
        await db.query(
          'UPDATE urls SET priority = GREATEST(priority, $1), updated_at = NOW() WHERE url_hash = $2',
          [priority, urlHash]
        );
        return existing.rows[0].id;
      }

      // Insert new URL
      const result = await db.query<{ id: number }>(
        `INSERT INTO urls (url_hash, url, domain, priority, crawl_status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (url_hash) DO UPDATE SET priority = GREATEST(urls.priority, $4)
         RETURNING id`,
        [urlHash, normalizedUrl, domain, priority]
      );

      const urlId = result.rows[0].id;

      // Add link if source provided
      if (sourceUrlId) {
        await db.query(
          `INSERT INTO links (source_url_id, target_url_id)
           VALUES ($1, $2)
           ON CONFLICT (source_url_id, target_url_id) DO NOTHING`,
          [sourceUrlId, urlId]
        );
      }

      return urlId;
    } catch (error) {
      console.error('Error adding URL to frontier:', (error as Error).message);
      return null;
    }
  }

  /**
   * Get next URLs to crawl
   */
  async getNextUrls(limit = 10): Promise<UrlRecord[]> {
    const now = Date.now();

    // Get pending URLs grouped by domain to respect politeness
    const result = await db.query<UrlRecord>(
      `SELECT u.id, u.url, u.domain, u.priority
       FROM urls u
       WHERE u.crawl_status = 'pending'
       ORDER BY u.priority DESC, u.id ASC
       LIMIT $1`,
      [limit * 2] // Get more to filter by politeness
    );

    const selectedUrls: UrlRecord[] = [];
    const usedDomains = new Set<string>();

    for (const row of result.rows) {
      if (selectedUrls.length >= limit) break;

      // Check politeness - only one URL per domain per batch
      if (usedDomains.has(row.domain)) continue;

      // Check if we recently fetched from this host
      const lastFetch = await redis.get(CACHE_KEYS.HOST_LAST_FETCH(row.domain));
      if (lastFetch && now - parseInt(lastFetch) < config.crawler.delayMs) {
        continue;
      }

      selectedUrls.push(row);
      usedDomains.add(row.domain);
    }

    // Mark selected URLs as in-progress
    if (selectedUrls.length > 0) {
      const ids = selectedUrls.map((u) => u.id);
      await db.query(
        `UPDATE urls SET crawl_status = 'crawling', updated_at = NOW()
         WHERE id = ANY($1)`,
        [ids]
      );
    }

    return selectedUrls;
  }

  /**
   * Check if crawling is allowed by robots.txt
   */
  async isAllowed(url: string, domain: string): Promise<boolean> {
    try {
      // Check cache first
      const cached = await redis.get(CACHE_KEYS.ROBOTS_TXT(domain));
      if (cached) {
        const robots = robotsParser(`https://${domain}/robots.txt`, cached);
        return robots.isAllowed(url, config.crawler.userAgent) ?? true;
      }

      // Fetch robots.txt
      const robotsUrl = `https://${domain}/robots.txt`;
      try {
        const response = await axios.get(robotsUrl, {
          timeout: 5000,
          headers: { 'User-Agent': config.crawler.userAgent },
        });

        const robotsContent = response.data as string;

        // Cache the robots.txt
        await redis.setex(CACHE_KEYS.ROBOTS_TXT(domain), CACHE_TTL.ROBOTS_TXT, robotsContent);

        // Also store in database
        await db.query(
          `INSERT INTO robots_cache (domain, content, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '24 hours')
           ON CONFLICT (domain) DO UPDATE SET content = $2, expires_at = NOW() + INTERVAL '24 hours'`,
          [domain, robotsContent]
        );

        const robots = robotsParser(robotsUrl, robotsContent);
        return robots.isAllowed(url, config.crawler.userAgent) ?? true;
      } catch {
        // No robots.txt or error - allow crawling
        await redis.setex(CACHE_KEYS.ROBOTS_TXT(domain), CACHE_TTL.ROBOTS_TXT, '');
        return true;
      }
    } catch (error) {
      console.error('Error checking robots.txt:', (error as Error).message);
      return true; // Allow on error
    }
  }
}

/**
 * Crawler - fetches and parses web pages
 */
class Crawler {
  frontier: URLFrontier;

  constructor() {
    this.frontier = new URLFrontier();
  }

  /**
   * Fetch and parse a single URL
   */
  async crawl(urlId: number, url: string, domain: string): Promise<CrawlResult | null> {
    try {
      // Check robots.txt
      const allowed = await this.frontier.isAllowed(url, domain);
      if (!allowed) {
        await this.markUrlStatus(urlId, 'blocked');
        return null;
      }

      // Record fetch time for politeness
      await redis.setex(CACHE_KEYS.HOST_LAST_FETCH(domain), CACHE_TTL.HOST_LAST_FETCH, Date.now().toString());

      // Fetch the page
      const response = await axios.get(url, {
        timeout: config.crawler.timeout,
        headers: {
          'User-Agent': config.crawler.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 400,
      });

      // Only process HTML content
      const contentType = (response.headers['content-type'] as string) || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        await this.markUrlStatus(urlId, 'skipped');
        return null;
      }

      const html = response.data as string;

      // Check for duplicate content
      const contentHash = hashContent(html);
      const duplicate = await db.query<{ id: number }>(
        'SELECT id FROM urls WHERE content_hash = $1 AND id != $2 LIMIT 1',
        [contentHash, urlId]
      );

      if (duplicate.rows.length > 0) {
        await this.markUrlStatus(urlId, 'duplicate', contentHash);
        return null;
      }

      // Parse the page
      const parsed = this.parseHTML(html, url);

      // Store the document
      await this.storeDocument(urlId, url, parsed);

      // Extract and add new links
      const newLinks = await this.processLinks(parsed.links, urlId);

      // Mark as crawled
      await this.markUrlStatus(urlId, 'crawled', contentHash);

      return {
        urlId,
        url,
        title: parsed.title,
        linksFound: parsed.links.length,
        newLinksAdded: newLinks,
      };
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status || 'error';
      await this.markUrlStatus(urlId, `error:${status}`);
      console.error(`Crawl error for ${url}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Parse HTML and extract content
   */
  parseHTML(html: string, baseUrl: string): ParsedPage {
    const $ = cheerio.load(html);

    // Remove scripts, styles, and other non-content elements
    $('script, style, nav, footer, header, aside, noscript, iframe').remove();

    // Extract title
    const title = $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      '';

    // Extract meta description
    const description = $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';

    // Extract main content
    let content = '';
    const mainContent = $('main, article, .content, #content, .post, .entry');
    if (mainContent.length > 0) {
      content = mainContent.text();
    } else {
      content = $('body').text();
    }

    // Clean up content
    content = content
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000); // Limit content size

    // Extract links
    const links: { url: string; anchorText: string }[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const anchorText = $(el).text().trim();
      if (href) {
        const absoluteUrl = toAbsoluteUrl(href, baseUrl);

        if (absoluteUrl && isValidUrl(absoluteUrl)) {
          links.push({ url: absoluteUrl, anchorText });
        }
      }
    });

    return {
      title,
      description,
      content,
      links,
    };
  }

  /**
   * Store document in database
   */
  async storeDocument(urlId: number, url: string, parsed: ParsedPage): Promise<void> {
    await db.query(
      `INSERT INTO documents (url_id, url, title, description, content, content_length)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url_id) DO UPDATE
       SET title = $3, description = $4, content = $5, content_length = $6, fetch_time = NOW()`,
      [urlId, url, parsed.title, parsed.description, parsed.content, parsed.content.length]
    );
  }

  /**
   * Process extracted links
   */
  async processLinks(links: { url: string; anchorText: string }[], sourceUrlId: number): Promise<number> {
    let added = 0;
    const domain = await this.getUrlDomain(sourceUrlId);

    for (const link of links) {
      // Calculate priority based on domain similarity
      const linkDomain = extractDomain(link.url);
      let priority = 0.3; // External link base priority

      if (linkDomain === domain) {
        priority = 0.5; // Same domain
      }

      const urlId = await this.frontier.addUrl(link.url, priority, sourceUrlId);
      if (urlId) added++;
    }

    return added;
  }

  /**
   * Get domain for a URL ID
   */
  async getUrlDomain(urlId: number): Promise<string | undefined> {
    const result = await db.query<{ domain: string }>('SELECT domain FROM urls WHERE id = $1', [urlId]);
    return result.rows[0]?.domain;
  }

  /**
   * Mark URL status in database
   */
  async markUrlStatus(urlId: number, status: string, contentHash: string | null = null): Promise<void> {
    if (contentHash) {
      await db.query(
        `UPDATE urls
         SET crawl_status = $1, content_hash = $2, last_crawl = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [status, contentHash, urlId]
      );
    } else {
      await db.query(
        `UPDATE urls
         SET crawl_status = $1, last_crawl = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [status, urlId]
      );
    }
  }

  /**
   * Run the crawler
   */
  async run(maxPages = config.crawler.maxPages): Promise<CrawlStats> {
    console.log(`Starting crawler (max ${maxPages} pages)...`);
    let crawledCount = 0;
    let errorCount = 0;

    while (crawledCount < maxPages) {
      const urls = await this.frontier.getNextUrls(config.crawler.maxConcurrent);

      if (urls.length === 0) {
        console.log('No more URLs to crawl');
        break;
      }

      // Crawl URLs concurrently
      const results = await Promise.all(
        urls.map(({ id, url, domain }) => this.crawl(id, url, domain))
      );

      for (const result of results) {
        if (result) {
          crawledCount++;
          console.log(`[${crawledCount}] Crawled: ${result.title} (${result.linksFound} links found)`);
        } else {
          errorCount++;
        }
      }

      // Small delay between batches
      await sleep(100);
    }

    console.log(`Crawling complete. Crawled: ${crawledCount}, Errors: ${errorCount}`);
    return { crawled: crawledCount, errors: errorCount };
  }
}

export const crawler = new Crawler();
export const urlFrontier = new URLFrontier();
