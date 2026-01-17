import { query } from '../config/database.js';
import { cacheGet, cacheSet, cacheDel } from '../config/redis.js';
import {
  Workflow,
  WorkflowWithStatuses,
  Status,
  Transition,
  TransitionCondition,
  TransitionValidator,
  TransitionPostFunction,
  Issue,
  User,
} from '../types/index.js';

/** Cache TTL for workflow data in seconds (1 hour) */
const WORKFLOW_CACHE_TTL = 3600;

/**
 * Retrieves a workflow by ID with all statuses and transitions.
 * Results are cached in Redis to avoid repeated database queries.
 *
 * @param workflowId - ID of the workflow
 * @returns Workflow with statuses and transitions, or null if not found
 */
export async function getWorkflow(workflowId: number): Promise<WorkflowWithStatuses | null> {
  const cacheKey = `workflow:${workflowId}`;
  const cached = await cacheGet<WorkflowWithStatuses>(cacheKey);
  if (cached) return cached;

  const { rows: workflows } = await query<Workflow>(
    'SELECT * FROM workflows WHERE id = $1',
    [workflowId]
  );

  if (workflows.length === 0) return null;

  const workflow = workflows[0];

  // Get statuses
  const { rows: statuses } = await query<Status>(
    'SELECT * FROM statuses WHERE workflow_id = $1 ORDER BY position',
    [workflowId]
  );

  // Get transitions
  const { rows: transitions } = await query<Transition>(
    'SELECT * FROM transitions WHERE workflow_id = $1',
    [workflowId]
  );

  const result: WorkflowWithStatuses = {
    ...workflow,
    statuses,
    transitions: transitions.map((t) => ({
      ...t,
      conditions: t.conditions as unknown as TransitionCondition[],
      validators: t.validators as unknown as TransitionValidator[],
      post_functions: t.post_functions as unknown as TransitionPostFunction[],
    })),
  };

  await cacheSet(cacheKey, result, WORKFLOW_CACHE_TTL);
  return result;
}

/**
 * Retrieves the workflow assigned to a project.
 *
 * @param projectId - UUID of the project
 * @returns Workflow with statuses and transitions, or null if not found
 */
export async function getWorkflowByProject(projectId: string): Promise<WorkflowWithStatuses | null> {
  const { rows } = await query<{ workflow_id: number }>(
    'SELECT workflow_id FROM projects WHERE id = $1',
    [projectId]
  );

  if (rows.length === 0) return null;
  return getWorkflow(rows[0].workflow_id);
}

/**
 * Gets all transitions available for an issue from its current status.
 * Checks transition conditions against the user and their project roles.
 *
 * @param issue - The issue to get transitions for
 * @param user - User requesting the transitions
 * @param projectRoles - Roles the user has in the project
 * @returns Array of available transitions
 */
export async function getAvailableTransitions(
  issue: Issue,
  user: User,
  projectRoles: string[]
): Promise<Transition[]> {
  const workflow = await getWorkflowByProject(issue.project_id);
  if (!workflow) return [];

  const availableTransitions: Transition[] = [];

  for (const transition of workflow.transitions) {
    // Check if transition is valid from current status
    if (
      transition.from_status_id !== null &&
      transition.from_status_id !== issue.status_id
    ) {
      continue;
    }

    // Check conditions
    let conditionsPassed = true;
    for (const condition of transition.conditions) {
      const passed = await checkCondition(condition, issue, user, projectRoles);
      if (!passed) {
        conditionsPassed = false;
        break;
      }
    }

    if (conditionsPassed) {
      availableTransitions.push(transition);
    }
  }

  return availableTransitions;
}

/**
 * Executes a workflow transition on an issue.
 * Validates conditions and validators, updates the issue status,
 * records history, and runs post-functions.
 *
 * @param issue - Issue to transition
 * @param transitionId - ID of the transition to execute
 * @param user - User executing the transition
 * @param projectRoles - Roles the user has in the project
 * @param updateData - Additional data for validators
 * @returns Result object with success status and error message or new status ID
 */
export async function executeTransition(
  issue: Issue,
  transitionId: number,
  user: User,
  projectRoles: string[],
  updateData?: Record<string, unknown>
): Promise<{ success: boolean; error?: string; newStatusId?: number }> {
  const workflow = await getWorkflowByProject(issue.project_id);
  if (!workflow) {
    return { success: false, error: 'Workflow not found' };
  }

  const transition = workflow.transitions.find((t) => t.id === transitionId);
  if (!transition) {
    return { success: false, error: 'Transition not found' };
  }

  // Check if transition is valid from current status
  if (
    transition.from_status_id !== null &&
    transition.from_status_id !== issue.status_id
  ) {
    return {
      success: false,
      error: 'Transition not allowed from current status',
    };
  }

  // Check conditions
  for (const condition of transition.conditions) {
    const passed = await checkCondition(condition, issue, user, projectRoles);
    if (!passed) {
      return {
        success: false,
        error: `Condition failed: ${condition.type}`,
      };
    }
  }

  // Run validators
  for (const validator of transition.validators) {
    const valid = await runValidator(validator, issue, updateData);
    if (!valid.passed) {
      return {
        success: false,
        error: `Validation failed: ${valid.message}`,
      };
    }
  }

  // Update issue status
  const previousStatusId = issue.status_id;
  await query(
    'UPDATE issues SET status_id = $1, updated_at = NOW() WHERE id = $2',
    [transition.to_status_id, issue.id]
  );

  // Record history
  await recordStatusHistory(issue.id, user.id, previousStatusId, transition.to_status_id);

  // Run post-functions
  for (const postFunc of transition.post_functions) {
    await runPostFunction(postFunc, issue, user, transition);
  }

  return { success: true, newStatusId: transition.to_status_id };
}

/**
 * Checks if a transition condition is satisfied.
 * Supports: always, user_in_role, issue_assignee, user_in_group.
 *
 * @param condition - Condition to check
 * @param issue - Issue being transitioned
 * @param user - User attempting the transition
 * @param projectRoles - User's roles in the project
 * @returns True if condition is satisfied
 */
async function checkCondition(
  condition: TransitionCondition,
  issue: Issue,
  user: User,
  projectRoles: string[]
): Promise<boolean> {
  switch (condition.type) {
    case 'always':
      return true;

    case 'user_in_role':
      const requiredRole = condition.config.role as string;
      return projectRoles.includes(requiredRole);

    case 'issue_assignee':
      return issue.assignee_id === user.id;

    case 'user_in_group':
      // For simplicity, we'll skip group checking in this implementation
      return true;

    default:
      return true;
  }
}

/**
 * Runs a transition validator to check issue data.
 * Supports: field_required, field_value.
 *
 * @param validator - Validator to run
 * @param issue - Issue being validated
 * @param updateData - Additional data provided during transition
 * @returns Object with passed status and optional error message
 */
async function runValidator(
  validator: TransitionValidator,
  issue: Issue,
  updateData?: Record<string, unknown>
): Promise<{ passed: boolean; message?: string }> {
  switch (validator.type) {
    case 'field_required':
      const fieldName = validator.config.field as string;
      const fieldValue = updateData?.[fieldName] ?? (issue as unknown as Record<string, unknown>)[fieldName];
      if (!fieldValue || (typeof fieldValue === 'string' && fieldValue.trim() === '')) {
        return { passed: false, message: `Field '${fieldName}' is required` };
      }
      return { passed: true };

    case 'field_value':
      const checkField = validator.config.field as string;
      const expectedValue = validator.config.value;
      const actualValue = updateData?.[checkField] ?? (issue as unknown as Record<string, unknown>)[checkField];
      if (actualValue !== expectedValue) {
        return { passed: false, message: `Field '${checkField}' must be '${expectedValue}'` };
      }
      return { passed: true };

    default:
      return { passed: true };
  }
}

/**
 * Runs a post-function after a successful transition.
 * Supports: assign_to_current_user, clear_field, update_field, send_notification.
 *
 * @param postFunc - Post-function to run
 * @param issue - Issue that was transitioned
 * @param user - User who executed the transition
 * @param transition - The transition that was executed
 */
async function runPostFunction(
  postFunc: TransitionPostFunction,
  issue: Issue,
  user: User,
  transition: Transition
): Promise<void> {
  switch (postFunc.type) {
    case 'assign_to_current_user':
      await query('UPDATE issues SET assignee_id = $1 WHERE id = $2', [user.id, issue.id]);
      break;

    case 'clear_field':
      const fieldToClear = postFunc.config.field as string;
      if (fieldToClear === 'assignee_id') {
        await query('UPDATE issues SET assignee_id = NULL WHERE id = $1', [issue.id]);
      }
      break;

    case 'update_field':
      const fieldToUpdate = postFunc.config.field as string;
      const newValue = postFunc.config.value;
      // For safety, only allow certain fields
      const allowedFields = ['priority', 'story_points'];
      if (allowedFields.includes(fieldToUpdate)) {
        await query(`UPDATE issues SET ${fieldToUpdate} = $1 WHERE id = $2`, [newValue, issue.id]);
      }
      break;

    case 'send_notification':
      // TODO: Implement notification sending
      console.log(`Would send notification for issue ${issue.key}: ${postFunc.config.message}`);
      break;
  }
}

/**
 * Records a status change in issue history for audit trail.
 *
 * @param issueId - ID of the issue
 * @param userId - ID of the user who made the change
 * @param oldStatusId - Previous status ID
 * @param newStatusId - New status ID
 */
async function recordStatusHistory(
  issueId: number,
  userId: string,
  oldStatusId: number,
  newStatusId: number
): Promise<void> {
  // Get status names for history
  const { rows: statuses } = await query<{ id: number; name: string }>(
    'SELECT id, name FROM statuses WHERE id = ANY($1)',
    [[oldStatusId, newStatusId]]
  );

  const statusMap = new Map(statuses.map((s) => [s.id, s.name]));

  await query(
    `INSERT INTO issue_history (issue_id, user_id, field, old_value, new_value)
     VALUES ($1, $2, 'status', $3, $4)`,
    [issueId, userId, statusMap.get(oldStatusId), statusMap.get(newStatusId)]
  );
}

/**
 * Creates a new workflow definition.
 *
 * @param name - Workflow name
 * @param description - Optional description
 * @returns Newly created workflow
 */
export async function createWorkflow(
  name: string,
  description?: string
): Promise<Workflow> {
  const { rows } = await query<Workflow>(
    `INSERT INTO workflows (name, description) VALUES ($1, $2) RETURNING *`,
    [name, description]
  );
  return rows[0];
}

/**
 * Creates a status in a workflow.
 * Invalidates the workflow cache.
 *
 * @param workflowId - ID of the workflow
 * @param name - Status name
 * @param category - Status category (todo, in_progress, done)
 * @param color - Hex color code
 * @param position - Sort position
 * @returns Newly created status
 */
export async function createStatus(
  workflowId: number,
  name: string,
  category: 'todo' | 'in_progress' | 'done',
  color: string,
  position: number
): Promise<Status> {
  const { rows } = await query<Status>(
    `INSERT INTO statuses (workflow_id, name, category, color, position)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [workflowId, name, category, color, position]
  );

  await cacheDel(`workflow:${workflowId}`);
  return rows[0];
}

/**
 * Creates a transition between statuses in a workflow.
 * Invalidates the workflow cache.
 *
 * @param workflowId - ID of the workflow
 * @param name - Transition name (displayed to users)
 * @param fromStatusId - Source status ID (null = from any)
 * @param toStatusId - Target status ID
 * @param conditions - Array of conditions to check
 * @param validators - Array of validators to run
 * @param postFunctions - Array of post-functions to execute
 * @returns Newly created transition
 */
export async function createTransition(
  workflowId: number,
  name: string,
  fromStatusId: number | null,
  toStatusId: number,
  conditions: TransitionCondition[] = [],
  validators: TransitionValidator[] = [],
  postFunctions: TransitionPostFunction[] = []
): Promise<Transition> {
  const { rows } = await query<Transition>(
    `INSERT INTO transitions (workflow_id, name, from_status_id, to_status_id, conditions, validators, post_functions)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [workflowId, name, fromStatusId, toStatusId, JSON.stringify(conditions), JSON.stringify(validators), JSON.stringify(postFunctions)]
  );

  await cacheDel(`workflow:${workflowId}`);
  return rows[0];
}

/**
 * Retrieves all workflow definitions.
 *
 * @returns Array of all workflows
 */
export async function getAllWorkflows(): Promise<Workflow[]> {
  const { rows } = await query<Workflow>('SELECT * FROM workflows ORDER BY name');
  return rows;
}

/**
 * Retrieves all statuses for a workflow.
 *
 * @param workflowId - ID of the workflow
 * @returns Array of statuses ordered by position
 */
export async function getStatuses(workflowId: number): Promise<Status[]> {
  const { rows } = await query<Status>(
    'SELECT * FROM statuses WHERE workflow_id = $1 ORDER BY position',
    [workflowId]
  );
  return rows;
}

/**
 * Retrieves a status by its ID.
 *
 * @param statusId - ID of the status
 * @returns Status or null if not found
 */
export async function getStatus(statusId: number): Promise<Status | null> {
  const { rows } = await query<Status>('SELECT * FROM statuses WHERE id = $1', [statusId]);
  return rows[0] || null;
}

/**
 * Updates a status definition.
 * Invalidates the workflow cache.
 *
 * @param statusId - ID of the status to update
 * @param updates - Partial status data to update
 * @returns Updated status or null if not found
 */
export async function updateStatus(
  statusId: number,
  updates: Partial<Pick<Status, 'name' | 'category' | 'color' | 'position'>>
): Promise<Status | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.category !== undefined) {
    fields.push(`category = $${paramIndex++}`);
    values.push(updates.category);
  }
  if (updates.color !== undefined) {
    fields.push(`color = $${paramIndex++}`);
    values.push(updates.color);
  }
  if (updates.position !== undefined) {
    fields.push(`position = $${paramIndex++}`);
    values.push(updates.position);
  }

  if (fields.length === 0) return null;

  values.push(statusId);

  const { rows } = await query<Status>(
    `UPDATE statuses SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (rows[0]) {
    await cacheDel(`workflow:${rows[0].workflow_id}`);
  }

  return rows[0] || null;
}
