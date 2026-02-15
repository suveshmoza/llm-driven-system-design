import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { addClient } from '../services/sseService.js';
import { subscribeToChannel } from '../services/pubsub.js';

const router = Router();

// GET /api/sse/:channelId - SSE stream for channel
router.get('/:channelId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { channelId } = req.params;
    const userId = req.session.userId!;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ channelId, userId })}\n\n`);

    // Subscribe to Redis pub/sub for this channel
    await subscribeToChannel(channelId);

    // Add client to SSE manager
    addClient(channelId, userId, res);

    // Keep connection alive with periodic heartbeat
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      logger.info({ channelId, userId }, 'SSE connection closed');
    });
  } catch (err) {
    logger.error({ err }, 'Failed to establish SSE connection');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
