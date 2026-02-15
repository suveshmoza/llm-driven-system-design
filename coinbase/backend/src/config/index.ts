import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'coinbase',
    password: process.env.PGPASSWORD || 'coinbase123',
    database: process.env.PGDATABASE || 'coinbase',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'coinbase-api',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'coinbase-dev-secret-key-change-in-production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },

  fees: {
    makerFee: 0.001, // 0.1%
    takerFee: 0.002, // 0.2%
  },
};
