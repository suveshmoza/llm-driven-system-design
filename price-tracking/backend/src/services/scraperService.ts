import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { queryOne, query } from '../db/pool.js';
import { checkRateLimit } from '../db/redis.js';
import { ScraperConfig, ScrapedData } from '../types/index.js';
import { parsePrice, extractDomain, sleep } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Configuration for HTTP proxy rotation.
 * Used to avoid IP-based rate limiting and blocks.
 */
interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * Web scraper for extracting product prices from e-commerce websites.
 * Supports multiple extraction strategies: JSON-LD structured data,
 * domain-specific CSS selectors, and generic price pattern matching.
 * Implements rate limiting per domain to avoid being blocked.
 */
export class Scraper {
  private httpClient: AxiosInstance;
  private proxy: ProxyConfig | null = null;

  /**
   * Initializes the scraper with a configured axios instance.
   * Sets up browser-like headers to avoid bot detection.
   * Configures proxy if environment variables are set.
   */
  constructor() {
    this.httpClient = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Configure proxy if available
    if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
      this.proxy = {
        host: process.env.PROXY_HOST,
        port: parseInt(process.env.PROXY_PORT, 10),
        username: process.env.PROXY_USERNAME,
        password: process.env.PROXY_PASSWORD,
      };
    }
  }

  /**
   * Returns a random User-Agent string to mimic different browsers.
   * Helps avoid detection as a bot scraper.
   * @returns A random browser User-Agent string
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Retrieves the scraper configuration for a specific domain.
   * Configurations define CSS selectors and parser settings.
   * @param domain - The domain to look up configuration for
   * @returns The scraper config or null if not configured
   */
  async getScraperConfig(domain: string): Promise<ScraperConfig | null> {
    return queryOne<ScraperConfig>(
      'SELECT * FROM scraper_configs WHERE domain = $1 AND is_active = true',
      [domain]
    );
  }

  /**
   * Scrapes product data from a URL.
   * Checks rate limits before fetching, extracts price/title/image data.
   * Uses domain-specific configuration if available, otherwise falls back to generic selectors.
   * @param url - The product URL to scrape
   * @returns Scraped product data including price, title, and availability
   * @throws Error if scraping fails
   */
  async scrape(url: string): Promise<ScrapedData> {
    const domain = extractDomain(url);

    // Check rate limit
    const config = await this.getScraperConfig(domain);
    const rateLimit = config?.rate_limit || 60;

    const canProceed = await checkRateLimit(domain, rateLimit);
    if (!canProceed) {
      logger.warn(`Rate limit exceeded for domain: ${domain}`);
      await sleep(5000); // Wait 5 seconds before retrying
    }

    try {
      const html = await this.fetchPage(url);
      return this.extractData(html, config);
    } catch (error) {
      logger.error(`Scrape error for ${url}: ${error}`);
      throw error;
    }
  }

  /**
   * Fetches the HTML content of a page.
   * Applies proxy configuration if available.
   * @param url - The URL to fetch
   * @returns The HTML content as a string
   */
  private async fetchPage(url: string): Promise<string> {
    const config: Record<string, unknown> = {
      headers: {
        'User-Agent': this.getRandomUserAgent(),
      },
    };

    if (this.proxy) {
      config.proxy = {
        host: this.proxy.host,
        port: this.proxy.port,
        auth: this.proxy.username
          ? { username: this.proxy.username, password: this.proxy.password }
          : undefined,
      };
    }

    const response = await this.httpClient.get(url, config);
    return response.data;
  }

  /**
   * Extracts product data from HTML using multiple strategies.
   * Tries JSON-LD first (most reliable), then domain-specific selectors,
   * then falls back to generic CSS selector patterns.
   * @param html - The HTML content to parse
   * @param config - Optional domain-specific scraper configuration
   * @returns Extracted product data
   */
  private extractData(html: string, config: ScraperConfig | null): ScrapedData {
    const $ = cheerio.load(html);

    // Try to extract structured data (JSON-LD) first
    const jsonLdData = this.extractJsonLd($);
    if (jsonLdData.price !== null) {
      return jsonLdData;
    }

    // Fall back to CSS selectors
    let price: number | null = null;
    let title: string | null = null;
    let imageUrl: string | null = null;

    if (config) {
      // Use configured selectors
      if (config.price_selector) {
        const priceText = $(config.price_selector).first().text();
        price = parsePrice(priceText);
      }

      if (config.title_selector) {
        title = $(config.title_selector).first().text().trim();
      }

      if (config.image_selector) {
        imageUrl = $(config.image_selector).first().attr('src') || null;
      }
    }

    // Try generic selectors if configured ones fail
    if (price === null) {
      price = this.findPrice($);
    }

    if (!title) {
      title = this.findTitle($);
    }

    if (!imageUrl) {
      imageUrl = this.findImage($);
    }

    return {
      price,
      title,
      image_url: imageUrl,
      availability: this.checkAvailability($),
      currency: this.detectCurrency($) || 'USD',
    };
  }

  /**
   * Extracts product data from JSON-LD structured data.
   * JSON-LD is the most reliable extraction method as it's explicitly structured.
   * Looks for Product schema with Offer data.
   * @param $ - Cheerio instance with loaded HTML
   * @returns Extracted product data
   */
  private extractJsonLd($: cheerio.CheerioAPI): ScrapedData {
    const result: ScrapedData = {
      price: null,
      title: null,
      image_url: null,
      availability: true,
      currency: 'USD',
    };

    try {
      const scripts = $('script[type="application/ld+json"]');
      scripts.each((_, script) => {
        try {
          const json = JSON.parse($(script).html() || '');
          const data = Array.isArray(json) ? json[0] : json;

          // Handle Product schema
          if (data['@type'] === 'Product') {
            result.title = data.name || null;
            result.image_url = Array.isArray(data.image) ? data.image[0] : data.image;

            const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
            if (offers) {
              result.price = parsePrice(String(offers.price || offers.lowPrice));
              result.currency = offers.priceCurrency || 'USD';
              result.availability = offers.availability !== 'OutOfStock';
            }
          }
        } catch {
          // Invalid JSON, skip
        }
      });
    } catch {
      // No JSON-LD found
    }

    return result;
  }

  /**
   * Searches for price using common CSS selector patterns.
   * Tries data attributes first, then text content.
   * @param $ - Cheerio instance with loaded HTML
   * @returns Parsed price or null if not found
   */
  private findPrice($: cheerio.CheerioAPI): number | null {
    // Common price selectors
    const selectors = [
      '[data-price]',
      '.price',
      '.product-price',
      '.sale-price',
      '.current-price',
      '[itemprop="price"]',
      '.a-price .a-offscreen',
      '.priceValue',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const priceAttr = element.attr('data-price') || element.attr('content');
        if (priceAttr) {
          const price = parsePrice(priceAttr);
          if (price) return price;
        }

        const priceText = element.text();
        const price = parsePrice(priceText);
        if (price) return price;
      }
    }

    return null;
  }

  /**
   * Searches for product title using common CSS selector patterns.
   * Falls back to page title if no product-specific title found.
   * @param $ - Cheerio instance with loaded HTML
   * @returns Product title or null if not found
   */
  private findTitle($: cheerio.CheerioAPI): string | null {
    // Common title selectors
    const selectors = [
      '[itemprop="name"]',
      '.product-title',
      '.product-name',
      'h1.title',
      '#productTitle',
      '.product-single__title',
    ];

    for (const selector of selectors) {
      const text = $(selector).first().text().trim();
      if (text) return text;
    }

    // Fall back to page title
    const pageTitle = $('title').text().trim();
    return pageTitle || null;
  }

  /**
   * Searches for product image using common CSS selector patterns.
   * Checks src, data-src, and data-zoom-image attributes.
   * @param $ - Cheerio instance with loaded HTML
   * @returns Image URL or null if not found
   */
  private findImage($: cheerio.CheerioAPI): string | null {
    // Common image selectors
    const selectors = [
      '[itemprop="image"]',
      '.product-image img',
      '#main-image',
      '.product-photo img',
      '[data-zoom-image]',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      const src = element.attr('src') || element.attr('data-src') || element.attr('data-zoom-image');
      if (src) return src;
    }

    return null;
  }

  /**
   * Checks if a product is available based on out-of-stock text patterns.
   * Searches the page body for common unavailability phrases.
   * @param $ - Cheerio instance with loaded HTML
   * @returns True if product appears available, false otherwise
   */
  private checkAvailability($: cheerio.CheerioAPI): boolean {
    // Check for out of stock indicators
    const outOfStockPatterns = [
      'out of stock',
      'sold out',
      'currently unavailable',
      'not available',
      'out-of-stock',
    ];

    const pageText = $('body').text().toLowerCase();

    for (const pattern of outOfStockPatterns) {
      if (pageText.includes(pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Attempts to detect the currency from the page.
   * Checks meta tags and price element text for currency symbols.
   * @param $ - Cheerio instance with loaded HTML
   * @returns ISO 4217 currency code or null if not detected
   */
  private detectCurrency($: cheerio.CheerioAPI): string | null {
    const currencyMap: Record<string, string> = {
      '$': 'USD',
      '€': 'EUR',
      '£': 'GBP',
      '¥': 'JPY',
      'CAD': 'CAD',
      'AUD': 'AUD',
    };

    // Check for currency in structured data
    const meta = $('meta[itemprop="priceCurrency"]').attr('content');
    if (meta) return meta;

    // Check price elements for currency symbols
    const priceText = $('.price, .product-price, [itemprop="price"]').first().text();
    for (const [symbol, code] of Object.entries(currencyMap)) {
      if (priceText.includes(symbol)) {
        return code;
      }
    }

    return null;
  }
}

/** Singleton scraper instance for use across the application */
export const scraper = new Scraper();

/**
 * Retrieves all active scraper configurations.
 * Used by admin dashboard to view and manage domain-specific settings.
 * @returns Array of active scraper configurations sorted by domain
 */
export async function getScraperConfigs(): Promise<ScraperConfig[]> {
  return query<ScraperConfig>('SELECT * FROM scraper_configs WHERE is_active = true ORDER BY domain');
}

/**
 * Updates an existing scraper configuration.
 * Used by admins to fix broken selectors or adjust rate limits.
 * @param domain - The domain to update
 * @param updates - Partial configuration with fields to update
 * @returns The updated configuration or null if not found
 */
export async function updateScraperConfig(
  domain: string,
  updates: Partial<ScraperConfig>
): Promise<ScraperConfig | null> {
  const result = await query<ScraperConfig>(
    `UPDATE scraper_configs
     SET price_selector = COALESCE($2, price_selector),
         title_selector = COALESCE($3, title_selector),
         image_selector = COALESCE($4, image_selector),
         requires_js = COALESCE($5, requires_js),
         rate_limit = COALESCE($6, rate_limit),
         is_active = COALESCE($7, is_active),
         last_validated = NOW(),
         updated_at = NOW()
     WHERE domain = $1
     RETURNING *`,
    [
      domain,
      updates.price_selector,
      updates.title_selector,
      updates.image_selector,
      updates.requires_js,
      updates.rate_limit,
      updates.is_active,
    ]
  );
  return result[0] || null;
}

/**
 * Creates a new scraper configuration for a domain.
 * Used when adding support for a new e-commerce website.
 * @param config - Configuration including domain, selectors, and settings
 * @returns The created configuration or null on failure
 */
export async function createScraperConfig(config: Partial<ScraperConfig>): Promise<ScraperConfig | null> {
  const result = await query<ScraperConfig>(
    `INSERT INTO scraper_configs (domain, price_selector, title_selector, image_selector, parser_type, requires_js, rate_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      config.domain,
      config.price_selector,
      config.title_selector,
      config.image_selector,
      config.parser_type || 'css',
      config.requires_js || false,
      config.rate_limit || 100,
    ]
  );
  return result[0] || null;
}
