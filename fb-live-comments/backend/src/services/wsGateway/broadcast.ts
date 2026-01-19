/**
 * Broadcast Module
 *
 * Handles message batching and broadcasting to stream viewers.
 * Includes CommentBatcher and ReactionAggregator for efficient delivery.
 *
 * @module services/wsGateway/broadcast
 */

import { WebSocket } from 'ws';
import { redisPub } from '../../utils/redis.js';
import { ExtendedWebSocket, ICommentBatcher, IReactionAggregator } from './types.js';
import { CommentWithUser, ReactionCount, WSMessage } from '../../types/index.js';
import { logger } from '../../shared/index.js';

const _wsLogger = logger.child({ module: 'broadcast' });

/**
 * Broadcasts a message to all clients in a stream.
 */
export function broadcastToStream(
  connections: Map<string, Set<ExtendedWebSocket>>,
  streamId: string,
  message: WSMessage
): void {
  const streamConnections = connections.get(streamId);
  if (!streamConnections) return;

  const data = JSON.stringify(message);
  streamConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

/**
 * Sends an error message to a client.
 */
export function sendError(ws: WebSocket, code: string, message: string): void {
  ws.send(
    JSON.stringify({
      type: 'error',
      payload: { code, message },
      timestamp: Date.now(),
    })
  );
}

/**
 * CommentBatcher - Batches comments for efficient delivery
 *
 * Instead of sending each comment individually, we batch them
 * and send every 100ms. This reduces WebSocket message overhead
 * and helps handle high-volume streams.
 */
export class CommentBatcher implements ICommentBatcher {
  /** Stream this batcher is associated with */
  private streamId: string;

  /** Buffer holding comments awaiting delivery */
  private buffer: CommentWithUser[] = [];

  /** Timer for periodic flushing */
  private intervalId: NodeJS.Timeout | null = null;

  /** Interval between batch deliveries in milliseconds */
  private batchInterval: number;

  constructor(streamId: string) {
    this.streamId = streamId;
    this.batchInterval = parseInt(process.env.COMMENT_BATCH_INTERVAL_MS || '100', 10);
  }

  /**
   * Adds a comment to the batch buffer.
   */
  addComment(comment: CommentWithUser): void {
    this.buffer.push(comment);
  }

  /**
   * Starts the periodic flush timer.
   */
  start(): void {
    this.intervalId = setInterval(() => {
      this.flush();
    }, this.batchInterval);
  }

  /**
   * Stops the periodic flush timer and delivers any remaining comments.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.flush();
  }

  /**
   * Flushes the buffer by publishing to Redis for cross-instance delivery.
   */
  private flush(): void {
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];

    redisPub.publish(
      `stream:${this.streamId}:comments`,
      JSON.stringify({ stream_id: this.streamId, comments: batch })
    );
  }
}

/**
 * ReactionAggregator - Aggregates reactions for efficient delivery
 *
 * Reactions are very high volume (thousands per second).
 * We aggregate counts and send every 500ms.
 */
export class ReactionAggregator implements IReactionAggregator {
  /** Stream this aggregator is associated with */
  private streamId: string;

  /** Aggregated counts by reaction type awaiting delivery */
  private counts: ReactionCount = {};

  /** Timer for periodic flushing */
  private intervalId: NodeJS.Timeout | null = null;

  /** Interval between batch deliveries in milliseconds */
  private batchInterval: number;

  constructor(streamId: string) {
    this.streamId = streamId;
    this.batchInterval = parseInt(process.env.REACTION_BATCH_INTERVAL_MS || '500', 10);
  }

  /**
   * Adds a reaction to the aggregation.
   */
  addReaction(type: string): void {
    this.counts[type] = (this.counts[type] || 0) + 1;
  }

  /**
   * Starts the periodic flush timer.
   */
  start(): void {
    this.intervalId = setInterval(() => {
      this.flush();
    }, this.batchInterval);
  }

  /**
   * Stops the periodic flush timer and delivers any remaining reactions.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.flush();
  }

  /**
   * Flushes aggregated counts by publishing to Redis for cross-instance delivery.
   */
  private flush(): void {
    if (Object.keys(this.counts).length === 0) return;

    const batch = this.counts;
    this.counts = {};

    redisPub.publish(
      `stream:${this.streamId}:reactions`,
      JSON.stringify({ stream_id: this.streamId, counts: batch })
    );
  }
}
