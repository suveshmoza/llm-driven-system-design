/**
 * Formats a duration in seconds to a time string (H:MM:SS or M:SS).
 * Used for displaying current time and total duration in the video player.
 *
 * @param seconds - Duration in seconds to format
 * @returns Formatted time string (e.g., "1:23:45" for 1h 23m 45s, or "3:45" for 3m 45s)
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats a duration in seconds to a human-readable string (Xh Ym).
 * Used for displaying content length in cards and detail pages.
 *
 * @param seconds - Duration in seconds to format
 * @returns Human-readable duration (e.g., "2h 15m" or "45m")
 */
export function formatDurationHuman(seconds: number): string {
  if (!seconds || seconds <= 0) return '';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Formats an ISO date string to a localized date display.
 * Used for displaying release dates and creation dates.
 *
 * @param dateString - ISO 8601 date string
 * @returns Localized date string (e.g., "January 15, 2024")
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Extracts the year from an ISO date string.
 * Used for displaying release year in content metadata.
 *
 * @param dateString - ISO 8601 date string
 * @returns Year as string (e.g., "2024")
 */
export function formatYear(dateString: string): string {
  const date = new Date(dateString);
  return date.getFullYear().toString();
}

/**
 * Converts a video resolution height to a human-readable quality label.
 * Used in quality selection menus for adaptive streaming.
 *
 * @param resolution - Video height in pixels (e.g., 2160 for 4K)
 * @returns Quality label (e.g., "4K", "HD", "720p")
 */
export function getResolutionLabel(resolution: number): string {
  if (resolution >= 2160) return '4K';
  if (resolution >= 1080) return 'HD';
  if (resolution >= 720) return '720p';
  return `${resolution}p`;
}

/**
 * Formats a bitrate value to a human-readable string.
 * Used for displaying stream quality information in player settings.
 *
 * @param bitrate - Bitrate in kilobits per second
 * @returns Formatted bitrate string (e.g., "5.0 Mbps" or "500 Kbps")
 */
export function getBitrateLabel(bitrate: number): string {
  if (bitrate >= 1000) {
    return `${(bitrate / 1000).toFixed(1)} Mbps`;
  }
  return `${bitrate} Kbps`;
}

/**
 * Utility function for conditionally joining CSS class names.
 * Filters out falsy values and joins remaining strings with spaces.
 *
 * @param classes - Array of class names, booleans, undefined, or null values
 * @returns Space-separated string of truthy class names
 *
 * @example
 * classNames('base', isActive && 'active', isDisabled && 'disabled')
 * // Returns "base active" if isActive is true and isDisabled is false
 */
export function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
