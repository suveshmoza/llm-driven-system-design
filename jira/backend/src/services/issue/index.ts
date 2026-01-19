/**
 * Issue Service - Main Export
 *
 * @description This module serves as the public API for all issue-related operations.
 * It re-exports functionality from focused sub-modules organized by responsibility:
 *
 * - **types**: TypeScript interfaces for issue data structures
 * - **queries**: Read-only operations for fetching issues and history
 * - **create**: Issue creation and search indexing
 * - **update**: Issue modification and deletion
 * - **transitions**: Workflow transition metrics
 * - **comments**: Comment CRUD operations
 *
 * Import from this file to access all issue service functions in a single import.
 *
 * @module services/issue
 *
 * @example
 * ```typescript
 * import {
 *   createIssue,
 *   getIssueByKey,
 *   updateIssue,
 *   addComment,
 *   type CreateIssueData
 * } from './services/issue/index.js';
 *
 * // Create a new issue
 * const issue = await createIssue(issueData, currentUser);
 *
 * // Fetch by key
 * const fetched = await getIssueByKey('PROJ-123');
 *
 * // Add a comment
 * await addComment(issue.id, currentUser.id, 'Working on this now');
 * ```
 */

// Types
export type { CreateIssueData, UpdateIssueData, HistoryRecord, IssueSearchDetails } from './types.js';

// Query functions
export {
  getIssueById,
  getIssueByKey,
  getIssuesByProject,
  getIssuesBySprint,
  getBacklogIssues,
  getIssueHistory,
} from './queries.js';

// Create functions
export {
  createIssue,
  indexIssueForSearch,
  invalidateProjectBoardCache,
} from './create.js';

// Update functions
export {
  updateIssue,
  deleteIssue,
  invalidateIssueCache,
} from './update.js';

// Transition functions
export { recordTransitionMetric } from './transitions.js';

// Comment functions
export {
  getIssueComments,
  addComment,
  updateComment,
  deleteComment,
} from './comments.js';
