/**
 * Cleanup routes for the admin service.
 * Handles manual triggering of data lifecycle cleanup jobs.
 * @module admin/cleanup
 */

import { Router, Request, Response } from 'express'
import { createChildLogger, logError } from '../shared/logger.js'
import { runAllCleanupJobs, LifecycleConfig } from '../shared/cleanup.js'
import { requireAdmin } from './auth.js'

const router = Router()

/**
 * POST /api/admin/cleanup/run - Manually triggers cleanup jobs.
 * Runs soft-delete cleanup, flagged archival, and orphan detection.
 */
router.post('/run', requireAdmin, async (req: Request, res: Response) => {
  const reqLogger = createChildLogger({ endpoint: '/api/admin/cleanup/run' })

  try {
    const config: Partial<LifecycleConfig> = {
      dryRun: req.body.dryRun ?? false,
      batchSize: req.body.batchSize ?? 100,
    }

    reqLogger.info({ msg: 'Starting manual cleanup', config })

    const results = await runAllCleanupJobs(config)

    const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0)
    const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0)

    res.json({
      success: true,
      totalDeleted,
      totalErrors,
      results,
    })
  } catch (error) {
    logError(error as Error, { endpoint: '/api/admin/cleanup/run' })
    res.status(500).json({ error: 'Failed to run cleanup jobs' })
  }
})

export { router as cleanupRouter }
