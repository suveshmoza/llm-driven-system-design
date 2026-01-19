/**
 * Transaction Archival and Retention Configuration
 *
 * WHY transaction archival is necessary:
 *
 * 1. REGULATORY COMPLIANCE: Financial regulations (BSA/AML, SOX) require
 *    transaction records to be retained for 5-7 years. This data must be
 *    accessible for audits and investigations.
 *
 * 2. STORAGE COSTS: Keeping all transactions in hot storage (PostgreSQL)
 *    indefinitely is expensive. Old transactions are rarely accessed but
 *    must be available if needed.
 *
 * 3. DATABASE PERFORMANCE: Tables with billions of rows become slow.
 *    Archiving old data keeps the active tables small and fast.
 *
 * 4. BACKUP/RESTORE: Smaller active datasets mean faster backups and
 *    quicker recovery times during incidents.
 *
 * Strategy:
 * - Hot tier (PostgreSQL): Last 90 days - fast queries, full feature support
 * - Warm tier (Archive table): 90 days - 2 years - slower but still queryable
 * - Cold tier (S3/MinIO): 2-7 years - for compliance, rarely accessed
 * - Deletion: After 7 years (per retention policy)
 *
 * Tradeoffs:
 * - More complexity in querying (need to check multiple tiers)
 * - Archival jobs need to be reliable and idempotent
 * - Cold storage queries are slow (minutes, not milliseconds)
 * - Costs saved on storage must outweigh archival infrastructure costs
 */

import { pool } from '../db/pool.js';
import { logger } from './logger.js';

export interface RetentionConfig {
  hotRetentionDays: number;
  warmRetentionDays: number;
  totalRetentionDays: number;
  archivalBatchSize: number;
  archivableTables: string[];
}

export interface ArchivalResult {
  table: string;
  archived: number;
}

export interface StorageStats {
  [tableName: string]: {
    rowCount?: number;
    sizeBytes?: number;
    sizeMB?: string;
    error?: string;
    note?: string;
  };
}

export interface QueryHistoricalOptions {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  includeArchive?: boolean;
}

export interface TransferRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  note: string;
  visibility: string;
  status: string;
  created_at: Date;
  storage_tier?: string;
}

// Retention configuration
export const RETENTION_CONFIG: RetentionConfig = {
  // How long to keep transactions in hot storage (active table)
  hotRetentionDays: 90,

  // How long to keep in warm storage (archive table)
  warmRetentionDays: 730, // 2 years

  // Total retention before deletion (compliance requirement)
  totalRetentionDays: 2555, // 7 years

  // Batch size for archival operations
  archivalBatchSize: 1000,

  // Tables to archive
  archivableTables: ['transfers', 'cashouts', 'payment_requests'],
};

/**
 * Archive old transfers from hot to warm storage
 *
 * This should be run as a scheduled job (e.g., daily via cron)
 */
export async function archiveOldTransfers(): Promise<ArchivalResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_CONFIG.hotRetentionDays);

  logger.info({
    event: 'archival_started',
    table: 'transfers',
    cutoffDate: cutoffDate.toISOString(),
  });

  let totalArchived = 0;
  let batch = 0;

  try {
    while (true) {
      batch++;

      // Use a transaction to ensure consistency
      const result = await pool.query(
        `WITH archived AS (
          DELETE FROM transfers
          WHERE created_at < $1
            AND id NOT IN (SELECT transfer_id FROM payment_requests WHERE transfer_id IS NOT NULL)
          RETURNING *
          LIMIT $2
        )
        INSERT INTO transfers_archive
        SELECT *, NOW() as archived_at FROM archived
        RETURNING id`,
        [cutoffDate, RETENTION_CONFIG.archivalBatchSize]
      );

      if (result.rowCount === 0) {
        break;
      }

      totalArchived += result.rowCount;

      logger.debug({
        event: 'archival_batch_complete',
        table: 'transfers',
        batch,
        batchSize: result.rowCount,
        totalArchived,
      });

      // Small delay to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info({
      event: 'archival_completed',
      table: 'transfers',
      totalArchived,
      batches: batch,
    });

    return { table: 'transfers', archived: totalArchived };
  } catch (error) {
    logger.error({
      event: 'archival_failed',
      table: 'transfers',
      error: (error as Error).message,
      totalArchived,
      batch,
    });
    throw error;
  }
}

/**
 * Archive old cashouts
 */
export async function archiveOldCashouts(): Promise<ArchivalResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_CONFIG.hotRetentionDays);

  logger.info({
    event: 'archival_started',
    table: 'cashouts',
    cutoffDate: cutoffDate.toISOString(),
  });

  let totalArchived = 0;

  try {
    const result = await pool.query(
      `WITH archived AS (
        DELETE FROM cashouts
        WHERE created_at < $1 AND status IN ('completed', 'failed')
        RETURNING *
      )
      INSERT INTO cashouts_archive
      SELECT *, NOW() as archived_at FROM archived
      RETURNING id`,
      [cutoffDate]
    );

    totalArchived = result.rowCount || 0;

    logger.info({
      event: 'archival_completed',
      table: 'cashouts',
      totalArchived,
    });

    return { table: 'cashouts', archived: totalArchived };
  } catch (error) {
    logger.error({
      event: 'archival_failed',
      table: 'cashouts',
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Purge data older than total retention period
 * This permanently deletes data - used for compliance
 */
export async function purgeExpiredData(): Promise<Record<string, number>> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_CONFIG.totalRetentionDays);

  logger.warn({
    event: 'purge_started',
    cutoffDate: cutoffDate.toISOString(),
    warning: 'Permanently deleting data older than retention period',
  });

  const results: Record<string, number> = {};

  // Purge from archive tables
  const archiveTables = ['transfers_archive', 'cashouts_archive', 'audit_log_archive'];

  for (const table of archiveTables) {
    try {
      const result = await pool.query(`DELETE FROM ${table} WHERE created_at < $1`, [cutoffDate]);
      results[table] = result.rowCount || 0;

      logger.info({
        event: 'purge_table_complete',
        table,
        deleted: result.rowCount,
      });
    } catch (error) {
      // Table might not exist yet
      const pgError = error as { code?: string };
      if (pgError.code !== '42P01') {
        // 42P01 = undefined_table
        logger.error({
          event: 'purge_table_failed',
          table,
          error: (error as Error).message,
        });
      }
    }
  }

  logger.info({
    event: 'purge_completed',
    results,
  });

  return results;
}

/**
 * Query historical transactions (checks both hot and warm storage)
 */
export async function queryHistoricalTransfers(
  userId: string,
  options: QueryHistoricalOptions = {}
): Promise<TransferRow[]> {
  const { startDate, endDate, limit = 100, includeArchive = true } = options;

  let transfers: TransferRow[] = [];

  // Query hot storage first
  let hotQuery = `
    SELECT *, 'hot' as storage_tier FROM transfers
    WHERE (sender_id = $1 OR receiver_id = $1)
  `;
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (startDate) {
    hotQuery += ` AND created_at >= $${paramIndex++}`;
    params.push(startDate);
  }

  if (endDate) {
    hotQuery += ` AND created_at <= $${paramIndex++}`;
    params.push(endDate);
  }

  hotQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const hotResult = await pool.query(hotQuery, params);
  transfers = [...hotResult.rows];

  // If we need more results and should include archive
  if (includeArchive && transfers.length < limit) {
    const remainingLimit = limit - transfers.length;

    let archiveQuery = `
      SELECT *, 'warm' as storage_tier FROM transfers_archive
      WHERE (sender_id = $1 OR receiver_id = $1)
    `;
    const archiveParams: unknown[] = [userId];
    let archiveParamIndex = 2;

    if (startDate) {
      archiveQuery += ` AND created_at >= $${archiveParamIndex++}`;
      archiveParams.push(startDate);
    }

    if (endDate) {
      archiveQuery += ` AND created_at <= $${archiveParamIndex++}`;
      archiveParams.push(endDate);
    }

    archiveQuery += ` ORDER BY created_at DESC LIMIT $${archiveParamIndex}`;
    archiveParams.push(remainingLimit);

    try {
      const archiveResult = await pool.query(archiveQuery, archiveParams);
      transfers = [...transfers, ...archiveResult.rows];
    } catch {
      // Archive table might not exist yet
      logger.debug({ event: 'archive_table_not_found', table: 'transfers_archive' });
    }
  }

  return transfers;
}

/**
 * Get storage statistics for monitoring
 */
export async function getStorageStats(): Promise<StorageStats> {
  const stats: StorageStats = {};

  // Get row counts and sizes
  const tables = ['transfers', 'cashouts', 'payment_requests', 'audit_log'];

  for (const table of tables) {
    try {
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      const sizeResult = await pool.query(`SELECT pg_total_relation_size($1) as size`, [table]);

      stats[table] = {
        rowCount: parseInt(countResult.rows[0].count),
        sizeBytes: parseInt(sizeResult.rows[0].size),
        sizeMB: (parseInt(sizeResult.rows[0].size) / 1024 / 1024).toFixed(2),
      };
    } catch {
      stats[table] = { error: 'table not found' };
    }
  }

  // Check archive tables
  const archiveTables = ['transfers_archive', 'cashouts_archive'];

  for (const table of archiveTables) {
    try {
      const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      stats[table] = { rowCount: parseInt(countResult.rows[0].count) };
    } catch {
      stats[table] = { rowCount: 0, note: 'not created yet' };
    }
  }

  return stats;
}
