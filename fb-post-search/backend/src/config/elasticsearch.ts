/**
 * @fileoverview Elasticsearch client configuration and index management.
 * Provides the Elasticsearch client instance, index mapping definitions,
 * and initialization logic for the posts search index.
 */

import { Client } from '@elastic/elasticsearch';
import { config } from '../config/index.js';

/**
 * Elasticsearch client instance configured from environment settings.
 * Used for all search and indexing operations.
 * @constant
 */
export const esClient = new Client({
  node: config.elasticsearch.url,
});

/**
 * Name of the Elasticsearch index used for storing searchable posts.
 * @constant
 */
export const POSTS_INDEX = config.elasticsearch.index;

/**
 * Elasticsearch index mapping for posts documents.
 * Defines field types and analyzers for efficient full-text search with privacy filtering.
 * Key fields include:
 * - content: Full-text searchable with standard analyzer
 * - visibility_fingerprints: Keyword array for efficient privacy filtering
 * - engagement_score: Float for ranking by popularity
 * @constant
 */
export const postsMapping = {
  mappings: {
    properties: {
      post_id: { type: 'keyword' as const },
      author_id: { type: 'keyword' as const },
      author_name: { type: 'text' as const },
      content: {
        type: 'text' as const,
        analyzer: 'standard',
        fields: {
          keyword: { type: 'keyword' as const, ignore_above: 256 },
        },
      },
      hashtags: { type: 'keyword' as const },
      mentions: { type: 'keyword' as const },
      created_at: { type: 'date' as const },
      updated_at: { type: 'date' as const },
      visibility: { type: 'keyword' as const }, // 'public', 'friends', 'friends_of_friends', 'private'
      visibility_fingerprints: { type: 'keyword' as const }, // For privacy-aware filtering
      post_type: { type: 'keyword' as const }, // 'text', 'photo', 'video', 'link'
      engagement_score: { type: 'float' as const },
      like_count: { type: 'integer' as const },
      comment_count: { type: 'integer' as const },
      share_count: { type: 'integer' as const },
      language: { type: 'keyword' as const },
    },
  },
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        standard: {
          type: 'standard' as const,
          stopwords: '_english_' as const,
        },
      },
    },
  },
};

/**
 * Initializes the Elasticsearch posts index if it doesn't exist.
 * Creates the index with the predefined mapping for proper field types and analyzers.
 * Should be called during application startup before accepting search requests.
 * @returns Promise that resolves when initialization is complete
 * @throws Throws an error if Elasticsearch connection fails
 */
export async function initializeElasticsearch(): Promise<void> {
  try {
    const indexExists = await esClient.indices.exists({ index: POSTS_INDEX });

    if (!indexExists) {
      await esClient.indices.create({
        index: POSTS_INDEX,
        body: postsMapping,
      });
      console.log(`Created Elasticsearch index: ${POSTS_INDEX}`);
    } else {
      console.log(`Elasticsearch index ${POSTS_INDEX} already exists`);
    }
  } catch (error) {
    console.error('Failed to initialize Elasticsearch:', error);
    throw error;
  }
}
