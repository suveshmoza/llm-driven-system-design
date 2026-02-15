import { EventEmitter } from 'events';
import { Response } from 'express';
import { logger } from './logger.js';
import { sseConnectionsGauge } from './metrics.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

interface SSEClient {
  res: Response;
  userId: string;
}

const channelClients = new Map<string, Set<SSEClient>>();

/** Registers an SSE client for a channel and handles cleanup on disconnect. */
export function addClient(channelId: string, userId: string, res: Response): void {
  if (!channelClients.has(channelId)) {
    channelClients.set(channelId, new Set());
  }

  const client: SSEClient = { res, userId };
  channelClients.get(channelId)!.add(client);
  sseConnectionsGauge.inc();

  logger.info({ channelId, userId }, 'SSE client connected');

  res.on('close', () => {
    channelClients.get(channelId)?.delete(client);
    if (channelClients.get(channelId)?.size === 0) {
      channelClients.delete(channelId);
    }
    sseConnectionsGauge.dec();
    logger.info({ channelId, userId }, 'SSE client disconnected');
  });
}

/** Sends an SSE event to all connected clients on a specific channel. */
export function broadcastToChannel(channelId: string, event: string, data: unknown): void {
  const clients = channelClients.get(channelId);
  if (!clients || clients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch (err) {
      logger.error({ err, channelId }, 'Failed to send SSE event');
    }
  }
}

/** Returns the number of active SSE clients for a channel. */
export function getChannelClientCount(channelId: string): number {
  return channelClients.get(channelId)?.size || 0;
}

export { emitter };
