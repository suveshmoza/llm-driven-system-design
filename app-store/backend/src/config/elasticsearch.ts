/**
 * @fileoverview Elasticsearch client and index configuration for app search.
 * Provides full-text search, fuzzy matching, and autocomplete suggestions.
 */

import { Client } from '@elastic/elasticsearch';
import { config } from './index.js';

/**
 * Elasticsearch client instance for search operations.
 */
export const esClient = new Client({
  node: config.elasticsearch.url,
});

/** Index name for app documents in Elasticsearch */
export const APP_INDEX = 'apps';

/**
 * Elasticsearch index mapping for app documents.
 * Defines field types, analyzers, and search configurations.
 * Includes completion suggester for autocomplete functionality.
 */
export const appIndexMapping = {
  mappings: {
    properties: {
      id: { type: 'keyword' as const },
      bundleId: { type: 'keyword' as const },
      name: {
        type: 'text' as const,
        analyzer: 'standard',
        fields: {
          keyword: { type: 'keyword' as const },
          suggest: { type: 'completion' as const },
        },
      },
      developer: {
        type: 'text' as const,
        fields: {
          keyword: { type: 'keyword' as const },
        },
      },
      developerId: { type: 'keyword' as const },
      description: { type: 'text' as const },
      keywords: { type: 'text' as const },
      category: { type: 'keyword' as const },
      subcategory: { type: 'keyword' as const },
      isFree: { type: 'boolean' as const },
      price: { type: 'float' as const },
      averageRating: { type: 'float' as const },
      ratingCount: { type: 'integer' as const },
      downloadCount: { type: 'long' as const },
      releaseDate: { type: 'date' as const },
      lastUpdated: { type: 'date' as const },
      ageRating: { type: 'keyword' as const },
      size: { type: 'long' as const },
      version: { type: 'keyword' as const },
      iconUrl: { type: 'keyword' as const },
      screenshots: { type: 'keyword' as const },
      qualityScore: { type: 'float' as const },
      engagementScore: { type: 'float' as const },
    },
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        standard: {
          type: 'standard' as const,
        },
      },
    },
  },
};

/**
 * Creates the apps index if it does not exist.
 * Called during server startup to ensure search infrastructure is ready.
 * @throws Error if Elasticsearch is unreachable or index creation fails
 */
export async function initializeElasticsearch(): Promise<void> {
  try {
    const indexExists = await esClient.indices.exists({ index: APP_INDEX });

    if (!indexExists) {
      await esClient.indices.create({
        index: APP_INDEX,
        body: appIndexMapping,
      });
      console.log(`Created Elasticsearch index: ${APP_INDEX}`);
    } else {
      console.log(`Elasticsearch index ${APP_INDEX} already exists`);
    }
  } catch (error) {
    console.error('Error initializing Elasticsearch:', error);
    throw error;
  }
}
