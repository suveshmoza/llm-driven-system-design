/**
 * Formats a byte count into a human-readable string with appropriate units.
 *
 * Automatically selects the most appropriate unit (B, KB, MB, GB, TB)
 * based on the magnitude of the value.
 *
 * @param bytes - Number of bytes to format
 * @returns Formatted string like "1.5 MB" or "256 KB"
 *
 * @example
 * formatBytes(0)         // "0 B"
 * formatBytes(1024)      // "1 KB"
 * formatBytes(1536)      // "1.5 KB"
 * formatBytes(1048576)   // "1 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formats a date into a localized short date string.
 *
 * Uses en-US locale with abbreviated month format (e.g., "Jan 15, 2024").
 *
 * @param date - Date object or ISO date string to format
 * @returns Formatted date string like "Jan 15, 2024"
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a date into a localized date and time string.
 *
 * Includes both date and time components for precise timestamps.
 *
 * @param date - Date object or ISO date string to format
 * @returns Formatted string like "Jan 15, 2024, 2:30 PM"
 */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a date as a human-readable relative time string.
 *
 * Shows "Just now", "X minutes ago", "X hours ago", "X days ago",
 * or falls back to a formatted date for older timestamps.
 *
 * @param date - Date object or ISO date string to format
 * @returns Relative time string like "5 minutes ago" or "2 days ago"
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return formatDate(d);
  } else if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
}

/**
 * Returns an icon type identifier based on the file's MIME type.
 *
 * Maps MIME types to icon categories for display in the file browser.
 * Returns 'folder' for directories, specific types for known formats,
 * or 'file' as a fallback.
 *
 * @param mimeType - MIME type string (e.g., "image/jpeg")
 * @param isFolder - Whether the file is a directory
 * @returns Icon type identifier ('folder', 'image', 'video', 'pdf', etc.)
 */
export function getFileIcon(mimeType?: string, isFolder?: boolean): string {
  if (isFolder) return 'folder';

  if (!mimeType) return 'file';

  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'doc';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'spreadsheet';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return 'archive';
  if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('xml'))
    return 'text';

  return 'file';
}

/**
 * Extracts the file extension from a filename.
 *
 * Returns an empty string if no extension is found.
 *
 * @param fileName - Name of the file (e.g., "document.pdf")
 * @returns Lowercase extension without the dot (e.g., "pdf")
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Determines the MIME type of a file based on its extension.
 *
 * Contains mappings for common file types including images, documents,
 * text files, archives, and media. Falls back to 'application/octet-stream'
 * for unknown extensions.
 *
 * @param fileName - Name of the file (e.g., "photo.jpg")
 * @returns MIME type string (e.g., "image/jpeg")
 */
export function getMimeType(fileName: string): string {
  const ext = getFileExtension(fileName);
  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    txt: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'application/typescript',
    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    // Media
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Generates a friendly device name based on browser and OS detection.
 *
 * Combines the detected browser name with the operating system
 * to create a human-readable device identifier.
 *
 * @returns Device name string like "Chrome on Mac" or "Safari on iOS"
 */
export function generateDeviceName(): string {
  const browser = getBrowserName();
  const os = getOSName();
  return `${browser} on ${os}`;
}

/**
 * Detects the user's browser from the user agent string.
 *
 * Checks for common browsers in order of specificity since some
 * browsers include multiple browser names in their UA strings.
 *
 * @returns Browser name (Chrome, Firefox, Safari, Edge, Opera, or Browser)
 */
function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  if (ua.includes('Opera')) return 'Opera';
  return 'Browser';
}

/**
 * Detects the user's operating system from the user agent string.
 *
 * @returns OS name (Windows, Mac, Linux, Android, iOS, or Unknown)
 */
function getOSName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'Mac';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Unknown';
}

/**
 * Creates a debounced version of a function.
 *
 * The debounced function delays invoking the provided function until
 * after the specified delay has elapsed since the last invocation.
 * Useful for handling rapid events like typing or resizing.
 *
 * @template T - The function type
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function that delays execution
 *
 * @example
 * const debouncedSearch = debounce(search, 300);
 * inputElement.addEventListener('input', () => debouncedSearch(input.value));
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Creates a throttled version of a function.
 *
 * The throttled function invokes the provided function at most once
 * per specified time period, ignoring subsequent calls during the cooldown.
 * Useful for rate-limiting scroll handlers or API calls.
 *
 * @template T - The function type
 * @param fn - Function to throttle
 * @param limit - Minimum time between invocations in milliseconds
 * @returns Throttled function that limits execution frequency
 *
 * @example
 * const throttledScroll = throttle(onScroll, 100);
 * window.addEventListener('scroll', throttledScroll);
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
