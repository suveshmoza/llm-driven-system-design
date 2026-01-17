/**
 * @fileoverview Click aggregation service for pre-computed analytics.
 * Queries aggregation data from ClickHouse materialized views.
 * ClickHouse automatically maintains minute, hour, and day aggregates
 * via materialized views when click events are inserted.
 *
 * NOTE: This file no longer contains UPSERT logic - ClickHouse handles
 * aggregation automatically through its materialized view system.
 */

import type { AggregateQueryParams, AggregateQueryResult } from '../types/index.js';
import {
  queryAggregates as queryClickHouseAggregates,
  getRealTimeStats as getClickHouseRealTimeStats,
  getCampaignSummary as getClickHouseCampaignSummary,
} from './clickhouse.js';

/**
 * Queries pre-aggregated click data from ClickHouse.
 * Automatically selects the appropriate aggregation table based on granularity.
 * Supports filtering by campaign, advertiser, ad, and time range.
 *
 * @param params - Query parameters including time range, filters, and grouping
 * @returns Aggregated data with totals and query timing
 */
export async function queryAggregates(params: AggregateQueryParams): Promise<AggregateQueryResult> {
  const startTime = Date.now();
  const granularity = params.granularity || 'hour';

  const groupBy: ('country' | 'device_type')[] = [];
  if (params.group_by?.includes('country')) {
    groupBy.push('country');
  }
  if (params.group_by?.includes('device_type')) {
    groupBy.push('device_type');
  }

  const rows = await queryClickHouseAggregates({
    granularity: granularity as 'minute' | 'hour' | 'day',
    startTime: new Date(params.start_time),
    endTime: new Date(params.end_time),
    campaignId: params.campaign_id,
    advertiserId: params.advertiser_id,
    adId: params.ad_id,
    groupBy: groupBy.length > 0 ? groupBy : undefined,
  });

  // Calculate totals
  let totalClicks = 0;
  let totalUniqueUsers = 0;

  const data = rows.map((row) => {
    totalClicks += row.click_count;
    totalUniqueUsers += row.unique_users;

    const fraudRate =
      row.click_count > 0 ? Math.round((row.fraud_count / row.click_count) * 10000) / 10000 : 0;

    return {
      time_bucket: row.time_bucket,
      country: row.country,
      device_type: row.device_type,
      clicks: row.click_count,
      unique_users: row.unique_users,
      fraud_rate: fraudRate,
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
  return getClickHouseCampaignSummary(campaignId, startTime, endTime);
}

/**
 * Retrieves real-time click statistics for the last N minutes.
 * Queries minute-level aggregations from ClickHouse for live dashboard display.
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
  return getClickHouseRealTimeStats(minutes);
}
