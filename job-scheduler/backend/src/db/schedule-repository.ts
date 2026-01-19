/**
 * Schedule repository module for job scheduling operations.
 * Handles scheduling, pausing, resuming, and fetching due jobs.
 * @module db/schedule-repository
 */

import cronParser from 'cron-parser';
import { query, queryOne } from './pool.js';
import { Job } from './types.js';
import { JobStatus } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getJob, updateJobStatus } from './job-repository.js';

/**
 * Retrieves jobs due for execution.
 * Uses FOR UPDATE SKIP LOCKED for distributed safety when multiple
 * scheduler instances are running. Only returns jobs scheduled in the
 * last 5 minutes to avoid processing stale schedules.
 * @param limit - Maximum number of jobs to retrieve
 * @returns Array of jobs ready to be scheduled
 */
export async function getDueJobs(limit: number = 100): Promise<Job[]> {
  return query<Job>(
    `SELECT * FROM jobs
     WHERE status = 'SCHEDULED'
       AND next_run_time <= NOW()
       AND next_run_time > NOW() - INTERVAL '5 minutes'
     ORDER BY priority DESC, next_run_time ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit]
  );
}

/**
 * Calculates and sets the next run time for a recurring job.
 * Called after a job execution completes to schedule the next occurrence.
 * @param jobId - UUID of the job
 * @returns Updated job or null if not found or not recurring
 */
export async function scheduleNextRun(jobId: string): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job || !job.schedule) {
    return null;
  }

  try {
    const interval = cronParser.parseExpression(job.schedule);
    const nextRunTime = interval.next().toDate();

    return queryOne<Job>(
      'UPDATE jobs SET next_run_time = $1, status = $2 WHERE id = $3 RETURNING *',
      [nextRunTime, JobStatus.SCHEDULED, jobId]
    );
  } catch (error) {
    logger.error(`Failed to calculate next run time for job ${jobId}`, error);
    return null;
  }
}

/**
 * Pauses a job, preventing it from being scheduled.
 * @param id - UUID of the job to pause
 * @returns Updated job or null if not found
 */
export async function pauseJob(id: string): Promise<Job | null> {
  return updateJobStatus(id, JobStatus.PAUSED);
}

/**
 * Resumes a paused job, recalculating the next run time for recurring jobs.
 * @param id - UUID of the job to resume
 * @returns Updated job or null if not found or not paused
 */
export async function resumeJob(id: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job || job.status !== JobStatus.PAUSED) {
    return null;
  }

  // Recalculate next run time for recurring jobs
  if (job.schedule) {
    const interval = cronParser.parseExpression(job.schedule);
    const nextRunTime = interval.next().toDate();
    return queryOne<Job>(
      'UPDATE jobs SET status = $1, next_run_time = $2 WHERE id = $3 RETURNING *',
      [JobStatus.SCHEDULED, nextRunTime, id]
    );
  }

  return updateJobStatus(id, JobStatus.SCHEDULED);
}
