import { query } from '../utils/db.js';
import { cacheSet, cacheGet } from '../utils/redis.js';
import { publishTranscodeJob, getQueueStats } from '../shared/queue.js';
import config from '../config/index.js';
import logger from '../shared/logger.js';
import { transcodeQueueDepth } from '../shared/metrics.js';

// ============ Type Definitions ============

interface TranscodeJob {
  videoId: string;
  sourceKey: string;
  userId: string;
  createdAt: string;
  status: string;
}

interface TranscodeStatus {
  videoId: string;
  status: string;
}

interface VideoRow {
  status: string;
}

/**
 * Queue a transcoding job via RabbitMQ
 */
export const queueTranscodingJob = async (
  videoId: string,
  sourceKey: string,
  userId: string
): Promise<TranscodeJob> => {
  // Publish to RabbitMQ queue
  await publishTranscodeJob(videoId, sourceKey, userId);

  const job: TranscodeJob = {
    videoId,
    sourceKey,
    userId,
    createdAt: new Date().toISOString(),
    status: 'queued',
  };

  // Cache job status for quick lookups
  await cacheSet(`transcode:${videoId}`, job, 3600);

  // Update queue depth metric (async, don't await)
  getQueueStats().then(stats => {
    if (stats) {
      transcodeQueueDepth.set(stats.messageCount);
    }
  }).catch(() => {});

  logger.info({
    event: 'transcode_job_queued',
    videoId,
    userId,
  }, `Transcoding job queued for video ${videoId}`);

  return job;
};

/**
 * Get transcoding status
 */
export const getTranscodingStatus = async (videoId: string): Promise<TranscodeStatus | TranscodeJob | null> => {
  const cached = await cacheGet<TranscodeJob>(`transcode:${videoId}`);
  if (cached) {
    return cached;
  }

  // Check database if not in cache
  const result = await query(
    'SELECT status FROM videos WHERE id = $1',
    [videoId]
  );

  const row = result.rows[0] as VideoRow | undefined;
  if (!row) {
    return null;
  }

  return {
    videoId,
    status: row.status,
  };
};

/**
 * Get queue status for admin dashboard
 */
export const getQueueStatus = async () => {
  const stats = await getQueueStats();
  return {
    queueLength: stats?.messageCount || 0,
    consumerCount: stats?.consumerCount || 0,
    queue: stats?.queue || config.rabbitmq.queues.transcode,
  };
};

/**
 * Get current queue length (synchronous, returns cached value or 0)
 */
let cachedQueueLength = 0;

// Update queue length periodically
setInterval(async () => {
  try {
    const stats = await getQueueStats();
    cachedQueueLength = stats?.messageCount || 0;
  } catch {
    // Keep previous value on error
  }
}, 5000);

export const getQueueLength = (): number => {
  return cachedQueueLength;
};
