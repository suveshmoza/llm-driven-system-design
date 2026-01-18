# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development - run all 3 services concurrently with watch mode
npm run dev

# Run individual services
npm run dev:collection   # Collection service (port 3001)
npm run dev:admin        # Admin service (port 3002)
npm run dev:inference    # Inference service (port 3003)

# Database operations
npm run db:migrate       # Run schema migrations
npm run db:seed-admin    # Create admin user

# Build
npm run build            # TypeScript compilation to dist/

# Testing
npm test                 # Run tests once (vitest)
npm run test:watch       # Watch mode

# Code quality
npm run lint             # ESLint
npm run format           # Prettier
```

## Architecture Overview

This is a TypeScript/Node.js microservices backend for a collaborative drawing game with ML-powered shape classification. It consists of three independent Express services:

### Services

1. **Collection Service** (port 3001) - High-write-throughput drawing submission API
   - Entry: `src/collection/index.ts`, routes in `src/collection/app.ts`
   - Handles: drawing uploads, shape listing, user stats

2. **Admin Service** (port 3002) - Data management and model training orchestration
   - Entry: `src/admin/index.ts`
   - Handles: dashboard stats, drawing curation, training job submission
   - Requires session-based authentication

3. **Inference Service** (port 3003) - ML model predictions and shape generation
   - Entry: `src/inference/index.ts`
   - Handles: drawing classification, procedural shape generation

### Data Layer

- **PostgreSQL**: Persistent storage (drawings, users, shapes, models, training_jobs)
- **MinIO**: S3-compatible object storage for stroke JSON and model files
- **Redis**: Caching and session storage
- **RabbitMQ**: Message queue for async training job processing

### Shared Infrastructure (`src/shared/`)

| Module | Purpose |
|--------|---------|
| `db.ts` | PostgreSQL pool + `withTransaction()` |
| `logger.ts` | Pino structured JSON logging |
| `cache.ts` | Redis wrapper with `cacheGet`, `cacheSet`, `CacheKeys` |
| `storage.ts` | MinIO client for drawings and models |
| `queue.ts` | RabbitMQ pub/sub for training jobs |
| `metrics.ts` | Prometheus metrics + `trackExternalCall()` |
| `circuitBreaker.ts` | Circuit breaker pattern for external services |
| `retry.ts` | Retry with exponential backoff (`RetryPresets`) |
| `idempotency.ts` | Duplicate request prevention middleware |
| `healthCheck.ts` | `/health/ready` and `/health/live` endpoints |
| `auth.ts` | Session-based authentication |
| `quality.ts` | Drawing quality scoring |
| `prototype.ts` | Shape prototype computation |
| `cleanup.ts` | Data lifecycle management |

## Key Patterns

### Circuit Breaker Usage
All external service calls (PostgreSQL, MinIO, RabbitMQ) should be wrapped with circuit breakers:
```typescript
const result = await postgresCircuitBreaker.execute(async () => {
  return trackExternalCall('postgres', 'select_shapes', async () => {
    return pool.query('SELECT ...')
  })
})
```

### Error Handling
Handle `CircuitBreakerOpenError` with 503 responses:
```typescript
if (error instanceof CircuitBreakerOpenError) {
  return res.status(503).json({
    error: 'Service temporarily unavailable',
    retryAfter: Math.ceil(error.retryAfterMs / 1000),
  })
}
```

### Caching Pattern
Use `CacheKeys` for consistent key naming:
```typescript
const cached = await cacheGet<object[]>(CacheKeys.shapes())
if (cached) return res.json(cached)
// ... load from DB ...
await cacheSet(CacheKeys.shapes(), result.rows, 300)
```

## Environment Variables

Required environment variables:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - PostgreSQL
- `REDIS_URL` - Redis connection
- `RABBITMQ_URL` - RabbitMQ connection
- `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` - MinIO
- `NODE_ENV` - development/production
- `LOG_LEVEL` - trace/debug/info/warn/error
- `FRONTEND_URL` - CORS origin for Admin service
