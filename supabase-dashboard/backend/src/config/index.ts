import 'dotenv/config';

/** Application configuration with metadata and target database connection strings. */
export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL || 'postgresql://supabase:supabase123@localhost:5432/supabase_meta',
  },
  targetDatabase: {
    url: process.env.TARGET_DATABASE_URL || 'postgresql://sample:sample123@localhost:5433/sample_db',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  session: {
    secret: process.env.SESSION_SECRET || 'supabase-dev-secret-change-in-production',
    maxAge: 24 * 60 * 60 * 1000,
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
};
