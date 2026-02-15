import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { broadcastToChannel } from './sseService.js';

const Redis = IORedis.default || IORedis;

let subscriber: InstanceType<typeof Redis> | null = null;
let publisher: InstanceType<typeof Redis> | null = null;

const CHANNEL_PREFIX = 'teams:channel:';

/** Initializes Redis pub/sub with dedicated subscriber and publisher connections. */
export async function initPubSub(): Promise<void> {
  try {
    subscriber = new Redis(config.redis.url);
    publisher = new Redis(config.redis.url);

    subscriber.on('error', (err: Error) => {
      logger.error({ err }, 'PubSub subscriber error');
    });

    publisher.on('error', (err: Error) => {
      logger.error({ err }, 'PubSub publisher error');
    });

    subscriber.on('message', (channel: string, message: string) => {
      const channelId = channel.replace(CHANNEL_PREFIX, '');
      try {
        const data = JSON.parse(message);
        broadcastToChannel(channelId, data.event, data.payload);
      } catch (err) {
        logger.error({ err, channel }, 'Failed to parse pub/sub message');
      }
    });

    logger.info('PubSub initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize PubSub');
  }
}

/** Subscribes this server instance to a channel's Redis pub/sub topic. */
export async function subscribeToChannel(channelId: string): Promise<void> {
  if (!subscriber) return;
  await subscriber.subscribe(`${CHANNEL_PREFIX}${channelId}`);
}

/** Unsubscribes this server instance from a channel's Redis pub/sub topic. */
export async function unsubscribeFromChannel(channelId: string): Promise<void> {
  if (!subscriber) return;
  await subscriber.unsubscribe(`${CHANNEL_PREFIX}${channelId}`);
}

/** Publishes a message event to all server instances via Redis pub/sub. */
export async function publishToChannel(
  channelId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  if (!publisher) return;
  await publisher.publish(
    `${CHANNEL_PREFIX}${channelId}`,
    JSON.stringify({ event, payload }),
  );
}

/** Closes the Redis pub/sub subscriber and publisher connections. */
export async function closePubSub(): Promise<void> {
  await subscriber?.quit();
  await publisher?.quit();
}
