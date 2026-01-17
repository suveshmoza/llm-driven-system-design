/**
 * Virtual waiting room service for managing high-demand event access.
 * Implements a fair queue system using Redis sorted sets to control
 * the number of concurrent shoppers during high-traffic ticket sales.
 */
import redis from '../db/redis.js';
import type { QueueStatus } from '../types/index.js';

/** Duration in seconds that active shoppers can browse before timing out (15 minutes) */
const ACTIVE_SESSION_TTL = 900;
/** Interval in milliseconds for processing the queue and admitting users (1 second) */
const QUEUE_PROCESS_INTERVAL = 1000;

/**
 * Service class for virtual waiting room functionality.
 * Manages user queues, admission control, and active session tracking.
 */
export class WaitingRoomService {
  /** Map of event IDs to their queue processing intervals */
  private processingIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Adds a user to the waiting queue for an event.
   * If already active or in queue, returns current status.
   * Uses timestamp with jitter for fair ordering.
   *
   * @param eventId - The event ID
   * @param sessionId - The user's session ID
   * @returns Current queue status (position, status, estimated wait)
   */
  async joinQueue(eventId: string, sessionId: string): Promise<QueueStatus> {
    const queueKey = `queue:${eventId}`;
    const activeKey = `active:${eventId}`;

    // Check if already active
    const isActive = await redis.sismember(activeKey, sessionId);
    if (isActive) {
      return {
        position: 0,
        status: 'active',
        estimated_wait_seconds: 0,
      };
    }

    // Check if already in queue
    const existingRank = await redis.zrank(queueKey, sessionId);
    if (existingRank !== null) {
      const position = existingRank + 1;
      return {
        position,
        status: 'waiting',
        estimated_wait_seconds: this.estimateWait(position),
      };
    }

    // Add to queue with current timestamp + small random jitter for fairness
    const timestamp = Date.now() + Math.random() * 100;
    await redis.zadd(queueKey, timestamp, sessionId);

    const rank = await redis.zrank(queueKey, sessionId);
    const position = (rank || 0) + 1;

    return {
      position,
      status: 'waiting',
      estimated_wait_seconds: this.estimateWait(position),
    };
  }

  /**
   * Gets the current queue status for a user.
   *
   * @param eventId - The event ID
   * @param sessionId - The user's session ID
   * @returns Current queue status
   */
  async getQueueStatus(eventId: string, sessionId: string): Promise<QueueStatus> {
    const queueKey = `queue:${eventId}`;
    const activeKey = `active:${eventId}`;

    // Check if active
    const isActive = await redis.sismember(activeKey, sessionId);
    if (isActive) {
      return {
        position: 0,
        status: 'active',
        estimated_wait_seconds: 0,
      };
    }

    // Check queue position
    const rank = await redis.zrank(queueKey, sessionId);
    if (rank === null) {
      return {
        position: 0,
        status: 'not_in_queue',
        estimated_wait_seconds: 0,
      };
    }

    const position = rank + 1;
    return {
      position,
      status: 'waiting',
      estimated_wait_seconds: this.estimateWait(position),
    };
  }

  /**
   * Checks if a session is currently active for shopping.
   *
   * @param eventId - The event ID
   * @param sessionId - The user's session ID
   * @returns True if session is active, false otherwise
   */
  async isSessionActive(eventId: string, sessionId: string): Promise<boolean> {
    const activeSessionKey = `active_session:${eventId}:${sessionId}`;
    const exists = await redis.exists(activeSessionKey);
    return exists === 1;
  }

  /**
   * Admits the next batch of users from the queue to active shopping.
   * Called periodically by the queue processor.
   * Respects the maximum concurrent shoppers limit.
   *
   * @param eventId - The event ID
   * @param maxConcurrent - Maximum allowed concurrent active shoppers
   * @returns Number of users admitted in this batch
   */
  async admitNextBatch(eventId: string, maxConcurrent: number): Promise<number> {
    const queueKey = `queue:${eventId}`;
    const activeKey = `active:${eventId}`;

    // Count current active users
    const activeCount = await redis.scard(activeKey);
    const slotsAvailable = maxConcurrent - activeCount;

    if (slotsAvailable <= 0) {
      return 0;
    }

    // Get next batch from queue
    const nextUsers = await redis.zrange(queueKey, 0, slotsAvailable - 1);

    if (nextUsers.length === 0) {
      return 0;
    }

    // Move to active set
    const pipeline = redis.pipeline();
    for (const sessionId of nextUsers) {
      pipeline.sadd(activeKey, sessionId);
      pipeline.setex(`active_session:${eventId}:${sessionId}`, ACTIVE_SESSION_TTL, '1');
    }
    pipeline.zrem(queueKey, ...nextUsers);
    await pipeline.exec();

    return nextUsers.length;
  }

  /**
   * Removes a user from the queue and/or active set.
   * Called when user explicitly leaves or navigates away.
   *
   * @param eventId - The event ID
   * @param sessionId - The user's session ID
   */
  async leaveQueue(eventId: string, sessionId: string): Promise<void> {
    const queueKey = `queue:${eventId}`;
    const activeKey = `active:${eventId}`;

    await redis.zrem(queueKey, sessionId);
    await redis.srem(activeKey, sessionId);
    await redis.del(`active_session:${eventId}:${sessionId}`);
  }

  /**
   * Gets statistics about the current queue state.
   * Useful for monitoring and display purposes.
   *
   * @param eventId - The event ID
   * @returns Object with queue length, active count, and estimated wait
   */
  async getQueueStats(eventId: string): Promise<{
    queueLength: number;
    activeCount: number;
    estimatedWait: number;
  }> {
    const queueKey = `queue:${eventId}`;
    const activeKey = `active:${eventId}`;

    const [queueLength, activeCount] = await Promise.all([
      redis.zcard(queueKey),
      redis.scard(activeKey),
    ]);

    return {
      queueLength,
      activeCount,
      estimatedWait: this.estimateWait(queueLength),
    };
  }

  /**
   * Starts the background queue processor for an event.
   * Periodically admits users from the queue as slots become available.
   *
   * @param eventId - The event ID to start processing
   * @param maxConcurrent - Maximum concurrent shoppers allowed
   */
  startQueueProcessor(eventId: string, maxConcurrent: number): void {
    if (this.processingIntervals.has(eventId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const admitted = await this.admitNextBatch(eventId, maxConcurrent);
        if (admitted > 0) {
          console.log(`Admitted ${admitted} users for event ${eventId}`);
        }
      } catch (error) {
        console.error(`Error processing queue for event ${eventId}:`, error);
      }
    }, QUEUE_PROCESS_INTERVAL);

    this.processingIntervals.set(eventId, interval);
    console.log(`Started queue processor for event ${eventId}`);
  }

  /**
   * Stops the queue processor for an event.
   * Called when event goes off-sale or is cancelled.
   *
   * @param eventId - The event ID to stop processing
   */
  stopQueueProcessor(eventId: string): void {
    const interval = this.processingIntervals.get(eventId);
    if (interval) {
      clearInterval(interval);
      this.processingIntervals.delete(eventId);
      console.log(`Stopped queue processor for event ${eventId}`);
    }
  }

  /**
   * Estimates wait time based on queue position.
   * Uses a simplified model assuming ~10 users admitted per second.
   *
   * @param position - User's position in the queue
   * @returns Estimated wait time in seconds
   */
  private estimateWait(position: number): number {
    // Rough estimate: ~10 users per second can be admitted
    // and average shopping time is about 5 minutes
    const usersPerSecond = 10;
    return Math.ceil(position / usersPerSecond);
  }
}

/** Singleton instance of WaitingRoomService for use throughout the application */
export const waitingRoomService = new WaitingRoomService();
