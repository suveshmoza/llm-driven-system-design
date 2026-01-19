/**
 * Room Manager Module
 *
 * Handles stream room lifecycle, including join/leave operations,
 * viewer count tracking, and Redis Pub/Sub subscriptions.
 *
 * @module services/wsGateway/room-manager
 */

import { redisSub, redis } from '../../utils/redis.js';
import { ExtendedWebSocket, ICommentBatcher, IReactionAggregator } from './types.js';
import { CommentBatcher, ReactionAggregator, broadcastToStream } from './broadcast.js';
import { commentService } from '../commentService.js';
import { logger, peakViewersGauge } from '../../shared/index.js';

const wsLogger = logger.child({ module: 'room-manager' });

/**
 * Manages stream rooms, including joining, leaving, and resource cleanup.
 */
export class RoomManager {
  /** Map of stream ID to connected clients */
  private connections: Map<string, Set<ExtendedWebSocket>>;

  /** Comment batchers per stream */
  private commentBatchers: Map<string, ICommentBatcher> = new Map();

  /** Reaction aggregators per stream */
  private reactionAggregators: Map<string, IReactionAggregator> = new Map();

  /** Peak viewer counts per stream */
  private peakViewers: Map<string, number> = new Map();

  constructor(connections: Map<string, Set<ExtendedWebSocket>>) {
    this.connections = connections;
  }

  /**
   * Adds a user to a stream room.
   * Sets up Redis subscriptions and batchers if this is the first viewer.
   */
  async joinStream(
    ws: ExtendedWebSocket,
    streamId: string,
    addConnection: (streamId: string, ws: ExtendedWebSocket) => void
  ): Promise<void> {
    const isFirstViewer = !this.connections.has(streamId);

    if (isFirstViewer) {
      await redisSub.subscribe(`stream:${streamId}:comments`);
      await redisSub.subscribe(`stream:${streamId}:reactions`);

      const batcher = new CommentBatcher(streamId);
      this.commentBatchers.set(streamId, batcher);
      batcher.start();

      const aggregator = new ReactionAggregator(streamId);
      this.reactionAggregators.set(streamId, aggregator);
      aggregator.start();
    }

    addConnection(streamId, ws);

    const viewerCount = this.connections.get(streamId)!.size;
    await redis.hset(`stream:${streamId}`, 'viewer_count', viewerCount.toString());

    // Track peak viewers
    const currentPeak = this.peakViewers.get(streamId) || 0;
    if (viewerCount > currentPeak) {
      this.peakViewers.set(streamId, viewerCount);
      peakViewersGauge.labels(streamId).set(viewerCount);
    }

    // Broadcast viewer count
    broadcastToStream(this.connections, streamId, {
      type: 'viewer_count',
      payload: { stream_id: streamId, count: viewerCount },
      timestamp: Date.now(),
    });

    // Send recent comments to the new viewer
    const recentComments = await commentService.getRecentComments(streamId, 50);
    ws.send(
      JSON.stringify({
        type: 'comments_batch',
        payload: { stream_id: streamId, comments: recentComments.reverse() },
        timestamp: Date.now(),
      })
    );

    wsLogger.info({ userId: ws.userId, streamId, viewers: viewerCount }, 'User joined stream');
  }

  /**
   * Removes a user from a stream room.
   * Cleans up resources when the last viewer leaves.
   */
  leaveStream(
    ws: ExtendedWebSocket,
    removeConnection: (streamId: string, ws: ExtendedWebSocket) => boolean
  ): void {
    if (!ws.streamId) return;

    const streamId = ws.streamId;
    const userId = ws.userId;
    const isEmpty = removeConnection(streamId, ws);

    if (isEmpty) {
      // Clean up when no viewers
      redisSub.unsubscribe(`stream:${streamId}:comments`);
      redisSub.unsubscribe(`stream:${streamId}:reactions`);

      const batcher = this.commentBatchers.get(streamId);
      if (batcher) {
        batcher.stop();
        this.commentBatchers.delete(streamId);
      }

      const aggregator = this.reactionAggregators.get(streamId);
      if (aggregator) {
        aggregator.stop();
        this.reactionAggregators.delete(streamId);
      }

      wsLogger.info({ streamId }, 'All viewers left, stream resources cleaned up');
    } else {
      // Update viewer count
      const viewerCount = this.connections.get(streamId)!.size;
      redis.hset(`stream:${streamId}`, 'viewer_count', viewerCount.toString());

      broadcastToStream(this.connections, streamId, {
        type: 'viewer_count',
        payload: { stream_id: streamId, count: viewerCount },
        timestamp: Date.now(),
      });
    }

    ws.streamId = undefined;
    ws.userId = undefined;

    wsLogger.debug({ userId, streamId }, 'User left stream');
  }

  /**
   * Gets the comment batcher for a stream.
   */
  getCommentBatcher(streamId: string): ICommentBatcher | undefined {
    return this.commentBatchers.get(streamId);
  }

  /**
   * Gets the reaction aggregator for a stream.
   */
  getReactionAggregator(streamId: string): IReactionAggregator | undefined {
    return this.reactionAggregators.get(streamId);
  }

  /**
   * Cleans up all batchers and aggregators during shutdown.
   */
  shutdown(): void {
    wsLogger.info('Flushing pending batches');

    this.commentBatchers.forEach((batcher, streamId) => {
      wsLogger.debug({ streamId }, 'Stopping comment batcher');
      batcher.stop();
    });

    this.reactionAggregators.forEach((aggregator, streamId) => {
      wsLogger.debug({ streamId }, 'Stopping reaction aggregator');
      aggregator.stop();
    });

    this.commentBatchers.clear();
    this.reactionAggregators.clear();
    this.peakViewers.clear();
  }
}
