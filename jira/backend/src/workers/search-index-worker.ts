/**
 * Search index worker for Jira
 * Processes jira.search.index queue to keep Elasticsearch in sync with PostgreSQL.
 */
import {
  initializeMessageQueue,
  consumeQueue,
  closeMessageQueue,
  QUEUES,
  IssueEventMessage
} from '../config/messageQueue.js';
import {
  esClient,
  ISSUE_INDEX,
  initializeElasticsearch,
  indexIssue,
  deleteIssueFromIndex
} from '../config/elasticsearch.js';
import { pool, query } from '../config/database.js';
import { logger } from '../config/logger.js';

/**
 * Process search index update events.
 * Syncs issue data from PostgreSQL to Elasticsearch.
 */
async function processSearchIndexEvent(event: IssueEventMessage): Promise<void> {
  const { event_id, event_type, issue_id, issue_key } = event;

  logger.info({ event_id, event_type, issue_key }, 'Processing search index event');

  try {
    if (event_type === 'deleted') {
      // Remove from index
      await deleteIssueFromIndex(issue_id);
      logger.info({ issue_key }, 'Removed issue from search index');
      return;
    }

    // Fetch full issue data for indexing
    const result = await query(`
      SELECT
        i.id,
        i.key,
        i.project_id,
        p.key as project_key,
        i.summary,
        i.description,
        i.issue_type,
        s.name as status,
        s.category as status_category,
        i.priority,
        i.assignee_id,
        a.display_name as assignee_name,
        i.reporter_id,
        r.display_name as reporter_name,
        i.sprint_id,
        sp.name as sprint_name,
        i.epic_id,
        ep.key as epic_key,
        i.story_points,
        i.labels,
        i.components,
        i.custom_fields,
        i.created_at,
        i.updated_at
      FROM issues i
      LEFT JOIN projects p ON i.project_id = p.id
      LEFT JOIN statuses s ON i.status_id = s.id
      LEFT JOIN users a ON i.assignee_id = a.id
      LEFT JOIN users r ON i.reporter_id = r.id
      LEFT JOIN sprints sp ON i.sprint_id = sp.id
      LEFT JOIN issues ep ON i.epic_id = ep.id
      WHERE i.id = $1
    `, [issue_id]);

    if (result.rows.length === 0) {
      logger.warn({ issue_id }, 'Issue not found for indexing, may have been deleted');
      return;
    }

    const issue = result.rows[0];

    // Index the issue document
    await indexIssue({
      id: issue.id,
      key: issue.key,
      project_id: issue.project_id,
      project_key: issue.project_key,
      summary: issue.summary,
      description: issue.description || '',
      issue_type: issue.issue_type,
      status: issue.status,
      status_category: issue.status_category,
      priority: issue.priority,
      assignee_id: issue.assignee_id,
      assignee_name: issue.assignee_name,
      reporter_id: issue.reporter_id,
      reporter_name: issue.reporter_name,
      sprint_id: issue.sprint_id,
      sprint_name: issue.sprint_name,
      epic_id: issue.epic_id,
      epic_key: issue.epic_key,
      story_points: issue.story_points,
      labels: issue.labels || [],
      components: issue.components || [],
      custom_fields: issue.custom_fields || {},
      created_at: issue.created_at,
      updated_at: issue.updated_at,
    });

    logger.info({ issue_key, event_type }, 'Issue indexed successfully');
  } catch (error) {
    logger.error({ error, event_id, issue_key }, 'Failed to process search index event');
    throw error; // Rethrow to trigger retry
  }
}

/**
 * Main worker entry point.
 */
async function main(): Promise<void> {
  logger.info('Starting Jira search index worker...');

  try {
    // Initialize Elasticsearch index if needed
    await initializeElasticsearch();

    // Connect to RabbitMQ
    await initializeMessageQueue();

    // Start consuming search index events
    await consumeQueue(QUEUES.SEARCH_INDEX, async (message) => {
      await processSearchIndexEvent(message as unknown as IssueEventMessage);
    });

    logger.info('Jira search index worker started, waiting for messages...');

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down search index worker...');
      await closeMessageQueue();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start search index worker');
    process.exit(1);
  }
}

main();
