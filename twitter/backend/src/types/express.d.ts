import type { Logger } from 'pino';
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    role?: 'user' | 'admin';
  }
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      log?: Logger;
      idempotencyKey?: string;
    }
  }
}

export {};
