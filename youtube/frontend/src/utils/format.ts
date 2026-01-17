/**
 * Format a duration in seconds to a human-readable time string.
 * Returns HH:MM:SS format for durations >= 1 hour, MM:SS otherwise.
 * Used for displaying video lengths and playback position.
 *
 * @param seconds - Duration in seconds (can be null)
 * @returns Formatted time string (e.g., "1:23:45" or "3:45")
 */
export const formatDuration = (seconds: number | null): string => {
  if (seconds === null || seconds === undefined) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Format a view count with abbreviated suffixes.
 * Uses K (thousands), M (millions), B (billions) for compact display.
 * Matches YouTube's view count formatting style.
 *
 * @param count - Number of views
 * @returns Formatted string (e.g., "1.2M views", "500K views")
 */
export const formatViewCount = (count: number): string => {
  if (count >= 1000000000) {
    return `${(count / 1000000000).toFixed(1)}B views`;
  }
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M views`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K views`;
  }
  return `${count} views`;
};

/**
 * Format a subscriber count with abbreviated suffixes.
 * Similar to view count but uses more decimal places for precision
 * at higher subscriber counts (e.g., 1.23M vs 1.2M).
 *
 * @param count - Number of subscribers
 * @returns Formatted string (e.g., "1.23M subscribers")
 */
export const formatSubscriberCount = (count: number): string => {
  if (count >= 1000000000) {
    return `${(count / 1000000000).toFixed(2)}B subscribers`;
  }
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(2)}M subscribers`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K subscribers`;
  }
  return `${count} subscribers`;
};

/**
 * Calculate a human-readable "time ago" string from a date.
 * Returns relative time like "3 days ago" or "2 months ago".
 * Used for video publish dates and comment timestamps.
 *
 * @param dateString - ISO date string (can be null)
 * @returns Relative time string (e.g., "5 hours ago", "Just now")
 */
export const timeAgo = (dateString: string | null): string => {
  if (!dateString) return '';

  const now = new Date();
  const past = new Date(dateString);
  const diffMs = now.getTime() - past.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  if (diffWeeks > 0) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMinutes > 0) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  return 'Just now';
};

/**
 * Format a file size in bytes to a human-readable string.
 * Uses KB, MB, GB suffixes with two decimal places.
 * Used in upload UI to show file sizes.
 *
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.50 MB", "256 KB")
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes >= 1073741824) {
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} bytes`;
};

/**
 * Generate a placeholder thumbnail SVG as a data URI.
 * Creates a simple gray rectangle with truncated title text.
 * Used when a video has no uploaded thumbnail.
 *
 * @param title - Video title to display on the placeholder
 * @returns Data URI string for the SVG image
 */
export const getPlaceholderThumbnail = (title: string): string => {
  // Return a simple data URI for placeholder
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <rect fill="#333" width="320" height="180"/>
      <text fill="#888" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle" dy=".3em">
        ${title.substring(0, 20)}${title.length > 20 ? '...' : ''}
      </text>
    </svg>
  `)}`;
};

/**
 * Truncate text to a maximum length with ellipsis.
 * Adds "..." when text exceeds the specified length.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum allowed length including ellipsis
 * @returns Original text or truncated text with "..."
 */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

/**
 * Generate an avatar image URL from a username.
 * Returns the provided avatarUrl if available, otherwise generates
 * an SVG avatar with the first letter of the username and a
 * deterministic background color based on the username.
 *
 * @param avatarUrl - Existing avatar URL (can be null)
 * @param username - Username for fallback avatar generation
 * @returns Avatar URL (either the provided one or a generated SVG data URI)
 */
export const getAvatarUrl = (avatarUrl: string | null, username: string): string => {
  if (avatarUrl) return avatarUrl;
  // Generate a simple avatar with first letter
  const letter = username.charAt(0).toUpperCase();
  const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
  const colorIndex = username.charCodeAt(0) % colors.length;
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <circle fill="${colors[colorIndex]}" cx="20" cy="20" r="20"/>
      <text fill="white" font-family="sans-serif" font-size="18" font-weight="bold" x="50%" y="50%" text-anchor="middle" dy=".35em">
        ${letter}
      </text>
    </svg>
  `)}`;
};
