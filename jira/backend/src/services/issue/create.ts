import { withTransaction } from '../../config/database.js';
import { indexIssue } from '../../config/elasticsearch.js';
import { cacheDelPattern } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { issuesCreatedCounter } from '../../config/metrics.js';
import { publishIssueEvent } from '../../config/messageQueue.js';
import { Issue, User } from '../../types/index.js';
import { CreateIssueData, IssueSearchDetails } from './types.js';
import { query } from '../../config/database.js';

/**
 * Creates a new issue within a project.
 *
 * @description Performs a transactional issue creation that:
 * 1. Increments the project's issue counter to generate a unique key (e.g., PROJ-123)
 * 2. Determines the initial status from the project's workflow (first 'todo' status)
 * 3. Inserts the issue record with all provided data
 * 4. Records the creation event in issue history for audit trail
 * 5. Increments Prometheus metrics for monitoring
 * 6. Asynchronously indexes the issue in Elasticsearch for search
 * 7. Publishes an event for notifications and webhooks
 * 8. Invalidates board cache for the project
 *
 * @param data - Issue creation data including project, summary, type, and reporter
 * @param user - User creating the issue (used for history tracking)
 * @returns Promise resolving to the newly created issue
 *
 * @throws Error - If the project is not found
 * @throws Error - If no initial status is found in the project's workflow
 * @throws Error - If database transaction fails
 *
 * @example
 * ```typescript
 * const issue = await createIssue({
 *   projectId: 'project-uuid',
 *   summary: 'Implement user authentication',
 *   description: 'Add OAuth2 login support',
 *   issueType: 'story',
 *   priority: 'high',
 *   reporterId: currentUser.id
 * }, currentUser);
 *
 * console.log(issue.key); // "PROJ-42"
 * ```
 */
export async function createIssue(data: CreateIssueData, user: User): Promise<Issue> {
  const log = logger.child({ operation: 'createIssue', projectId: data.projectId, userId: user.id });

  return withTransaction(async (client) => {
    // Get project and increment counter
    const { rows: projects } = await client.query(
      `UPDATE projects SET issue_counter = issue_counter + 1
       WHERE id = $1
       RETURNING key, issue_counter, workflow_id`,
      [data.projectId]
    );

    if (projects.length === 0) {
      log.warn('Project not found');
      throw new Error('Project not found');
    }

    const project = projects[0];
    const issueKey = `${project.key}-${project.issue_counter}`;

    // Get initial status (first 'todo' status in workflow)
    const { rows: statuses } = await client.query(
      `SELECT id FROM statuses
       WHERE workflow_id = $1 AND category = 'todo'
       ORDER BY position LIMIT 1`,
      [project.workflow_id]
    );

    if (statuses.length === 0) {
      log.error({ workflowId: project.workflow_id }, 'No initial status found in workflow');
      throw new Error('No initial status found in workflow');
    }

    const statusId = statuses[0].id;

    // Create the issue
    const { rows } = await client.query<Issue>(
      `INSERT INTO issues (
        project_id, key, summary, description, issue_type, status_id,
        priority, assignee_id, reporter_id, parent_id, epic_id, sprint_id,
        story_points, labels, components, custom_fields
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        data.projectId,
        issueKey,
        data.summary,
        data.description || null,
        data.issueType,
        statusId,
        data.priority || 'medium',
        data.assigneeId || null,
        data.reporterId,
        data.parentId || null,
        data.epicId || null,
        data.sprintId || null,
        data.storyPoints || null,
        data.labels || [],
        data.components || [],
        JSON.stringify(data.customFields || {})
      ]
    );

    const issue = rows[0];

    // Record creation in history
    await client.query(
      `INSERT INTO issue_history (issue_id, user_id, field, new_value)
       VALUES ($1, $2, 'created', $3)`,
      [issue.id, user.id, issueKey]
    );

    // Increment metrics
    issuesCreatedCounter.inc({ project_key: project.key, issue_type: data.issueType });

    log.info({ issueId: issue.id, issueKey }, 'Issue created');

    // Index in Elasticsearch (async, non-blocking)
    indexIssueForSearch(issue).catch((error) => {
      log.error({ err: error }, 'Failed to index issue in Elasticsearch');
    });

    // Publish event for async processing (notifications, webhooks)
    publishIssueEvent({
      event_type: 'created',
      issue_id: issue.id,
      issue_key: issueKey,
      project_id: data.projectId,
      project_key: project.key,
      actor_id: user.id,
    }).catch((error) => {
      log.error({ err: error }, 'Failed to publish issue created event');
    });

    // Invalidate board cache for this project
    invalidateProjectBoardCache(data.projectId).catch((error) => {
      log.error({ err: error }, 'Failed to invalidate board cache');
    });

    return issue;
  });
}

/**
 * Indexes an issue document in Elasticsearch for search.
 *
 * @description Prepares and indexes an issue for full-text search by:
 * 1. Fetching denormalized data (status name, assignee name, etc.) from related tables
 * 2. Building a search document with all searchable and filterable fields
 * 3. Sending the document to Elasticsearch for indexing
 *
 * This function is typically called asynchronously after issue creation or updates
 * to keep the search index in sync with the database.
 *
 * @param issue - The issue entity to index
 * @returns Promise that resolves when indexing is complete
 *
 * @example
 * ```typescript
 * // After creating or updating an issue
 * await indexIssueForSearch(issue);
 * ```
 */
export async function indexIssueForSearch(issue: Issue): Promise<void> {
  // Get additional data for search
  const { rows: details } = await query<IssueSearchDetails>(
    `SELECT
      s.name as status_name,
      s.category as status_category,
      p.key as project_key,
      a.name as assignee_name,
      r.name as reporter_name,
      sp.name as sprint_name,
      e.key as epic_key
    FROM issues i
    JOIN statuses s ON i.status_id = s.id
    JOIN projects p ON i.project_id = p.id
    LEFT JOIN users a ON i.assignee_id = a.id
    JOIN users r ON i.reporter_id = r.id
    LEFT JOIN sprints sp ON i.sprint_id = sp.id
    LEFT JOIN issues e ON i.epic_id = e.id
    WHERE i.id = $1`,
    [issue.id]
  );

  const detail = details[0];
  if (!detail) return;

  await indexIssue({
    id: issue.id,
    key: issue.key,
    project_id: issue.project_id,
    project_key: detail.project_key,
    summary: issue.summary,
    description: issue.description,
    issue_type: issue.issue_type,
    status: detail.status_name,
    status_category: detail.status_category,
    priority: issue.priority,
    assignee_id: issue.assignee_id,
    assignee_name: detail.assignee_name,
    reporter_id: issue.reporter_id,
    reporter_name: detail.reporter_name,
    sprint_id: issue.sprint_id,
    sprint_name: detail.sprint_name,
    epic_id: issue.epic_id,
    epic_key: detail.epic_key,
    story_points: issue.story_points,
    labels: issue.labels,
    components: issue.components,
    custom_fields: issue.custom_fields,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
  });
}

/**
 * Invalidates board cache for a project when issues change.
 *
 * @description Clears all Redis cache entries related to a project's board views.
 * This ensures that after issue changes (create, update, delete), subsequent
 * board requests will fetch fresh data from the database.
 *
 * Uses a pattern-based deletion to clear all board cache variants for the project.
 *
 * @param projectId - UUID of the project whose board cache should be invalidated
 * @returns Promise that resolves when cache invalidation is complete
 *
 * @example
 * ```typescript
 * // After modifying an issue
 * await invalidateProjectBoardCache('project-uuid');
 * ```
 */
export async function invalidateProjectBoardCache(projectId: string): Promise<void> {
  await cacheDelPattern(`board:*:project:${projectId}*`);
}
