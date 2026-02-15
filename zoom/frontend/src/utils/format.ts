/** Formats a meeting code into the human-readable xxx-xxxx-xxx pattern. */
export function formatMeetingCode(code: string): string {
  // Already formatted
  if (code.includes('-')) return code;
  // Format as xxx-xxxx-xxx
  if (code.length === 10) {
    return `${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`;
  }
  return code;
}

/** Formats a date string to localized time (e.g. "2:30 PM"). */
export function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Formats a date string to localized short date (e.g. "Jan 15, 2025"). */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Formats a date string to combined date and time. */
export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return `${formatDate(dateStr)} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Calculates and formats the duration between two date strings (e.g. "1h 30m"). */
export function formatDuration(startStr: string | null, endStr: string | null): string {
  if (!startStr || !endStr) return '';
  const start = new Date(startStr);
  const end = new Date(endStr);
  const diffMs = end.getTime() - start.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/** Returns a human-readable countdown string until a future date. */
export function timeUntil(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) return 'Started';
  if (diffMs < 60000) return 'Starting soon';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `In ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `In ${hours}h`;

  const days = Math.floor(hours / 24);
  return `In ${days}d`;
}

/** Extracts up to 2 uppercase initials from a display name. */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
