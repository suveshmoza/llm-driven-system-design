/**
 * @fileoverview Database seeding script.
 *
 * This script populates the database with initial seed URLs to start crawling.
 * Seed URLs are high-value starting points for discovering new content.
 *
 * Usage:
 *   npm run db:seed
 *
 * The script:
 * 1. Initializes the database connection
 * 2. Adds predefined seed URLs to the seed_urls table
 * 3. Adds the same URLs to the frontier with high priority
 * 4. Closes connections and exits
 *
 * Note: Running this multiple times is safe - existing URLs are skipped.
 *
 * @module scripts/seed
 */

import { pool, initDatabase, closeDatabase } from '../models/database.js';
import { frontierService } from '../services/frontier.js';
import { closeRedis } from '../models/redis.js';

/**
 * Default seed URLs for initial crawling.
 *
 * These are popular, well-structured websites that serve as good
 * starting points for a web crawl. They include:
 * - Example.com (for testing)
 * - Wikipedia (comprehensive, well-linked)
 * - News sites (frequently updated)
 * - Tech sites (diverse content)
 */
const SEED_URLS = [
  'https://example.com',
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://news.ycombinator.com',
  'https://www.reddit.com',
  'https://github.com',
  'https://www.bbc.com/news',
  'https://www.cnn.com',
  'https://www.nytimes.com',
  'https://techcrunch.com',
  'https://www.wired.com',
];

/**
 * Seeds the database with initial URLs.
 *
 * This function:
 * 1. Adds URLs to the seed_urls table for reference
 * 2. Adds URLs to the frontier with priority 3 (high) and depth 0
 * 3. Reports how many URLs were added vs. already existed
 */
async function seed() {
  try {
    console.log('Initializing database...');
    await initDatabase();

    console.log('Adding seed URLs to frontier...');

    // Add to seed_urls table
    for (const url of SEED_URLS) {
      await pool.query(
        `INSERT INTO seed_urls (url, priority) VALUES ($1, 3)
         ON CONFLICT (url) DO NOTHING`,
        [url]
      );
    }

    // Add to frontier with high priority
    const added = await frontierService.addUrls(SEED_URLS, {
      priority: 3,
      depth: 0,
    });

    console.log(`Added ${added} seed URLs to frontier`);
    console.log('Seed completed successfully');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
    await closeRedis();
  }
}

seed();
