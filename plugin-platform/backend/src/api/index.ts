import { app } from './app.js';
import { logger } from '../shared/logger.js';
import { ensureBucket } from '../shared/storage.js';

const PORT = process.env.PORT || 3000;

// Initialize storage bucket
ensureBucket().catch((err) => {
  logger.error(err, 'Failed to initialize storage bucket');
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Plugin Platform API server started');
});
