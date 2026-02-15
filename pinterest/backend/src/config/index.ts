import 'dotenv/config';

const config = {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'pinterest',
    user: process.env.PGUSER || 'pinterest',
    password: process.env.PGPASSWORD || 'pinterest123',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'pinterest-images',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://pinterest:pinterest123@localhost:5672',
  },
  session: {
    secret: process.env.SESSION_SECRET || 'pinterest-dev-secret-change-in-production',
    maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'),
  },
};

export default config;
