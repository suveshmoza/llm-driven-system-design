/**
 * Order Retention and Archival Configuration
 *
 * Manages order data lifecycle:
 * - Active orders in PostgreSQL (hot storage)
 * - Archived orders after retention period
 * - Data anonymization for compliance
 * - Cold storage for long-term retention
 *
 * Balances:
 * - Customer access to order history
 * - Legal retention requirements (7 years typical)
 * - Storage costs
 * - Query performance
 */
import { query, transaction } from '../services/database.js';
import logger from './logger.js';
import type { PoolClient } from 'pg';

// ============================================================
// Configuration
// ============================================================

interface RetentionPolicy {
  hotStorageDays?: number;
  archiveRetentionDays?: number;
  anonymizeAfterDays?: number;
  reservationMinutes?: number;
  cleanupIntervalMinutes?: number;
  ttlSeconds?: number;
  retentionDays?: number;
}

interface OrderForArchival {
  id: number;
  user_id: number;
  created_at: Date;
  status: string;
}

interface OrderWithItems {
  id: number;
  user_id: number;
  status: string;
  subtotal: string;
  tax: string;
  shipping_cost: string;
  total: string;
  payment_method: string;
  payment_status: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  items: unknown[];
}

interface ArchiveResult {
  archived: number;
  errors: Array<{ orderId: number; error: string }>;
}

export interface RetentionStats {
  orders: {
    active_orders: string;
    archived_orders: string;
    anonymized_orders: string;
    oldest_active_order: Date | null;
  };
  cartItems: {
    total_items: string;
    expired_items: string;
  };
  auditLogs: {
    total_logs: string;
    oldest_log: Date | null;
  };
  sessions: {
    total_sessions: string;
    expired_sessions: string;
  };
}

/**
 * Retention policies by data type
 * All durations in days
 */
export const RetentionPolicies: Record<string, RetentionPolicy> = {
  // Orders - keep in hot storage for 2 years, archive for 7 years total
  ORDERS: {
    hotStorageDays: 730,        // 2 years - quick access for customer support
    archiveRetentionDays: 2555, // 7 years total (legal requirement)
    anonymizeAfterDays: 2555    // Anonymize PII after 7 years
  },

  // Cart items - expire after 30 minutes
  CART_ITEMS: {
    reservationMinutes: 30,
    cleanupIntervalMinutes: 5
  },

  // Sessions - 24 hour TTL
  SESSIONS: {
    ttlSeconds: 86400
  },

  // Audit logs - keep for 3 years
  AUDIT_LOGS: {
    hotStorageDays: 365,        // 1 year in database
    archiveRetentionDays: 1095  // 3 years total
  },

  // Search logs - 90 days
  SEARCH_LOGS: {
    retentionDays: 90
  },

  // Idempotency keys - 24 hours
  IDEMPOTENCY_KEYS: {
    ttlSeconds: 86400
  },

  // Product recommendations cache - refresh daily
  RECOMMENDATIONS: {
    ttlSeconds: 86400
  }
};

/**
 * Order archive status enum
 */
export const ArchiveStatus = {
  ACTIVE: 'active',
  PENDING_ARCHIVE: 'pending_archive',
  ARCHIVED: 'archived',
  ANONYMIZED: 'anonymized'
} as const;

export type ArchiveStatusType = (typeof ArchiveStatus)[keyof typeof ArchiveStatus];

// ============================================================
// Archival Functions
// ============================================================

/**
 * Get orders eligible for archival
 */
export async function getOrdersForArchival(limit: number = 1000): Promise<OrderForArchival[]> {
  const cutoffDate = new Date();
  const policy = RetentionPolicies.ORDERS;
  cutoffDate.setDate(cutoffDate.getDate() - (policy?.hotStorageDays ?? 730));

  const result = await query<OrderForArchival>(
    `SELECT o.id, o.user_id, o.created_at, o.status
     FROM orders o
     WHERE o.created_at < $1
       AND (o.archive_status IS NULL OR o.archive_status = 'active')
       AND o.status IN ('delivered', 'cancelled', 'refunded')
     ORDER BY o.created_at ASC
     LIMIT $2`,
    [cutoffDate, limit]
  );

  return result.rows;
}

/**
 * Archive a batch of orders
 * Moves data to cold storage and marks as archived
 */
export async function archiveOrders(orderIds: number[]): Promise<ArchiveResult> {
  if (orderIds.length === 0) {
    return { archived: 0, errors: [] };
  }

  let archived = 0;
  const errors: Array<{ orderId: number; error: string }> = [];

  for (const orderId of orderIds) {
    try {
      await transaction(async (client: PoolClient) => {
        // Get full order data for archival
        const orderResult = await client.query<OrderWithItems>(
          `SELECT o.*, json_agg(oi.*) as items
           FROM orders o
           LEFT JOIN order_items oi ON o.id = oi.order_id
           WHERE o.id = $1
           GROUP BY o.id`,
          [orderId]
        );

        if (orderResult.rows.length === 0) {
          throw new Error(`Order ${orderId} not found`);
        }

        const order = orderResult.rows[0];
        if (!order) {
          throw new Error(`Order ${orderId} not found`);
        }

        // Create archive record
        const archiveData = JSON.stringify({
          order: {
            id: order.id,
            userId: order.user_id,
            status: order.status,
            subtotal: order.subtotal,
            tax: order.tax,
            shippingCost: order.shipping_cost,
            total: order.total,
            paymentMethod: order.payment_method,
            paymentStatus: order.payment_status,
            notes: order.notes,
            createdAt: order.created_at,
            updatedAt: order.updated_at
          },
          items: order.items,
          archivedAt: new Date().toISOString()
        });

        // Store in orders_archive table
        await client.query(
          `INSERT INTO orders_archive (order_id, user_id, archive_data, created_at, archived_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [orderId, order.user_id, archiveData, order.created_at]
        );

        // Update order with archive status and remove PII
        await client.query(
          `UPDATE orders
           SET archive_status = 'archived',
               archived_at = NOW(),
               shipping_address = NULL,
               billing_address = NULL,
               notes = NULL
           WHERE id = $1`,
          [orderId]
        );

        archived++;
      });
    } catch (error) {
      const err = error as Error;
      logger.error({ orderId, error: err.message }, 'Failed to archive order');
      errors.push({ orderId, error: err.message });
    }
  }

  logger.info({ archived, errors: errors.length }, 'Order archival completed');
  return { archived, errors };
}

/**
 * Retrieve archived order data
 * For customer support or legal requests
 */
export async function retrieveArchivedOrder(orderId: number): Promise<unknown | null> {
  // First check if order is archived
  const orderCheck = await query<{ id: number; archive_status: string }>(
    'SELECT id, archive_status FROM orders WHERE id = $1',
    [orderId]
  );

  if (orderCheck.rows.length === 0) {
    return null;
  }

  const order = orderCheck.rows[0];
  if (!order) {
    return null;
  }

  if (order.archive_status !== 'archived' && order.archive_status !== 'anonymized') {
    // Order is still in hot storage - return from main table
    const result = await query<OrderWithItems>(
      `SELECT o.*, json_agg(oi.*) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1
       GROUP BY o.id`,
      [orderId]
    );
    return result.rows[0];
  }

  // Retrieve from archive
  const archiveResult = await query<{ archive_data: string }>(
    'SELECT * FROM orders_archive WHERE order_id = $1',
    [orderId]
  );

  if (archiveResult.rows.length === 0) {
    logger.warn({ orderId }, 'Archived order not found in archive table');
    return null;
  }

  const archiveRow = archiveResult.rows[0];
  if (!archiveRow) {
    return null;
  }

  return JSON.parse(archiveRow.archive_data);
}

/**
 * Anonymize old orders for GDPR/CCPA compliance
 */
export async function anonymizeOldOrders(limit: number = 500): Promise<number> {
  const cutoffDate = new Date();
  const ordersPolicy = RetentionPolicies.ORDERS;
  cutoffDate.setDate(cutoffDate.getDate() - (ordersPolicy?.anonymizeAfterDays ?? 2555));

  const result = await query(
    `UPDATE orders
     SET shipping_address = '{"anonymized": true}'::jsonb,
         billing_address = '{"anonymized": true}'::jsonb,
         notes = NULL,
         archive_status = 'anonymized',
         updated_at = NOW()
     WHERE created_at < $1
       AND archive_status != 'anonymized'
     RETURNING id`,
    [cutoffDate]
  );

  const count = result.rowCount || 0;
  if (count > 0) {
    logger.info({ count }, 'Anonymized old orders');
  }

  return count;
}

// ============================================================
// Cleanup Functions
// ============================================================

/**
 * Clean up expired cart reservations
 */
export async function cleanupExpiredCartItems(): Promise<number> {
  const result = await query<{ product_id: number; quantity: number }>(
    `DELETE FROM cart_items
     WHERE reserved_until IS NOT NULL AND reserved_until < NOW()
     RETURNING product_id, quantity`
  );

  const count = result.rowCount || 0;
  if (count > 0) {
    logger.info({ count }, 'Cleaned up expired cart reservations');

    // Release inventory reservations
    for (const item of result.rows) {
      await query(
        `UPDATE inventory SET reserved = GREATEST(0, reserved - $1)
         WHERE product_id = $2`,
        [item.quantity, item.product_id]
      );
    }
  }

  return count;
}

/**
 * Clean up old search logs
 */
export async function cleanupSearchLogs(): Promise<number> {
  const cutoffDate = new Date();
  const searchLogsPolicy = RetentionPolicies.SEARCH_LOGS;
  cutoffDate.setDate(cutoffDate.getDate() - (searchLogsPolicy?.retentionDays ?? 90));

  const result = await query(
    'DELETE FROM search_logs WHERE created_at < $1',
    [cutoffDate]
  );

  if ((result.rowCount || 0) > 0) {
    logger.info({ count: result.rowCount }, 'Cleaned up old search logs');
  }

  return result.rowCount || 0;
}

/**
 * Clean up old audit logs (move to archive)
 */
export async function archiveOldAuditLogs(): Promise<number> {
  const cutoffDate = new Date();
  const auditLogsPolicy = RetentionPolicies.AUDIT_LOGS;
  cutoffDate.setDate(cutoffDate.getDate() - (auditLogsPolicy?.hotStorageDays ?? 365));

  // For now, just log - in production would move to cold storage
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM audit_logs WHERE created_at < $1',
    [cutoffDate]
  );

  const countRow = countResult.rows[0];
  const count = countRow ? parseInt(countRow.count) : 0;
  if (count > 0) {
    logger.info({ count, cutoffDate }, 'Audit logs eligible for archival');
    // In production: Move to S3/MinIO cold storage
  }

  return count;
}

/**
 * Clean up expired idempotency keys
 */
export async function cleanupIdempotencyKeys(): Promise<number> {
  const idempotencyPolicy = RetentionPolicies.IDEMPOTENCY_KEYS;
  const cutoffDate = new Date(Date.now() - (idempotencyPolicy?.ttlSeconds ?? 86400) * 1000);

  const result = await query(
    'DELETE FROM idempotency_keys WHERE created_at < $1',
    [cutoffDate]
  );

  if ((result.rowCount || 0) > 0) {
    logger.info({ count: result.rowCount }, 'Cleaned up expired idempotency keys');
  }

  return result.rowCount || 0;
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await query(
    'DELETE FROM sessions WHERE expires_at < NOW()'
  );

  if ((result.rowCount || 0) > 0) {
    logger.info({ count: result.rowCount }, 'Cleaned up expired sessions');
  }

  return result.rowCount || 0;
}

// ============================================================
// Scheduled Job Runner
// ============================================================

/**
 * Run all archival and cleanup jobs
 * Should be called periodically (e.g., daily)
 */
export async function runArchivalJobs(): Promise<void> {
  logger.info('Starting archival jobs');

  try {
    // Clean up expired data first
    await cleanupExpiredCartItems();
    await cleanupExpiredSessions();
    await cleanupIdempotencyKeys();
    await cleanupSearchLogs();

    // Archive old orders
    const ordersToArchive = await getOrdersForArchival(500);
    if (ordersToArchive.length > 0) {
      await archiveOrders(ordersToArchive.map(o => o.id));
    }

    // Anonymize very old orders
    await anonymizeOldOrders();

    // Archive old audit logs
    await archiveOldAuditLogs();

    logger.info('Archival jobs completed');
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, 'Archival jobs failed');
  }
}

/**
 * Get data retention statistics
 */
export async function getRetentionStats(): Promise<RetentionStats> {
  const stats: Partial<RetentionStats> = {};

  // Orders by status
  const orderStats = await query<{
    active_orders: string;
    archived_orders: string;
    anonymized_orders: string;
    oldest_active_order: Date | null;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE archive_status IS NULL OR archive_status = 'active') as active_orders,
      COUNT(*) FILTER (WHERE archive_status = 'archived') as archived_orders,
      COUNT(*) FILTER (WHERE archive_status = 'anonymized') as anonymized_orders,
      MIN(created_at) FILTER (WHERE archive_status IS NULL OR archive_status = 'active') as oldest_active_order
    FROM orders
  `);
  stats.orders = orderStats.rows[0];

  // Cart items
  const cartStats = await query<{
    total_items: string;
    expired_items: string;
  }>(`
    SELECT
      COUNT(*) as total_items,
      COUNT(*) FILTER (WHERE reserved_until < NOW()) as expired_items
    FROM cart_items
  `);
  stats.cartItems = cartStats.rows[0];

  // Audit logs
  const auditStats = await query<{
    total_logs: string;
    oldest_log: Date | null;
  }>(`
    SELECT
      COUNT(*) as total_logs,
      MIN(created_at) as oldest_log
    FROM audit_logs
  `);
  stats.auditLogs = auditStats.rows[0];

  // Sessions
  const sessionStats = await query<{
    total_sessions: string;
    expired_sessions: string;
  }>(`
    SELECT
      COUNT(*) as total_sessions,
      COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_sessions
    FROM sessions
  `);
  stats.sessions = sessionStats.rows[0];

  return stats as RetentionStats;
}

export default {
  RetentionPolicies,
  ArchiveStatus,
  getOrdersForArchival,
  archiveOrders,
  retrieveArchivedOrder,
  anonymizeOldOrders,
  cleanupExpiredCartItems,
  cleanupSearchLogs,
  archiveOldAuditLogs,
  cleanupIdempotencyKeys,
  cleanupExpiredSessions,
  runArchivalJobs,
  getRetentionStats
};
