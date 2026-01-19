import { query } from '../../config/database.js';
import { IssueWithDetails, IssueType, IssueHistoryWithUser } from '../../types/index.js';

/**
 * Retrieves an issue by its database ID with full details.
 * Joins related data including status, assignee, reporter, project, epic, and sprint.
 *
 * @param issueId - Numeric ID of the issue
 * @returns Issue with all related entities, or null if not found
 */
export async function getIssueById(issueId: number): Promise<IssueWithDetails | null> {
  const { rows } = await query<IssueWithDetails>(
    `SELECT
      i.*,
      json_build_object('id', s.id, 'name', s.name, 'category', s.category, 'color', s.color) as status,
      CASE WHEN a.id IS NOT NULL THEN json_build_object('id', a.id, 'name', a.name, 'email', a.email, 'avatar_url', a.avatar_url) ELSE NULL END as assignee,
      json_build_object('id', r.id, 'name', r.name, 'email', r.email, 'avatar_url', r.avatar_url) as reporter,
      json_build_object('id', p.id, 'key', p.key, 'name', p.name) as project,
      CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'key', e.key, 'summary', e.summary) ELSE NULL END as epic,
      CASE WHEN sp.id IS NOT NULL THEN json_build_object('id', sp.id, 'name', sp.name, 'status', sp.status) ELSE NULL END as sprint
    FROM issues i
    JOIN statuses s ON i.status_id = s.id
    LEFT JOIN users a ON i.assignee_id = a.id
    JOIN users r ON i.reporter_id = r.id
    JOIN projects p ON i.project_id = p.id
    LEFT JOIN issues e ON i.epic_id = e.id
    LEFT JOIN sprints sp ON i.sprint_id = sp.id
    WHERE i.id = $1`,
    [issueId]
  );

  return rows[0] || null;
}

/**
 * Retrieves an issue by its human-readable key (e.g., "PROJ-123").
 *
 * @param key - Issue key string
 * @returns Issue with full details, or null if not found
 */
export async function getIssueByKey(key: string): Promise<IssueWithDetails | null> {
  const { rows } = await query<{ id: number }>(
    'SELECT id FROM issues WHERE key = $1',
    [key]
  );

  if (rows.length === 0) return null;
  return getIssueById(rows[0].id);
}

/**
 * Retrieves paginated issues for a project with optional filters.
 * Supports filtering by status, assignee, sprint, epic, and issue type.
 *
 * @param projectId - UUID of the project
 * @param options - Filter and pagination options
 * @returns Object containing issues array and total count
 */
export async function getIssuesByProject(
  projectId: string,
  options: {
    statusId?: number;
    assigneeId?: string;
    sprintId?: number;
    epicId?: number;
    issueType?: IssueType;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ issues: IssueWithDetails[]; total: number }> {
  const conditions: string[] = ['i.project_id = $1'];
  const values: unknown[] = [projectId];
  let paramIndex = 2;

  if (options.statusId) {
    conditions.push(`i.status_id = $${paramIndex++}`);
    values.push(options.statusId);
  }
  if (options.assigneeId) {
    conditions.push(`i.assignee_id = $${paramIndex++}`);
    values.push(options.assigneeId);
  }
  if (options.sprintId !== undefined) {
    if (options.sprintId === 0) {
      conditions.push('i.sprint_id IS NULL');
    } else {
      conditions.push(`i.sprint_id = $${paramIndex++}`);
      values.push(options.sprintId);
    }
  }
  if (options.epicId) {
    conditions.push(`i.epic_id = $${paramIndex++}`);
    values.push(options.epicId);
  }
  if (options.issueType) {
    conditions.push(`i.issue_type = $${paramIndex++}`);
    values.push(options.issueType);
  }

  const whereClause = conditions.join(' AND ');
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  // Get total count
  const { rows: countRows } = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM issues i WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countRows[0].count, 10);

  // Get issues
  const { rows } = await query<IssueWithDetails>(
    `SELECT
      i.*,
      json_build_object('id', s.id, 'name', s.name, 'category', s.category, 'color', s.color) as status,
      CASE WHEN a.id IS NOT NULL THEN json_build_object('id', a.id, 'name', a.name, 'email', a.email, 'avatar_url', a.avatar_url) ELSE NULL END as assignee,
      json_build_object('id', r.id, 'name', r.name, 'email', r.email, 'avatar_url', r.avatar_url) as reporter,
      json_build_object('id', p.id, 'key', p.key, 'name', p.name) as project,
      CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'key', e.key, 'summary', e.summary) ELSE NULL END as epic,
      CASE WHEN sp.id IS NOT NULL THEN json_build_object('id', sp.id, 'name', sp.name, 'status', sp.status) ELSE NULL END as sprint
    FROM issues i
    JOIN statuses s ON i.status_id = s.id
    LEFT JOIN users a ON i.assignee_id = a.id
    JOIN users r ON i.reporter_id = r.id
    JOIN projects p ON i.project_id = p.id
    LEFT JOIN issues e ON i.epic_id = e.id
    LEFT JOIN sprints sp ON i.sprint_id = sp.id
    WHERE ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...values, limit, offset]
  );

  return { issues: rows, total };
}

/**
 * Retrieves all issues assigned to a specific sprint.
 * Used for sprint board views.
 *
 * @param sprintId - ID of the sprint
 * @returns Array of issues with full details
 */
export async function getIssuesBySprint(sprintId: number): Promise<IssueWithDetails[]> {
  const { rows } = await query<IssueWithDetails>(
    `SELECT
      i.*,
      json_build_object('id', s.id, 'name', s.name, 'category', s.category, 'color', s.color) as status,
      CASE WHEN a.id IS NOT NULL THEN json_build_object('id', a.id, 'name', a.name, 'email', a.email, 'avatar_url', a.avatar_url) ELSE NULL END as assignee,
      json_build_object('id', r.id, 'name', r.name, 'email', r.email, 'avatar_url', r.avatar_url) as reporter,
      json_build_object('id', p.id, 'key', p.key, 'name', p.name) as project,
      CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'key', e.key, 'summary', e.summary) ELSE NULL END as epic,
      CASE WHEN sp.id IS NOT NULL THEN json_build_object('id', sp.id, 'name', sp.name, 'status', sp.status) ELSE NULL END as sprint
    FROM issues i
    JOIN statuses s ON i.status_id = s.id
    LEFT JOIN users a ON i.assignee_id = a.id
    JOIN users r ON i.reporter_id = r.id
    JOIN projects p ON i.project_id = p.id
    LEFT JOIN issues e ON i.epic_id = e.id
    LEFT JOIN sprints sp ON i.sprint_id = sp.id
    WHERE i.sprint_id = $1
    ORDER BY i.created_at ASC`,
    [sprintId]
  );

  return rows;
}

/**
 * Retrieves issues not assigned to any sprint (backlog).
 *
 * @param projectId - UUID of the project
 * @returns Array of backlog issues
 */
export async function getBacklogIssues(projectId: string): Promise<IssueWithDetails[]> {
  const { issues } = await getIssuesByProject(projectId, { sprintId: 0 });
  return issues;
}

/**
 * Retrieves the change history for an issue.
 * Includes user details for each history entry, ordered newest first.
 *
 * @param issueId - ID of the issue
 * @returns Array of history entries with user information
 */
export async function getIssueHistory(issueId: number): Promise<IssueHistoryWithUser[]> {
  const { rows } = await query<IssueHistoryWithUser>(
    `SELECT
      h.*,
      json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url) as user
    FROM issue_history h
    JOIN users u ON h.user_id = u.id
    WHERE h.issue_id = $1
    ORDER BY h.created_at DESC`,
    [issueId]
  );

  return rows;
}
