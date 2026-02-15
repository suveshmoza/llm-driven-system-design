/**
 * Search indexer worker
 *
 * Polls PostgreSQL for newly created messages and indexes them
 * in Elasticsearch for full-text search. Tracks the last indexed
 * timestamp in Redis to avoid re-indexing.
 */
import { query } from '../services/db.js';
import redis from '../services/redis.js';
import { indexMessage, initializeIndex } from '../services/elasticsearch.js';
import { indexedMessagesTotal } from '../services/metrics.js';
import logger from '../services/logger.js';

const LAST_INDEXED_KEY = 'search-indexer:last-indexed';
const POLL_INTERVAL_MS = 5000;

interface MessageToIndex {
  message_id: string;
  thread_id: string;
  sender_id: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  body_text: string;
  has_attachments: boolean;
  created_at: string;
}

interface RecipientInfo {
  message_id: string;
  user_id: string;
  display_name: string;
  email: string;
  recipient_type: string;
}

const indexNewMessages = async (): Promise<number> => {
  const lastIndexed = (await redis.get(LAST_INDEXED_KEY)) || '1970-01-01T00:00:00Z';

  const messagesResult = await query<MessageToIndex>(
    `SELECT m.id as message_id, m.thread_id, m.sender_id,
            u.display_name as sender_name, u.email as sender_email,
            t.subject, m.body_text, m.has_attachments, m.created_at
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     JOIN threads t ON t.id = m.thread_id
     WHERE m.created_at > $1
     ORDER BY m.created_at ASC
     LIMIT 100`,
    [lastIndexed]
  );

  if (messagesResult.rows.length === 0) return 0;

  const messageIds = messagesResult.rows.map((m) => m.message_id);

  const recipientsResult = await query<RecipientInfo>(
    `SELECT mr.message_id, mr.user_id, u.display_name, u.email, mr.recipient_type
     FROM message_recipients mr
     JOIN users u ON u.id = mr.user_id
     WHERE mr.message_id = ANY($1)`,
    [messageIds]
  );

  const recipientsByMessage = new Map<string, RecipientInfo[]>();
  for (const row of recipientsResult.rows) {
    const existing = recipientsByMessage.get(row.message_id) || [];
    existing.push(row);
    recipientsByMessage.set(row.message_id, existing);
  }

  let lastTimestamp = lastIndexed;

  for (const msg of messagesResult.rows) {
    const recipients = recipientsByMessage.get(msg.message_id) || [];

    // visible_to includes sender + all recipients (including bcc, since each person
    // can only search their own visible emails)
    const visibleTo = [
      msg.sender_id,
      ...recipients.map((r) => r.user_id),
    ];

    await indexMessage({
      thread_id: msg.thread_id,
      message_id: msg.message_id,
      sender_id: msg.sender_id,
      sender_name: msg.sender_name,
      sender_email: msg.sender_email,
      recipients: recipients
        .filter((r) => r.recipient_type !== 'bcc')
        .map((r) => r.email),
      recipient_names: recipients
        .filter((r) => r.recipient_type !== 'bcc')
        .map((r) => r.display_name),
      subject: msg.subject,
      body: msg.body_text,
      has_attachments: msg.has_attachments,
      created_at: msg.created_at,
      visible_to: [...new Set(visibleTo)],
    });

    indexedMessagesTotal.inc();
    lastTimestamp = msg.created_at;
  }

  await redis.set(LAST_INDEXED_KEY, lastTimestamp);

  return messagesResult.rows.length;
};

const startWorker = async (): Promise<void> => {
  logger.info('Search indexer worker starting...');

  // Initialize ES index
  await initializeIndex();

  logger.info('Search indexer worker started. Polling for new messages...');

  while (true) {
    try {
      const count = await indexNewMessages();
      if (count > 0) {
        logger.info({ count }, `Indexed ${count} messages`);
      }
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'Indexing error');
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
};

startWorker().catch((error) => {
  logger.error({ error: (error as Error).message }, 'Worker failed to start');
  process.exit(1);
});
