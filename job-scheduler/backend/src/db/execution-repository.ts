/**
 * Execution repository module for job execution records.
 * Handles creating, reading, updating executions and execution logs.
 * @module db/execution-repository
 */

import { query, queryOne } from './pool.js';
import { JobExecution, Job, ExecutionLog, PaginatedResponse, CountResult, EXECUTION_FIELD_MAP } from './types.js';
import { calculateOffset, buildWhereClause } from './queries.js';
import { ExecutionStatus } from '../types/index.js';

/**
 * Creates a new execution record for a job.
 * Executions track individual runs including timing, status, and results.
 * @param jobId - UUID of the job being executed
 * @param scheduledAt - When the execution was scheduled (defaults to now)
 * @param attempt - Attempt number for retry tracking (defaults to 1)
 * @returns The created execution record
 */
export async function createExecution(
  jobId: string,
  scheduledAt: Date = new Date(),
  attempt: number = 1
): Promise<JobExecution> {
  const result = await queryOne<JobExecution>(
    `INSERT INTO job_executions (job_id, status, attempt, scheduled_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [jobId, ExecutionStatus.PENDING, attempt, scheduledAt]
  );

  if (!result) {
    throw new Error('Failed to create execution');
  }

  return result;
}

/**
 * Retrieves an execution by its unique identifier.
 * @param id - UUID of the execution
 * @returns Execution record or null if not found
 */
export async function getExecution(id: string): Promise<JobExecution | null> {
  return queryOne<JobExecution>('SELECT * FROM job_executions WHERE id = $1', [id]);
}

/**
 * Retrieves an execution with its associated job data.
 * Used when worker needs both execution and job details.
 * @param id - UUID of the execution
 * @returns Execution with embedded job or null if not found
 */
export async function getExecutionWithJob(id: string): Promise<(JobExecution & { job: Job }) | null> {
  const result = await queryOne<JobExecution & { job: Job }>(
    `SELECT e.*, row_to_json(j.*) as job
     FROM job_executions e
     JOIN jobs j ON j.id = e.job_id
     WHERE e.id = $1`,
    [id]
  );
  return result;
}

/**
 * Lists executions with pagination and optional filtering.
 * @param jobId - Optional job UUID to filter by
 * @param page - Page number (1-indexed)
 * @param limit - Maximum executions per page
 * @param status - Optional status filter
 * @returns Paginated response with execution list
 */
export async function listExecutions(
  jobId?: string,
  page: number = 1,
  limit: number = 20,
  status?: ExecutionStatus
): Promise<PaginatedResponse<JobExecution>> {
  const offset = calculateOffset(page, limit);
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (jobId) {
    conditions.push(`job_id = $${paramIndex}`);
    params.push(jobId);
    paramIndex++;
  }

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  const whereClause = buildWhereClause(conditions);

  params.push(limit, offset);
  const executions = await query<JobExecution>(
    `SELECT * FROM job_executions ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  const countParams = jobId || status ? params.slice(0, -2) : [];
  const countResult = await query<CountResult>(
    `SELECT COUNT(*) as count FROM job_executions ${whereClause}`,
    countParams
  );
  const total = parseInt(countResult[0]?.count || '0', 10);

  return {
    items: executions,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  };
}

/**
 * Updates an execution record with new values.
 * Used to update status, timing, results, and error information.
 * @param id - UUID of the execution
 * @param updates - Fields to update
 * @returns Updated execution or null if not found
 */
export async function updateExecution(
  id: string,
  updates: Partial<Omit<JobExecution, 'id' | 'job_id' | 'created_at'>>
): Promise<JobExecution | null> {
  const updateFields: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const [key, column] of Object.entries(EXECUTION_FIELD_MAP)) {
    if (key in updates) {
      updateFields.push(`${column} = $${paramIndex}`);
      const value = updates[key as keyof typeof updates];
      params.push(key === 'result' && value ? JSON.stringify(value) : value);
      paramIndex++;
    }
  }

  if (updateFields.length === 0) {
    return getExecution(id);
  }

  params.push(id);
  return queryOne<JobExecution>(
    `UPDATE job_executions SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
}

/**
 * Retrieves executions in PENDING_RETRY status that are ready for retry.
 * Uses FOR UPDATE SKIP LOCKED for safe concurrent processing.
 * @param limit - Maximum number of executions to retrieve
 * @returns Array of executions ready for retry
 */
export async function getRetryableExecutions(limit: number = 50): Promise<JobExecution[]> {
  return query<JobExecution>(
    `SELECT * FROM job_executions
     WHERE status = 'PENDING_RETRY'
       AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit]
  );
}

/**
 * Adds a log entry for an execution.
 * Handlers use this to record progress, warnings, and errors during execution.
 * @param executionId - UUID of the execution
 * @param level - Log level (info, warn, error)
 * @param message - Log message
 * @param metadata - Optional structured metadata
 * @returns The created log entry
 */
export async function addExecutionLog(
  executionId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, unknown>
): Promise<ExecutionLog> {
  const result = await queryOne<ExecutionLog>(
    `INSERT INTO execution_logs (execution_id, level, message, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [executionId, level, message, metadata ? JSON.stringify(metadata) : null]
  );

  if (!result) {
    throw new Error('Failed to add execution log');
  }

  return result;
}

/**
 * Retrieves log entries for an execution.
 * @param executionId - UUID of the execution
 * @param limit - Maximum number of log entries
 * @returns Array of log entries in chronological order
 */
export async function getExecutionLogs(
  executionId: string,
  limit: number = 100
): Promise<ExecutionLog[]> {
  return query<ExecutionLog>(
    `SELECT * FROM execution_logs
     WHERE execution_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [executionId, limit]
  );
}
