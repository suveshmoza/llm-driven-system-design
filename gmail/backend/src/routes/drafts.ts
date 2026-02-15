import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import * as draftService from '../services/draftService.js';
import logger from '../services/logger.js';

const router = Router();

/**
 * GET /api/v1/drafts
 * List all drafts for the current user
 */
router.get('/', requireAuth as unknown as import('express').RequestHandler, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.session.userId!;
    const drafts = await draftService.listDrafts(userId);
    res.json({ drafts });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Failed to list drafts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/drafts/:draftId
 * Get a single draft
 */
router.get('/:draftId', requireAuth as unknown as import('express').RequestHandler, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.session.userId!;
    const { draftId } = req.params;

    const draft = await draftService.getDraft(userId, draftId);
    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    res.json({ draft });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Failed to get draft');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/drafts
 * Create a new draft
 */
router.post('/', requireAuth as unknown as import('express').RequestHandler, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.session.userId!;

    const draft = await draftService.createDraft(userId, {
      threadId: req.body.threadId,
      inReplyTo: req.body.inReplyTo,
      subject: req.body.subject,
      bodyText: req.body.bodyText,
      bodyHtml: req.body.bodyHtml,
      toRecipients: req.body.to,
      ccRecipients: req.body.cc,
      bccRecipients: req.body.bcc,
    });

    res.status(201).json({ draft });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Failed to create draft');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/drafts/:draftId
 * Update a draft (with optimistic locking)
 */
router.put('/:draftId', requireAuth as unknown as import('express').RequestHandler, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.session.userId!;
    const { draftId } = req.params;
    const { version } = req.body;

    if (version === undefined) {
      return res.status(400).json({ error: 'Version is required for updates' });
    }

    const { draft, conflict } = await draftService.updateDraft(
      userId,
      draftId,
      {
        threadId: req.body.threadId,
        inReplyTo: req.body.inReplyTo,
        subject: req.body.subject,
        bodyText: req.body.bodyText,
        bodyHtml: req.body.bodyHtml,
        toRecipients: req.body.to,
        ccRecipients: req.body.cc,
        bccRecipients: req.body.bcc,
      },
      version
    );

    if (conflict) {
      return res.status(409).json({
        error: 'Draft has been modified by another session',
        draft,
      });
    }

    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    res.json({ draft });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Failed to update draft');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/v1/drafts/:draftId
 * Delete a draft
 */
router.delete('/:draftId', requireAuth as unknown as import('express').RequestHandler, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.session.userId!;
    const { draftId } = req.params;

    const deleted = await draftService.deleteDraft(userId, draftId);
    if (!deleted) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    res.json({ message: 'Draft deleted' });
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Failed to delete draft');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
