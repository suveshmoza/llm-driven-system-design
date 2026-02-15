import dotenv from 'dotenv';
dotenv.config();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface RedisConfig {
  url: string;
  host: string;
  port: number;
}

export interface SessionConfig {
  secret: string;
  maxAge: number;
}

export interface Config {
  port: number;
  nodeEnv: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  session: SessionConfig;
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'excalidraw',
    user: process.env.POSTGRES_USER || 'excalidraw',
    password: process.env.POSTGRES_PASSWORD || 'excalidraw123',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  session: {
    secret: process.env.SESSION_SECRET || 'excalidraw-dev-session-secret',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

export default config;
