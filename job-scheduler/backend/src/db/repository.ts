/**
 * Repository module combining all database operations.
 * Re-exports all functions from individual repository modules for convenience.
 * Import from this file for a unified API, or import directly from specific
 * modules for more granular control.
 * @module db/repository
 */

// Re-export all job operations
export {
  createJob,
  getJob,
  getJobByName,
  listJobs,
  listJobsWithStats,
  updateJob,
  deleteJob,
  updateJobStatus,
} from './job-repository.js';

// Re-export all schedule operations
export {
  getDueJobs,
  scheduleNextRun,
  pauseJob,
  resumeJob,
} from './schedule-repository.js';

// Re-export all execution operations
export {
  createExecution,
  getExecution,
  getExecutionWithJob,
  listExecutions,
  updateExecution,
  getRetryableExecutions,
  addExecutionLog,
  getExecutionLogs,
} from './execution-repository.js';

// Re-export query helpers and metrics
export {
  getSystemMetrics,
  getExecutionStats,
  buildWhereClause,
  calculateOffset,
  getCount,
} from './queries.js';

// Re-export types for convenience
export type {
  Job,
  JobExecution,
  JobWithStats,
  ExecutionLog,
  PaginatedResponse,
  SystemMetrics,
  HourlyStats,
  CountResult,
} from './types.js';
