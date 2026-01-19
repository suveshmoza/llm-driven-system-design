/**
 * Structured JSON Logging with Pino
 *
 * Provides consistent logging across all services with:
 * - JSON format for log aggregation
 * - Request correlation via trace IDs
 * - Log levels (info, warn, error, debug)
 * - Service/instance identification
 */
import pino from 'pino';
import { Request, Response, NextFunction } from 'express';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label: string) => ({ level: label })
  },
  base: {
    service: 'twitch-api',
    instance: process.env.INSTANCE_ID || `port-${process.env.PORT || 3000}`,
    pid: process.pid
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

/**
 * Create a child logger with additional context
 */
function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      userId?: number;
      username?: string;
      userRole?: string;
      idempotencyKey?: string | null;
      auditActor?: () => { userId: number | null; username: string; ip: string };
    }
  }
}

/**
 * Express middleware for request logging
 */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const traceId = (req.headers['x-trace-id'] as string) || generateTraceId();

  // Attach trace ID to request for downstream use
  req.traceId = traceId;

  // Set trace ID in response headers
  res.setHeader('x-trace-id', traceId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      user_id: req.userId || null,
      trace_id: traceId,
      ip: req.ip || req.socket.remoteAddress,
      user_agent: req.headers['user-agent']
    };

    if (res.statusCode >= 500) {
      logger.error(logData, 'request completed with server error');
    } else if (res.statusCode >= 400) {
      logger.warn(logData, 'request completed with client error');
    } else if (duration > 1000) {
      logger.warn(logData, 'slow request completed');
    } else {
      logger.info(logData, 'request completed');
    }
  });

  next();
}

/**
 * Generate a trace ID for request correlation
 */
function generateTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Log a business event
 */
function logEvent(eventType: string, data: Record<string, unknown> = {}): void {
  logger.info({
    event_type: eventType,
    ...data,
    timestamp: new Date().toISOString()
  }, `event: ${eventType}`);
}

/**
 * Log a stream-related event
 */
function logStreamEvent(eventType: string, channelId: string | number, metadata: Record<string, unknown> = {}): void {
  logEvent(`stream.${eventType}`, {
    channel_id: channelId,
    ...metadata
  });
}

/**
 * Log a chat-related event
 */
function logChatEvent(eventType: string, channelId: string | number | null, metadata: Record<string, unknown> = {}): void {
  logEvent(`chat.${eventType}`, {
    channel_id: channelId,
    ...metadata
  });
}

export {
  logger,
  createChildLogger,
  requestLogger,
  generateTraceId,
  logEvent,
  logStreamEvent,
  logChatEvent
};
