import crypto from 'crypto';

/** Generates a SHA-256 based numeric hash for a URL, used as a deduplication key. */
export const hashUrl = (url: string): string => {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  // Convert first 16 hex chars to BigInt for storage
  return BigInt('0x' + hash.substring(0, 16)).toString();
};

/** Generates a SHA-256 based numeric hash for HTML content, used for duplicate detection. */
export const hashContent = (content: string): string => {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return BigInt('0x' + hash.substring(0, 16)).toString();
};

/** Extracts the hostname from a URL string, returning null on parse failure. */
export const extractDomain = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
};

/** Normalizes a URL by removing fragments and trailing slashes for consistent deduplication. */
export const normalizeUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    // Remove fragment
    parsed.hash = '';
    // Remove trailing slash (except for root)
    let normalized = parsed.href;
    if (normalized.endsWith('/') && parsed.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
};

/** Resolves a relative URL against a base URL, returning null on parse failure. */
export const toAbsoluteUrl = (relativeUrl: string, baseUrl: string): string | null => {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return null;
  }
};

/** Validates a URL for crawling: must be HTTP(S) and not a binary/media file extension. */
export const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    // Skip common file extensions we don't want to crawl
    const skipExtensions = [
      '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico',
      '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
      '.zip', '.tar', '.gz', '.rar', '.7z',
      '.mp3', '.mp4', '.avi', '.mov', '.wmv',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    ];
    const pathname = parsed.pathname.toLowerCase();
    for (const ext of skipExtensions) {
      if (pathname.endsWith(ext)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

/** Computes the Levenshtein edit distance between two strings for spell-check suggestions. */
export const editDistance = (str1: string, str2: string): number => {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + 1, // replace
          dp[i - 1][j] + 1,     // delete
          dp[i][j - 1] + 1      // insert
        );
      }
    }
  }

  return dp[m][n];
};

/** Formats a byte count into a human-readable string (e.g., "1.5 MB"). */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/** Returns a promise that resolves after the specified number of milliseconds. */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
