import db from "../db/index.js";
import { FeedbackEntry } from "../types/index.js";

/**
 * Feedback Service.
 *
 * Provides the Feedback Service API similar to Apple's APNs Feedback Service.
 * App providers poll this service to learn about invalid device tokens
 * so they can stop sending notifications to those devices.
 */
export class FeedbackService {
  /**
   * Reports a token as invalid and queues it for feedback.
   * Called internally when tokens are invalidated.
   *
   * @param tokenHash - SHA-256 hash of the invalidated token
   * @param reason - Reason for invalidation
   */
  async reportInvalidToken(tokenHash: string, reason: string): Promise<void> {
    // Get app info for the token
    const tokenInfo = await db.query<{ app_bundle_id: string; invalidated_at: Date }>(
      `SELECT app_bundle_id, invalidated_at FROM device_tokens WHERE token_hash = $1`,
      [tokenHash]
    );

    if (tokenInfo.rows.length === 0) return;

    const { app_bundle_id, invalidated_at } = tokenInfo.rows[0];

    // Store in feedback queue for providers
    await db.query(
      `INSERT INTO feedback_queue (token_hash, app_bundle_id, reason, timestamp)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, app_bundle_id, reason, invalidated_at || new Date()]
    );
  }

  /**
   * Gets feedback entries for a specific app.
   * App providers should poll this to discover invalid tokens.
   * Returns up to 1000 entries to prevent response size issues.
   *
   * @param appBundleId - App bundle ID to get feedback for
   * @param since - Optional date to filter feedback after (default: epoch)
   * @returns Array of feedback entries
   */
  async getFeedback(
    appBundleId: string,
    since?: Date
  ): Promise<FeedbackEntry[]> {
    const sinceDate = since || new Date(0);

    const result = await db.query<FeedbackEntry>(
      `SELECT * FROM feedback_queue
       WHERE app_bundle_id = $1 AND timestamp > $2
       ORDER BY timestamp ASC
       LIMIT 1000`,
      [appBundleId, sinceDate]
    );

    return result.rows;
  }

  /**
   * Gets all feedback entries with pagination.
   * Used for admin dashboard display.
   *
   * @param limit - Maximum entries to return (default 100)
   * @param offset - Number of entries to skip (default 0)
   * @returns Object with feedback array and total count
   */
  async getAllFeedback(
    limit: number = 100,
    offset: number = 0
  ): Promise<{ feedback: FeedbackEntry[]; total: number }> {
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) FROM feedback_queue`
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await db.query<FeedbackEntry>(
      `SELECT * FROM feedback_queue
       ORDER BY timestamp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return { feedback: result.rows, total };
  }

  /**
   * Clears feedback entries for an app after they've been processed.
   * Called by app providers after they've updated their token database.
   *
   * @param appBundleId - App bundle ID to clear feedback for
   * @param beforeTimestamp - Optional cutoff date to clear feedback before
   * @returns Number of entries cleared
   */
  async clearFeedback(appBundleId: string, beforeTimestamp?: Date): Promise<number> {
    let query = `DELETE FROM feedback_queue WHERE app_bundle_id = $1`;
    const params: unknown[] = [appBundleId];

    if (beforeTimestamp) {
      query += ` AND timestamp <= $2`;
      params.push(beforeTimestamp);
    }

    const result = await db.query(query, params);
    return result.rowCount || 0;
  }
}

/**
 * Singleton instance of the Feedback Service.
 * Use this throughout the application for feedback management.
 */
export const feedbackService = new FeedbackService();
