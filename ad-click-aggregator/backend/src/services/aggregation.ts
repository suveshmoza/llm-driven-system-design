/**
 * @fileoverview Click aggregation service for pre-computed analytics.
 * Maintains aggregation tables at minute, hour, and day granularity
 * to enable fast analytical queries without scanning raw events.
 * Uses UPSERT pattern for atomic counter updates.
 */

import type { ClickEvent, ClickAggregate, AggregateQueryParams, AggregateQueryResult } from '../types/index.js';
import { query } from './database.js';
import { getUniqueUserCount } from './redis.js';

/**
 * Truncates a date to minute granularity for aggregation bucketing.
 *
 * @param date - Source date
 * @returns Date with seconds and milliseconds set to zero
 */
function getMinuteBucket(date: Date): Date {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d;
}

/**
 * Truncates a date to hour granularity for aggregation bucketing.
 *
 * @param date - Source date
 * @returns Date with minutes, seconds, and milliseconds set to zero
 */
function getHourBucket(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

/**
 * Truncates a date to day granularity for aggregation bucketing.
 *
 * @param date - Source date
 * @returns Date with hours, minutes, seconds, and milliseconds set to zero
 */
function getDayBucket(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Updates all aggregation tables (minute, hour, day) for a processed click.
 * Called synchronously during click ingestion to maintain real-time accuracy.
 * Uses Redis HyperLogLog for unique user estimation in minute aggregates.
 *
 * @param click - The click event to aggregate
 */
export async function updateAggregates(click: ClickEvent): Promise<void> {
  const minuteBucket = getMinuteBucket(click.timestamp);
  const hourBucket = getHourBucket(click.timestamp);
  const dayBucket = getDayBucket(click.timestamp);

  // Get unique user count estimate from HyperLogLog
  const minuteBucketStr = minuteBucket.toISOString().slice(0, 16) + ':00Z';
  const uniqueUsers = await getUniqueUserCount(click.ad_id, minuteBucketStr);

  // Update minute aggregation
  await upsertMinuteAggregate(click, minuteBucket, uniqueUsers);

  // Update hour aggregation
  await upsertHourAggregate(click, hourBucket);

  // Update day aggregation
  await upsertDayAggregate(click, dayBucket);
}

/**
 * Upserts minute-level aggregation with unique user count from HyperLogLog.
 * Uses ON CONFLICT for atomic increment of click and fraud counters.
 *
 * @param click - Click event being aggregated
 * @param timeBucket - Minute-granularity time bucket
 * @param uniqueUsers - Estimated unique user count from Redis HLL
 */
async function upsertMinuteAggregate(
  click: ClickEvent,
  timeBucket: Date,
  uniqueUsers: number
): Promise<void> {
  const sql = `
    INSERT INTO click_aggregates_minute (
      time_bucket, ad_id, campaign_id, advertiser_id, country, device_type,
      click_count, unique_users, fraud_count, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, NOW())
    ON CONFLICT (time_bucket, ad_id, country, device_type)
    DO UPDATE SET
      click_count = click_aggregates_minute.click_count + 1,
      unique_users = $7,
      fraud_count = click_aggregates_minute.fraud_count + $8,
      updated_at = NOW()
  `;

  await query(sql, [
    timeBucket,
    click.ad_id,
    click.campaign_id,
    click.advertiser_id,
    click.country || 'unknown',
    click.device_type || 'unknown',
    uniqueUsers,
    click.is_fraudulent ? 1 : 0,
  ]);
}

/**
 * Upserts hour-level aggregation with atomic counter increments.
 * Uses ON CONFLICT for atomic increment of click and fraud counters.
 *
 * @param click - Click event being aggregated
 * @param timeBucket - Hour-granularity time bucket
 */
async function upsertHourAggregate(click: ClickEvent, timeBucket: Date): Promise<void> {
  const sql = `
    INSERT INTO click_aggregates_hour (
      time_bucket, ad_id, campaign_id, advertiser_id, country, device_type,
      click_count, unique_users, fraud_count, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, NOW())
    ON CONFLICT (time_bucket, ad_id, country, device_type)
    DO UPDATE SET
      click_count = click_aggregates_hour.click_count + 1,
      unique_users = click_aggregates_hour.unique_users + 1,
      fraud_count = click_aggregates_hour.fraud_count + $7,
      updated_at = NOW()
  `;

  await query(sql, [
    timeBucket,
    click.ad_id,
    click.campaign_id,
    click.advertiser_id,
    click.country || 'unknown',
    click.device_type || 'unknown',
    click.is_fraudulent ? 1 : 0,
  ]);
}

/**
 * Upserts day-level aggregation with atomic counter increments.
 * Uses ON CONFLICT for atomic increment of click and fraud counters.
 *
 * @param click - Click event being aggregated
 * @param timeBucket - Day-granularity time bucket
 */
async function upsertDayAggregate(click: ClickEvent, timeBucket: Date): Promise<void> {
  const sql = `
    INSERT INTO click_aggregates_day (
      time_bucket, ad_id, campaign_id, advertiser_id, country, device_type,
      click_count, unique_users, fraud_count, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, NOW())
    ON CONFLICT (time_bucket, ad_id, country, device_type)
    DO UPDATE SET
      click_count = click_aggregates_day.click_count + 1,
      unique_users = click_aggregates_day.unique_users + 1,
      fraud_count = click_aggregates_day.fraud_count + $7,
      updated_at = NOW()
  `;

  await query(sql, [
    timeBucket,
    click.ad_id,
    click.campaign_id,
    click.advertiser_id,
    click.country || 'unknown',
    click.device_type || 'unknown',
    click.is_fraudulent ? 1 : 0,
  ]);
}

/**
 * Queries pre-aggregated click data with flexible filtering and grouping.
 * Automatically selects the appropriate aggregation table based on granularity.
 * Supports filtering by campaign, advertiser, ad, and time range.
 *
 * @param params - Query parameters including time range, filters, and grouping
 * @returns Aggregated data with totals and query timing
 */
export async function queryAggregates(params: AggregateQueryParams): Promise<AggregateQueryResult> {
  const startTime = Date.now();
  const granularity = params.granularity || 'hour';

  let tableName: string;
  switch (granularity) {
    case 'minute':
      tableName = 'click_aggregates_minute';
      break;
    case 'day':
      tableName = 'click_aggregates_day';
      break;
    default:
      tableName = 'click_aggregates_hour';
  }

  // Build WHERE clause
  const conditions: string[] = ['time_bucket >= $1', 'time_bucket <= $2'];
  const values: unknown[] = [params.start_time, params.end_time];
  let paramIndex = 3;

  if (params.campaign_id) {
    conditions.push(`campaign_id = $${paramIndex}`);
    values.push(params.campaign_id);
    paramIndex++;
  }

  if (params.advertiser_id) {
    conditions.push(`advertiser_id = $${paramIndex}`);
    values.push(params.advertiser_id);
    paramIndex++;
  }

  if (params.ad_id) {
    conditions.push(`ad_id = $${paramIndex}`);
    values.push(params.ad_id);
    paramIndex++;
  }

  // Build GROUP BY clause
  const groupByFields = ['time_bucket'];
  const selectFields = ['time_bucket'];

  if (params.group_by) {
    if (params.group_by.includes('country')) {
      groupByFields.push('country');
      selectFields.push('country');
    }
    if (params.group_by.includes('device_type')) {
      groupByFields.push('device_type');
      selectFields.push('device_type');
    }
  }

  const sql = `
    SELECT
      ${selectFields.join(', ')},
      SUM(click_count) as clicks,
      SUM(unique_users) as unique_users,
      SUM(fraud_count) as fraud_count,
      CASE WHEN SUM(click_count) > 0
        THEN ROUND(SUM(fraud_count)::numeric / SUM(click_count)::numeric, 4)
        ELSE 0
      END as fraud_rate
    FROM ${tableName}
    WHERE ${conditions.join(' AND ')}
    GROUP BY ${groupByFields.join(', ')}
    ORDER BY time_bucket ASC
  `;

  const rows = await query<{
    time_bucket: Date;
    country?: string;
    device_type?: string;
    clicks: string;
    unique_users: string;
    fraud_count: string;
    fraud_rate: string;
  }>(sql, values);

  // Calculate totals
  let totalClicks = 0;
  let totalUniqueUsers = 0;

  const data = rows.map((row) => {
    const clicks = parseInt(row.clicks, 10);
    const uniqueUsers = parseInt(row.unique_users, 10);
    totalClicks += clicks;
    totalUniqueUsers += uniqueUsers;

    return {
      time_bucket: row.time_bucket.toISOString(),
      country: row.country,
      device_type: row.device_type,
      clicks,
      unique_users: uniqueUsers,
      fraud_rate: parseFloat(row.fraud_rate),
    };
  });

  return {
    data,
    total_clicks: totalClicks,
    total_unique_users: totalUniqueUsers,
    query_time_ms: Date.now() - startTime,
  };
}

/**
 * Generates a comprehensive summary for a specific campaign.
 * Returns total metrics, fraud statistics, and breakdowns by country and device.
 * Useful for campaign performance dashboards.
 *
 * @param campaignId - Campaign identifier to summarize
 * @param startTime - Start of the reporting period
 * @param endTime - End of the reporting period
 * @returns Campaign summary with totals and dimension breakdowns
 */
export async function getCampaignSummary(
  campaignId: string,
  startTime: Date,
  endTime: Date
): Promise<{
  total_clicks: number;
  unique_users: number;
  fraud_count: number;
  fraud_rate: number;
  top_countries: { country: string; clicks: number }[];
  top_devices: { device_type: string; clicks: number }[];
}> {
  // Get total stats
  const totalsSql = `
    SELECT
      SUM(click_count) as total_clicks,
      SUM(unique_users) as unique_users,
      SUM(fraud_count) as fraud_count
    FROM click_aggregates_hour
    WHERE campaign_id = $1 AND time_bucket >= $2 AND time_bucket <= $3
  `;

  const totalsResult = await query<{
    total_clicks: string;
    unique_users: string;
    fraud_count: string;
  }>(totalsSql, [campaignId, startTime, endTime]);

  const totals = totalsResult[0] || { total_clicks: '0', unique_users: '0', fraud_count: '0' };
  const totalClicks = parseInt(totals.total_clicks || '0', 10);
  const uniqueUsers = parseInt(totals.unique_users || '0', 10);
  const fraudCount = parseInt(totals.fraud_count || '0', 10);

  // Get top countries
  const countriesSql = `
    SELECT country, SUM(click_count) as clicks
    FROM click_aggregates_hour
    WHERE campaign_id = $1 AND time_bucket >= $2 AND time_bucket <= $3
    GROUP BY country
    ORDER BY clicks DESC
    LIMIT 10
  `;

  const countriesResult = await query<{ country: string; clicks: string }>(countriesSql, [
    campaignId,
    startTime,
    endTime,
  ]);

  // Get top devices
  const devicesSql = `
    SELECT device_type, SUM(click_count) as clicks
    FROM click_aggregates_hour
    WHERE campaign_id = $1 AND time_bucket >= $2 AND time_bucket <= $3
    GROUP BY device_type
    ORDER BY clicks DESC
    LIMIT 10
  `;

  const devicesResult = await query<{ device_type: string; clicks: string }>(devicesSql, [
    campaignId,
    startTime,
    endTime,
  ]);

  return {
    total_clicks: totalClicks,
    unique_users: uniqueUsers,
    fraud_count: fraudCount,
    fraud_rate: totalClicks > 0 ? fraudCount / totalClicks : 0,
    top_countries: countriesResult.map((r) => ({
      country: r.country,
      clicks: parseInt(r.clicks, 10),
    })),
    top_devices: devicesResult.map((r) => ({
      device_type: r.device_type,
      clicks: parseInt(r.clicks, 10),
    })),
  };
}

/**
 * Retrieves real-time click statistics for the last N minutes.
 * Queries minute-level aggregations for live dashboard display.
 * Returns time series data and calculated throughput metrics.
 *
 * @param minutes - Number of minutes to look back (default: 60, max: 1440)
 * @returns Time series data with per-minute counts and averages
 */
export async function getRealTimeStats(
  minutes: number = 60
): Promise<{
  time_series: { timestamp: string; clicks: number }[];
  total_clicks: number;
  clicks_per_minute: number;
}> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - minutes * 60 * 1000);

  const sql = `
    SELECT time_bucket, SUM(click_count) as clicks
    FROM click_aggregates_minute
    WHERE time_bucket >= $1 AND time_bucket <= $2
    GROUP BY time_bucket
    ORDER BY time_bucket ASC
  `;

  const rows = await query<{ time_bucket: Date; clicks: string }>(sql, [startTime, endTime]);

  let totalClicks = 0;
  const timeSeries = rows.map((row) => {
    const clicks = parseInt(row.clicks, 10);
    totalClicks += clicks;
    return {
      timestamp: row.time_bucket.toISOString(),
      clicks,
    };
  });

  return {
    time_series: timeSeries,
    total_clicks: totalClicks,
    clicks_per_minute: minutes > 0 ? totalClicks / minutes : 0,
  };
}
