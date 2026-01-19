import express, { Request, Response } from 'express';
import cors from 'cors';
import config from '../../shared/config/index.js';
import { requestIdMiddleware, requestLoggerMiddleware, corsOptions } from '../../shared/middleware/common.js';
import { metricsService } from '../../shared/services/metrics.js';
import { CircuitBreaker } from '../../shared/services/circuit-breaker.js';

const app = express();

interface ExtendedRequest extends Request {
  id: string;
}

interface ServerInfo {
  url: string;
  healthy: boolean;
  weight: number;
  currentConnections: number;
  totalRequests: number;
  failedRequests: number;
  lastCheck: string | null;
  lastError: string | null;
  circuitBreaker: CircuitBreaker;
}

// Server pool management
class ServerPool {
  private servers: ServerInfo[];
  private currentIndex: number;
  private healthCheckInterval: ReturnType<typeof setInterval> | null;

  constructor(serverUrls: string[]) {
    this.servers = serverUrls.map((url: string) => ({
      url,
      healthy: true,
      weight: 5,
      currentConnections: 0,
      totalRequests: 0,
      failedRequests: 0,
      lastCheck: null,
      lastError: null,
      circuitBreaker: new CircuitBreaker(`lb-${url}`, {
        failureThreshold: 3,
        resetTimeout: 15000,
      }),
    }));
    this.currentIndex = 0;
    this.healthCheckInterval = null;
  }

  /**
   * Get next healthy server using least connections algorithm
   */
  getNextServer(): ServerInfo | undefined {
    const healthyServers = this.servers.filter((s: ServerInfo) => s.healthy && s.circuitBreaker.state !== 'open');

    if (healthyServers.length === 0) {
      // Fallback: try any server if all are unhealthy
      console.warn('All servers unhealthy, trying first server');
      return this.servers[0];
    }

    // Least connections with weight consideration
    healthyServers.sort((a: ServerInfo, b: ServerInfo) => {
      const aScore = a.currentConnections / a.weight;
      const bScore = b.currentConnections / b.weight;
      return aScore - bScore;
    });

    return healthyServers[0];
  }

  /**
   * Round-robin selection (alternative algorithm)
   */
  getNextServerRoundRobin(): ServerInfo | undefined {
    const healthyServers = this.servers.filter((s: ServerInfo) => s.healthy);
    if (healthyServers.length === 0) {
      return this.servers[0];
    }

    this.currentIndex = (this.currentIndex + 1) % healthyServers.length;
    return healthyServers[this.currentIndex];
  }

  /**
   * Mark request as started
   */
  requestStarted(server: ServerInfo): void {
    server.currentConnections++;
    server.totalRequests++;
  }

  /**
   * Mark request as completed
   */
  requestCompleted(server: ServerInfo, success: boolean): void {
    server.currentConnections = Math.max(0, server.currentConnections - 1);
    if (!success) {
      server.failedRequests++;
    }
  }

  /**
   * Check health of a single server
   */
  async checkServerHealth(server: ServerInfo): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(`${server.url}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as { load?: number };
        server.healthy = true;
        server.lastCheck = new Date().toISOString();
        server.lastError = null;

        // Adjust weight based on response time or load
        if (data['load'] !== undefined) {
          server.weight = Math.max(1, 10 - Math.floor(data['load'] / 10));
        }

        return true;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      clearTimeout(timeout);
      server.healthy = false;
      server.lastCheck = new Date().toISOString();
      server.lastError = (error as Error).message;
      console.warn(`Health check failed for ${server.url}:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs = 5000): void {
    // Initial check
    this.checkAllServers();

    this.healthCheckInterval = setInterval(() => {
      this.checkAllServers();
    }, intervalMs);
  }

  /**
   * Check all servers
   */
  async checkAllServers(): Promise<void> {
    await Promise.all(this.servers.map((s: ServerInfo) => this.checkServerHealth(s)));
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get pool status
   */
  getStatus(): {
    totalServers: number;
    healthyServers: number;
    servers: Array<{
      url: string;
      healthy: boolean;
      weight: number;
      currentConnections: number;
      totalRequests: number;
      failedRequests: number;
      successRate: string;
      lastCheck: string | null;
      lastError: string | null;
      circuitState: string;
    }>;
  } {
    return {
      totalServers: this.servers.length,
      healthyServers: this.servers.filter((s: ServerInfo) => s.healthy).length,
      servers: this.servers.map((s: ServerInfo) => ({
        url: s.url,
        healthy: s.healthy,
        weight: s.weight,
        currentConnections: s.currentConnections,
        totalRequests: s.totalRequests,
        failedRequests: s.failedRequests,
        successRate: s.totalRequests > 0
          ? ((s.totalRequests - s.failedRequests) / s.totalRequests * 100).toFixed(2) + '%'
          : 'N/A',
        lastCheck: s.lastCheck,
        lastError: s.lastError,
        circuitState: s.circuitBreaker.state,
      })),
    };
  }
}

// Initialize server pool
const serverPool = new ServerPool(config.loadBalancer.servers);

// Basic middleware
app.set('trust proxy', true);
app.use(cors(corsOptions()));
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Load balancer health check
app.get('/health', (req: Request, res: Response) => {
  const status = serverPool.getStatus();
  const healthy = status.healthyServers > 0;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    service: 'load-balancer',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    backends: status,
  });
});

// Load balancer status
app.get('/lb/status', (req: Request, res: Response) => {
  res.json(serverPool.getStatus());
});

// Metrics endpoint
app.get('/metrics', (req: Request, res: Response) => {
  res.set('Content-Type', 'text/plain');
  res.send(metricsService.getMetricsPrometheus());
});

// Proxy all other requests to backend servers
app.use('*', async (req: Request, res: Response): Promise<void> => {
  const extReq = req as ExtendedRequest;
  const server = serverPool.getNextServer();

  if (!server) {
    res.status(503).json({
      error: 'No healthy backend servers available',
      requestId: extReq.id,
    });
    return;
  }

  const targetUrl = `${server.url}${req.originalUrl}`;
  serverPool.requestStarted(server);

  const startTime = Date.now();

  try {
    const result = await server.circuitBreaker.execute(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      // Prepare headers
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (key !== 'host' && typeof value === 'string') {
          headers[key] = value;
        }
      }
      headers['x-request-id'] = extReq.id;
      headers['x-forwarded-for'] = req.ip || '';
      headers['x-forwarded-host'] = req.hostname;
      headers['x-forwarded-proto'] = req.protocol;

      // Prepare body
      let body: string | Buffer | undefined = undefined;
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        if (typeof req.body === 'object' && !(req.body instanceof Buffer)) {
          body = JSON.stringify(req.body);
          headers['content-type'] = 'application/json';
        } else {
          body = req.body;
        }
      }

      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response;
    });

    const duration = Date.now() - startTime;

    // Copy response headers
    for (const [key, value] of result.headers.entries()) {
      if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    // Add load balancer headers
    res.setHeader('X-Served-By', server.url);
    res.setHeader('X-Response-Time', `${duration}ms`);

    // Stream response body
    const responseBody = await result.text();
    res.status(result.status).send(responseBody);

    serverPool.requestCompleted(server, true);

    // Record metrics
    metricsService.recordRequest({
      method: req.method,
      path: req.path,
      status: result.status,
      duration,
    });

  } catch (error) {
    serverPool.requestCompleted(server, false);

    console.error(`Proxy error to ${server.url}:`, (error as Error).message);

    metricsService.recordError({
      method: req.method,
      path: req.path,
      error: (error as Error).name || 'ProxyError',
    });

    if ((error as Error).message.includes('Circuit breaker')) {
      res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Backend server is experiencing issues',
        requestId: extReq.id,
      });
      return;
    }

    res.status(502).json({
      error: 'Bad gateway',
      message: 'Failed to connect to backend server',
      requestId: extReq.id,
    });
  }
});

// Start server and health checks
const PORT = config.loadBalancer.port;
app.listen(PORT, () => {
  console.log(`Load Balancer running on port ${PORT}`);
  console.log(`Backend servers: ${config.loadBalancer.servers.join(', ')}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Status: http://localhost:${PORT}/lb/status`);

  // Start health checks
  serverPool.startHealthChecks(5000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  serverPool.stopHealthChecks();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  serverPool.stopHealthChecks();
  process.exit(0);
});
