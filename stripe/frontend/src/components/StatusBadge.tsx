/**
 * Status Badge Component
 *
 * Displays a colored badge for various status types.
 * Used throughout the dashboard to show payment states, risk levels,
 * and delivery statuses with consistent visual styling.
 *
 * @module components/StatusBadge
 */

import type { PaymentIntentStatus } from '@/types';
import { getStatusColor } from '@/utils';

/**
 * Props for the StatusBadge component.
 */
interface StatusBadgeProps {
  /** The status string to display (e.g., 'succeeded', 'failed', 'pending') */
  status: string;
}

/**
 * Colored status badge component.
 * Automatically maps status values to appropriate colors (success, warning, danger, etc.)
 * and formats the status text for human readability.
 *
 * @param props - Component props
 * @param props.status - The status value to display
 * @returns A styled span element with the status label
 *
 * @example
 * <StatusBadge status="succeeded" /> // Green "Succeeded" badge
 * <StatusBadge status="requires_payment_method" /> // Yellow "Requires Payment" badge
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  const colorClass = getStatusColor(status);
  const label = formatStatusLabel(status);

  return <span className={colorClass}>{label}</span>;
}

/**
 * Formats a snake_case status string to a human-readable label.
 * Uses a lookup table for common statuses, or falls back to
 * Title Case conversion for unknown statuses.
 *
 * @param status - The raw status string to format
 * @returns Formatted display label
 */
function formatStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    requires_payment_method: 'Requires Payment',
    requires_confirmation: 'Requires Confirmation',
    requires_action: 'Requires Action',
    requires_capture: 'Authorized',
    processing: 'Processing',
    succeeded: 'Succeeded',
    failed: 'Failed',
    canceled: 'Canceled',
    pending: 'Pending',
    delivered: 'Delivered',
    refunded: 'Refunded',
    partially_refunded: 'Partially Refunded',
    active: 'Active',
    inactive: 'Inactive',
    suspended: 'Suspended',
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical Risk',
    needs_response: 'Needs Response',
    under_review: 'Under Review',
    won: 'Won',
    lost: 'Lost',
  };

  return labels[status] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
