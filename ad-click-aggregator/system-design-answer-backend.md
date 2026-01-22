# Ad Click Aggregator - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a real-time ad click aggregation system. Key challenges include:
- High-volume click ingestion (10,000+ clicks/second)
- Exactly-once semantics for accurate billing
- Real-time aggregation with multiple time granularities
- Fraud detection pipeline
- OLAP analytics with sub-second query response

## Requirements Clarification

### Functional Requirements
1. **Click Ingestion**: Record every ad click with metadata (ad_id, campaign_id, user_id, timestamp, geo, device)
2. **Real-time Aggregation**: Aggregate clicks by dimensions (per ad, per campaign, per hour, per geo)
3. **Reporting API**: Query aggregated data for dashboards and billing
4. **Fraud Detection**: Identify and filter suspicious click patterns based on velocity

### Non-Functional Requirements
1. **Throughput**: 10,000 clicks/second write capacity
2. **Latency**: Writes < 10ms, queries < 100ms for aggregations
3. **Consistency**: Exactly-once semantics for billing accuracy
4. **Availability**: 99.9% uptime target

### Scale Estimates
- 10,000 clicks/second = 864 million clicks/day
- Each click event: ~500 bytes
- Daily raw data: 864M x 500B = ~430 GB/day
- 30-day raw retention: ~13 TB

## High-Level Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Ad Servers    │────▶│  Click API      │────▶│     Redis       │
│ (Click Sources) │     │  (Express)      │     │  (Dedup/Cache)  │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                │
                   ┌────────────┴────────────┐
                   ▼                         ▼
         ┌─────────────────┐      ┌─────────────────┐
         │   Raw Storage   │      │   ClickHouse    │
         │  (PostgreSQL)   │      │  (Analytics)    │
         └─────────────────┘      └────────┬────────┘
                                           │
                                  ┌────────┴────────┐
                                  │ Materialized    │
                                  │ Views (Auto-    │
                                  │ Aggregation)    │
                                  └────────┬────────┘
                                           │
                                           ▼
                                ┌─────────────────┐
                                │  Query Service  │
                                │  (Analytics)    │
                                └─────────────────┘
```

## Deep Dive: Exactly-Once Semantics

### The Billing Problem

Ad click billing requires exact counts. A 1% duplicate rate on 10M daily clicks = 100K phantom clicks = significant overbilling. We implement defense-in-depth idempotency:

### Multi-Layer Deduplication

```typescript
// Layer 1: Idempotency-Key Header (Request Level)
app.post('/api/v1/clicks', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (idempotencyKey) {
    const cached = await redis.get(`idem:${idempotencyKey}`);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
  }

  // Process click...
  const result = await processClick(req.body);

  if (idempotencyKey) {
    // Cache response for 5 minutes
    await redis.setex(`idem:${idempotencyKey}`, 300, JSON.stringify(result));
  }

  return res.status(202).json(result);
});

// Layer 2: click_id Deduplication (Click Level)
async function isDuplicate(clickId: string): Promise<boolean> {
  // SETNX returns 1 if key was set, 0 if already exists
  const result = await redis.set(`dedup:${clickId}`, '1', 'EX', 300, 'NX');
  return result === null;  // null means key already existed
}

// Layer 3: PostgreSQL UPSERT (Storage Level)
const insertQuery = `
  INSERT INTO click_events (click_id, ad_id, campaign_id, ...)
  VALUES ($1, $2, $3, ...)
  ON CONFLICT (click_id) DO NOTHING
  RETURNING id
`;
```

### Why Three Layers?

| Layer | Catches | Failure Mode |
|-------|---------|--------------|
| Idempotency-Key | Load balancer retries, network timeouts | Header not sent |
| Redis dedup | Duplicate click_ids from different requests | Redis down, TTL expired |
| PostgreSQL UPSERT | Edge cases where Redis fails | Last line of defense |

## Deep Dive: Hybrid Storage Architecture

### Why PostgreSQL + ClickHouse?

```sql
-- PostgreSQL: Business Entities (ACID Required)
CREATE TABLE advertisers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE campaigns (
    id VARCHAR(50) PRIMARY KEY,
    advertiser_id VARCHAR(50) NOT NULL REFERENCES advertisers(id),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE ads (
    id VARCHAR(50) PRIMARY KEY,
    campaign_id VARCHAR(50) NOT NULL REFERENCES campaigns(id),
    name VARCHAR(255) NOT NULL
);
```

```sql
-- ClickHouse: Click Events (High Write Throughput)
CREATE TABLE click_events (
    click_id String,
    ad_id String,
    campaign_id String,
    advertiser_id String,
    user_id Nullable(String),
    timestamp DateTime64(3),
    device_type LowCardinality(String) DEFAULT 'unknown',
    country LowCardinality(String) DEFAULT 'unknown',
    is_fraudulent UInt8 DEFAULT 0
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (campaign_id, ad_id, timestamp, click_id)
TTL timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;
```

### ClickHouse Materialized Views

```sql
-- Auto-aggregation on insert
CREATE MATERIALIZED VIEW click_aggregates_minute_mv
TO click_aggregates_minute
AS SELECT
    toStartOfMinute(timestamp) AS time_bucket,
    ad_id, campaign_id, advertiser_id, country, device_type,
    count() AS click_count,
    uniqExact(user_id) AS unique_users,
    countIf(is_fraudulent = 1) AS fraud_count
FROM click_events
GROUP BY time_bucket, ad_id, campaign_id, advertiser_id, country, device_type;

-- SummingMergeTree automatically aggregates during compaction
CREATE TABLE click_aggregates_minute (
    time_bucket DateTime,
    ad_id String,
    campaign_id String,
    advertiser_id String,
    country LowCardinality(String),
    device_type LowCardinality(String),
    click_count UInt64,
    unique_users UInt64,
    fraud_count UInt64
) ENGINE = SummingMergeTree((click_count, fraud_count))
PARTITION BY toYYYYMM(time_bucket)
ORDER BY (time_bucket, ad_id, campaign_id, country, device_type)
TTL time_bucket + INTERVAL 7 DAY;
```

### Storage Decision Matrix

| Data Type | Storage | Rationale |
|-----------|---------|-----------|
| Business entities | PostgreSQL | ACID, referential integrity |
| Raw click events | ClickHouse | 10K+ writes/sec, columnar compression |
| Aggregations | ClickHouse MVs | Auto-aggregation, fast OLAP |
| Audit trail | PostgreSQL | Billing disputes, legal hold |

## Deep Dive: Fraud Detection Pipeline

### Real-Time Rules Engine

```typescript
interface FraudRule {
  name: string;
  check: (click: ClickEvent, context: FraudContext) => Promise<boolean>;
  reason: string;
}

const fraudRules: FraudRule[] = [
  {
    name: 'ip_velocity',
    check: async (click, ctx) => {
      const key = `ratelimit:ip:${click.ip_hash}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      return count > 100;  // > 100 clicks/minute per IP
    },
    reason: 'velocity_ip',
  },
  {
    name: 'user_velocity',
    check: async (click, ctx) => {
      const key = `ratelimit:user:${click.user_id}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 60);
      return count > 50;  // > 50 clicks/minute per user
    },
    reason: 'velocity_user',
  },
  {
    name: 'missing_device_info',
    check: async (click) => {
      return !click.device_type && !click.os && !click.browser;
    },
    reason: 'suspicious_device',
  },
];

async function detectFraud(click: ClickEvent): Promise<FraudResult> {
  for (const rule of fraudRules) {
    if (await rule.check(click, {})) {
      return { isFraudulent: true, reason: rule.reason };
    }
  }
  return { isFraudulent: false, reason: null };
}
```

### Fraud Detection Architecture

```
Click Event → Fraud Rules Engine → Flag/Pass
                    │
                    ├── IP Velocity (Redis INCR)
                    ├── User Velocity (Redis INCR)
                    ├── Device Fingerprint
                    └── Pattern Analysis

Flagged clicks are stored but marked:
- Still counted in raw events
- Excluded from billing aggregates
- Available for fraud analysis
```

## Deep Dive: Data Lifecycle Management

### Retention Policies

| Data Type | Hot Storage | TTL | Archive |
|-----------|-------------|-----|---------|
| Raw clicks (ClickHouse) | 90 days | Automatic | S3/Parquet |
| Minute aggregates | 7 days | ClickHouse TTL | N/A |
| Hourly aggregates | 1 year | Manual cleanup | PostgreSQL |
| Daily aggregates | Indefinite | N/A | N/A |
| Redis dedup keys | 5 minutes | TTL | N/A |
| Redis rate counters | 1 minute | TTL | N/A |

### Backfill and Replay Procedures

```sql
-- Rebuild aggregates after bug fix
-- Step 1: Clear affected time range
DELETE FROM click_aggregates_hour
WHERE time_bucket BETWEEN '2024-01-15 00:00:00' AND '2024-01-15 23:59:59';

-- Step 2: Rebuild from raw events
INSERT INTO click_aggregates_hour
SELECT
    toStartOfHour(timestamp) as time_bucket,
    ad_id, campaign_id, advertiser_id, country, device_type,
    count() as click_count,
    uniqExact(user_id) as unique_users,
    countIf(is_fraudulent = 1) as fraud_count
FROM click_events
WHERE timestamp BETWEEN '2024-01-15 00:00:00' AND '2024-01-15 23:59:59'
GROUP BY time_bucket, ad_id, campaign_id, advertiser_id, country, device_type;
```

### Redis Recovery on Restart

```typescript
async function warmupRedisCounters(): Promise<void> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Reload recent click IDs for deduplication
  const recentClicks = await clickhouse.query(`
    SELECT click_id FROM click_events
    WHERE timestamp > toDateTime64('${hourAgo.toISOString()}', 3)
  `);

  for (const row of recentClicks) {
    await redis.set(`dedup:${row.click_id}`, '1', 'EX', 300);
  }

  // Reload rate limit counters
  const rateLimits = await clickhouse.query(`
    SELECT ip_hash, count() as cnt FROM click_events
    WHERE timestamp > now() - INTERVAL 1 MINUTE
    GROUP BY ip_hash
  `);

  for (const row of rateLimits) {
    await redis.set(`ratelimit:ip:${row.ip_hash}`, row.cnt, 'EX', 60);
  }
}
```

## Deep Dive: Observability

### Prometheus Metrics

```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

// Ingestion metrics
const clicksReceived = new Counter({
  name: 'clicks_received_total',
  help: 'Total clicks received',
  labelNames: ['status'],  // 'success', 'duplicate', 'fraud'
});

const ingestionLatency = new Histogram({
  name: 'click_ingestion_duration_seconds',
  help: 'Click ingestion latency',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
});

// Queue lag metrics
const queueLag = new Gauge({
  name: 'click_queue_lag_seconds',
  help: 'Age of oldest unprocessed click',
});

// Storage metrics
const aggregationUpdates = new Counter({
  name: 'aggregation_updates_total',
  help: 'Aggregation table updates',
  labelNames: ['granularity'],  // 'minute', 'hour', 'day'
});
```

### Alert Thresholds

```yaml
groups:
  - name: ad-click-aggregator
    rules:
      - alert: HighIngestionLatency
        expr: histogram_quantile(0.95, rate(click_ingestion_duration_seconds_bucket[5m])) > 0.1
        for: 5m
        annotations:
          summary: "Click ingestion p95 latency > 100ms"

      - alert: HighDuplicateRate
        expr: rate(clicks_received_total{status="duplicate"}[5m]) / rate(clicks_received_total[5m]) > 0.1
        for: 10m
        annotations:
          summary: "Duplicate click rate > 10%"

      - alert: HighFraudRate
        expr: rate(clicks_received_total{status="fraud"}[5m]) / rate(clicks_received_total[5m]) > 0.05
        for: 5m
        annotations:
          summary: "Fraud rate exceeds 5%"
```

## Scalability Considerations

### Horizontal Scaling

| Component | Scaling Strategy |
|-----------|-----------------|
| Click API | Stateless, load balancer |
| Redis | Cluster mode, sharded by key |
| ClickHouse | ReplicatedMergeTree, sharding by campaign_id |
| PostgreSQL | Read replicas for analytics |

### Handling Traffic Spikes

```
Normal: 10K clicks/sec
Super Bowl: 100K clicks/sec (10x)

Strategy:
1. Redis absorbs burst (in-memory)
2. Async batch writes to ClickHouse
3. Backpressure: Return 503 if queue > threshold
4. Degradation: Skip minute aggregates, prioritize hourly
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| ClickHouse for analytics | 10-100x faster OLAP, auto-aggregation MVs | Additional infrastructure |
| PostgreSQL for entities | ACID, referential integrity | Not for high-volume time-series |
| Redis 3-layer dedup | Defense in depth, sub-ms checks | Memory cost, TTL edge cases |
| Sync aggregation | Simple, no Kafka needed | Higher per-click latency |
| Rule-based fraud | Fast, interpretable | Less accurate than ML |

## Future Backend Enhancements

1. **Kafka Integration**: Async event streaming for higher throughput
2. **Flink/Spark Streaming**: Complex event processing, watermarking
3. **ML Fraud Detection**: Gradient Boosted Trees for pattern recognition
4. **Geo-Velocity Detection**: Impossible travel checks
5. **Multi-Region Replication**: ClickHouse clusters per region
6. **Data Lake Archive**: Parquet files on S3 for historical analysis
