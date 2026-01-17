/**
 * @fileoverview Click event ingestion service - the core data pipeline.
 * Handles incoming ad clicks with deduplication, fraud detection,
 * persistent storage, and real-time aggregation updates.
 * Designed for high throughput (10,000+ clicks/second at scale).
 */

import { v4 as uuidv4 } from 'uuid';
import type { ClickEvent, ClickEventInput } from '../types/index.js';
import { query } from './database.js';
import {
  isDuplicateClick,
  markClickProcessed,
  incrementRealTimeCounter,
  trackUniqueUser,
} from './redis.js';
import { detectFraud } from './fraud-detection.js';
import { updateAggregates } from './aggregation.js';

/**
 * Result of processing a click event through the ingestion pipeline.
 */
interface ClickIngestionResult {
  /** Whether processing completed successfully */
  success: boolean;
  /** Unique click identifier */
  click_id: string;
  /** Whether this was a duplicate click (already processed) */
  is_duplicate: boolean;
  /** Whether the click was flagged as fraudulent */
  is_fraudulent: boolean;
  /** Reason for fraud flagging, if applicable */
  fraud_reason?: string;
  /** Human-readable processing status message */
  message: string;
}

/**
 * Formats a date to minute-granularity bucket for aggregation.
 * Used as the key for real-time counters and aggregation tables.
 *
 * @param date - Date to format
 * @returns ISO string truncated to minute (YYYY-MM-DDTHH:MM:00Z)
 */
function getMinuteBucket(date: Date): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16) + ':00Z';
}

/**
 * Main entry point for processing incoming click events.
 * Implements the full ingestion pipeline:
 * 1. Deduplication check via Redis
 * 2. Fraud detection scoring
 * 3. Persistent storage in PostgreSQL
 * 4. Real-time counter updates in Redis
 * 5. Aggregation table updates
 *
 * @param input - Raw click event input from API
 * @returns Processing result with click ID and status
 */
export async function processClickEvent(input: ClickEventInput): Promise<ClickIngestionResult> {
  // Generate click_id if not provided
  const clickId = input.click_id || uuidv4();

  // Check for duplicate click
  const isDuplicate = await isDuplicateClick(clickId);
  if (isDuplicate) {
    return {
      success: true,
      click_id: clickId,
      is_duplicate: true,
      is_fraudulent: false,
      message: 'Click already processed (duplicate)',
    };
  }

  // Create click event with server timestamp
  const clickEvent: ClickEvent = {
    click_id: clickId,
    ad_id: input.ad_id,
    campaign_id: input.campaign_id,
    advertiser_id: input.advertiser_id,
    user_id: input.user_id,
    timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
    device_type: input.device_type,
    os: input.os,
    browser: input.browser,
    country: input.country,
    region: input.region,
    ip_hash: input.ip_hash,
  };

  // Run fraud detection
  const fraudResult = await detectFraud(clickEvent);
  clickEvent.is_fraudulent = fraudResult.is_fraudulent;
  clickEvent.fraud_reason = fraudResult.reason;

  // Store raw click event in database
  await storeClickEvent(clickEvent);

  // Mark click as processed for deduplication
  await markClickProcessed(clickId);

  // Update real-time counters in Redis
  const timeBucket = getMinuteBucket(clickEvent.timestamp);
  await incrementRealTimeCounter(clickEvent.ad_id, clickEvent.campaign_id, timeBucket);

  // Track unique users if user_id is provided
  if (clickEvent.user_id) {
    await trackUniqueUser(clickEvent.ad_id, clickEvent.user_id, timeBucket);
  }

  // Update aggregation tables
  await updateAggregates(clickEvent);

  return {
    success: true,
    click_id: clickId,
    is_duplicate: false,
    is_fraudulent: fraudResult.is_fraudulent,
    fraud_reason: fraudResult.reason,
    message: fraudResult.is_fraudulent
      ? 'Click recorded but flagged as potentially fraudulent'
      : 'Click recorded successfully',
  };
}

/**
 * Persists a click event to the PostgreSQL database.
 * Uses ON CONFLICT DO NOTHING for idempotency.
 *
 * @param click - Fully populated click event to store
 */
async function storeClickEvent(click: ClickEvent): Promise<void> {
  const sql = `
    INSERT INTO click_events (
      click_id, ad_id, campaign_id, advertiser_id, user_id,
      timestamp, device_type, os, browser, country, region,
      ip_hash, is_fraudulent, fraud_reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (click_id) DO NOTHING
  `;

  await query(sql, [
    click.click_id,
    click.ad_id,
    click.campaign_id,
    click.advertiser_id,
    click.user_id,
    click.timestamp,
    click.device_type,
    click.os,
    click.browser,
    click.country,
    click.region,
    click.ip_hash,
    click.is_fraudulent,
    click.fraud_reason,
  ]);
}

/**
 * Processes multiple click events in sequence.
 * Used for batch ingestion endpoints to improve throughput.
 * Each click is processed independently; failures don't affect others.
 *
 * @param inputs - Array of click event inputs to process
 * @returns Array of results matching input order
 */
export async function processBatchClickEvents(
  inputs: ClickEventInput[]
): Promise<ClickIngestionResult[]> {
  const results: ClickIngestionResult[] = [];

  for (const input of inputs) {
    try {
      const result = await processClickEvent(input);
      results.push(result);
    } catch (error) {
      results.push({
        success: false,
        click_id: input.click_id || 'unknown',
        is_duplicate: false,
        is_fraudulent: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}
