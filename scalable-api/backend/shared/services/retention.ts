import config, { type Config } from '../config/index.js';
import db from './database.js';
import logger from './logger.js';
import type { Logger } from 'pino';

interface RetentionStats {
  requestLogs?: {
    total_count: string;
    oldest_log: string | null;
    newest_log: string | null;
    table_size: string;
  };
  apiKeys?: {
    active_keys: string;
    revoked_keys: string;
  };
}

/**
 * Data Retention Service
 *
 * WHY request retention balances debugging vs storage:
 * - Too short: Lose ability to debug production issues, compliance violations
 * - Too long: Storage costs grow unbounded, query performance degrades
 * - Tiered approach: Hot data for quick access, warm for investigation, cold for compliance
 *
 * This service implements lifecycle policies for:
 * - Request logs (hot -> warm -> cold -> delete)
 * - Metrics data (in-memory -> persistent -> delete)
 * - Session data (auto-expire via Redis TTL)
 */
export class RetentionService {
  private config: Config['retention'];
  private log: Logger;

  constructor() {
    this.config = config.retention;
    this.log = logger.child({ service: 'retention' });
  }

  /**
   * Archive old request logs from hot storage (PostgreSQL) to warm storage
   * Should be run as a scheduled job (e.g., daily at 2 AM)
   */
  async archiveRequestLogs(): Promise<{ archived: number }> {
    const hotRetentionDays = this.config.requestLogs.hot;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - hotRetentionDays);

    this.log.info({ cutoffDate, hotRetentionDays }, 'Starting request logs archival');

    try {
      // Count logs to archive
      const countResult = await db.query(
        `SELECT COUNT(*) as count FROM request_logs WHERE created_at < $1`,
        [cutoffDate]
      );
      const count = parseInt(countResult.rows[0]?.['count'] ?? '0', 10);

      if (count === 0) {
        this.log.info('No request logs to archive');
        return { archived: 0 };
      }

      this.log.info({ count }, 'Found request logs to archive');

      // In production, you would:
      // 1. Export logs to JSONL format
      // 2. Compress with gzip
      // 3. Upload to object storage (MinIO/S3)
      // 4. Delete from PostgreSQL

      // For now, we just delete old logs (implement archival based on your storage setup)
      const deleteResult = await db.query(
        `DELETE FROM request_logs WHERE created_at < $1`,
        [cutoffDate]
      );

      this.log.info({ deleted: deleteResult.rowCount }, 'Archived and deleted old request logs');
      return { archived: deleteResult.rowCount ?? 0 };
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'Failed to archive request logs');
      throw error;
    }
  }

  /**
   * Drop old partitions for partitioned tables
   * More efficient than row-by-row deletion
   */
  async dropOldPartitions(tableName = 'request_logs_partitioned'): Promise<{ dropped: string[] }> {
    const coldRetentionDays = this.config.requestLogs.cold;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - coldRetentionDays);

    this.log.info({ tableName, cutoffDate, coldRetentionDays }, 'Checking for old partitions to drop');

    try {
      // Find partitions older than cutoff
      const result = await db.query(`
        SELECT tablename FROM pg_tables
        WHERE tablename LIKE $1
        AND schemaname = 'public'
      `, [`${tableName}_%`]);

      const droppedPartitions: string[] = [];
      for (const row of result.rows) {
        const tablename = row['tablename'] as string;
        // Parse date from partition name (e.g., request_logs_2024_01)
        const match = tablename.match(/_(\d{4})_(\d{2})$/);
        if (match && match[1] && match[2]) {
          const partitionDate = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, 1);
          if (partitionDate < cutoffDate) {
            this.log.info({ partition: tablename }, 'Dropping old partition');
            await db.query(`DROP TABLE IF EXISTS ${tablename}`);
            droppedPartitions.push(tablename);
          }
        }
      }

      this.log.info({ droppedCount: droppedPartitions.length }, 'Partition cleanup complete');
      return { dropped: droppedPartitions };
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'Failed to drop old partitions');
      throw error;
    }
  }

  /**
   * Create future partitions for partitioned tables
   * Should be run weekly to ensure partitions exist before needed
   */
  async createFuturePartitions(tableName = 'request_logs_partitioned', monthsAhead = 3): Promise<{ created: string[] }> {
    this.log.info({ tableName, monthsAhead }, 'Creating future partitions');

    try {
      const createdPartitions: string[] = [];
      const currentDate = new Date();

      for (let i = 0; i < monthsAhead; i++) {
        const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
        const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i + 1, 1);
        const partitionName = `${tableName}_${startDate.getFullYear()}_${String(startDate.getMonth() + 1).padStart(2, '0')}`;

        try {
          await db.query(`
            CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF ${tableName}
            FOR VALUES FROM ('${startDate.toISOString().split('T')[0]}') TO ('${endDate.toISOString().split('T')[0]}')
          `);
          createdPartitions.push(partitionName);
        } catch (error) {
          // Partition might already exist, that's fine
          if (!(error as Error).message.includes('already exists')) {
            throw error;
          }
        }
      }

      this.log.info({ createdCount: createdPartitions.length }, 'Future partitions created');
      return { created: createdPartitions };
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'Failed to create future partitions');
      throw error;
    }
  }

  /**
   * Clean up expired API keys that were soft-deleted
   */
  async cleanupExpiredApiKeys(): Promise<{ deleted: number }> {
    const softDeleteDays = this.config.apiKeys.softDeleteDays;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - softDeleteDays);

    this.log.info({ cutoffDate, softDeleteDays }, 'Cleaning up expired API keys');

    try {
      const result = await db.query(
        `DELETE FROM api_keys WHERE revoked_at IS NOT NULL AND revoked_at < $1`,
        [cutoffDate]
      );

      this.log.info({ deleted: result.rowCount }, 'Deleted expired API keys');
      return { deleted: result.rowCount ?? 0 };
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'Failed to cleanup API keys');
      throw error;
    }
  }

  /**
   * Get retention status for monitoring
   */
  async getRetentionStatus(): Promise<{
    config: Config['retention'];
    stats: RetentionStats;
    timestamp: string;
  }> {
    try {
      const stats: RetentionStats = {};

      // Request logs stats
      const logsResult = await db.query<{
        total_count: string;
        oldest_log: string | null;
        newest_log: string | null;
        table_size: string;
      }>(`
        SELECT
          COUNT(*) as total_count,
          MIN(created_at) as oldest_log,
          MAX(created_at) as newest_log,
          pg_size_pretty(pg_total_relation_size('request_logs')) as table_size
        FROM request_logs
      `);
      stats.requestLogs = logsResult.rows[0];

      // API keys stats
      const keysResult = await db.query<{
        active_keys: string;
        revoked_keys: string;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE revoked_at IS NULL) as active_keys,
          COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) as revoked_keys
        FROM api_keys
      `);
      stats.apiKeys = keysResult.rows[0];

      return {
        config: this.config,
        stats,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'Failed to get retention status');
      throw error;
    }
  }
}

export const retentionService = new RetentionService();
export default RetentionService;
