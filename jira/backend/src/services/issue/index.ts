/**
 * Issue Service - Main Export
 *
 * This module re-exports all issue-related functionality from the focused sub-modules.
 * Import from this file to access all issue service functions.
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
