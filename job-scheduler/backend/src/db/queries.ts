/**
 * Reusable query helpers for database operations.
 * Provides utilities for building dynamic queries and handling common patterns.
 * @module db/queries
 */

import { query, queryOne } from './pool.js';
import { CountResult, SystemMetrics, SystemMetricsResult, HourlyStats } from './types.js';

/**
 * Builds a WHERE clause from an array of conditions.
 * @param conditions - Array of SQL condition strings
 * @returns Formatted WHERE clause or empty string if no conditions
 */
export function buildWhereClause(conditions: string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

/**
 * Calculates pagination offset from page number and limit.
 * @param page - Page number (1-indexed)
 * @param limit - Items per page
 * @returns Offset value for SQL OFFSET clause
 */
export function calculateOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Gets total count from a table with optional WHERE clause.
 * @param table - Table name to count
 * @param whereClause - Optional WHERE clause (without WHERE keyword)
 * @param params - Parameters for the WHERE clause
 * @returns Total count as a number
 */
export async function getCount(
  table: string,
  whereClause?: string,
  params: unknown[] = []
): Promise<number> {
  const sql = whereClause
    ? `SELECT COUNT(*) as count FROM ${table} WHERE ${whereClause}`
    : `SELECT COUNT(*) as count FROM ${table}`;

  const result = await query<CountResult>(sql, params);
  return parseInt(result[0]?.count || '0', 10);
}

/**
 * Retrieves aggregated system metrics for dashboard display.
 * Provides counts of jobs, executions, and completion statistics.
 * @returns Object with various system metrics
 */
export async function getSystemMetrics(): Promise<SystemMetrics> {
  const result = await queryOne<SystemMetricsResult>(`
    SELECT
      (SELECT COUNT(*) FROM jobs) as total_jobs,
      (SELECT COUNT(*) FROM jobs WHERE status IN ('SCHEDULED', 'QUEUED', 'RUNNING')) as active_jobs,
      (SELECT COUNT(*) FROM job_executions WHERE status = 'PENDING') as queued_executions,
      (SELECT COUNT(*) FROM job_executions WHERE status = 'RUNNING') as running_executions,
      (SELECT COUNT(*) FROM job_executions WHERE status = 'COMPLETED' AND completed_at > NOW() - INTERVAL '24 hours') as completed_24h,
      (SELECT COUNT(*) FROM job_executions WHERE status = 'FAILED' AND completed_at > NOW() - INTERVAL '24 hours') as failed_24h
  `);

  if (!result) {
    return {
      total_jobs: 0,
      active_jobs: 0,
      queued_executions: 0,
      running_executions: 0,
      completed_24h: 0,
      failed_24h: 0,
    };
  }

  return {
    total_jobs: parseInt(result.total_jobs, 10),
    active_jobs: parseInt(result.active_jobs, 10),
    queued_executions: parseInt(result.queued_executions, 10),
    running_executions: parseInt(result.running_executions, 10),
    completed_24h: parseInt(result.completed_24h, 10),
    failed_24h: parseInt(result.failed_24h, 10),
  };
}

/**
 * Retrieves hourly execution statistics for charting.
 * Used to display execution trends over time in the dashboard.
 * @param hours - Number of hours of history to retrieve
 * @returns Array of hourly statistics with completion counts and durations
 */
export async function getExecutionStats(hours: number = 24): Promise<HourlyStats[]> {
  return query<HourlyStats>(
    `SELECT
      date_trunc('hour', completed_at) as hour,
      COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
      COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) as avg_duration_ms
    FROM job_executions
    WHERE completed_at > NOW() - INTERVAL '${hours} hours'
    GROUP BY date_trunc('hour', completed_at)
    ORDER BY hour ASC`,
    []
  );
}
