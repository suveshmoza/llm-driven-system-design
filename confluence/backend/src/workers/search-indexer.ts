import amqplib from 'amqplib';
import { config } from '../config/index.js';
import { indexPage, deletPageIndex } from '../services/searchService.js';
import { ensureIndex } from '../services/elasticsearch.js';
import { logger } from '../services/logger.js';

interface IndexMessage {
  action: 'index' | 'delete';
  pageId: string;
  spaceId: string;
}

async function start() {
  logger.info('Starting search indexer worker...');

  await ensureIndex();

  const connection = await amqplib.connect(config.rabbitmq.url);
  const channel = await connection.createChannel();

  await channel.assertQueue(config.rabbitmq.pageIndexQueue, { durable: true });
  channel.prefetch(10);

  logger.info('Search indexer worker ready, waiting for messages...');

  channel.consume(config.rabbitmq.pageIndexQueue, async (msg) => {
    if (!msg) return;

    try {
      const message: IndexMessage = JSON.parse(msg.content.toString());

      switch (message.action) {
        case 'index':
          await indexPage(message.pageId, message.spaceId);
          logger.debug({ pageId: message.pageId }, 'Page indexed');
          break;

        case 'delete':
          await deletPageIndex(message.pageId);
          logger.debug({ pageId: message.pageId }, 'Page removed from index');
          break;

        default:
          logger.warn({ action: (message as IndexMessage).action }, 'Unknown index action');
      }

      channel.ack(msg);
    } catch (err) {
      logger.error({ err }, 'Failed to process index message');
      // Negative acknowledge with no requeue to avoid infinite loop
      channel.nack(msg, false, false);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down search indexer worker...');
    await channel.close();
    await connection.close();
    process.exit(0);
  });
}

start().catch((err) => {
  logger.error({ err }, 'Search indexer worker failed to start');
  process.exit(1);
});
