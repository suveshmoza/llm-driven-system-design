export interface Config {
  port: number;
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
  };
  minio: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    buckets: {
      raw: string;
      processed: string;
      thumbnails: string;
    };
  };
  rabbitmq: {
    url: string;
    queues: {
      transcode: string;
    };
  };
  cors: {
    origin: string;
    credentials: boolean;
  };
  session: {
    secret: string;
    maxAge: number;
  };
  upload: {
    maxFileSize: number;
    chunkSize: number;
    allowedMimeTypes: string[];
  };
  transcoding: {
    resolutions: string[];
    simulatedDuration: number;
  };
}

const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),

  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'youtube',
    user: process.env.POSTGRES_USER || 'youtube',
    password: process.env.POSTGRES_PASSWORD || 'youtube_secret',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
    buckets: {
      raw: 'raw-videos',
      processed: 'processed-videos',
      thumbnails: 'thumbnails',
    },
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    queues: {
      transcode: 'transcode-jobs',
    },
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },

  session: {
    secret: process.env.SESSION_SECRET || 'youtube-session-secret-dev',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  upload: {
    maxFileSize: 500 * 1024 * 1024, // 500MB for local dev
    chunkSize: 5 * 1024 * 1024, // 5MB chunks
    allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
  },

  transcoding: {
    resolutions: ['1080p', '720p', '480p', '360p'],
    simulatedDuration: 5000, // 5 seconds simulated transcoding time
  },
};

export default config;
