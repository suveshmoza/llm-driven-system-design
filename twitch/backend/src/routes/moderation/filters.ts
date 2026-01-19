/**
 * Chat Filters / Automod - Handles slow mode, emote-only, and other chat settings.
 */
import express, { Request, Response, Router } from 'express';
import { query } from '../../services/database.js';
import { publishMessage } from '../../services/redis.js';
import { logger } from '../../utils/logger.js';
import { authenticateRequest, requireModeratorAccess } from './helpers.js';
import type { ChannelParams } from './types.js';

const router: Router = express.Router({ mergeParams: true });

interface SlowModeBody { enabled?: boolean; durationSeconds?: number; }
interface EmoteOnlyBody { enabled?: boolean; }
interface FilterRow {
  id: number; channel_id: number; slow_mode_enabled: boolean; slow_mode_seconds: number;
  emote_only: boolean; subscriber_only: boolean; follower_only: boolean; follower_only_minutes: number;
}

const defaultFilters = {
  slowMode: { enabled: false, durationSeconds: 0 },
  emoteOnly: false,
  subscriberOnly: false,
  followerOnly: { enabled: false, durationMinutes: 0 }
};

/** Get channel filter settings - GET /api/moderation/:channelId/filters */
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

/** Update slow mode - POST /api/moderation/:channelId/filters/slow-mode */
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

/** Update emote-only mode - POST /api/moderation/:channelId/filters/emote-only */
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
