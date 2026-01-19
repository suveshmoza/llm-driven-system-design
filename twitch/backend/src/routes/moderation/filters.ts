/**
 * Chat Filters / Automod - Handles slow mode, emote-only, and other chat settings.
 *
 * Provides endpoints for:
 * - Viewing current filter settings
 * - Enabling/disabling slow mode with configurable duration
 * - Enabling/disabling emote-only mode
 *
 * Filter changes are broadcast via Redis pub/sub to all connected chat clients.
 *
 * @module routes/moderation/filters
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { authenticateRequest, requireModeratorAccess } from './helpers.js';
import type { ChannelParams } from './types.js';

const router: Router = express.Router({ mergeParams: true });

/**
 * Request body for slow mode configuration.
 */
interface SlowModeBody {
  /** Whether slow mode should be enabled */
  enabled?: boolean;
  /** Delay between messages in seconds (default: 5) */
  durationSeconds?: number;
}

/**
 * Request body for emote-only mode configuration.
 */
interface EmoteOnlyBody {
  /** Whether emote-only mode should be enabled */
  enabled?: boolean;
}

/**
 * Database row for channel filter settings.
 */
interface FilterRow {
  id: number;
  channel_id: number;
  slow_mode_enabled: boolean;
  slow_mode_seconds: number;
  emote_only: boolean;
  subscriber_only: boolean;
  follower_only: boolean;
  follower_only_minutes: number;
}

/** Default filter settings for channels without custom configuration */
const defaultFilters = {
  slowMode: { enabled: false, durationSeconds: 0 },
  emoteOnly: false,
  subscriberOnly: false,
  followerOnly: { enabled: false, durationMinutes: 0 }
};

/**
 * Gets the current filter settings for a channel.
 *
 * Returns all chat filter configurations including slow mode, emote-only,
 * subscriber-only, and follower-only settings. Returns defaults if no
 * custom settings exist.
 *
 * @description GET /api/moderation/:channelId/filters - Get filter settings
 * @param req.params.channelId - The channel to get settings for
 * @returns JSON with filters object containing all chat restrictions
 *
 * @example
 * GET /api/moderation/123/filters
 * // Response:
 * {
 *   "filters": {
 *     "slowMode": { "enabled": true, "durationSeconds": 30 },
 *     "emoteOnly": false,
 *     "subscriberOnly": false,
 *     "followerOnly": { "enabled": false, "durationMinutes": 0 }
 *   }
 * }
 */
router.get('/', async (req: Request<ChannelParams>, res: Response): Promise<void> => {
  try {
    const { channelId } = req.params;
    const result = await query<FilterRow>('SELECT * FROM channel_filters WHERE channel_id = $1', [channelId]);

    if (result.rows.length === 0) {
      res.json({ filters: defaultFilters });
      return;
    }

    const row = result.rows[0];
    res.json({
      filters: {
        slowMode: { enabled: row.slow_mode_enabled, durationSeconds: row.slow_mode_seconds },
        emoteOnly: row.emote_only,
        subscriberOnly: row.subscriber_only,
        followerOnly: { enabled: row.follower_only, durationMinutes: row.follower_only_minutes }
      }
    });
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Get filters - table may not exist');
    res.json({ filters: defaultFilters });
  }
});

/**
 * Updates slow mode settings for a channel.
 *
 * Enables or disables slow mode, which limits how frequently users can
 * send chat messages. Broadcasts the change to all connected clients.
 *
 * @description POST /api/moderation/:channelId/filters/slow-mode - Update slow mode
 * @param req.params.channelId - The channel to update
 * @param req.body.enabled - Whether to enable slow mode
 * @param req.body.durationSeconds - Delay between messages (default: 5)
 * @returns JSON with success status and new slow mode settings
 * @throws 401 if not authenticated
 * @throws 403 if not authorized to moderate this channel
 * @throws 500 on database or server error
 *
 * @example
 * // Enable 30-second slow mode
 * POST /api/moderation/123/filters/slow-mode
 * { "enabled": true, "durationSeconds": 30 }
 */
router.post('/slow-mode', async (req: Request<ChannelParams, object, SlowModeBody>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId } = req.params;
    const { enabled, durationSeconds = 5 } = req.body;
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    await publishMessage(`chat:${channelId}`, {
      type: 'slow_mode_changed', channelId: parseInt(channelId),
      enabled: !!enabled, durationSeconds: enabled ? durationSeconds : 0
    });

    logger.info({ actor_id: actorId, channel_id: channelId, enabled, duration_seconds: durationSeconds }, 'Slow mode updated');
    res.json({ success: true, slowMode: { enabled: !!enabled, durationSeconds: enabled ? durationSeconds : 0 } });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Update slow mode error');
    res.status(500).json({ error: 'Failed to update slow mode' });
  }
});

/**
 * Updates emote-only mode settings for a channel.
 *
 * When enabled, users can only send messages containing emotes.
 * Text-only messages are blocked. Broadcasts the change to all connected clients.
 *
 * @description POST /api/moderation/:channelId/filters/emote-only - Update emote-only mode
 * @param req.params.channelId - The channel to update
 * @param req.body.enabled - Whether to enable emote-only mode
 * @returns JSON with success status and new emote-only setting
 * @throws 401 if not authenticated
 * @throws 403 if not authorized to moderate this channel
 * @throws 500 on database or server error
 *
 * @example
 * POST /api/moderation/123/filters/emote-only
 * { "enabled": true }
 */
router.post('/emote-only', async (req: Request<ChannelParams, object, EmoteOnlyBody>, res: Response): Promise<void> => {
  try {
    const actorId = await authenticateRequest(req, res);
    if (!actorId) return;

    const { channelId } = req.params;
    const { enabled } = req.body;
    if (!(await requireModeratorAccess(actorId, channelId, res))) return;

    await publishMessage(`chat:${channelId}`, {
      type: 'emote_only_changed', channelId: parseInt(channelId), enabled: !!enabled
    });

    logger.info({ actor_id: actorId, channel_id: channelId, enabled }, 'Emote-only mode updated');
    res.json({ success: true, emoteOnly: !!enabled });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Update emote-only error');
    res.status(500).json({ error: 'Failed to update emote-only mode' });
  }
});

export default router;
