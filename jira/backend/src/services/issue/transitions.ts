import { transitionsCounter } from '../../config/metrics.js';

/**
 * Records a status transition for Prometheus metrics.
 *
 * @description Increments the transitions counter metric with labels for
 * project key, source status, and target status. This enables monitoring
 * of workflow patterns and identifying bottlenecks in issue progression.
 *
 * Metrics can be visualized in Grafana to understand:
 * - Which transitions happen most frequently
 * - Workflow patterns per project
 * - Bottleneck identification (issues getting stuck in certain states)
 *
 * @param projectKey - Project key prefix (e.g., "PROJ")
 * @param fromStatus - Name of the previous status (e.g., "To Do")
 * @param toStatus - Name of the new status (e.g., "In Progress")
 * @returns void
 *
 * @example
 * ```typescript
 * // When an issue moves from "To Do" to "In Progress"
 * recordTransitionMetric('PROJ', 'To Do', 'In Progress');
 *
 * // When an issue is resolved
 * recordTransitionMetric('PROJ', 'In Review', 'Done');
 * ```
 */
export function recordTransitionMetric(projectKey: string, fromStatus: string, toStatus: string): void {
  transitionsCounter.inc({ project_key: projectKey, from_status: fromStatus, to_status: toStatus });
}
