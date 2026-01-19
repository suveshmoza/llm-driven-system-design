import { transitionsCounter } from '../../config/metrics.js';

/**
 * Records a status transition for metrics.
 *
 * @param projectKey - Project key
 * @param fromStatus - Previous status name
 * @param toStatus - New status name
 */
export function recordTransitionMetric(projectKey: string, fromStatus: string, toStatus: string): void {
  transitionsCounter.inc({ project_key: projectKey, from_status: fromStatus, to_status: toStatus });
}
