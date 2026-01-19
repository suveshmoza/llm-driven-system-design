export interface Config {
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  redis: {
    url: string;
  };
  rabbitmq: {
    url: string;
  };
  server: {
    port: number;
    sessionSecret: string;
  };
  platform: {
    domain: string;
    storefrontDomain: string;
  };
  inventory: {
    lowStockThreshold: number;
  };
}

const config: Config = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'shopify',
    user: process.env.DB_USER || 'shopify',
    password: process.env.DB_PASSWORD || 'shopify_password',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://shopify:shopify_dev@localhost:5672',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    sessionSecret: process.env.SESSION_SECRET || 'shopify-dev-secret-change-in-production',
  },
  platform: {
    domain: process.env.PLATFORM_DOMAIN || 'localhost:3001',
    storefrontDomain: process.env.STOREFRONT_DOMAIN || 'localhost:5173',
  },
  // Inventory thresholds
  inventory: {
    lowStockThreshold: parseInt(process.env.LOW_STOCK_THRESHOLD || '10', 10),
  },
};

export default config;
