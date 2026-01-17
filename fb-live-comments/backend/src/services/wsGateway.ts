/**
 * WebSocket Gateway Module
 *
 * Manages real-time bidirectional communication with clients for live comments
 * and reactions. Handles connection lifecycle, message routing, and coordinates
 * with Redis Pub/Sub for horizontal scaling across multiple server instances.
 *
 * Key features:
 * - Comment batching to reduce message overhead
 * - Reaction aggregation for high-volume updates
 * - Heartbeat monitoring for connection health
 * - Redis Pub/Sub for multi-instance synchronization
 *
 * @module services/wsGateway
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { redisSub, redisPub, redis } from '../utils/redis.js';
import { commentService } from './commentService.js';
import { reactionService } from './reactionService.js';
import { userService } from './userService.js';
import {
  WSMessage,
  WSMessageType,
  CommentWithUser,
  ReactionCount,
  JoinStreamPayload,
  PostCommentPayload,
  ReactPayload,
} from '../types/index.js';

/**
 * Extended WebSocket interface with stream session data.
 * Tracks which stream and user are associated with each connection.
 */
interface ExtendedWebSocket extends WebSocket {
  /** Currently joined stream ID */
  streamId?: string;
  /** Authenticated user ID */
  userId?: string;
  /** Heartbeat status for connection health monitoring */
  isAlive?: boolean;
}

/**
 * WebSocket Gateway for real-time communication.
 * Manages connections, message routing, and coordinates batching/aggregation.
 */
export class WebSocketGateway {
  /** WebSocket server instance */
  private wss: WebSocketServer;

  /** Map of stream ID to connected clients for efficient broadcasting */
  private connections: Map<string, Set<ExtendedWebSocket>> = new Map();

  /** Comment batchers per stream for efficient delivery */
  private commentBatchers: Map<string, CommentBatcher> = new Map();

  /** Reaction aggregators per stream for high-volume handling */
  private reactionAggregators: Map<string, ReactionAggregator> = new Map();

  /**
   * Creates a new WebSocket gateway attached to an HTTP server.
   * Initializes WebSocket handling, Redis Pub/Sub, and heartbeat monitoring.
   *
   * @param server - HTTP server to attach WebSocket server to
   */
  constructor(server: unknown) {
    this.wss = new WebSocketServer({ server: server as Parameters<typeof WebSocketServer>[0]['server'] });
    this.setupWebSocket();
    this.setupRedisPubSub();
    this.startHeartbeat();
  }

  /**
   * Sets up WebSocket event handlers for new connections.
   * Handles connection, message, close, and error events.
   */
  private setupWebSocket(): void {
    this.wss.on('connection', (ws: ExtendedWebSocket, req: IncomingMessage) => {
      console.log('New WebSocket connection from:', req.socket.remoteAddress);

      ws.isAlive = true;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('Error handling message:', error);
          this.sendError(ws, 'INVALID_MESSAGE', 'Failed to parse message');
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.handleDisconnect(ws);
      });
    });
  }

  /**
   * Sets up Redis Pub/Sub listeners for cross-instance message distribution.
   * Subscribes to comment and reaction channels per stream.
   */
  private setupRedisPubSub(): void {
    redisSub.on('message', (channel: string, message: string) => {
      // Channel format: stream:{streamId}:comments or stream:{streamId}:reactions
      const parts = channel.split(':');
      if (parts.length < 3) return;

      const streamId = parts[1];
      const type = parts[2];

      if (type === 'comments') {
        this.broadcastToStream(streamId, {
          type: 'comments_batch',
          payload: JSON.parse(message),
          timestamp: Date.now(),
        });
      } else if (type === 'reactions') {
        this.broadcastToStream(streamId, {
          type: 'reactions_batch',
          payload: JSON.parse(message),
          timestamp: Date.now(),
        });
      }
    });
  }

  /**
   * Starts the heartbeat monitoring interval.
   * Terminates connections that fail to respond to pings within 30 seconds.
   */
  private startHeartbeat(): void {
    setInterval(() => {
      this.wss.clients.forEach((ws: ExtendedWebSocket) => {
        if (ws.isAlive === false) {
          this.handleDisconnect(ws);
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  /**
   * Routes incoming WebSocket messages to appropriate handlers.
   *
   * @param ws - Client WebSocket connection
   * @param message - Parsed WebSocket message
   */
  private async handleMessage(ws: ExtendedWebSocket, message: WSMessage): Promise<void> {
    switch (message.type) {
      case 'join_stream':
        await this.handleJoinStream(ws, message.payload as JoinStreamPayload);
        break;
      case 'leave_stream':
        this.handleLeaveStream(ws);
        break;
      case 'post_comment':
        await this.handlePostComment(ws, message.payload as PostCommentPayload);
        break;
      case 'react':
        await this.handleReaction(ws, message.payload as ReactPayload);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        this.sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handles a user joining a stream.
   * Sets up subscriptions, initializes batchers, and sends initial data.
   *
   * @param ws - Client WebSocket connection
   * @param payload - Join request with stream_id and user_id
   */
  private async handleJoinStream(ws: ExtendedWebSocket, payload: JoinStreamPayload): Promise<void> {
    const { stream_id, user_id } = payload;

    // Check if user is banned
    const isBanned = await userService.isBanned(user_id, stream_id);
    if (isBanned) {
      this.sendError(ws, 'BANNED', 'You are banned from this stream');
      return;
    }

    // Leave previous stream if any
    if (ws.streamId) {
      this.handleLeaveStream(ws);
    }

    ws.streamId = stream_id;
    ws.userId = user_id;

    // Add to connections
    if (!this.connections.has(stream_id)) {
      this.connections.set(stream_id, new Set());
      await redisSub.subscribe(`stream:${stream_id}:comments`);
      await redisSub.subscribe(`stream:${stream_id}:reactions`);
    }
    this.connections.get(stream_id)!.add(ws);

    // Initialize batcher and aggregator if needed
    if (!this.commentBatchers.has(stream_id)) {
      const batcher = new CommentBatcher(stream_id);
      this.commentBatchers.set(stream_id, batcher);
      batcher.start();
    }

    if (!this.reactionAggregators.has(stream_id)) {
      const aggregator = new ReactionAggregator(stream_id);
      this.reactionAggregators.set(stream_id, aggregator);
      aggregator.start();
    }

    // Update viewer count
    const viewerCount = this.connections.get(stream_id)!.size;
    await redis.hset(`stream:${stream_id}`, 'viewer_count', viewerCount.toString());

    // Broadcast viewer count
    this.broadcastToStream(stream_id, {
      type: 'viewer_count',
      payload: { stream_id, count: viewerCount },
      timestamp: Date.now(),
    });

    // Send recent comments to the new viewer
    const recentComments = await commentService.getRecentComments(stream_id, 50);
    ws.send(
      JSON.stringify({
        type: 'comments_batch',
        payload: { stream_id, comments: recentComments.reverse() },
        timestamp: Date.now(),
      })
    );

    console.log(`User ${user_id} joined stream ${stream_id}. Viewers: ${viewerCount}`);
  }

  /**
   * Handles a user leaving a stream.
   * Cleans up subscriptions and batchers when no viewers remain.
   *
   * @param ws - Client WebSocket connection
   */
  private handleLeaveStream(ws: ExtendedWebSocket): void {
    if (!ws.streamId) return;

    const streamId = ws.streamId;
    const connections = this.connections.get(streamId);

    if (connections) {
      connections.delete(ws);

      if (connections.size === 0) {
        // Clean up when no viewers
        this.connections.delete(streamId);
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
      } else {
        // Update viewer count
        const viewerCount = connections.size;
        redis.hset(`stream:${streamId}`, 'viewer_count', viewerCount.toString());
        this.broadcastToStream(streamId, {
          type: 'viewer_count',
          payload: { stream_id: streamId, count: viewerCount },
          timestamp: Date.now(),
        });
      }
    }

    ws.streamId = undefined;
    ws.userId = undefined;
  }

  /**
   * Handles a new comment submission from a client.
   * Validates the request and adds to the comment batcher for delivery.
   *
   * @param ws - Client WebSocket connection
   * @param payload - Comment content and metadata
   */
  private async handlePostComment(ws: ExtendedWebSocket, payload: PostCommentPayload): Promise<void> {
    if (!ws.streamId || !ws.userId) {
      this.sendError(ws, 'NOT_IN_STREAM', 'You must join a stream first');
      return;
    }

    if (ws.streamId !== payload.stream_id || ws.userId !== payload.user_id) {
      this.sendError(ws, 'INVALID_REQUEST', 'Stream or user mismatch');
      return;
    }

    try {
      const comment = await commentService.createComment(
        payload.stream_id,
        payload.user_id,
        payload.content,
        payload.parent_id
      );

      // Add to batcher for fan-out
      const batcher = this.commentBatchers.get(payload.stream_id);
      if (batcher) {
        batcher.addComment(comment);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to post comment';
      this.sendError(ws, 'POST_FAILED', message);
    }
  }

  /**
   * Handles a reaction submission from a client.
   * Adds to the reaction aggregator for batched delivery.
   *
   * @param ws - Client WebSocket connection
   * @param payload - Reaction type and target
   */
  private async handleReaction(ws: ExtendedWebSocket, payload: ReactPayload): Promise<void> {
    if (!ws.streamId || !ws.userId) {
      this.sendError(ws, 'NOT_IN_STREAM', 'You must join a stream first');
      return;
    }

    try {
      await reactionService.addReaction(
        payload.stream_id,
        payload.user_id,
        payload.reaction_type,
        payload.comment_id
      );

      // Add to aggregator
      const aggregator = this.reactionAggregators.get(payload.stream_id);
      if (aggregator) {
        aggregator.addReaction(payload.reaction_type);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add reaction';
      this.sendError(ws, 'REACTION_FAILED', message);
    }
  }

  /**
   * Handles client disconnection.
   * Delegates to handleLeaveStream for cleanup.
   *
   * @param ws - Disconnected client WebSocket
   */
  private handleDisconnect(ws: ExtendedWebSocket): void {
    this.handleLeaveStream(ws);
  }

  /**
   * Sends an error message to a client.
   *
   * @param ws - Client WebSocket connection
   * @param code - Error code for client handling
   * @param message - Human-readable error message
   */
  private sendError(ws: WebSocket, code: string, message: string): void {
    ws.send(
      JSON.stringify({
        type: 'error',
        payload: { code, message },
        timestamp: Date.now(),
      })
    );
  }

  /**
   * Broadcasts a message to all clients in a stream.
   *
   * @param streamId - Target stream ID
   * @param message - Message to broadcast
   */
  private broadcastToStream(streamId: string, message: WSMessage): void {
    const connections = this.connections.get(streamId);
    if (!connections) return;

    const data = JSON.stringify(message);
    connections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  /**
   * Gets the current viewer count for a stream.
   *
   * @param streamId - Stream to check
   * @returns Number of connected viewers
   */
  getViewerCount(streamId: string): number {
    return this.connections.get(streamId)?.size || 0;
  }
}

/**
 * CommentBatcher - Batches comments for efficient delivery
 *
 * Instead of sending each comment individually, we batch them
 * and send every 100ms. This reduces WebSocket message overhead
 * and helps handle high-volume streams.
 */
class CommentBatcher {
  /** Stream this batcher is associated with */
  private streamId: string;

  /** Buffer holding comments awaiting delivery */
  private buffer: CommentWithUser[] = [];

  /** Timer for periodic flushing */
  private intervalId: NodeJS.Timeout | null = null;

  /** Interval between batch deliveries in milliseconds */
  private batchInterval: number;

  /**
   * Creates a new comment batcher for a stream.
   *
   * @param streamId - Stream to batch comments for
   */
  constructor(streamId: string) {
    this.streamId = streamId;
    this.batchInterval = parseInt(process.env.COMMENT_BATCH_INTERVAL_MS || '100', 10);
  }

  /**
   * Adds a comment to the batch buffer.
   *
   * @param comment - Comment to queue for delivery
   */
  addComment(comment: CommentWithUser): void {
    this.buffer.push(comment);
  }

  /**
   * Starts the periodic flush timer.
   * Should be called when first viewer joins the stream.
   */
  start(): void {
    this.intervalId = setInterval(() => {
      this.flush();
    }, this.batchInterval);
  }

  /**
   * Stops the periodic flush timer and delivers any remaining comments.
   * Should be called when last viewer leaves the stream.
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
   * Called automatically on interval and on stop.
   */
  private flush(): void {
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];

    // Publish to Redis for distribution across server instances
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
class ReactionAggregator {
  /** Stream this aggregator is associated with */
  private streamId: string;

  /** Aggregated counts by reaction type awaiting delivery */
  private counts: ReactionCount = {};

  /** Timer for periodic flushing */
  private intervalId: NodeJS.Timeout | null = null;

  /** Interval between batch deliveries in milliseconds */
  private batchInterval: number;

  /**
   * Creates a new reaction aggregator for a stream.
   *
   * @param streamId - Stream to aggregate reactions for
   */
  constructor(streamId: string) {
    this.streamId = streamId;
    this.batchInterval = parseInt(process.env.REACTION_BATCH_INTERVAL_MS || '500', 10);
  }

  /**
   * Adds a reaction to the aggregation.
   * Increments the count for the specified reaction type.
   *
   * @param type - Reaction type to increment
   */
  addReaction(type: string): void {
    this.counts[type] = (this.counts[type] || 0) + 1;
  }

  /**
   * Starts the periodic flush timer.
   * Should be called when first viewer joins the stream.
   */
  start(): void {
    this.intervalId = setInterval(() => {
      this.flush();
    }, this.batchInterval);
  }

  /**
   * Stops the periodic flush timer and delivers any remaining reactions.
   * Should be called when last viewer leaves the stream.
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
   * Called automatically on interval and on stop.
   */
  private flush(): void {
    if (Object.keys(this.counts).length === 0) return;

    const batch = this.counts;
    this.counts = {};

    // Publish to Redis for distribution across server instances
    redisPub.publish(
      `stream:${this.streamId}:reactions`,
      JSON.stringify({ stream_id: this.streamId, counts: batch })
    );
  }
}
