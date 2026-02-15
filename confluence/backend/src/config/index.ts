import dotenv from 'dotenv';
dotenv.config();

/** Application configuration sourced from environment variables with development defaults. */
export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'confluence',
    password: process.env.DB_PASSWORD || 'confluence123',
    database: process.env.DB_NAME || 'confluence',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  session: {
    secret: process.env.SESSION_SECRET || 'confluence-dev-secret-change-in-production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },

  elasticsearch: {
    node: process.env.ES_NODE || 'http://localhost:9200',
    index: 'wiki_pages',
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://confluence:confluence123@localhost:5672',
    pageIndexQueue: 'page-index',
  },
};
