/**
 * RSS and Atom feed parsing utilities.
 * Provides unified parsing for RSS 2.0, RSS 1.0 (RDF), and Atom feed formats.
 * Essential for ingesting content from diverse news sources.
 */

import { XMLParser } from 'fast-xml-parser';

/**
 * Normalized representation of a feed item.
 * Provides a consistent interface regardless of source feed format.
 */
export interface RSSItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  category?: string | string[];
  guid?: string;
  content?: string;
  'content:encoded'?: string;
  'dc:creator'?: string;
}

/**
 * Normalized representation of an RSS/Atom feed.
 * Contains feed metadata and an array of items.
 */
export interface RSSFeed {
  title: string;
  link: string;
  description?: string;
  items: RSSItem[];
}

/** XML parser configured for RSS/Atom parsing with attribute handling */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Parse RSS/Atom feed XML content into a normalized structure.
 * Automatically detects and handles RSS 2.0, Atom, and RDF (RSS 1.0) formats.
 * @param xml - Raw XML string from feed fetch
 * @returns Parsed feed with normalized items
 * @throws Error if feed format is not recognized
 */
export function parseRSS(xml: string): RSSFeed {
  const parsed = parser.parse(xml);

  // Handle RSS 2.0
  if (parsed.rss?.channel) {
    const channel = parsed.rss.channel;
    return {
      title: channel.title || '',
      link: channel.link || '',
      description: channel.description || '',
      items: normalizeItems(channel.item),
    };
  }

  // Handle Atom
  if (parsed.feed) {
    const feed = parsed.feed;
    return {
      title: feed.title || '',
      link: extractAtomLink(feed.link),
      description: feed.subtitle || '',
      items: normalizeAtomEntries(feed.entry),
    };
  }

  // Handle RDF (RSS 1.0)
  if (parsed['rdf:RDF']) {
    const rdf = parsed['rdf:RDF'];
    const channel = rdf.channel;
    return {
      title: channel?.title || '',
      link: channel?.link || '',
      description: channel?.description || '',
      items: normalizeItems(rdf.item),
    };
  }

  throw new Error('Unknown feed format');
}

/**
 * Normalize RSS 2.0/RDF items to a consistent format.
 * Handles single items or arrays, and various content field names.
 * @param items - Raw items from parsed XML (may be single object or array)
 * @returns Array of normalized RSSItem objects
 */
function normalizeItems(items: unknown): RSSItem[] {
  if (!items) return [];
  const itemArray = Array.isArray(items) ? items : [items];

  return itemArray.map((item: Record<string, unknown>) => ({
    title: String(item.title || ''),
    link: String(item.link || item.guid || ''),
    description: String(item.description || ''),
    pubDate: item.pubDate as string | undefined,
    author: String(item.author || item['dc:creator'] || ''),
    category: item.category as string | string[] | undefined,
    guid: String(item.guid || item.link || ''),
    content: String(item['content:encoded'] || item.content || ''),
  }));
}

/**
 * Normalize Atom feed entries to a consistent format.
 * Maps Atom-specific fields to the common RSSItem interface.
 * @param entries - Raw Atom entries from parsed XML
 * @returns Array of normalized RSSItem objects
 */
function normalizeAtomEntries(entries: unknown): RSSItem[] {
  if (!entries) return [];
  const entryArray = Array.isArray(entries) ? entries : [entries];

  return entryArray.map((entry: Record<string, unknown>) => ({
    title: extractText(entry.title),
    link: extractAtomLink(entry.link),
    description: extractText(entry.summary),
    pubDate: String(entry.published || entry.updated || ''),
    author: extractAtomAuthor(entry.author),
    category: extractAtomCategories(entry.category),
    guid: String(entry.id || ''),
    content: extractText(entry.content),
  }));
}

/**
 * Extract text content from various Atom text constructs.
 * Handles plain strings, text nodes, and objects with #text or $t properties.
 * @param value - Atom text construct (string, object, or null)
 * @returns Extracted text string
 */
function extractText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return String(obj['#text'] || obj['$t'] || '');
  }
  return String(value);
}

/**
 * Extract link URL from Atom link elements.
 * Handles various link formats: string, single object, or array of link objects.
 * Prefers 'alternate' rel type when multiple links exist.
 * @param link - Atom link element (string, object, or array)
 * @returns Extracted URL string
 */
function extractAtomLink(link: unknown): string {
  if (!link) return '';
  if (typeof link === 'string') return link;
  if (Array.isArray(link)) {
    const alternate = link.find((l: Record<string, unknown>) => l['@_rel'] === 'alternate' || !l['@_rel']);
    return alternate ? String(alternate['@_href'] || '') : '';
  }
  if (typeof link === 'object' && link !== null) {
    return String((link as Record<string, unknown>)['@_href'] || '');
  }
  return '';
}

/**
 * Extract author name from Atom author element.
 * Handles string or object with name property.
 * @param author - Atom author element
 * @returns Author name string
 */
function extractAtomAuthor(author: unknown): string {
  if (!author) return '';
  if (typeof author === 'string') return author;
  if (typeof author === 'object' && author !== null) {
    const obj = author as Record<string, unknown>;
    return String(obj.name || '');
  }
  return '';
}

/**
 * Extract category terms from Atom category elements.
 * Handles single or multiple categories with term or label attributes.
 * @param category - Atom category element(s)
 * @returns Array of category strings
 */
function extractAtomCategories(category: unknown): string[] {
  if (!category) return [];
  const cats = Array.isArray(category) ? category : [category];
  return cats.map((c: Record<string, unknown>) => String(c['@_term'] || c['@_label'] || c || ''));
}

/**
 * Remove HTML tags and decode entities from text content.
 * Strips scripts, styles, and all markup while preserving text content.
 * @param html - HTML string to clean
 * @returns Plain text with HTML removed and entities decoded
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a summary from text content, truncating intelligently.
 * Attempts to break at sentence boundaries when possible.
 * @param text - Full text content (may contain HTML)
 * @param maxLength - Maximum summary length in characters (default: 300)
 * @returns Truncated summary, ending at sentence boundary if possible
 */
export function extractSummary(text: string, maxLength = 300): string {
  const cleaned = stripHtml(text);
  if (cleaned.length <= maxLength) return cleaned;

  // Try to break at sentence boundary
  const truncated = cleaned.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastQuestion = truncated.lastIndexOf('?');
  const lastExclaim = truncated.lastIndexOf('!');

  const lastSentence = Math.max(lastPeriod, lastQuestion, lastExclaim);
  if (lastSentence > maxLength * 0.5) {
    return truncated.slice(0, lastSentence + 1);
  }

  return truncated + '...';
}
