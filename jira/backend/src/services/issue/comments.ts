import { query } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { publishIssueEvent } from '../../config/messageQueue.js';
import { Comment, CommentWithAuthor } from '../../types/index.js';
import { getIssueById } from './queries.js';

/**
 * Retrieves all comments for an issue with author details.
 *
 * @param issueId - ID of the issue
 * @returns Array of comments with author information
 */
export async function getIssueComments(issueId: number): Promise<CommentWithAuthor[]> {
  const { rows } = await query<CommentWithAuthor>(
    `SELECT
      c.*,
      json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url) as author
    FROM comments c
    JOIN users u ON c.author_id = u.id
    WHERE c.issue_id = $1
    ORDER BY c.created_at ASC`,
    [issueId]
  );

  return rows;
}

/**
 * Adds a comment to an issue.
 * Also updates the issue's updated_at timestamp and publishes an event.
 *
 * @param issueId - ID of the issue to comment on
 * @param authorId - UUID of the comment author
 * @param body - Comment text content
 * @returns Newly created comment
 */
export async function addComment(
  issueId: number,
  authorId: string,
  body: string
): Promise<Comment> {
  const log = logger.child({ operation: 'addComment', issueId, authorId });

  const { rows } = await query<Comment>(
    `INSERT INTO comments (issue_id, author_id, body)
     VALUES ($1, $2, $3) RETURNING *`,
    [issueId, authorId, body]
  );

  // Update issue updated_at
  await query('UPDATE issues SET updated_at = NOW() WHERE id = $1', [issueId]);

  // Get issue details for event
  const issue = await getIssueById(issueId);
  if (issue) {
    publishIssueEvent({
      event_type: 'commented',
      issue_id: issueId,
      issue_key: issue.key,
      project_id: issue.project_id,
      project_key: issue.project.key,
      actor_id: authorId,
    }).catch((error) => {
      log.error({ err: error }, 'Failed to publish comment event');
    });
  }

  log.info({ commentId: rows[0].id }, 'Comment added');

  return rows[0];
}

/**
 * Updates an existing comment.
 * Only the original author can update their comment.
 *
 * @param commentId - ID of the comment to update
 * @param body - New comment text
 * @param userId - ID of user attempting the update (must match author)
 * @returns Updated comment, or null if not found or unauthorized
 */
export async function updateComment(
  commentId: number,
  body: string,
  userId: string
): Promise<Comment | null> {
  const { rows } = await query<Comment>(
    `UPDATE comments SET body = $1, updated_at = NOW()
     WHERE id = $2 AND author_id = $3
     RETURNING *`,
    [body, commentId, userId]
  );

  return rows[0] || null;
}

/**
 * Deletes a comment.
 * Only the original author can delete their comment.
 *
 * @param commentId - ID of the comment to delete
 * @param userId - ID of user attempting deletion (must match author)
 * @returns True if deleted, false if not found or unauthorized
 */
export async function deleteComment(commentId: number, userId: string): Promise<boolean> {
  const { rowCount } = await query(
    'DELETE FROM comments WHERE id = $1 AND author_id = $2',
    [commentId, userId]
  );

  return (rowCount ?? 0) > 0;
}
