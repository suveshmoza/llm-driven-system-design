import { IssueType, Priority } from '../../types/index.js';

/**
 * Data required to create a new issue.
 */
export interface CreateIssueData {
  projectId: string;
  summary: string;
  description?: string;
  issueType: IssueType;
  priority?: Priority;
  assigneeId?: string;
  reporterId: string;
  parentId?: number;
  epicId?: number;
  sprintId?: number;
  storyPoints?: number;
  labels?: string[];
  components?: number[];
  customFields?: Record<string, unknown>;
}

/**
 * Data for updating an existing issue.
 * All fields are optional to allow partial updates.
 */
export interface UpdateIssueData {
  summary?: string;
  description?: string;
  issueType?: IssueType;
  priority?: Priority;
  assigneeId?: string | null;
  epicId?: number | null;
  sprintId?: number | null;
  storyPoints?: number | null;
  labels?: string[];
  components?: number[];
  customFields?: Record<string, unknown>;
}

/**
 * History record for tracking field changes.
 */
export interface HistoryRecord {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * Data used for indexing issues in Elasticsearch.
 */
export interface IssueSearchDetails {
  status_name: string;
  status_category: string;
  project_key: string;
  assignee_name: string;
  reporter_name: string;
  sprint_name: string;
  epic_key: string;
}
