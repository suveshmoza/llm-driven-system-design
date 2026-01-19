/**
 * Shared types for database repository modules.
 * These types are used across job, execution, and schedule repositories.
 * @module db/types
 */

import {
  Job,
  JobExecution,
  JobWithStats,
  ExecutionLog,
  PaginatedResponse,
} from '../types/index.js';

/**
 * Re-export main types for convenience.
 * Consumers can import these from db/types instead of the main types module.
 */
export type {
  Job,
  JobExecution,
  JobWithStats,
  ExecutionLog,
  PaginatedResponse,
};

/**
 * Common count result from aggregate queries.
 */
export interface CountResult {
  count: string;
}

/**
 * Hourly execution statistics for dashboard charts.
 */
export interface HourlyStats {
  hour: Date;
  completed: number;
  failed: number;
  avg_duration_ms: number;
}

/**
 * Aggregated system metrics from the database.
 * Used for dashboard display and monitoring.
 */
export interface SystemMetricsResult {
  total_jobs: string;
  active_jobs: string;
  queued_executions: string;
  running_executions: string;
  completed_24h: string;
  failed_24h: string;
}

/**
 * Parsed system metrics with numeric values.
 */
export interface SystemMetrics {
  total_jobs: number;
  active_jobs: number;
  queued_executions: number;
  running_executions: number;
  completed_24h: number;
  failed_24h: number;
}

/**
 * Field mapping for execution updates.
 * Maps update input keys to database column names.
 */
export const EXECUTION_FIELD_MAP: Record<string, string> = {
  status: 'status',
  attempt: 'attempt',
  started_at: 'started_at',
  completed_at: 'completed_at',
  next_retry_at: 'next_retry_at',
  result: 'result',
  error: 'error',
  worker_id: 'worker_id',
};
