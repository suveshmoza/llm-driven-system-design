/**
 * HTTP request utilities for communicating with cache nodes
 */

import type { NodeRequestResult, NodeRequestFn } from './types.js';

/**
 * Create a node request function with configurable timeout
 */
export function createNodeRequest(timeoutMs = 5000): NodeRequestFn {
  return async function nodeRequest(
    nodeUrl: string,
    path: string,
    options: RequestInit = {}
  ): Promise<NodeRequestResult> {
    const url = `${nodeUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: 'Unknown error' }));
        return { success: false, status: response.status, error };
      }

      const data = await response.json();
      return { success: true, data, status: response.status };
    } catch (error: unknown) {
      clearTimeout(timeout);
      return { success: false, error: (error as Error).message };
    }
  };
}
