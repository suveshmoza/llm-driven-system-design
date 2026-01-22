# Ad Click Aggregator - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 📋 Problem Statement

Design the backend infrastructure for a real-time ad click aggregation system. Key challenges include:
- High-volume click ingestion (10,000+ clicks/second)
- Exactly-once semantics for accurate billing
- Real-time aggregation with multiple time granularities
- Fraud detection pipeline
- OLAP analytics with sub-second query response

---

## 🎯 Requirements Clarification

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

---

## 🏗️ High-Level Architecture

```
+------------------+     +------------------+     +------------------+
|   Ad Servers     |---->|   Click API      |---->|     Redis        |
| (Click Sources)  |     |   (Express)      |     | (Dedup/Cache)    |
+------------------+     +--------+---------+     +------------------+
                                 |
                    +------------+------------+
                    |                         |
                    v                         v
          +------------------+      +------------------+
          |   Raw Storage    |      |   ClickHouse     |
          |  (PostgreSQL)    |      |  (Analytics)     |
          +------------------+      +--------+---------+
                                             |
                                    +--------+---------+
                                    | Materialized     |
                                    | Views (Auto-     |
                                    | Aggregation)     |
                                    +--------+---------+
                                             |
                                             v
                                  +------------------+
                                  |  Query Service   |
                                  |  (Analytics)     |
                                  +------------------+
```

### Core Components

| Component | Responsibility | Technology |
|-----------|----------------|------------|
| Click API | Receive clicks, validate, deduplicate | Express + REST |
| Redis Layer | Idempotency, dedup, rate limiting | Redis Cluster |
| Raw Storage | Business entities, audit trail | PostgreSQL |
| Analytics Storage | High-volume clicks, OLAP queries | ClickHouse |
| Query Service | Aggregated metrics, dashboards | Express + Cache |

---

## 🔐 Deep Dive: Exactly-Once Semantics

### The Billing Problem

Ad click billing requires exact counts. A 1% duplicate rate on 10M daily clicks = 100K phantom clicks = significant overbilling. We implement defense-in-depth idempotency.

### Multi-Layer Deduplication

```
+-------------------------------------------------------------+
|                   Three Layers of Defense                    |
+-------------------------------------------------------------+
|                                                              |
|  Layer 1: Idempotency-Key Header (Request Level)            |
|  +-------------------------------------------------------+  |
|  | Client sends X-Idempotency-Key header                 |  |
|  | Redis: Check idem:{key}                               |  |
|  | If exists: Return cached response                     |  |
|  | If new: Process, cache response for 5 min             |  |
|  +-------------------------------------------------------+  |
|                                                              |
|  Layer 2: click_id Deduplication (Click Level)              |
|  +-------------------------------------------------------+  |
|  | Redis SETNX: dedup:{click_id}                         |  |
|  | TTL: 5 minutes (300 seconds)                          |  |
|  | Returns NULL if key exists (duplicate)                |  |
|  +-------------------------------------------------------+  |
|                                                              |
|  Layer 3: PostgreSQL UPSERT (Storage Level)                 |
|  +-------------------------------------------------------+  |
|  | INSERT ... ON CONFLICT (click_id) DO NOTHING          |  |
|  | Last line of defense for edge cases                   |  |
|  +-------------------------------------------------------+  |
|                                                              |
+-------------------------------------------------------------+
```

### Deduplication Flow

```
+----------+     +-------------+     +-------------+     +-------------+
|  Client  |     |  Click API  |     |    Redis    |     | PostgreSQL  |
+----------+     +-------------+     +-------------+     +-------------+
     |                 |                   |                   |
     | POST /clicks    |                   |                   |
     | X-Idempotency   |                   |                   |
     |---------------->|                   |                   |
     |                 |                   |                   |
     |                 | GET idem:{key}    |                   |
     |                 |------------------>|                   |
     |                 |                   |                   |
     |                 |  [Cache HIT]      |                   |
     |                 |  Return cached    |                   |
     |                 |                   |                   |
     |                 |  [Cache MISS]     |                   |
     |                 |                   |                   |
     |                 | SETNX dedup:{id}  |                   |
     |                 |------------------>|                   |
     |                 |                   |                   |
     |                 |  [Key EXISTS]     |                   |
     |                 |  Return duplicate |                   |
     |                 |                   |                   |
     |                 |  [Key SET]        |                   |
     |                 |                   |                   |
     |                 | INSERT ... ON CONFLICT DO NOTHING     |
     |                 |---------------------------------------->|
     |                 |                   |                   |
     |                 | SET idem:{key}    |                   |
     |                 | (cache response)  |                   |
     |                 |------------------>|                   |
     |                 |                   |                   |
     | 202 Accepted    |                   |                   |
     |<----------------|                   |                   |
```

### Why Three Layers?

| Layer | Catches | Failure Mode |
|-------|---------|--------------|
| Idempotency-Key | Load balancer retries, network timeouts | Header not sent |
| Redis dedup | Duplicate click_ids from different requests | Redis down, TTL expired |
| PostgreSQL UPSERT | Edge cases where Redis fails | Last line of defense |

---

## 📊 Deep Dive: Hybrid Storage Architecture

### Storage Decision Matrix

| Data Type | Storage | Rationale |
|-----------|---------|-----------|
| Business entities | PostgreSQL | ACID, referential integrity |
| Raw click events | ClickHouse | 10K+ writes/sec, columnar compression |
| Aggregations | ClickHouse MVs | Auto-aggregation, fast OLAP |
| Audit trail | PostgreSQL | Billing disputes, legal hold |

### PostgreSQL Schema (Business Entities)

```
+------------------------+
|      advertisers       |
+------------------------+
| id: VARCHAR(50) PK     |
| name: VARCHAR(255)     |
| created_at: TIMESTAMPTZ|
+------------------------+
         |
         | 1:N
         v
+------------------------+
|       campaigns        |
+------------------------+
| id: VARCHAR(50) PK     |
| advertiser_id: FK      |
| name: VARCHAR(255)     |
| status: VARCHAR(20)    |
+------------------------+
         |
         | 1:N
         v
+------------------------+
|          ads           |
+------------------------+
| id: VARCHAR(50) PK     |
| campaign_id: FK        |
| name: VARCHAR(255)     |
+------------------------+
```

### ClickHouse Schema (Click Events)

```
+------------------------------------------+
|              click_events                 |
+------------------------------------------+
| click_id: String                          |
| ad_id: String                             |
| campaign_id: String                       |
| advertiser_id: String                     |
| user_id: Nullable(String)                 |
| timestamp: DateTime64(3)                  |
| device_type: LowCardinality(String)       |
| country: LowCardinality(String)           |
| is_fraudulent: UInt8                      |
+------------------------------------------+
| ENGINE: MergeTree()                       |
| PARTITION BY: toYYYYMM(timestamp)         |
| ORDER BY: (campaign_id, ad_id, timestamp) |
| TTL: timestamp + 90 DAY                   |
+------------------------------------------+
```

### Materialized Views for Auto-Aggregation

```
When click inserted:

+------------------+       +---------------------------+
|  click_events    | --->  | click_aggregates_minute_mv|
|  (raw data)      |       | (Materialized View)       |
+------------------+       +---------------------------+
                                      |
                                      | Aggregates on INSERT:
                                      | - count() as click_count
                                      | - uniqExact(user_id)
                                      | - countIf(is_fraudulent=1)
                                      v
                           +---------------------------+
                           | click_aggregates_minute   |
                           | (SummingMergeTree)        |
                           +---------------------------+
                           | time_bucket: DateTime     |
                           | ad_id, campaign_id        |
                           | advertiser_id, country    |
                           | device_type               |
                           | click_count: UInt64       |
                           | unique_users: UInt64      |
                           | fraud_count: UInt64       |
                           +---------------------------+
                           | TTL: time_bucket + 7 DAY  |
                           +---------------------------+
```

### SummingMergeTree Behavior

```
On compaction (automatic):

Before:
+--------+-------+-------------+
| bucket | ad_id | click_count |
+--------+-------+-------------+
| 10:00  | ad123 | 100         |
| 10:00  | ad123 | 50          |
| 10:00  | ad123 | 75          |
+--------+-------+-------------+

After:
+--------+-------+-------------+
| bucket | ad_id | click_count |
+--------+-------+-------------+
| 10:00  | ad123 | 225         |  <-- Auto-merged
+--------+-------+-------------+
```

---

## 🛡️ Deep Dive: Fraud Detection Pipeline

### Fraud Detection Architecture

```
Click Event → Fraud Rules Engine → Flag/Pass
                    |
                    +-- IP Velocity Check
                    |   (Redis INCR with TTL)
                    |
                    +-- User Velocity Check
                    |   (Redis INCR with TTL)
                    |
                    +-- Device Fingerprint Check
                    |   (Missing info = suspicious)
                    |
                    +-- Pattern Analysis
                        (Regular timing = bot)
```

### Velocity-Based Detection

```
+-----------------------------------------------+
|            IP Velocity Check                   |
+-----------------------------------------------+
|                                               |
| Key: ratelimit:ip:{ip_hash}                   |
| Operation: INCR (atomic counter)              |
| TTL: 60 seconds                               |
| Threshold: 100 clicks/minute                  |
|                                               |
| count = INCR key                              |
| if count == 1: EXPIRE key 60                  |
| if count > 100: FLAG as fraud                 |
|                                               |
+-----------------------------------------------+

+-----------------------------------------------+
|           User Velocity Check                  |
+-----------------------------------------------+
|                                               |
| Key: ratelimit:user:{user_id}                 |
| Operation: INCR (atomic counter)              |
| TTL: 60 seconds                               |
| Threshold: 50 clicks/minute                   |
|                                               |
+-----------------------------------------------+
```

### Fraud Rules Summary

| Rule | Threshold | Rationale |
|------|-----------|-----------|
| IP Velocity | > 100 clicks/min per IP | Bot detection |
| User Velocity | > 50 clicks/min per user | Click farm |
| Missing Device Info | No device, OS, browser | Automated script |
| Regular Timing | Clicks at exact intervals | Bot pattern |

### Fraud Handling

```
+-------------------------------------------+
|          Fraud Detection Result           |
+-------------------------------------------+
|                                           |
| Flagged clicks are:                       |
| 1. STORED in raw events (for analysis)   |
| 2. MARKED with is_fraudulent = 1         |
| 3. EXCLUDED from billing aggregates      |
|    (countIf excludes fraud_count)        |
| 4. AVAILABLE for fraud analysis reports  |
|                                           |
+-------------------------------------------+
```

---

## 📦 Deep Dive: Data Lifecycle Management

### Retention Policies

| Data Type | Hot Storage | TTL | Archive |
|-----------|-------------|-----|---------|
| Raw clicks (ClickHouse) | 90 days | Automatic | S3/Parquet |
| Minute aggregates | 7 days | ClickHouse TTL | N/A |
| Hourly aggregates | 1 year | Manual cleanup | PostgreSQL |
| Daily aggregates | Indefinite | N/A | N/A |
| Redis dedup keys | 5 minutes | TTL | N/A |
| Redis rate counters | 1 minute | TTL | N/A |

### Backfill Procedure

```
When bug fix requires aggregate rebuild:

+-------------------------------------------+
|         Rebuild Aggregates Flow           |
+-------------------------------------------+
|                                           |
| Step 1: Clear affected time range         |
| DELETE FROM click_aggregates_hour         |
| WHERE time_bucket BETWEEN start AND end   |
|                                           |
| Step 2: Rebuild from raw events           |
| INSERT INTO click_aggregates_hour         |
| SELECT                                    |
|   toStartOfHour(timestamp) as bucket,     |
|   ad_id, campaign_id, ...                 |
|   count() as click_count                  |
| FROM click_events                         |
| WHERE timestamp BETWEEN start AND end     |
| GROUP BY bucket, ad_id, campaign_id, ...  |
|                                           |
+-------------------------------------------+
```

### Redis Recovery on Restart

```
+-------------------------------------------+
|         Redis Warmup Procedure            |
+-------------------------------------------+
|                                           |
| On Redis restart, reload from ClickHouse: |
|                                           |
| 1. Recent click IDs (last hour)           |
|    Query: click_id FROM click_events      |
|            WHERE timestamp > NOW() - 1h   |
|    Load: SET dedup:{click_id} 1 EX 300    |
|                                           |
| 2. Rate limit counters (last minute)      |
|    Query: ip_hash, count() FROM clicks    |
|            WHERE timestamp > NOW() - 1min |
|    Load: SET ratelimit:ip:{hash} {cnt}    |
|                                           |
+-------------------------------------------+
```

---

## 📈 Deep Dive: Observability

### Key Metrics

| Metric | Type | Labels | Purpose |
|--------|------|--------|---------|
| clicks_received_total | Counter | status (success/duplicate/fraud) | Throughput tracking |
| click_ingestion_duration_seconds | Histogram | - | Latency monitoring |
| click_queue_lag_seconds | Gauge | - | Processing delay |
| aggregation_updates_total | Counter | granularity (min/hour/day) | Aggregation health |

### Latency Buckets

```
+------------------------------------------+
|     Ingestion Latency Distribution       |
+------------------------------------------+
|                                          |
| Buckets (seconds):                       |
| [0.001, 0.005, 0.01, 0.025, 0.05, 0.1]  |
|                                          |
| Target: p95 < 10ms                       |
| Alert: p95 > 100ms for 5 minutes         |
|                                          |
+------------------------------------------+
```

### Alert Thresholds

| Alert | Condition | Duration | Severity |
|-------|-----------|----------|----------|
| HighIngestionLatency | p95 > 100ms | 5 min | Warning |
| HighDuplicateRate | duplicate rate > 10% | 10 min | Warning |
| HighFraudRate | fraud rate > 5% | 5 min | Critical |
| QueueLag | lag > 60 seconds | 5 min | Critical |

---

## 📐 Scalability Considerations

### Horizontal Scaling

| Component | Scaling Strategy |
|-----------|-----------------|
| Click API | Stateless, load balancer (round-robin) |
| Redis | Cluster mode, sharded by key prefix |
| ClickHouse | ReplicatedMergeTree, sharding by campaign_id |
| PostgreSQL | Read replicas for analytics queries |

### Handling Traffic Spikes

```
Normal Traffic: 10K clicks/sec
Super Bowl:     100K clicks/sec (10x spike)

+-------------------------------------------+
|          Spike Handling Strategy          |
+-------------------------------------------+
|                                           |
| 1. Redis absorbs burst (in-memory)        |
|    - Dedup checks stay sub-millisecond    |
|    - Rate counters handled atomically     |
|                                           |
| 2. Async batch writes to ClickHouse       |
|    - Buffer in memory, flush every 100ms  |
|    - ClickHouse handles bulk inserts well |
|                                           |
| 3. Backpressure: Return 503 if queue full |
|    - Queue depth > threshold              |
|    - Client retries with exponential back |
|                                           |
| 4. Graceful degradation                   |
|    - Skip minute aggregates temporarily   |
|    - Prioritize hourly/daily aggregates   |
|                                           |
+-------------------------------------------+
```

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| OLAP Storage | ✅ ClickHouse | ❌ PostgreSQL | 10-100x faster analytics, auto-aggregation MVs |
| Entity Storage | ✅ PostgreSQL | ❌ ClickHouse | ACID, referential integrity for business data |
| Deduplication | ✅ Redis 3-layer | ❌ DB-only | Defense in depth, sub-ms checks |
| Aggregation | ✅ Sync on insert | ❌ Kafka async | Simpler, no additional infrastructure |
| Fraud Detection | ✅ Rule-based | ❌ ML model | Fast, interpretable, easy to tune thresholds |

---

## 🚀 Future Backend Enhancements

1. **Kafka Integration**: Async event streaming for higher throughput
2. **Flink/Spark Streaming**: Complex event processing, watermarking for late arrivals
3. **ML Fraud Detection**: Gradient Boosted Trees for pattern recognition
4. **Geo-Velocity Detection**: Impossible travel checks (user in NYC then Tokyo in 1 hour)
5. **Multi-Region Replication**: ClickHouse clusters per region for low latency
6. **Data Lake Archive**: Parquet files on S3 for historical analysis beyond 90 days
