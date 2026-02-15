import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './services/logger.js';
import { setupWebSocket } from './websocket/handler.js';

const server = createServer(app);

// WebSocket server on /ws path
const wss = new WebSocketServer({
  server,
  path: '/ws',
});

setupWebSocket(wss);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Zoom backend server started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  wss.close();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  wss.close();
  server.close(() => {
    process.exit(0);
  });
});
