import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

interface RateLimitTier {
  requests: number;
  windowMs: number;
}

export interface Config {
  env: string;
  instanceId: string;
  server: {
    port: number;
  };
  gateway: {
    port: number;
  };
  loadBalancer: {
    port: number;
    servers: string[];
  };
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
  rabbitmq?: {
    url: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    limits: {
      anonymous: RateLimitTier;
      free: RateLimitTier;
      pro: RateLimitTier;
      enterprise: RateLimitTier;
      [key: string]: RateLimitTier;
    };
  };
  cache: {
    ttl: number;
    localTtl: number;
    maxMemory: string;
    evictionPolicy: string;
    ttlConfig: {
      session: number;
      rateLimit: number;
      apiResponse: number;
      userProfile: number;
    };
  };
  retention: {
    requestLogs: {
      hot: number;
      warm: number;
      cold: number;
    };
    metrics: {
      memory: number;
      persistent: number;
    };
    sessions: number;
    apiKeys: {
      softDeleteDays: number;
    };
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeout: number;
    halfOpenRequests: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  admin: {
    email: string;
    password: string;
  };
}

const config: Config = {
  env: process.env['NODE_ENV'] || 'development',
  instanceId: process.env['INSTANCE_ID'] || 'api-1',

  server: {
    port: parseInt(process.env['PORT'] || '3000', 10),
  },

  gateway: {
    port: parseInt(process.env['GATEWAY_PORT'] || '8080', 10),
  },

  loadBalancer: {
    port: parseInt(process.env['LB_PORT'] || '3000', 10),
    servers: (process.env['API_SERVERS'] || 'http://localhost:3001,http://localhost:3002,http://localhost:3003')
      .split(',')
      .map(s => s.trim()),
  },

  postgres: {
    host: process.env['POSTGRES_HOST'] || 'localhost',
    port: parseInt(process.env['POSTGRES_PORT'] || '5432', 10),
    database: process.env['POSTGRES_DB'] || 'scalable_api',
    user: process.env['POSTGRES_USER'] || 'postgres',
    password: process.env['POSTGRES_PASSWORD'] || 'postgres',
  },

  redis: {
    host: process.env['REDIS_HOST'] || 'localhost',
    port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
  },

  rabbitmq: {
    url: process.env['RABBITMQ_URL'] || 'amqp://guest:guest@localhost:5672',
  },

  rateLimit: {
    windowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '60000', 10),
    maxRequests: parseInt(process.env['RATE_LIMIT_MAX_REQUESTS'] || '100', 10),
    limits: {
      anonymous: { requests: 100, windowMs: 60000 },
      free: { requests: 1000, windowMs: 60000 },
      pro: { requests: 10000, windowMs: 60000 },
      enterprise: { requests: 100000, windowMs: 60000 },
    },
  },

  cache: {
    ttl: parseInt(process.env['CACHE_TTL'] || '300', 10),
    localTtl: 5000, // 5 seconds for local cache
    maxMemory: process.env['CACHE_MAX_MEMORY'] || '256mb',
    evictionPolicy: process.env['CACHE_EVICTION_POLICY'] || 'allkeys-lru',
    // TTL configuration per cache type (in seconds)
    ttlConfig: {
      session: parseInt(process.env['SESSION_TTL'] || '86400', 10), // 24 hours
      rateLimit: parseInt(process.env['RATE_LIMIT_TTL'] || '60', 10), // 1 minute
      apiResponse: parseInt(process.env['API_RESPONSE_TTL'] || '300', 10), // 5 minutes
      userProfile: parseInt(process.env['USER_PROFILE_TTL'] || '600', 10), // 10 minutes
    },
  },

  // Data retention configuration
  // WHY: Balances debugging/compliance needs against storage costs
  retention: {
    // Request logs retention in days
    requestLogs: {
      hot: parseInt(process.env['RETENTION_LOGS_HOT_DAYS'] || '7', 10), // PostgreSQL
      warm: parseInt(process.env['RETENTION_LOGS_WARM_DAYS'] || '30', 10), // Archived/compressed
      cold: parseInt(process.env['RETENTION_LOGS_COLD_DAYS'] || '90', 10), // Before deletion
    },
    // Metrics retention
    metrics: {
      memory: parseInt(process.env['RETENTION_METRICS_MEMORY_HOURS'] || '24', 10), // In-memory
      persistent: parseInt(process.env['RETENTION_METRICS_PERSISTENT_DAYS'] || '30', 10), // Prometheus
    },
    // Session data
    sessions: parseInt(process.env['RETENTION_SESSIONS_HOURS'] || '24', 10),
    // API keys (soft delete)
    apiKeys: {
      softDeleteDays: 365, // Keep soft-deleted keys for 1 year
    },
  },

  circuitBreaker: {
    failureThreshold: parseInt(process.env['CIRCUIT_FAILURE_THRESHOLD'] || '5', 10),
    resetTimeout: parseInt(process.env['CIRCUIT_RESET_TIMEOUT'] || '30000', 10),
    halfOpenRequests: 3,
  },

  jwt: {
    secret: process.env['JWT_SECRET'] || 'your-super-secret-jwt-key',
    expiresIn: '24h',
  },

  admin: {
    email: process.env['ADMIN_EMAIL'] || 'admin@example.com',
    password: process.env['ADMIN_PASSWORD'] || 'admin123',
  },
};

export default config;
