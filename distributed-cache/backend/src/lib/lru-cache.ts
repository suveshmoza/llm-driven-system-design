/**
 * LRU (Least Recently Used) Cache with TTL support
 *
 * Features:
 * - O(1) get, set, delete operations
 * - TTL-based expiration (lazy + active)
 * - LRU eviction when max capacity is reached
 * - Memory tracking
 */

interface LRUCacheOptions {
  maxSize?: number;
  maxMemoryMB?: number;
  defaultTTL?: number;
}

interface CacheItem {
  key: string;
  value: unknown;
  size: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  prev: CacheItem | null;
  next: CacheItem | null;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  expirations: number;
  currentSize: number;
  currentMemoryBytes: number;
}

export class LRUCache {
  private maxSize: number;
  private maxMemoryMB: number;
  private defaultTTL: number;
  cache: Map<string, CacheItem>;
  private head: CacheItem;
  private tail: CacheItem;
  private stats: CacheStats;
  private expirationInterval: ReturnType<typeof setInterval>;

  constructor(options: LRUCacheOptions = {}) {
    this.maxSize = options.maxSize || 10000; // Max number of entries
    this.maxMemoryMB = options.maxMemoryMB || 100; // Max memory in MB
    this.defaultTTL = options.defaultTTL || 0; // Default TTL in seconds (0 = no expiration)

    // Main storage: key -> { value, size, expiresAt, prev, next }
    this.cache = new Map();

    // Doubly-linked list for LRU tracking
    this.head = { key: '__HEAD__', value: null, size: 0, expiresAt: 0, createdAt: 0, updatedAt: 0, prev: null, next: null }; // Most recently used
    this.tail = { key: '__TAIL__', value: null, size: 0, expiresAt: 0, createdAt: 0, updatedAt: 0, prev: null, next: null }; // Least recently used
    this.head.next = this.tail;
    this.tail.prev = this.head;

    // Stats
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      expirations: 0,
      currentSize: 0,
      currentMemoryBytes: 0,
    };

    // Start active expiration cycle
    this.expirationInterval = setInterval(() => this._expireCycle(), 1000);
  }

  /**
   * Estimate the size of a value in bytes
   */
  _estimateSize(value: unknown): number {
    const str = JSON.stringify(value);
    // Rough estimate: 2 bytes per character for UTF-16
    return str.length * 2;
  }

  /**
   * Move a node to the head (most recently used)
   */
  _moveToHead(node: CacheItem): void {
    // Remove from current position
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }

    // Insert at head
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  /**
   * Remove the tail node (least recently used)
   */
  _removeTail(): CacheItem | null {
    const node = this.tail.prev;
    if (node === this.head) {
      return null;
    }

    node!.prev!.next = this.tail;
    this.tail.prev = node!.prev;

    return node;
  }

  /**
   * Remove a specific node from the list
   */
  _removeNode(node: CacheItem): void {
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
  }

  /**
   * Check if an item is expired
   */
  _isExpired(item: CacheItem): boolean {
    return item.expiresAt !== 0 && Date.now() > item.expiresAt;
  }

  /**
   * Evict entries until we're under limits
   */
  _evict(): void {
    while (
      (this.cache.size > this.maxSize ||
        this.stats.currentMemoryBytes > this.maxMemoryMB * 1024 * 1024) &&
      this.cache.size > 0
    ) {
      const node = this._removeTail();
      if (node && node.key !== '__HEAD__' && node.key !== '__TAIL__') {
        const item = this.cache.get(node.key);
        if (item) {
          this.stats.currentMemoryBytes -= item.size;
          this.cache.delete(node.key);
          this.stats.evictions++;
        }
      }
    }
  }

  /**
   * Active expiration cycle - samples random keys and expires them
   */
  _expireCycle(): void {
    const keys = Array.from(this.cache.keys());
    if (keys.length === 0) return;

    // Sample up to 20 random keys
    const sampleSize = Math.min(20, keys.length);
    const sampled: string[] = [];

    for (let i = 0; i < sampleSize; i++) {
      const randomIndex = Math.floor(Math.random() * keys.length);
      sampled.push(keys[randomIndex]);
    }

    let expired = 0;
    for (const key of sampled) {
      const item = this.cache.get(key);
      if (item && this._isExpired(item)) {
        this._deleteInternal(key);
        expired++;
        this.stats.expirations++;
      }
    }

    // If > 25% were expired, run again (but limit recursion)
    if (expired / sampleSize > 0.25 && sampleSize > 5) {
      setImmediate(() => this._expireCycle());
    }
  }

  /**
   * Internal delete without stats update
   */
  _deleteInternal(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    this._removeNode(item);
    this.stats.currentMemoryBytes -= item.size;
    this.stats.currentSize--;
    this.cache.delete(key);

    return true;
  }

  /**
   * Get a value from the cache
   */
  get(key: string): unknown {
    const item = this.cache.get(key);

    if (!item) {
      this.stats.misses++;
      return undefined;
    }

    // Lazy expiration
    if (this._isExpired(item)) {
      this._deleteInternal(key);
      this.stats.expirations++;
      this.stats.misses++;
      return undefined;
    }

    // Move to head (most recently used)
    this._moveToHead(item);
    this.stats.hits++;

    return item.value;
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: unknown, ttl = 0): boolean {
    const size = this._estimateSize(value) + key.length * 2;

    // Calculate expiration
    let expiresAt = 0;
    if (ttl > 0) {
      expiresAt = Date.now() + ttl * 1000;
    } else if (ttl === 0 && this.defaultTTL > 0) {
      expiresAt = Date.now() + this.defaultTTL * 1000;
    }

    // Check if key already exists
    const existing = this.cache.get(key);
    if (existing) {
      // Update existing entry
      this.stats.currentMemoryBytes -= existing.size;
      existing.value = value;
      existing.size = size;
      existing.expiresAt = expiresAt;
      existing.updatedAt = Date.now();
      this.stats.currentMemoryBytes += size;
      this._moveToHead(existing);
    } else {
      // Create new entry
      const item: CacheItem = {
        key,
        value,
        size,
        expiresAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        prev: null,
        next: null,
      };

      this.cache.set(key, item);
      this.stats.currentMemoryBytes += size;
      this.stats.currentSize++;

      // Insert at head
      this._moveToHead(item);

      // Evict if necessary
      this._evict();
    }

    this.stats.sets++;
    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    const result = this._deleteInternal(key);
    if (result) {
      this.stats.deletes++;
    }
    return result;
  }

  /**
   * Check if a key exists (without updating LRU order)
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    if (this._isExpired(item)) {
      this._deleteInternal(key);
      this.stats.expirations++;
      return false;
    }

    return true;
  }

  /**
   * Get the TTL remaining for a key in seconds
   */
  ttl(key: string): number {
    const item = this.cache.get(key);
    if (!item) return -2;

    if (this._isExpired(item)) {
      this._deleteInternal(key);
      return -2;
    }

    if (item.expiresAt === 0) return -1;

    return Math.max(0, Math.ceil((item.expiresAt - Date.now()) / 1000));
  }

  /**
   * Set TTL on an existing key
   */
  expire(key: string, ttl: number): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    if (this._isExpired(item)) {
      this._deleteInternal(key);
      return false;
    }

    item.expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : 0;
    return true;
  }

  /**
   * Increment a numeric value
   */
  incr(key: string, delta = 1): number | null {
    const value = this.get(key);

    if (value === undefined) {
      this.set(key, delta);
      return delta;
    }

    if (typeof value !== 'number') {
      return null;
    }

    const newValue = value + delta;
    const item = this.cache.get(key);
    if (item) {
      item.value = newValue;
      item.size = this._estimateSize(newValue) + key.length * 2;
    }

    return newValue;
  }

  /**
   * Get all keys (optionally matching a pattern)
   */
  keys(pattern = '*'): string[] {
    const allKeys: string[] = [];

    for (const [key, item] of this.cache) {
      if (!this._isExpired(item)) {
        if (pattern === '*') {
          allKeys.push(key);
        } else {
          // Simple pattern matching
          const regex = new RegExp(
            '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
          );
          if (regex.test(key)) {
            allKeys.push(key);
          }
        }
      }
    }

    return allKeys;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.stats.currentSize = 0;
    this.stats.currentMemoryBytes = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate =
      this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
        : 0;

    return {
      ...this.stats,
      hitRate: hitRate.toFixed(2),
      size: this.cache.size,
      memoryMB: (this.stats.currentMemoryBytes / (1024 * 1024)).toFixed(2),
      maxSize: this.maxSize,
      maxMemoryMB: this.maxMemoryMB,
    };
  }

  /**
   * Get detailed info about a key
   */
  getKeyInfo(key: string) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (this._isExpired(item)) {
      this._deleteInternal(key);
      return null;
    }

    return {
      key,
      valueType: typeof item.value,
      valuePreview:
        typeof item.value === 'string'
          ? item.value.substring(0, 100)
          : JSON.stringify(item.value).substring(0, 100),
      sizeBytes: item.size,
      ttl: item.expiresAt === 0 ? -1 : Math.ceil((item.expiresAt - Date.now()) / 1000),
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    };
  }

  /**
   * Stop the expiration cycle (for cleanup)
   */
  destroy(): void {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
    }
  }
}

export default LRUCache;
