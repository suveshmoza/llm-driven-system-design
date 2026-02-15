import { pool } from './db.js';
import { logger } from './logger.js';

export interface DashboardKPIs {
  totalRevenue: number;
  openOpportunities: number;
  wonOpportunities: number;
  newLeads: number;
  activitiesDue: number;
  pipelineValue: number;
  conversionRate: number;
  avgDealSize: number;
}

/** Aggregates dashboard KPIs for a user: revenue, pipeline, leads, activities, and conversion rate. */
export async function getDashboardKPIs(userId: string): Promise<DashboardKPIs> {
  try {
    // Total revenue from closed-won opportunities
    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) as total
       FROM opportunities
       WHERE stage = 'Closed Won' AND owner_id = $1`,
      [userId],
    );

    // Open opportunities count and pipeline value
    const openOppsResult = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as pipeline_value
       FROM opportunities
       WHERE stage NOT IN ('Closed Won', 'Closed Lost') AND owner_id = $1`,
      [userId],
    );

    // Won opportunities count
    const wonOppsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM opportunities
       WHERE stage = 'Closed Won' AND owner_id = $1`,
      [userId],
    );

    // New leads (created in last 30 days)
    const leadsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM leads
       WHERE status = 'New' AND owner_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [userId],
    );

    // Activities due today or overdue
    const activitiesResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM activities
       WHERE owner_id = $1
         AND completed = false
         AND due_date <= NOW() + INTERVAL '1 day'`,
      [userId],
    );

    // Conversion rate (converted leads / total leads)
    const conversionResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE converted_at IS NOT NULL) as converted,
         COUNT(*) as total
       FROM leads
       WHERE owner_id = $1`,
      [userId],
    );

    // Average deal size
    const avgDealResult = await pool.query(
      `SELECT COALESCE(AVG(amount_cents), 0) as avg_deal
       FROM opportunities
       WHERE stage = 'Closed Won' AND owner_id = $1`,
      [userId],
    );

    const totalLeads = parseInt(conversionResult.rows[0].total) || 1;
    const convertedLeads = parseInt(conversionResult.rows[0].converted) || 0;

    return {
      totalRevenue: parseInt(revenueResult.rows[0].total),
      openOpportunities: parseInt(openOppsResult.rows[0].count),
      wonOpportunities: parseInt(wonOppsResult.rows[0].count),
      newLeads: parseInt(leadsResult.rows[0].count),
      activitiesDue: parseInt(activitiesResult.rows[0].count),
      pipelineValue: parseInt(openOppsResult.rows[0].pipeline_value),
      conversionRate: Math.round((convertedLeads / totalLeads) * 100),
      avgDealSize: Math.round(parseFloat(avgDealResult.rows[0].avg_deal)),
    };
  } catch (err) {
    logger.error({ err }, 'Failed to fetch dashboard KPIs');
    throw err;
  }
}
