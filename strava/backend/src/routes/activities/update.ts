/**
 * @fileoverview Activity update router.
 * Handles kudos, comments, and activity deletion operations.
 * @module routes/activities/update
 */

import { Router, Response } from 'express';
import { query } from '../../utils/db.js';
import { requireAuth, AuthenticatedRequest } from '../../middleware/auth.js';
import { activityLogger as log, logError, ErrorWithCode } from '../../shared/logger.js';

const router = Router();

/**
 * @description POST /:id/kudos - Give kudos to an activity.
 * Adds a kudos entry for the current user. Idempotent - giving kudos twice has no effect.
 * Updates the activity's kudos_count after insertion.
 *
 * @route POST /activities/:id/kudos
 * @authentication Required
 * @param req.params.id - The activity UUID to give kudos to
 * @returns 200 - Kudos given successfully
 * @returns 500 - Server error
 * @example
 * // Request
 * POST /activities/550e8400-e29b-41d4-a716-446655440000/kudos
 *
 * // Response 200
 * { "message": "Kudos given" }
 */
router.post('/:id/kudos', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;

    await query(
      'INSERT INTO kudos (activity_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, userId]
    );

    await query(
      'UPDATE activities SET kudos_count = (SELECT COUNT(*) FROM kudos WHERE activity_id = $1) WHERE id = $1',
      [id]
    );

    res.json({ message: 'Kudos given' });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Kudos error');
    res.status(500).json({ error: 'Failed to give kudos' });
  }
});

/**
 * @description DELETE /:id/kudos - Remove kudos from an activity.
 * Removes the current user's kudos entry if it exists.
 * Updates the activity's kudos_count after deletion.
 *
 * @route DELETE /activities/:id/kudos
 * @authentication Required
 * @param req.params.id - The activity UUID to remove kudos from
 * @returns 200 - Kudos removed successfully
 * @returns 500 - Server error
 * @example
 * // Request
 * DELETE /activities/550e8400-e29b-41d4-a716-446655440000/kudos
 *
 * // Response 200
 * { "message": "Kudos removed" }
 */
router.delete('/:id/kudos', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;

    await query(
      'DELETE FROM kudos WHERE activity_id = $1 AND user_id = $2',
      [id, userId]
    );

    await query(
      'UPDATE activities SET kudos_count = (SELECT COUNT(*) FROM kudos WHERE activity_id = $1) WHERE id = $1',
      [id]
    );

    res.json({ message: 'Kudos removed' });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Remove kudos error');
    res.status(500).json({ error: 'Failed to remove kudos' });
  }
});

/**
 * @description POST /:id/comments - Add a comment to an activity.
 * Creates a new comment with the provided content and updates the activity's comment_count.
 *
 * @route POST /activities/:id/comments
 * @authentication Required
 * @param req.params.id - The activity UUID to comment on
 * @param req.body.content - The comment text (required, non-empty)
 * @returns 201 - Created comment object
 * @returns 400 - Comment content is required
 * @returns 500 - Server error
 * @example
 * // Request
 * POST /activities/550e8400-e29b-41d4-a716-446655440000/comments
 * { "content": "Great run! Keep it up!" }
 *
 * // Response 201
 * { "comment": { "id": "...", "content": "Great run! Keep it up!", "created_at": "..." } }
 */
router.post('/:id/comments', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;
    const { content } = req.body as { content?: string };

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    const result = await query<{ id: string; content: string; created_at: Date }>(
      `INSERT INTO comments (activity_id, user_id, content) VALUES ($1, $2, $3)
       RETURNING id, content, created_at`,
      [id, userId, content.trim()]
    );

    await query(
      'UPDATE activities SET comment_count = (SELECT COUNT(*) FROM comments WHERE activity_id = $1) WHERE id = $1',
      [id]
    );

    res.status(201).json({ comment: result.rows[0] });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Add comment error');
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

/**
 * @description DELETE /:id - Delete an activity.
 * Removes an activity and all associated data. Only the activity owner can delete.
 * Cascades to delete GPS points, kudos, comments, and segment efforts.
 *
 * @route DELETE /activities/:id
 * @authentication Required
 * @param req.params.id - The activity UUID to delete
 * @returns 200 - Activity deleted successfully
 * @returns 404 - Activity not found or not owned by current user
 * @returns 500 - Server error
 * @example
 * // Request
 * DELETE /activities/550e8400-e29b-41d4-a716-446655440000
 *
 * // Response 200
 * { "message": "Activity deleted" }
 */
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.session.userId!;

    const result = await query<{ id: string }>(
      'DELETE FROM activities WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Activity not found or not owned by you' });
      return;
    }

    log.info({ activityId: id, userId }, 'Activity deleted');
    res.json({ message: 'Activity deleted' });
  } catch (error) {
    logError(log, error as ErrorWithCode, 'Delete activity error');
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

export default router;
