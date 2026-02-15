import { query } from './db.js';
import logger from './logger.js';
import { draftConflictsTotal } from './metrics.js';

export interface DraftInput {
  threadId?: string;
  inReplyTo?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  toRecipients?: string[];
  ccRecipients?: string[];
  bccRecipients?: string[];
}

export interface DraftRow {
  id: string;
  user_id: string;
  thread_id: string | null;
  in_reply_to: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  to_recipients: string[];
  cc_recipients: string[];
  bcc_recipients: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Draft {
  id: string;
  threadId: string | null;
  inReplyTo: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const toDraft = (row: DraftRow): Draft => ({
  id: row.id,
  threadId: row.thread_id,
  inReplyTo: row.in_reply_to,
  subject: row.subject || '',
  bodyText: row.body_text || '',
  bodyHtml: row.body_html,
  to: row.to_recipients || [],
  cc: row.cc_recipients || [],
  bcc: row.bcc_recipients || [],
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Get all drafts for a user
 */
export const listDrafts = async (userId: string): Promise<Draft[]> => {
  const result = await query<DraftRow>(
    `SELECT * FROM drafts WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows.map(toDraft);
};

/**
 * Get a single draft
 */
export const getDraft = async (
  userId: string,
  draftId: string
): Promise<Draft | null> => {
  const result = await query<DraftRow>(
    `SELECT * FROM drafts WHERE id = $1 AND user_id = $2`,
    [draftId, userId]
  );
  return result.rows.length > 0 ? toDraft(result.rows[0]) : null;
};

/**
 * Create a new draft
 */
export const createDraft = async (
  userId: string,
  input: DraftInput
): Promise<Draft> => {
  const result = await query<DraftRow>(
    `INSERT INTO drafts (user_id, thread_id, in_reply_to, subject, body_text, body_html,
                         to_recipients, cc_recipients, bcc_recipients, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
     RETURNING *`,
    [
      userId,
      input.threadId || null,
      input.inReplyTo || null,
      input.subject || '',
      input.bodyText || '',
      input.bodyHtml || null,
      JSON.stringify(input.toRecipients || []),
      JSON.stringify(input.ccRecipients || []),
      JSON.stringify(input.bccRecipients || []),
    ]
  );
  return toDraft(result.rows[0]);
};

/**
 * Update a draft with optimistic locking via version column.
 * Returns 409 if version mismatch.
 */
export const updateDraft = async (
  userId: string,
  draftId: string,
  input: DraftInput,
  expectedVersion: number
): Promise<{ draft: Draft | null; conflict: boolean }> => {
  const result = await query<DraftRow>(
    `UPDATE drafts SET
       thread_id = COALESCE($3, thread_id),
       in_reply_to = COALESCE($4, in_reply_to),
       subject = COALESCE($5, subject),
       body_text = COALESCE($6, body_text),
       body_html = COALESCE($7, body_html),
       to_recipients = COALESCE($8, to_recipients),
       cc_recipients = COALESCE($9, cc_recipients),
       bcc_recipients = COALESCE($10, bcc_recipients),
       version = version + 1,
       updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND version = $11
     RETURNING *`,
    [
      draftId,
      userId,
      input.threadId || null,
      input.inReplyTo || null,
      input.subject,
      input.bodyText,
      input.bodyHtml || null,
      input.toRecipients ? JSON.stringify(input.toRecipients) : null,
      input.ccRecipients ? JSON.stringify(input.ccRecipients) : null,
      input.bccRecipients ? JSON.stringify(input.bccRecipients) : null,
      expectedVersion,
    ]
  );

  if (result.rows.length === 0) {
    // Check if draft exists (version mismatch vs not found)
    const existing = await query<DraftRow>(
      `SELECT * FROM drafts WHERE id = $1 AND user_id = $2`,
      [draftId, userId]
    );

    if (existing.rows.length > 0) {
      draftConflictsTotal.inc();
      logger.warn(
        {
          draftId,
          expectedVersion,
          actualVersion: existing.rows[0].version,
        },
        'Draft version conflict'
      );
      return { draft: toDraft(existing.rows[0]), conflict: true };
    }

    return { draft: null, conflict: false };
  }

  return { draft: toDraft(result.rows[0]), conflict: false };
};

/**
 * Delete a draft
 */
export const deleteDraft = async (
  userId: string,
  draftId: string
): Promise<boolean> => {
  const result = await query(
    `DELETE FROM drafts WHERE id = $1 AND user_id = $2`,
    [draftId, userId]
  );
  return (result.rowCount || 0) > 0;
};
