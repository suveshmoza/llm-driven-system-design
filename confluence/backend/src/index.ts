import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './services/logger.js';
import { connectQueue } from './services/queue.js';
import { ensureIndex } from './services/elasticsearch.js';

async function start() {
  // Connect to RabbitMQ (non-blocking)
  await connectQueue();

  // Ensure Elasticsearch index exists (non-blocking)
  await ensureIndex();

  app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      `Confluence API server running on port ${config.port}`,
    );
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
