import { query } from '../../config/database.js';
import { IssueWithDetails, IssueType, IssueHistoryWithUser } from '../../types/index.js';

/**
 * Retrieves an issue by its database ID with full details.
 *
 * @description Fetches a single issue with all related entities joined including
 * status, assignee, reporter, project, epic, and sprint. Returns fully hydrated
 * issue data suitable for display in issue views.
 *
 * @param issueId - Numeric ID of the issue in the database
 * @returns Promise resolving to the issue with all related entities, or null if not found
 *
 * @example
 * ```typescript
 * const issue = await getIssueById(123);
 * if (issue) {
 *   console.log(issue.key); // "PROJ-123"
 *   console.log(issue.status.name); // "In Progress"
 *   console.log(issue.assignee?.name); // "John Doe" or undefined
 * }
 * ```
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
 * @description Looks up an issue using its unique key string and returns
 * the full issue details. Internally resolves the key to an ID and delegates
 * to getIssueById for fetching complete data.
 *
 * @param key - Issue key string in format "PROJECT-NUMBER" (e.g., "DEMO-42")
 * @returns Promise resolving to the issue with full details, or null if not found
 *
 * @example
 * ```typescript
 * const issue = await getIssueByKey('PROJ-123');
 * if (issue) {
 *   console.log(issue.summary);
 * }
 * ```
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
 *
 * @description Fetches issues belonging to a project with support for filtering
 * by status, assignee, sprint, epic, and issue type. Results are paginated
 * and ordered by creation date (newest first). Supports backlog queries by
 * passing sprintId: 0 to find unassigned issues.
 *
 * @param projectId - UUID of the project to fetch issues from
 * @param options - Optional filter and pagination parameters
 * @param options.statusId - Filter by specific status ID
 * @param options.assigneeId - Filter by assignee's UUID
 * @param options.sprintId - Filter by sprint ID (use 0 for backlog/unassigned)
 * @param options.epicId - Filter by epic ID
 * @param options.issueType - Filter by issue type (bug, story, task, epic, subtask)
 * @param options.limit - Maximum number of issues to return (default: 50)
 * @param options.offset - Number of issues to skip for pagination (default: 0)
 * @returns Promise resolving to object containing issues array and total count
 *
 * @example
 * ```typescript
 * // Get first page of high priority bugs
 * const { issues, total } = await getIssuesByProject('project-uuid', {
 *   issueType: 'bug',
 *   limit: 20,
 *   offset: 0
 * });
 *
 * // Get backlog items (not in any sprint)
 * const backlog = await getIssuesByProject('project-uuid', { sprintId: 0 });
 * ```
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
 *
 * @description Fetches all issues belonging to a sprint with full details.
 * Used for sprint board views where all sprint issues need to be displayed
 * grouped by status. Results are ordered by creation date (oldest first)
 * to maintain consistent ordering on boards.
 *
 * @param sprintId - Numeric ID of the sprint
 * @returns Promise resolving to an array of issues with full details
 *
 * @example
 * ```typescript
 * const sprintIssues = await getIssuesBySprint(42);
 * // Group by status for board display
 * const byStatus = sprintIssues.reduce((acc, issue) => {
 *   (acc[issue.status.name] ||= []).push(issue);
 *   return acc;
 * }, {});
 * ```
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
 * @description Fetches all issues in a project that have not been assigned
 * to any sprint. These issues represent the product backlog and are candidates
 * for future sprint planning. Delegates to getIssuesByProject with sprintId: 0.
 *
 * @param projectId - UUID of the project
 * @returns Promise resolving to an array of backlog issues with full details
 *
 * @example
 * ```typescript
 * const backlogIssues = await getBacklogIssues('project-uuid');
 * console.log(`${backlogIssues.length} items in backlog`);
 * ```
 */
export async function getBacklogIssues(projectId: string): Promise<IssueWithDetails[]> {
  const { issues } = await getIssuesByProject(projectId, { sprintId: 0 });
  return issues;
}

/**
 * Retrieves the change history for an issue.
 *
 * @description Fetches the complete audit trail of changes made to an issue,
 * including who made each change and when. Each history entry includes the
 * field that changed, old and new values, and the user who made the change.
 * Results are ordered by creation date (newest first).
 *
 * @param issueId - Numeric ID of the issue
 * @returns Promise resolving to an array of history entries with user information
 *
 * @example
 * ```typescript
 * const history = await getIssueHistory(123);
 * history.forEach(entry => {
 *   console.log(`${entry.user.name} changed ${entry.field} from "${entry.old_value}" to "${entry.new_value}"`);
 * });
 * ```
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
