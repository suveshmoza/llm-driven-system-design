/**
 * Utility Helpers
 *
 * Common utility functions for formatting, displaying, and manipulating data
 * throughout the Stripe Clone dashboard. These functions provide consistent
 * formatting for currency, dates, and UI elements.
 *
 * @module utils/helpers
 */

/**
 * Formats an amount in cents to a localized currency string.
 * Uses Intl.NumberFormat for proper locale-aware formatting.
 *
 * @param cents - Amount in the smallest currency unit (e.g., 2500 = $25.00)
 * @param currency - Three-letter ISO currency code (defaults to 'usd')
 * @returns Formatted currency string (e.g., "$25.00")
 *
 * @example
 * formatCurrency(2500) // "$25.00"
 * formatCurrency(1000, 'eur') // "€10.00"
 */
export function formatCurrency(cents: number, currency: string = 'usd'): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

/**
 * Formats a Unix timestamp to a human-readable date string.
 * Displays date with month abbreviation and time in 12-hour format.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns Formatted date string (e.g., "Jan 15, 2024, 10:30 AM")
 *
 * @example
 * formatDate(1705330200) // "Jan 15, 2024, 10:30 AM"
 */
export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

/**
 * Formats a Unix timestamp to a relative time string.
 * Shows "just now", "Xm ago", "Xh ago", "Xd ago" for recent times,
 * or falls back to the full date for older timestamps.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns Relative time string (e.g., "5m ago", "2h ago", "3d ago")
 *
 * @example
 * formatRelativeTime(Date.now() / 1000 - 120) // "2m ago"
 * formatRelativeTime(Date.now() / 1000 - 7200) // "2h ago"
 */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return formatDate(timestamp);
}

/**
 * Maps a status string to the corresponding CSS badge class.
 * Provides consistent visual styling for payment and transaction statuses.
 *
 * @param status - The status string to get a color for
 * @returns CSS class name for the badge (e.g., "badge-success", "badge-warning")
 *
 * @example
 * getStatusColor('succeeded') // "badge-success"
 * getStatusColor('requires_payment_method') // "badge-warning"
 * getStatusColor('failed') // "badge-danger"
 */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    succeeded: 'badge-success',
    requires_payment_method: 'badge-warning',
    requires_confirmation: 'badge-warning',
    requires_action: 'badge-warning',
    requires_capture: 'badge-info',
    processing: 'badge-info',
    canceled: 'badge-gray',
    failed: 'badge-danger',
    pending: 'badge-warning',
    delivered: 'badge-success',
    refunded: 'badge-info',
    partially_refunded: 'badge-info',
    active: 'badge-success',
    inactive: 'badge-gray',
    suspended: 'badge-danger',
    low: 'badge-success',
    medium: 'badge-warning',
    high: 'badge-danger',
    critical: 'badge-danger',
  };

  return colors[status] || 'badge-gray';
}

/**
 * Converts a card brand code to a display-friendly label.
 * Maps internal brand identifiers to proper capitalized names.
 *
 * @param brand - The card brand code (e.g., 'visa', 'mastercard')
 * @returns Human-readable brand name (e.g., 'Visa', 'Mastercard')
 *
 * @example
 * getCardBrandLabel('visa') // "Visa"
 * getCardBrandLabel('amex') // "American Express"
 */
export function getCardBrandLabel(brand: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
    jcb: 'JCB',
    diners: 'Diners Club',
    unknown: 'Card',
  };

  return brands[brand] || brand;
}

/**
 * Truncates a string to a maximum length with ellipsis.
 * Useful for displaying IDs and long text in limited space.
 *
 * @param str - The string to truncate
 * @param maxLength - Maximum length including ellipsis (defaults to 20)
 * @returns Truncated string with "..." if it exceeded maxLength
 *
 * @example
 * truncate('pi_1234567890abcdef', 15) // "pi_123456789..."
 * truncate('short', 20) // "short"
 */
export function truncate(str: string, maxLength: number = 20): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Copies text to the system clipboard.
 * Uses the Clipboard API for secure clipboard access.
 *
 * @param text - The text to copy to clipboard
 * @returns Promise resolving to true on success, false on failure
 *
 * @example
 * await copyToClipboard('pi_1234567890abcdef'); // true
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a debounced version of a function.
 * Delays execution until after the specified delay has passed
 * since the last invocation. Useful for search inputs and resize handlers.
 *
 * @template T - The function type to debounce
 * @param fn - The function to debounce
 * @param delay - Delay in milliseconds before execution
 * @returns Debounced function that delays calls
 *
 * @example
 * const debouncedSearch = debounce((query: string) => {
 *   fetchResults(query);
 * }, 300);
 * input.addEventListener('input', (e) => debouncedSearch(e.target.value));
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Generates a short random ID string.
 * Suitable for local component keys, not for database identifiers.
 *
 * @returns 9-character random alphanumeric string
 *
 * @example
 * generateId() // "k7h2m9x4p"
 */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}
