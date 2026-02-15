# Health Data Pipeline - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 📋 Opening Statement (1 minute)

"I'll design a health data pipeline like Apple Health, which collects metrics from multiple devices, deduplicates overlapping data, and generates actionable health insights while maintaining strict privacy. The key backend challenges are handling data from diverse sources with different formats, accurately deduplicating overlapping measurements from multiple devices, and protecting highly sensitive health information under HIPAA requirements.

The core technical challenges are building a priority-based deduplication algorithm that handles overlapping time ranges, implementing efficient time-series storage with TimescaleDB hypertables, designing idempotent ingestion for unreliable mobile networks, and enforcing privacy-preserving data retention policies."

---

## 🎯 Requirements Clarification (3 minutes)

### Functional Requirements
- **Ingest**: Collect data from multiple devices (Apple Watch, iPhone, third-party scales, blood pressure monitors)
- **Process**: Aggregate, deduplicate, and normalize data from diverse sources
- **Store**: Persist with encryption in a time-series database
- **Query**: Fast access to historical data with pre-computed aggregates
- **Share**: Controlled, time-limited data sharing with healthcare providers

### Non-Functional Requirements
- **Privacy**: All data encrypted, minimal exposure, HIPAA-compliant retention
- **Reliability**: Zero data loss, idempotent ingestion across unreliable mobile networks
- **Latency**: Under 1 second for recent data queries, under 5ms for cached aggregates
- **Durability**: 7-year retention for raw health records

### Scale Estimates
- Millions of users with health data
- Each user has 2 to 5 devices syncing data
- Approximately 1,500 samples per day per user (heart rate at 1/min produces 1,440 alone)
- Years of historical data per user
- Write-heavy workload: 90% writes, 10% reads

---

## 🏗️ High-Level Architecture (5 minutes)

```
┌──────────────────────────────────────────────────────────────┐
│                       Data Sources                            │
│   Apple Watch  │   iPhone   │  Third-Party (scales, BP, etc.) │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                Ingestion Service (REST API)                    │
│     Validation  │  Normalization  │  Idempotency Check         │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  Message Queue (RabbitMQ)                      │
│       health-aggregation  │  health-insights queues            │
└────────────┬─────────────────────────────┬───────────────────┘
             │                             │
             ▼                             ▼
┌────────────────────────┐   ┌────────────────────────┐
│  Aggregation Worker     │   │   Insights Worker       │
│  - Deduplication        │   │   - Trend Detection     │
│  - Time Bucketing       │   │   - Alert Generation    │
│  - Aggregate Storage    │   │   - Severity Scoring    │
└────────────┬────────────┘   └────────────┬───────────┘
             │                             │
             ▼                             ▼
┌──────────────────────────────────────────────────────────────┐
│                       Storage Layer                           │
│  TimescaleDB (hypertables)  │  Valkey (cache, sessions)       │
│              MinIO (exports, cold archives)                    │
└──────────────────────────────────────────────────────────────┘
```

### Core Backend Components

| Component | Responsibility |
|-----------|----------------|
| Ingestion Service | Validates, normalizes, and inserts samples with idempotency key checking |
| Aggregation Worker | Consumes queue messages, deduplicates by device priority, computes hourly and daily aggregates |
| Insights Worker | Analyzes aggregate trends for heart rate, sleep, activity, and weight anomalies |
| Query API | Serves samples, aggregates, and summaries with Valkey caching |

---

## 💾 Deep Dive: Data Model (8 minutes)

### TimescaleDB Hypertables

TimescaleDB extends PostgreSQL with automatic time-based partitioning, making range queries on health data efficient without manual partition management.

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│     users        │       │  user_devices    │       │ health_samples   │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id (PK, UUID)    │──┐    │ id (PK, UUID)    │       │ id (PK, UUID)    │
│ email (unique)   │  │    │ user_id (FK)     │◄──────│ user_id (FK)     │
│ password_hash    │  │    │ device_type      │       │ type             │
│ name             │  │    │ device_name      │       │ value            │
│ role             │  │    │ device_identifier│       │ unit             │
│ created_at       │  │    │ priority         │       │ start_date       │
└─────────────────┘  │    │ last_sync        │       │ end_date         │
                     │    └─────────────────┘       │ source_device    │
                     │                               │ source_device_id │
                     │                               │ metadata (JSONB) │
                     │                               └─────────────────┘
                     │                                      │
                     │                       (hypertable, partitioned by start_date)
                     │
                     │    ┌─────────────────┐       ┌─────────────────┐
                     │    │health_aggregates │       │ health_insights  │
                     │    ├─────────────────┤       ├─────────────────┤
                     └────│ user_id (FK)     │       │ id (PK, UUID)    │
                          │ type             │       │ user_id (FK)     │
                          │ period           │       │ type             │
                          │ period_start     │       │ severity         │
                          │ value            │       │ direction        │
                          │ min_value        │       │ message          │
                          │ max_value        │       │ recommendation   │
                          │ sample_count     │       │ data (JSONB)     │
                          │ updated_at       │       │ acknowledged     │
                          └─────────────────┘       │ created_at       │
                                 │                  └─────────────────┘
                  (hypertable, partitioned by period_start)
```

### Device Priority Ranking

Higher priority means more trusted sensors. This ranking drives the deduplication algorithm.

| Device Type | Priority | Rationale |
|-------------|----------|-----------|
| Apple Watch | 100 | Direct skin contact, medical-grade optical and electrical sensors |
| iPhone | 80 | Motion coprocessor, CoreMotion integration, always carried |
| iPad | 70 | Similar sensors to iPhone but less frequently carried |
| Third-party wearable | 50 | Variable sensor quality across manufacturers |
| Third-party scale | 40 | Single-purpose device, infrequent measurements |
| Manual entry | 10 | Prone to user estimation error, no sensor verification |

### Key Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| idx_samples_user_type | (user_id, type, start_date DESC) | Dashboard and trend queries |
| idx_samples_device | (source_device_id) | Device-specific filtering and deduplication |
| idx_aggregates_user_type | (user_id, type, period, period_start DESC) | Chart data retrieval |
| idx_insights_unread | (user_id, acknowledged) WHERE acknowledged = false | Unread insight alerts |

### Compression Policy

TimescaleDB compresses older chunks automatically, reducing storage by approximately 10x for repetitive numeric health data.

```
                     Data Age Lifecycle
    ┌────────────────┬────────────────┬────────────────┐
    │    0-90 days    │  90 days-2 yr  │    2-7 years   │
    │      HOT        │      WARM      │      COLD      │
    ├────────────────┼────────────────┼────────────────┤
    │ Uncompressed    │ Compressed     │ MinIO Archive   │
    │ ~5ms queries    │ ~50ms queries  │ Minutes to      │
    │ Full read/write │ Read-only      │ restore         │
    └────────────────┴────────────────┴────────────────┘
                         │
            Compression ratio: ~10:1 for numeric health data
```

---

## 🔄 Deep Dive: Ingestion with Idempotency (8 minutes)

### Device Sync Flow

```
┌────────┐     POST /api/devices/:id/sync     ┌────────────┐
│ Device  │──────────────────────────────────▶│ Ingestion   │
│         │    { samples: [...] }              │ Service     │
│         │    X-Idempotency-Key: abc123       │             │
└────────┘                                    └──────┬──────┘
                                                     │
                            ┌────────────────────────┘
                            │
                            ▼
                 ┌────────────────────┐
                 │  Check Idempotency  │
                 │  Key in Valkey      │
                 └──────────┬─────────┘
                            │
                   ┌────────┴────────┐
                   │                  │
              (cache hit)        (cache miss)
                   │                  │
                   ▼                  ▼
           ┌──────────────┐  ┌───────────────┐
           │ Return cached │  │ Process Sync   │
           │ response      │  │ - Validate     │
           └──────────────┘  │ - Normalize    │
                              │ - Batch Insert │
                              └───────┬───────┘
                                      │
                                      ▼
                              ┌───────────────┐
                              │ Store response │
                              │ in Valkey      │
                              │ (24h TTL)      │
                              └───────┬───────┘
                                      │
                                      ▼
                              ┌───────────────┐
                              │ Queue for      │
                              │ aggregation    │
                              └───────────────┘
```

### Idempotency Key Strategy

When the client does not provide an X-Idempotency-Key header, the server generates one from the content: SHA-256(userId + deviceId + sorted JSON of samples). This ensures identical sync payloads produce the same key, preventing duplicate processing on network retries without requiring client-side key management.

> "I chose content-based idempotency over client-generated UUIDs because mobile health apps often retry silently after network timeouts. If the app generates a new UUID for each retry, the server would process the same data twice. Content hashing guarantees that identical payloads are recognized as duplicates regardless of how the client handles retries."

### Batch Insert with UPSERT

The ingestion pipeline validates each sample individually, collecting valid samples and errors separately. Valid samples are bulk-inserted using INSERT ... ON CONFLICT (id) DO NOTHING, which handles the case where a sample was previously inserted but the response was lost due to a network failure.

### API Design

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/v1/devices/:id/sync | Receive batch of samples from a device |
| GET | /api/v1/users/me/summary | Daily summary for a given date |
| GET | /api/v1/users/me/aggregates | Historical aggregates by type, period, and date range |
| GET | /api/v1/users/me/insights | Unacknowledged health insights |
| POST | /api/v1/users/me/share-tokens | Create a time-limited share token |
| GET | /api/v1/shared/:accessCode | Access shared data via token |
| DELETE | /api/v1/users/me/share-tokens/:id | Revoke a share token |

### Idempotency Key Storage

| Field | Type | Description |
|-------|------|-------------|
| key | VARCHAR(255) PK | SHA-256 hash of request content |
| user_id | UUID FK | Owner of the request |
| request_hash | VARCHAR(64) | Original payload hash for verification |
| response | JSONB | Cached response body |
| created_at | TIMESTAMP | Creation time |
| expires_at | TIMESTAMP | Auto-cleanup after 24 hours |

A daily cron job removes expired keys. Keys are also stored in Valkey with matching TTL for fast lookups, with the database serving as the durable fallback.

---

## 🔀 Deep Dive: Deduplication Algorithm (8 minutes)

### The Core Problem

When the same metric comes from multiple devices -- for example, steps from both an Apple Watch and an iPhone -- we must deduplicate to avoid double-counting. A user who walks 5,000 steps while wearing both devices should see 5,000 steps, not 10,000.

### Priority-Based Overlap Resolution

```
    Raw Samples for Time Window (e.g., 9:00 AM - 10:00 AM)
                         │
                         ▼
    ┌────────────────────────────────────────┐
    │ Sort by Device Priority (DESC)         │
    │ Apple Watch (100) processed first      │
    └────────────────────┬───────────────────┘
                         │
                         ▼
    ┌────────────────────────────────────────┐
    │ Initialize:                             │
    │   covered_ranges = []                   │
    │   result = []                           │
    └────────────────────┬───────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │ For each sample:  │
              └────────┬─────────┘
                       │
                       ▼
    ┌────────────────────────────────────────┐
    │ Check overlap with covered_ranges       │
    └────┬──────────────┬──────────────┬─────┘
         │              │              │
    (no overlap)   (partial)    (full overlap)
         │              │              │
         ▼              ▼              ▼
  ┌──────────┐  ┌──────────────┐  ┌────────┐
  │ Include   │  │ Adjust for   │  │ Skip   │
  │ full      │  │ non-overlap  │  │ sample │
  │ sample    │  │ portion      │  │        │
  └──────────┘  └──────────────┘  └────────┘
         │              │
         ▼              ▼
    ┌────────────────────────────────────────┐
    │ Add time range to covered_ranges       │
    └────────────────────────────────────────┘
```

### Overlap Scenarios Illustrated

**Case 1: No Overlap** -- Both samples cover distinct time windows. Include both fully.

```
Apple Watch: |═══════|
iPhone:                    |═══════|
             9:00   9:30           10:00  10:30
Result: Include both samples entirely
```

**Case 2: Partial Overlap** -- The lower-priority device covers a time window that partially overlaps with the higher-priority device. Include the Watch fully, and only the non-overlapping portion of the iPhone data.

```
Apple Watch: |═════════════|
iPhone:              |═════════════|
             9:00   9:30  10:00   10:30
Result: Watch covers 9:00-10:00, iPhone covers 10:00-10:30 only
```

**Case 3: Full Overlap** -- The lower-priority device is completely covered by the higher-priority device. Skip it entirely.

```
Apple Watch: |═══════════════════|
iPhone:          |═══════════|
             9:00  9:15  9:45  10:00
Result: Watch only, iPhone completely skipped
```

### Value Adjustment for Partial Overlap

For sum-based metrics like steps and calories, we proportionally adjust the lower-priority sample's value based on the remaining uncovered time fraction.

If the iPhone reports 2,000 steps for 9:30-10:30 but the Watch already covers 9:30-10:00 (50% overlap), the adjusted iPhone contribution is 1,000 steps for the 10:00-10:30 window only.

### Aggregation Strategies by Metric Type

| Metric Type | Strategy | Example |
|-------------|----------|---------|
| Steps | sum | Total steps for the hour or day |
| Distance | sum | Total distance walked |
| Heart Rate | average | Mean BPM for the period |
| Resting Heart Rate | average | Mean resting BPM |
| Weight | latest | Most recent measurement in the period |
| Body Fat | latest | Most recent measurement |
| Sleep | sum | Total minutes asleep |
| Active Energy | sum | Total calories burned |
| Blood Glucose | average | Mean glucose reading |
| Oxygen Saturation | average | Mean SpO2 percentage |

### Aggregate Storage

Aggregates are stored using UPSERT on the composite key (user_id, type, period, period_start). When new data arrives and triggers reaggregation, the existing aggregate row is updated in place rather than creating duplicates. This makes the aggregation pipeline naturally idempotent -- reprocessing the same date range produces the same result.

---

## 🔧 Deep Dive: Trade-off -- TimescaleDB vs InfluxDB for Time-Series Storage

**Decision**: Use TimescaleDB (PostgreSQL extension) over InfluxDB.

**Why TimescaleDB works for health data**: Health data requires joins between time-series measurements and relational metadata. A single query might need to join health_samples with user_devices (to get device priority for deduplication) and share_tokens (to verify access permissions). TimescaleDB is full PostgreSQL, so standard SQL JOINs, CTEs, and transactions work natively. The same database handles both the relational user model and the time-series health data.

**Why InfluxDB fails for this use case**: InfluxDB is optimized for pure time-series workloads like infrastructure metrics, where data flows in and is queried by time range only. It has no concept of foreign keys, transactions, or JOINs. For our deduplication algorithm, we need to query samples by (user_id, type, time_range) and then join with device priority -- this would require two separate queries to InfluxDB plus application-level joining. For the share token system, we need transactional guarantees when creating and validating tokens -- InfluxDB provides no ACID transactions.

**What we give up**: InfluxDB achieves higher write throughput for pure append workloads (millions of points per second vs. TimescaleDB's hundreds of thousands). At extreme scale with hundreds of millions of users, we might need to shard TimescaleDB across multiple instances. For the scale we're targeting (millions of users, ~1,500 samples/day/user), TimescaleDB's write performance is sufficient, and the operational simplicity of a single database engine outweighs InfluxDB's raw write speed.

---

## 💡 Deep Dive: Insights Engine (5 minutes)

### Insights Generation Pipeline

```
    Aggregation Worker publishes to health-insights queue
                         │
                         ▼
    ┌────────────────────────────────────────┐
    │  Insights Worker consumes message       │
    │  { userId, types: [...], dateRange }    │
    └────────┬──────────────┬────────────┬───┘
             │              │            │
             ▼              ▼            ▼
      ┌──────────┐  ┌────────────┐  ┌──────────┐
      │ Heart    │  │ Activity   │  │ Sleep    │
      │ Rate     │  │ Analysis   │  │ Deficit  │
      │ Trend    │  │            │  │ Check    │
      └──────────┘  └────────────┘  └──────────┘
             │              │            │
             └──────────────┼────────────┘
                            │
                            ▼
    ┌────────────────────────────────────────┐
    │  Store insights in health_insights      │
    │  table (only if threshold exceeded)     │
    └────────────────────────────────────────┘
```

### Heart Rate Trend Detection

The engine calculates linear regression over 30 days of resting heart rate aggregates. The slope formula is (n * SumXY - SumX * SumY) / (n * SumX^2 - (SumX)^2), where X is the day index (0 through 29) and Y is the resting heart rate value. An alert triggers when the absolute slope exceeds 0.5 BPM per day, indicating a clinically meaningful change over the observation window.

### Activity Comparison

The engine compares the current week's total steps to the 4-week rolling average. A percent change exceeding plus or minus 20% generates an insight. Positive changes produce encouraging "Great job" messages; negative changes prompt gentle "Activity is down" warnings.

### Insight Types and Thresholds

| Insight | Trigger Condition | Severity |
|---------|-------------------|----------|
| Heart Rate Trend | absolute slope > 0.5 BPM/day over 30 days | medium |
| Sleep Deficit | average sleep < 6 hours over 14 days | high |
| Activity Change | > 20% deviation from 4-week step average | low |
| Weight Change | > 3% body weight change over 30 days | medium |

---

## 🔧 Deep Dive: Trade-off -- Pre-Computed Aggregates vs On-Demand Calculation

**Decision**: Pre-compute hourly and daily aggregates in background workers.

**Why pre-computation works for health dashboards**: Every time a user opens the health dashboard, the app requests daily summaries for the selected date. With pre-computed aggregates, this is a single-row lookup by (user_id, type, period='day', period_start) -- an O(1) indexed read that returns in under 5ms. The dashboard displays 8 to 16 metric types, meaning 8 to 16 fast lookups versus scanning potentially thousands of raw samples per metric.

**Why on-demand calculation breaks down**: Consider a user who checks their dashboard 10 times per day. With on-demand aggregation, each visit scans all raw samples for the current day. For heart rate alone, that is 1,440 samples per day. Multiply by 16 metric types and 10 visits, and we are running 230,400 row scans daily for a single user. At millions of users, this query load would overwhelm the database, especially during morning hours when most users check their overnight sleep data simultaneously.

**What we give up**: Storage and write complexity. Pre-computed aggregates roughly double our storage footprint (25 aggregate rows per day per metric type on top of the raw samples). The aggregation worker adds architectural complexity -- we need a message queue, background processing, and cache invalidation logic. If the aggregation algorithm has a bug, we must replay affected date ranges to correct the data. Despite this complexity, the 100x reduction in read-path latency (5ms vs 500ms) and the elimination of hot-spot queries make pre-computation the clear winner for a dashboard-heavy application.

---

## 🔐 Deep Dive: Share Token System (3 minutes)

The share token system allows users to share specific health data with healthcare providers through time-limited, scope-restricted access codes.

```
┌─────────────────┐       ┌───────────────────────┐
│  share_tokens    │       │ Shared Data Access     │
├─────────────────┤       │ Flow                   │
│ id (PK, UUID)    │       └───────────┬───────────┘
│ user_id (FK)     │                   │
│ recipient_email  │                   ▼
│ data_types[]     │       ┌───────────────────────┐
│ date_start       │       │ 1. Validate token      │
│ date_end         │       │    - Not expired        │
│ expires_at       │       │    - Not revoked        │
│ access_code      │       │    - Recipient matches  │
│ revoked_at       │       └───────────┬───────────┘
└─────────────────┘                   │
                                      ▼
                           ┌───────────────────────┐
                           │ 2. Query only:          │
                           │    - Allowed types       │
                           │    - Within date range   │
                           │    - Daily aggregates    │
                           └───────────┬───────────┘
                                      │
                                      ▼
                           ┌───────────────────────┐
                           │ 3. Return filtered      │
                           │    health data           │
                           └───────────────────────┘
```

A token is valid only when all conditions are met: the access_code exists, expires_at is in the future, and revoked_at is null. Data access is further restricted to only the metric types listed in the data_types array and only dates within the date_start to date_end window. Providers receive daily aggregates only, never raw samples, limiting exposure of granular health data.

---

## 🔧 Deep Dive: Trade-off -- Batch Sync vs Real-Time Streaming for Device Ingestion

**Decision**: Use batch sync with idempotency over real-time streaming.

**Why batch sync works for mobile health devices**: Health data is collected continuously on-device but only needs to reach the server periodically. Apple Watch and iPhone accumulate samples locally and sync in batches (typically every few hours or when the device connects to WiFi). Batch sync aligns with this natural collection pattern. A single POST request sends hundreds of samples, amortizing the network overhead across the batch. The idempotency layer ensures safe retries when the mobile device loses connectivity mid-sync.

**Why real-time streaming fails for this use case**: WebSocket or gRPC streaming connections drain mobile device batteries because they require maintaining an active radio connection. A persistent stream from an Apple Watch would reduce battery life from 18 hours to under 6. Streaming also requires handling connection drops, reconnection logic, and partial message delivery -- all of which are more complex than the simple request-response pattern of batch sync. For health data where a 1-hour delay between collection and server-side availability is acceptable, the battery savings justify the latency trade-off.

**What we give up**: Timeliness. Real-time streaming would allow the server to detect critical health events (like an abnormal heart rate spike) within seconds of measurement. With batch sync, there could be a delay of hours between the measurement and the server receiving it. For truly urgent health alerts, on-device processing handles the immediate notification (the Apple Watch itself alerts the user), and the server's insights engine operates on the daily scale. This division of responsibility keeps the architecture simple while covering both immediate and long-term health monitoring.

---

## 📅 Data Retention and HIPAA Compliance (2 minutes)

| Data Type | Hot Retention | Warm Retention | Delete After |
|-----------|---------------|----------------|--------------|
| Raw samples | 90 days (uncompressed) | 2 years (compressed) | 7 years |
| Hourly aggregates | 90 days | N/A | 2 years |
| Daily aggregates | Forever | N/A | Never |
| Insights | 90 days | N/A | 2 years |
| Share tokens | Until expiry | N/A | 30 days after expiry |

A daily retention job runs at 3 AM, performing four operations in sequence: deleting raw samples older than 7 years, removing hourly aggregates older than 2 years, cleaning up insights older than 2 years, and purging expired share tokens. Each operation is logged to a retention_jobs audit table for compliance verification.

---

## ⚖️ Trade-offs Summary (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Time-series DB | ✅ TimescaleDB | ❌ InfluxDB | SQL compatibility, JOINs with relational data, ACID transactions |
| Aggregation | ✅ Pre-computed | ❌ On-demand | O(1) dashboard reads vs O(n) scans; 100x latency improvement |
| Deduplication | ✅ Priority-based | ❌ Latest-wins | Apple Watch sensors more accurate; consistent, predictable output |
| Sync model | ✅ Batch with idempotency | ❌ Real-time streaming | Battery efficiency on mobile, simpler retry semantics |
| Encryption | ✅ Per-user keys | ❌ Single system key | HIPAA compliance, breach isolation, selective sharing |
| Queue | ✅ RabbitMQ | ❌ Kafka | Simpler for single-consumer patterns, built-in retry and dead-letter queues |

---

## 🚀 Closing Summary (1 minute)

"The health data pipeline backend is built around three principles:

1. **Priority-based deduplication** -- When the same metric comes from multiple devices, we prioritize by sensor quality (Apple Watch over iPhone over third-party). Overlapping time ranges are proportionally adjusted for sum-based metrics like steps and calories, preventing double-counting that would mislead users about their health.

2. **Idempotent ingestion** -- Mobile devices on unreliable networks can safely retry sync requests. Content-based idempotency keys prevent duplicate processing without requiring client-side key management. The server detects identical payloads and returns cached responses.

3. **Tiered storage with pre-computed aggregates** -- TimescaleDB hypertables provide efficient time-series queries with automatic partitioning. Pre-computed hourly and daily aggregates enable sub-5ms dashboard rendering. Automatic compression reduces storage costs by 10x for data older than 90 days, and cold archives to MinIO handle the 7-year HIPAA retention requirement.

The main trade-off is complexity for accuracy. Priority-based deduplication with proportional overlap handling is significantly more complex than simply taking the latest value, but it ensures accurate totals for metrics like steps where double-counting would directly mislead users about their physical activity and health trajectory."
