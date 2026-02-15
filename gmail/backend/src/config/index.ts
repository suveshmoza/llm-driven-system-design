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

export interface ElasticsearchConfig {
  node: string;
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
  elasticsearch: ElasticsearchConfig;
  session: SessionConfig;
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'gmail',
    user: process.env.POSTGRES_USER || 'gmail',
    password: process.env.POSTGRES_PASSWORD || 'gmail123',
    connectionString: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  elasticsearch: {
    node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'gmail-dev-session-secret',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

export default config;
