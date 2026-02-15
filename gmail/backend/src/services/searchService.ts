import { searchEmails, SearchFilters } from './elasticsearch.js';
import { searchDuration, searchQueriesTotal } from './metrics.js';
import logger from './logger.js';

export interface ParsedSearchQuery {
  text: string;
  filters: SearchFilters;
}

/**
 * Parse Gmail-style search operators from a query string
 * Supports: from:, to:, has:attachment, before:, after:
 */
export const parseSearchQuery = (rawQuery: string): ParsedSearchQuery => {
  const filters: SearchFilters = {};
  let text = rawQuery;

  // Extract from: operator
  const fromMatch = text.match(/from:(\S+)/i);
  if (fromMatch) {
    filters.from = fromMatch[1];
    text = text.replace(fromMatch[0], '').trim();
  }

  // Extract to: operator
  const toMatch = text.match(/to:(\S+)/i);
  if (toMatch) {
    filters.to = toMatch[1];
    text = text.replace(toMatch[0], '').trim();
  }

  // Extract has:attachment
  const hasMatch = text.match(/has:attachment/i);
  if (hasMatch) {
    filters.hasAttachment = true;
    text = text.replace(hasMatch[0], '').trim();
  }

  // Extract before: operator
  const beforeMatch = text.match(/before:(\S+)/i);
  if (beforeMatch) {
    filters.dateBefore = beforeMatch[1];
    text = text.replace(beforeMatch[0], '').trim();
  }

  // Extract after: operator
  const afterMatch = text.match(/after:(\S+)/i);
  if (afterMatch) {
    filters.dateAfter = afterMatch[1];
    text = text.replace(afterMatch[0], '').trim();
  }

  return { text: text.trim(), filters };
};

/**
 * Search emails for a user
 */
export const search = async (
  userId: string,
  rawQuery: string,
  page: number = 1,
  limit: number = 20
) => {
  const startTime = process.hrtime.bigint();

  const { text, filters } = parseSearchQuery(rawQuery);

  searchQueriesTotal.inc();

  try {
    const result = await searchEmails(userId, text, filters, page, limit);

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    searchDuration.labels({ type: 'email' }).observe(duration);

    logger.debug(
      {
        userId,
        query: rawQuery,
        resultCount: result.results.length,
        total: result.total,
        durationMs: Math.round(duration * 1000),
      },
      'Search completed'
    );

    return result;
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, query: rawQuery }, 'Search failed');
    return { results: [], total: 0 };
  }
};
