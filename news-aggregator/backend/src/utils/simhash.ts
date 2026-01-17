/**
 * SimHash implementation for near-duplicate detection.
 *
 * SimHash creates a fingerprint that's similar for similar documents.
 * Articles with Hamming distance < 3 are considered duplicates.
 * This is essential for clustering related articles into stories
 * and avoiding duplicate content in the feed.
 */

/**
 * Compute a 64-bit FNV-1a hash of a string.
 * FNV-1a provides good distribution and is fast for short strings.
 * @param str - The string to hash
 * @returns 64-bit hash value as bigint
 */
function hash64(str: string): bigint {
  let hash = 14695981039346656037n;
  const fnvPrime = 1099511628211n;

  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * fnvPrime) & 0xFFFFFFFFFFFFFFFFn;
  }

  return hash;
}

/**
 * Tokenize text into lowercase words, filtering short words.
 * Removes punctuation and splits on whitespace.
 * @param text - Raw text to tokenize
 * @returns Array of cleaned word tokens (length > 2)
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2);
}

/**
 * Generate n-grams (word sequences) from tokens.
 * N-grams capture phrase-level similarity beyond individual words.
 * @param tokens - Array of word tokens
 * @param n - Size of each n-gram (default: 3 for trigrams)
 * @returns Array of n-gram strings (words joined with spaces)
 */
function getNgrams(tokens: string[], n: number = 3): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/**
 * Compute SimHash fingerprint for text content.
 * Creates a 64-bit fingerprint where similar texts produce similar fingerprints.
 * Uses both unigrams and trigrams for better accuracy.
 * @param text - The text content to fingerprint
 * @returns 64-bit SimHash fingerprint as bigint
 */
export function computeSimHash(text: string): bigint {
  const tokens = tokenize(text);

  // Use both unigrams and trigrams for better accuracy
  const features = [...tokens, ...getNgrams(tokens, 3)];

  if (features.length === 0) {
    return 0n;
  }

  const hashes = features.map(t => hash64(t));

  // Create weighted bit vector
  const vector = new Array(64).fill(0);

  for (const h of hashes) {
    for (let i = 0; i < 64; i++) {
      if ((h >> BigInt(i)) & 1n) {
        vector[i]++;
      } else {
        vector[i]--;
      }
    }
  }

  // Convert to fingerprint
  let fingerprint = 0n;
  for (let i = 0; i < 64; i++) {
    if (vector[i] > 0) {
      fingerprint |= (1n << BigInt(i));
    }
  }

  return fingerprint;
}

/**
 * Calculate Hamming distance between two fingerprints.
 * Counts the number of bit positions where the fingerprints differ.
 * Lower distance means more similar content.
 * @param a - First fingerprint
 * @param b - Second fingerprint
 * @returns Number of differing bits (0-64)
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

/**
 * Check if two fingerprints are similar (likely near-duplicates).
 * Uses Hamming distance with configurable threshold.
 * @param fp1 - First fingerprint
 * @param fp2 - Second fingerprint
 * @param threshold - Maximum Hamming distance for similarity (default: 3)
 * @returns True if fingerprints are within threshold distance
 */
export function areSimilar(fp1: bigint, fp2: bigint, threshold: number = 3): boolean {
  return hammingDistance(fp1, fp2) < threshold;
}

/**
 * Find similar fingerprints from a list of candidates.
 * Useful for finding existing stories that match a new article.
 * @param target - The fingerprint to match against
 * @param candidates - Array of {id, fingerprint} objects to search
 * @param threshold - Maximum Hamming distance for similarity (default: 3)
 * @returns Array of matching candidates with their distances, sorted by similarity
 */
export function findSimilar(
  target: bigint,
  candidates: { id: string; fingerprint: bigint }[],
  threshold: number = 3
): { id: string; distance: number }[] {
  return candidates
    .map(c => ({
      id: c.id,
      distance: hammingDistance(target, c.fingerprint),
    }))
    .filter(c => c.distance < threshold)
    .sort((a, b) => a.distance - b.distance);
}
