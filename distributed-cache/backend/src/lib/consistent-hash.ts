/**
 * Consistent Hash Ring implementation with virtual nodes
 *
 * This implements consistent hashing as described in the system design:
 * - Nodes and keys are hashed onto a ring (0 to 2^32-1)
 * - Key is assigned to the first node clockwise from its position
 * - Virtual nodes ensure even distribution
 */

import crypto from 'crypto';

export class ConsistentHashRing {
  private ring: Map<number, string>;
  private sortedHashes: number[];
  private virtualNodes: number;
  private nodes: Set<string>;

  constructor(virtualNodes = 150) {
    this.ring = new Map(); // hash -> node
    this.sortedHashes = [];
    this.virtualNodes = virtualNodes;
    this.nodes = new Set();
  }

  /**
   * Hash a string to a 32-bit integer
   */
  _hash(key: string): number {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  /**
   * Add a node to the ring with virtual nodes
   */
  addNode(nodeId: string): void {
    if (this.nodes.has(nodeId)) {
      return; // Node already exists
    }

    this.nodes.add(nodeId);

    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${nodeId}:vn${i}`;
      const hashVal = this._hash(virtualKey);
      this.ring.set(hashVal, nodeId);
      this.sortedHashes.push(hashVal);
    }

    // Keep sorted for binary search
    this.sortedHashes.sort((a: number, b: number) => a - b);
  }

  /**
   * Remove a node from the ring
   */
  removeNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      return;
    }

    this.nodes.delete(nodeId);

    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${nodeId}:vn${i}`;
      const hashVal = this._hash(virtualKey);
      this.ring.delete(hashVal);
      const index = this.sortedHashes.indexOf(hashVal);
      if (index > -1) {
        this.sortedHashes.splice(index, 1);
      }
    }
  }

  /**
   * Get the node responsible for a key
   */
  getNode(key: string): string | null {
    if (this.ring.size === 0) {
      return null;
    }

    const hashVal = this._hash(key);

    // Binary search for the first hash >= key hash
    let left = 0;
    let right = this.sortedHashes.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.sortedHashes[mid] < hashVal) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // Wrap around to the beginning if past the end
    if (left === this.sortedHashes.length) {
      left = 0;
    }

    return this.ring.get(this.sortedHashes[left]) ?? null;
  }

  /**
   * Get multiple nodes for replication (returns n distinct nodes)
   */
  getNodes(key: string, n = 3): string[] {
    if (this.ring.size === 0) {
      return [];
    }

    const nodes: string[] = [];
    const seen = new Set<string>();
    const hashVal = this._hash(key);

    // Binary search for starting position
    let left = 0;
    let right = this.sortedHashes.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.sortedHashes[mid] < hashVal) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // Collect n unique nodes
    let idx = left;
    while (nodes.length < n && seen.size < this.nodes.size) {
      if (idx >= this.sortedHashes.length) {
        idx = 0;
      }

      const nodeId = this.ring.get(this.sortedHashes[idx]);
      if (nodeId && !seen.has(nodeId)) {
        seen.add(nodeId);
        nodes.push(nodeId);
      }

      idx++;
    }

    return nodes;
  }

  /**
   * Get all nodes in the ring
   */
  getAllNodes(): string[] {
    return Array.from(this.nodes);
  }

  /**
   * Get the number of nodes in the ring
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Get the distribution of keys across nodes (for debugging/monitoring)
   */
  getDistribution(keys: string[]): Map<string, number> {
    const distribution = new Map<string, number>();

    for (const nodeId of this.nodes) {
      distribution.set(nodeId, 0);
    }

    for (const key of keys) {
      const nodeId = this.getNode(key);
      if (nodeId) {
        distribution.set(nodeId, (distribution.get(nodeId) || 0) + 1);
      }
    }

    return distribution;
  }
}

export default ConsistentHashRing;
