import dotenv from 'dotenv';
dotenv.config();

/** Application configuration loaded from environment variables with sensible defaults. */
export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'zoom',
    password: process.env.DB_PASSWORD || 'zoom123',
    database: process.env.DB_NAME || 'zoom',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  session: {
    secret: process.env.SESSION_SECRET || 'zoom-session-secret-dev-only',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
};
