import dotenv from 'dotenv';
dotenv.config();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionString: string | undefined;
}

export interface RedisConfig {
  url: string;
  host: string;
  port: number;
}

export interface MinioConfig {
  endPoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
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
  minio: MinioConfig;
  session: SessionConfig;
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'instagram',
    user: process.env.POSTGRES_USER || 'instagram',
    password: process.env.POSTGRES_PASSWORD || 'instagram123',
    connectionString: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
    bucket: process.env.MINIO_BUCKET || 'instagram-media',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

export default config;
