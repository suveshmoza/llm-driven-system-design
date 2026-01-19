import 'dotenv/config';

export interface Config {
  port: number;
  nodeEnv: string;
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  redis: {
    url: string;
  };
  elasticsearch: {
    url: string;
  };
  sessionSecret: string;
  reservationHoldMinutes: number;
}

const config: Config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // PostgreSQL
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'hotel_user',
    password: process.env.POSTGRES_PASSWORD || 'hotel_pass',
    database: process.env.POSTGRES_DB || 'hotel_booking',
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // Elasticsearch
  elasticsearch: {
    url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
  },

  // Session
  sessionSecret: process.env.SESSION_SECRET || 'hotel-booking-secret-key',

  // Booking settings
  reservationHoldMinutes: parseInt(process.env.RESERVATION_HOLD_MINUTES || '15', 10),
};

export default config;
