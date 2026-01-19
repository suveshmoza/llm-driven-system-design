import { query } from '../../config/database.js';
import { deleteIssueFromIndex } from '../../config/elasticsearch.js';
import { cacheDel } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { publishIssueEvent } from '../../config/messageQueue.js';
import { Issue, User } from '../../types/index.js';
import { UpdateIssueData, HistoryRecord } from './types.js';
import { getIssueById } from './queries.js';
import { indexIssueForSearch, invalidateProjectBoardCache } from './create.js';

/**
 * Updates an existing issue with partial data.
 * Records all field changes in issue history for audit trail.
 * Updates the Elasticsearch index and invalidates caches after modification.
 *
 * @param issueId - ID of the issue to update
 * @param data - Partial issue data to update
 * @param user - User making the update (for history tracking)
 * @returns Updated issue, or null if not found
 */
export async function updateIssue(
  issueId: number,
  data: UpdateIssueData,
  user: User
): Promise<Issue | null> {
  const log = logger.child({ operation: 'updateIssue', issueId, userId: user.id });

  // Get current issue for history
  const current = await getIssueById(issueId);
  if (!current) {
    log.warn('Issue not found');
    return null;
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  const historyRecords: HistoryRecord[] = [];
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  let paramIndex = 1;

  const addUpdate = (field: string, dbField: string, newValue: unknown, oldValue: unknown) => {
    updates.push(`${dbField} = $${paramIndex++}`);
    values.push(newValue);
    if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
      historyRecords.push({
        field,
        oldValue: oldValue ? String(oldValue) : null,
        newValue: newValue ? String(newValue) : null,
      });
      changes[field] = { old: oldValue, new: newValue };
    }
  };

  if (data.summary !== undefined) addUpdate('summary', 'summary', data.summary, current.summary);
  if (data.description !== undefined) addUpdate('description', 'description', data.description, current.description);
  if (data.issueType !== undefined) addUpdate('issue_type', 'issue_type', data.issueType, current.issue_type);
  if (data.priority !== undefined) addUpdate('priority', 'priority', data.priority, current.priority);
  if (data.assigneeId !== undefined) addUpdate('assignee', 'assignee_id', data.assigneeId, current.assignee_id);
  if (data.epicId !== undefined) addUpdate('epic', 'epic_id', data.epicId, current.epic_id);
  if (data.sprintId !== undefined) addUpdate('sprint', 'sprint_id', data.sprintId, current.sprint_id);
  if (data.storyPoints !== undefined) addUpdate('story_points', 'story_points', data.storyPoints, current.story_points);
  if (data.labels !== undefined) addUpdate('labels', 'labels', data.labels, current.labels);
  if (data.components !== undefined) addUpdate('components', 'components', data.components, current.components);
  if (data.customFields !== undefined) addUpdate('custom_fields', 'custom_fields', JSON.stringify(data.customFields), JSON.stringify(current.custom_fields));

  if (updates.length === 0) return current;

  updates.push('updated_at = NOW()');
  values.push(issueId);

  const { rows } = await query<Issue>(
    `UPDATE issues SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (rows.length === 0) return null;

  // Record history
  for (const record of historyRecords) {
    await query(
      `INSERT INTO issue_history (issue_id, user_id, field, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5)`,
      [issueId, user.id, record.field, record.oldValue, record.newValue]
    );
  }

  log.info({ changedFields: Object.keys(changes) }, 'Issue updated');

  // Update Elasticsearch index (async)
  indexIssueForSearch(rows[0]).catch((error) => {
    log.error({ err: error }, 'Failed to update issue in Elasticsearch');
  });

  // Publish update event
  publishIssueEvent({
    event_type: 'updated',
    issue_id: issueId,
    issue_key: current.key,
    project_id: current.project_id,
    project_key: current.project.key,
    changes,
    actor_id: user.id,
  }).catch((error) => {
    log.error({ err: error }, 'Failed to publish issue updated event');
  });

  // Invalidate caches
  invalidateIssueCache(issueId, current.key).catch((error) => {
    log.error({ err: error }, 'Failed to invalidate issue cache');
  });

  // If sprint changed, invalidate board cache
  if (data.sprintId !== undefined) {
    invalidateProjectBoardCache(current.project_id).catch((error) => {
      log.error({ err: error }, 'Failed to invalidate board cache');
    });
  }

  return rows[0];
}

/**
 * Deletes an issue from the database and search index.
 *
 * @param issueId - ID of the issue to delete
 * @returns True if issue was deleted, false if not found
 */
export async function deleteIssue(issueId: number): Promise<boolean> {
  const log = logger.child({ operation: 'deleteIssue', issueId });

  // Get issue details before deletion for event publishing
  const issue = await getIssueById(issueId);

  const { rowCount } = await query('DELETE FROM issues WHERE id = $1', [issueId]);

  if (rowCount && rowCount > 0) {
    log.info('Issue deleted');

    // Remove from Elasticsearch
    deleteIssueFromIndex(issueId).catch((error) => {
      log.error({ err: error }, 'Failed to delete issue from Elasticsearch');
    });

    // Publish delete event
    if (issue) {
      publishIssueEvent({
        event_type: 'deleted',
        issue_id: issueId,
        issue_key: issue.key,
        project_id: issue.project_id,
        project_key: issue.project.key,
        actor_id: 'system', // Would need to pass user context
      }).catch((error) => {
        log.error({ err: error }, 'Failed to publish issue deleted event');
      });

      // Invalidate caches
      invalidateIssueCache(issueId, issue.key).catch(() => {});
      invalidateProjectBoardCache(issue.project_id).catch(() => {});
    }

    return true;
  }

  return false;
}

/**
 * Invalidates cache entries for a specific issue.
 *
 * @param issueId - Issue ID
 * @param issueKey - Issue key (e.g., "PROJ-123")
 */
export async function invalidateIssueCache(issueId: number, issueKey: string): Promise<void> {
  await Promise.all([
    cacheDel(`issue:${issueId}`),
    cacheDel(`issue:key:${issueKey}`),
  ]);
}
