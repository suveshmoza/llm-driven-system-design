/**
 * Execution handling routes for the job scheduler API.
 * Handles listing, viewing, cancelling, and retrying job executions.
 * @module api/execution-routes
 */

import { Router } from 'express';
import { asyncHandler } from './types.js';
import { authenticate, authorize } from '../shared/auth.js';
import * as db from '../db/repository.js';
import { queue } from '../queue/reliable-queue.js';
import { ApiResponse, ExecutionStatus } from '../types/index.js';

const router = Router();

/** GET /api/v1/jobs/:id/executions - List executions for a specific job */
router.get(
  '/jobs/:id/executions',
  authenticate,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = req.query.status as ExecutionStatus | undefined;

    const result = await db.listExecutions(req.params.id, page, limit, status);

    res.json({
      success: true,
      data: result,
    } as ApiResponse<typeof result>);
  })
);

/** GET /api/v1/executions/:id - Get execution details with logs */
router.get(
  '/executions/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const execution = await db.getExecution(req.params.id);

    if (!execution) {
      res.status(404).json({
        success: false,
        error: 'Execution not found',
      } as ApiResponse<never>);
      return;
    }

    // Get logs
    const logs = await db.getExecutionLogs(req.params.id);

    res.json({
      success: true,
      data: { ...execution, logs },
    } as ApiResponse<typeof execution & { logs: typeof logs }>);
  })
);

/** POST /api/v1/executions/:id/cancel - Cancel a pending or running execution (Admin only) */
router.post(
  '/executions/:id/cancel',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const execution = await db.getExecution(req.params.id);

    if (!execution) {
      res.status(404).json({
        success: false,
        error: 'Execution not found',
      } as ApiResponse<never>);
      return;
    }

    if (
      execution.status !== ExecutionStatus.PENDING &&
      execution.status !== ExecutionStatus.RUNNING
    ) {
      res.status(400).json({
        success: false,
        error: 'Execution cannot be cancelled in current state',
      } as ApiResponse<never>);
      return;
    }

    const updated = await db.updateExecution(req.params.id, {
      status: ExecutionStatus.CANCELLED,
      completed_at: new Date(),
      error: 'Cancelled by user',
    });

    res.json({
      success: true,
      data: updated,
      message: 'Execution cancelled successfully',
    } as ApiResponse<typeof updated>);
  })
);

/** POST /api/v1/executions/:id/retry - Retry a failed or cancelled execution */
router.post(
  '/executions/:id/retry',
  authenticate,
  asyncHandler(async (req, res) => {
    const execution = await db.getExecution(req.params.id);

    if (!execution) {
      res.status(404).json({
        success: false,
        error: 'Execution not found',
      } as ApiResponse<never>);
      return;
    }

    if (
      execution.status !== ExecutionStatus.FAILED &&
      execution.status !== ExecutionStatus.CANCELLED
    ) {
      res.status(400).json({
        success: false,
        error: 'Only failed or cancelled executions can be retried',
      } as ApiResponse<never>);
      return;
    }

    const job = await db.getJob(execution.job_id);
    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Job not found',
      } as ApiResponse<never>);
      return;
    }

    // Create a new execution
    const newExecution = await db.createExecution(job.id, new Date());
    await queue.enqueue(newExecution.id, job.id, job.priority);

    res.json({
      success: true,
      data: newExecution,
      message: 'Retry scheduled successfully',
    } as ApiResponse<typeof newExecution>);
  })
);

export { router as executionRoutes };
