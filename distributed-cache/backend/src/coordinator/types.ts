/**
 * Shared types for the coordinator module
 */

import type { ConsistentHashRing } from '../lib/consistent-hash.js';

/**
 * Result of an HTTP request to a cache node
 */
export interface NodeRequestResult {
  success: boolean;
  data?: unknown;
  status?: number;
  error?: unknown;
}

/**
 * Function type for making requests to cache nodes
 */
export type NodeRequestFn = (
  nodeUrl: string,
  path: string,
  options?: RequestInit
) => Promise<NodeRequestResult>;

/**
 * Cache statistics from a single node
 */
export interface NodeStats {
  nodeUrl: string;
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  size: number;
  memoryMB: string;
  hotKeys?: HotKey[];
}

/**
 * Hot key information
 */
export interface HotKey {
  key: string;
  count: number;
  node?: string;
}

/**
 * Result of fetching hot keys from a node
 */
export interface NodeHotKeysResult {
  nodeUrl: string;
  hotKeys: HotKey[];
}

/**
 * Result of fetching keys from a node
 */
export interface KeysResult {
  nodeUrl: string;
  keys: string[];
}

/**
 * Status of a cache node
 */
export interface NodeStatusInfo {
  url: string;
  healthy: boolean;
  nodeId?: string;
  uptime?: number;
  cache?: unknown;
  error?: string;
  lastCheck: string;
  consecutiveFailures: number;
}

/**
 * Configuration for the coordinator
 */
export interface CoordinatorConfig {
  port: number | string;
  nodes: string[];
  healthCheckInterval: number;
  virtualNodes: number;
  gracefulRebalance: boolean;
}

/**
 * Coordinator context shared across modules
 */
export interface CoordinatorContext {
  config: CoordinatorConfig;
  ring: ConsistentHashRing;
  nodeStatus: Map<string, NodeStatusInfo>;
  nodeRequest: NodeRequestFn;
}
