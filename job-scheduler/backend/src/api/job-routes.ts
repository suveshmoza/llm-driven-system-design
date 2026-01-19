/**
 * Job CRUD routes for the job scheduler API.
 * Handles creation, listing, updating, and deletion of jobs.
 * @module api/job-routes
 */

import { Router, Response } from 'express';
import { asyncHandler } from './types.js';
import { authenticate, authorize } from '../shared/auth.js';
import { idempotencyMiddleware, markJobCreated, clearJobIdempotency } from '../shared/idempotency.js';
import { jobsScheduledTotal } from '../shared/metrics.js';
import * as db from '../db/repository.js';
import { queue } from '../queue/reliable-queue.js';
import { ApiResponse, CreateJobInput, UpdateJobInput, JobStatus } from '../types/index.js';

const router = Router();

/** Helper to send 404 response for missing jobs */
function notFound(res: Response): void {
  res.status(404).json({ success: false, error: 'Job not found' } as ApiResponse<never>);
}

/** POST /api/v1/jobs - Create a new job (Admin only, with idempotency) */
router.post('/', authenticate, authorize('admin'), idempotencyMiddleware(), asyncHandler(async (req, res) => {
  const input: CreateJobInput = req.body;
  if (!input.name || !input.handler) {
    res.status(400).json({ success: false, error: 'Name and handler are required' } as ApiResponse<never>);
    return;
  }

  const existingJob = await db.getJobByName(input.name);
  if (existingJob) {
    res.status(409).json({
      success: false,
      error: `Job with name "${input.name}" already exists`,
      data: { existingJobId: existingJob.id },
    } as ApiResponse<{ existingJobId: string }>);
    return;
  }

  const job = await db.createJob(input);
  await markJobCreated(input.name, job.id);
  jobsScheduledTotal.inc({ handler: job.handler, priority: job.priority.toString() });
  res.status(201).json({ success: true, data: job, message: 'Job created successfully' } as ApiResponse<typeof job>);
}));

/** GET /api/v1/jobs - List jobs with pagination and optional filtering */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const status = req.query.status as JobStatus | undefined;
  const withStats = req.query.withStats === 'true';

  const result = withStats ? await db.listJobsWithStats(page, limit) : await db.listJobs(page, limit, status);
  res.json({ success: true, data: result } as ApiResponse<typeof result>);
}));

/** GET /api/v1/jobs/:id - Get a single job by ID */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const job = await db.getJob(req.params.id);
  if (!job) { notFound(res); return; }
  res.json({ success: true, data: job } as ApiResponse<typeof job>);
}));

/** PUT /api/v1/jobs/:id - Update an existing job (Admin only) */
router.put('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const input: UpdateJobInput = req.body;
  const job = await db.updateJob(req.params.id, input);
  if (!job) { notFound(res); return; }
  res.json({ success: true, data: job, message: 'Job updated successfully' } as ApiResponse<typeof job>);
}));

/** DELETE /api/v1/jobs/:id - Delete a job and its executions (Admin only) */
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const job = await db.getJob(req.params.id);
  if (!job) { notFound(res); return; }

  const deleted = await db.deleteJob(req.params.id);
  if (deleted) await clearJobIdempotency(job.name);
  res.json({ success: true, message: 'Job deleted successfully' } as ApiResponse<never>);
}));

/** POST /api/v1/jobs/:id/pause - Pause a job (Admin only) */
router.post('/:id/pause', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const job = await db.pauseJob(req.params.id);
  if (!job) { notFound(res); return; }
  res.json({ success: true, data: job, message: 'Job paused successfully' } as ApiResponse<typeof job>);
}));

/** POST /api/v1/jobs/:id/resume - Resume a paused job (Admin only) */
router.post('/:id/resume', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const job = await db.resumeJob(req.params.id);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found or not paused' } as ApiResponse<never>);
    return;
  }
  res.json({ success: true, data: job, message: 'Job resumed successfully' } as ApiResponse<typeof job>);
}));

/** POST /api/v1/jobs/:id/trigger - Trigger immediate job execution */
router.post('/:id/trigger', authenticate, asyncHandler(async (req, res) => {
  const job = await db.getJob(req.params.id);
  if (!job) { notFound(res); return; }

  const execution = await db.createExecution(job.id, new Date());
  await queue.enqueue(execution.id, job.id, job.priority);
  await db.updateJobStatus(job.id, JobStatus.QUEUED);
  jobsScheduledTotal.inc({ handler: job.handler, priority: job.priority.toString() });

  res.json({
    success: true,
    data: { job, execution },
    message: 'Job triggered successfully',
  } as ApiResponse<{ job: typeof job; execution: typeof execution }>);
}));

export { router as jobRoutes };
