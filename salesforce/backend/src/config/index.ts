import 'dotenv/config';

/** Centralized application configuration sourced from environment variables with sensible defaults. */
export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL || 'postgresql://salesforce:salesforce123@localhost:5432/salesforce',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  session: {
    secret: process.env.SESSION_SECRET || 'salesforce-dev-secret-change-in-production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
};
