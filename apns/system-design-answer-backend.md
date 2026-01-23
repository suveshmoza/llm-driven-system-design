# APNs (Apple Push Notification Service) - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Opening Statement (1 minute)

"I'll design APNs from a backend engineering perspective, focusing on the infrastructure needed to deliver billions of push notifications daily. The core challenges are managing millions of concurrent device connections, implementing store-and-forward for reliable delivery, achieving sub-500ms latency for high-priority notifications, and maintaining exactly-once semantics where possible.

For this discussion, I'll emphasize the database schema design, caching strategies, connection management, and observability infrastructure."

---

## 🎯 Requirements Clarification (3 minutes)

### Functional Requirements

1. **Push Delivery**: Deliver notifications to devices with < 500ms latency for high-priority messages
2. **Token Registry**: Manage device token lifecycle (registration, invalidation, refresh)
3. **Store-and-Forward**: Queue notifications for offline devices with expiration policies
4. **Topic Subscriptions**: Subscribe devices to broadcast channels
5. **Feedback Service**: Report invalid tokens back to providers

### Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Throughput | 580K+ notifications/second | 50B per day |
| Latency | < 500ms for priority-10 | Real-time user experience |
| Reliability | 99.99% delivery to online devices | Critical for app engagement |
| Consistency | At-least-once with idempotency | Network failures require retries |

### Scale Estimates

| Metric | Value |
|--------|-------|
| Active Apple devices | 1 billion+ |
| Daily notifications | 50 billion (580K/sec) |
| Concurrent connections | Millions (persistent WebSocket) |
| Pending queue per device | Up to 100 notifications |
| Token registry size | 1B+ records, read-heavy |

> "This is a write-heavy system for notification ingestion but read-heavy for token lookups. The pending queue must be durable for offline devices."

---

## 🏗️ High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Provider Layer                                          │
│                    App Servers (Netflix, WhatsApp, etc.)                            │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                     │ HTTP/2 + JWT Auth
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              APNs Gateway                                            │
│         (Rate Limiting, JWT Validation, Payload Validation, Routing)                │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│    Token Registry    │  │    Push Service      │  │    Store Service     │
│                      │  │                      │  │                      │
│ - Token CRUD         │  │ - WebSocket manager  │  │ - Pending queue      │
│ - Topic subscriptions│  │ - Delivery routing   │  │ - Expiration cleanup │
│ - Invalidation       │  │ - Connection shards  │  │ - Collapse handling  │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
         │                          │                        │
         ▼                          ▼                        ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│    PostgreSQL        │  │       Redis          │  │    Feedback Queue    │
│    (Tokens, Logs)    │  │  (Connections, Rate) │  │    (Invalid Tokens)  │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

### Core Backend Components

| Component | Responsibility | Data Store |
|-----------|---------------|------------|
| APNs Gateway | HTTP/2 endpoint, JWT validation, rate limiting | Redis (rate limits) |
| Token Registry | Device token CRUD with hash-based storage | PostgreSQL |
| Push Service | Manages device connections and delivery routing | Redis (conn state) |
| Store Service | Queues notifications for offline devices | PostgreSQL |
| Feedback Service | Collects and exposes invalid token reports | PostgreSQL + Kafka |

---

## 🗄️ Deep Dive: Database Schema Design (8 minutes)

### Entity Relationship Model

```
┌──────────────────────────┐         ┌──────────────────────────┐
│      device_tokens       │◄────────│   topic_subscriptions    │
├──────────────────────────┤   1:N   ├──────────────────────────┤
│ device_id (PK)       UUID│         │ device_id (PK,FK)    UUID│
│ token_hash       VARCHAR │         │ topic (PK)         VARCHAR│
│ app_bundle_id    VARCHAR │         │ subscribed_at    TIMESTAMP│
│ device_info        JSONB │         └──────────────────────────┘
│ is_valid          BOOLEAN│
│ invalidated_at  TIMESTAMP│         ┌──────────────────────────┐
│ invalidation_reason      │◄────────│  pending_notifications   │
│   VARCHAR                │   1:N   ├──────────────────────────┤
│ created_at      TIMESTAMP│         │ id (PK)              UUID│
│ last_seen       TIMESTAMP│         │ device_id (FK)       UUID│
└────────────┬─────────────┘         │ payload             JSONB│
             │                       │ priority           INTEGER│
             │                       │ expiration       TIMESTAMP│
             │ 1:N                   │ collapse_id       VARCHAR│
             │                       │ created_at       TIMESTAMP│
             ▼                       │ UNIQUE(device_id,         │
┌──────────────────────────┐         │        collapse_id)       │
│       notifications      │         └──────────────────────────┘
├──────────────────────────┤
│ id (PK)              UUID│         ┌──────────────────────────┐
│ device_id (FK)       UUID│────────▶│       delivery_log       │
│ payload             JSONB│   1:1   ├──────────────────────────┤
│ priority           INTEGER│        │ notification_id (PK) UUID│
│ expiration       TIMESTAMP│        │ device_id (FK)       UUID│
│ collapse_id        VARCHAR│        │ status             VARCHAR│
│ status             VARCHAR│        │ delivered_at     TIMESTAMP│
│ created_at       TIMESTAMP│        └──────────────────────────┘
└──────────────────────────┘
                                     ┌──────────────────────────┐
                                     │      feedback_queue      │
                                     ├──────────────────────────┤
                                     │ id (PK)          BIGSERIAL│
                                     │ token_hash         VARCHAR│
                                     │ app_bundle_id      VARCHAR│
                                     │ reason             VARCHAR│
                                     │ timestamp        TIMESTAMP│
                                     └──────────────────────────┘
```

### Key Table Design Decisions

#### 1. Token Hashing for Security

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          device_tokens Table                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Core Columns:                                                                       │
│  ├── device_id: UUID PRIMARY KEY (auto-generated)                                   │
│  ├── token_hash: VARCHAR(64) UNIQUE NOT NULL  ◄── SHA-256 of raw token             │
│  ├── app_bundle_id: VARCHAR(200) NOT NULL                                           │
│  ├── device_info: JSONB (OS version, model, etc.)                                   │
│  └── is_valid: BOOLEAN DEFAULT TRUE                                                 │
│                                                                                      │
│  Lifecycle Columns:                                                                  │
│  ├── invalidated_at: TIMESTAMP (when token became invalid)                          │
│  ├── invalidation_reason: VARCHAR(50) (uninstalled, token_refresh, etc.)            │
│  ├── created_at: TIMESTAMP DEFAULT NOW()                                            │
│  └── last_seen: TIMESTAMP (updated on each connection)                              │
│                                                                                      │
│  Indexes:                                                                            │
│  ├── idx_tokens_valid: PARTIAL on token_hash WHERE is_valid = true                  │
│  └── idx_tokens_app: B-tree on app_bundle_id                                        │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

> "We hash tokens before storage using SHA-256. If the database is breached, attackers cannot use exposed hashes to send spam notifications. The 64-char hex output provides efficient fixed-length indexing."

#### 2. Collapse ID with UPSERT Pattern

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      Collapse ID Semantics                                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  UNIQUE CONSTRAINT on (device_id, collapse_id) enables atomic replacement:          │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐│
│  │  INSERT INTO pending_notifications (device_id, payload, priority, collapse_id) ││
│  │  VALUES (...)                                                                   ││
│  │  ON CONFLICT (device_id, collapse_id)                                           ││
│  │  DO UPDATE SET payload = NEW, priority = NEW, created_at = NOW()               ││
│  └────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                      │
│  Example: Sports score updates                                                       │
│  ├── collapse_id = "game-123-score"                                                 │
│  ├── First notification: "Score: 2-1" ──▶ Stored                                    │
│  ├── Second notification: "Score: 3-1" ──▶ Replaces first                           │
│  ├── Third notification: "Score: 4-1" ──▶ Replaces second                           │
│  └── Device comes online ──▶ Receives only "Score: 4-1"                             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

#### 3. Foreign Key Deletion Strategies

| Relationship | ON DELETE | Rationale |
|--------------|-----------|-----------|
| topic_subscriptions → device_tokens | CASCADE | Subscriptions meaningless without device |
| pending_notifications → device_tokens | CASCADE | Cannot deliver to deleted device |
| notifications → device_tokens | SET NULL | Preserve analytics history |
| delivery_log → device_tokens | SET NULL | Preserve audit trail |

---

## 💾 Deep Dive: Caching Strategy (7 minutes)

### Cache Topology

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Notification Request                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         Redis (Valkey) - L1 Cache                                    │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────┐ │
│  │ Token Lookups           │  │ Connection Mapping      │  │ Rate Limiting       │ │
│  │ cache:token:{hash}      │  │ conn:{deviceId}         │  │ rate:device:{id}    │ │
│  │ TTL: 1 hour             │  │ TTL: 5 min              │  │ TTL: 1 min          │ │
│  └─────────────────────────┘  └─────────────────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                     │ cache miss
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              PostgreSQL                                              │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Cache-Aside Pattern for Token Lookups

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         TokenRegistry.lookup(token)                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Step 1: Hash the raw token                                                          │
│  ├── tokenHash = SHA256(token)                                                       │
│  └── cacheKey = "cache:token:" + tokenHash                                           │
│                                                                                      │
│  Step 2: Check Redis cache first                                                     │
│  ├── cached = redis.GET(cacheKey)                                                    │
│  ├── IF cached exists ──▶ Return cached device (cache HIT)                          │
│  └── metrics.cacheHit.labels("token").inc()                                          │
│                                                                                      │
│  Step 3: Check negative cache (known invalid tokens)                                 │
│  ├── invalid = redis.EXISTS("cache:token:invalid:" + tokenHash)                      │
│  └── IF invalid ──▶ Return null (skip DB query)                                     │
│                                                                                      │
│  Step 4: Query PostgreSQL on cache miss                                              │
│  ├── SELECT * FROM device_tokens WHERE token_hash = $1 AND is_valid = true          │
│  ├── IF no rows ──▶ Set negative cache (5 min TTL), return null                     │
│  └── IF found ──▶ Cache result (1 hour TTL), return device                          │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Token Invalidation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      TokenRegistry.invalidateToken(token, reason)                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Step 1: Update PostgreSQL                                                           │
│  ├── UPDATE device_tokens SET                                                        │
│  │     is_valid = false,                                                             │
│  │     invalidated_at = NOW(),                                                       │
│  │     invalidation_reason = reason                                                  │
│  └── WHERE token_hash = SHA256(token)                                                │
│                                                                                      │
│  Step 2: Explicit cache invalidation                                                 │
│  ├── redis.DEL("cache:token:" + tokenHash)  ◄── Remove valid cache                 │
│  └── redis.SETEX("cache:token:invalid:" + tokenHash, 3600, reason)                  │
│                                                                                      │
│  Step 3: Report to feedback service                                                  │
│  └── feedbackService.reportInvalidToken(token, reason)                               │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### TTL Configuration Matrix

| Cache Key Pattern | TTL | Rationale |
|-------------------|-----|-----------|
| `cache:token:{hash}` | 1 hour | Tokens stable, long TTL reduces DB load |
| `cache:token:invalid:{hash}` | 5-60 min | Prevents repeated failed lookups |
| `conn:{deviceId}` | 5 min | Connection server location, short for reconnects |
| `rate:device:{id}` | 1 min | Sliding window rate limiting |
| `rate:app:{bundleId}` | 1 min | Per-app rate limiting |
| `cache:idem:{notificationId}` | 24 hours | Idempotency window for retries |

### Write-Through for Connection State

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      Connection State Management                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  On Device Connect:                                                                  │
│  ├── Immediately update Redis (write-through)                                       │
│  │   └── SETEX "conn:{deviceId}" 300 { serverId, connectedAt }                      │
│  ├── Store connection in local map                                                   │
│  └── Trigger delivery of pending notifications                                       │
│                                                                                      │
│  On Device Disconnect:                                                               │
│  ├── Immediately delete from Redis                                                   │
│  │   └── DEL "conn:{deviceId}"                                                       │
│  └── Remove from local connection map                                                │
│                                                                                      │
│  Why Write-Through (not Cache-Aside)?                                                │
│  └── Connection state must be immediately consistent ──▶ no stale data allowed      │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📬 Deep Dive: Store-and-Forward Queue (5 minutes)

### Queue Management for Offline Devices

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      StoreService.storeForDelivery(notification)                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Step 1: Check expiration                                                            │
│  ├── IF notification.expiration < NOW() ──▶ Reject (already expired)               │
│  └── metrics.notificationExpired.inc()                                               │
│                                                                                      │
│  Step 2: Atomic insert/update with collapse semantics                                │
│  ├── INSERT INTO pending_notifications                                               │
│  │     (id, device_id, payload, priority, expiration, collapse_id)                  │
│  │   VALUES (...)                                                                    │
│  │   ON CONFLICT (device_id, collapse_id)                                            │
│  │   DO UPDATE SET payload, priority, created_at = NOW()                            │
│  └── metrics.notificationQueued.inc()                                                │
│                                                                                      │
│  Return: { queued: true } or { expired: true }                                       │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Deliver Pending on Reconnect

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      StoreService.deliverPending(deviceId, connection)               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Step 1: Fetch pending notifications                                                 │
│  ├── SELECT * FROM pending_notifications                                             │
│  │   WHERE device_id = $1                                                            │
│  │   AND (expiration IS NULL OR expiration > NOW())                                  │
│  │   ORDER BY priority DESC, created_at ASC                                          │
│  └── LIMIT 100  ◄── Cap to prevent flooding                                         │
│                                                                                      │
│  Step 2: Deliver each notification                                                   │
│  ├── FOR EACH notification:                                                          │
│  │   ├── connection.send(JSON.stringify(notification))                               │
│  │   └── Mark as delivered in delivery_log                                           │
│                                                                                      │
│  Step 3: Clean up after delivery                                                     │
│  └── DELETE FROM pending_notifications WHERE device_id = $1                          │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Background Cleanup Job

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      StoreService.cleanupExpired() - Runs every 5 minutes            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  DELETE FROM pending_notifications                                                   │
│  WHERE expiration IS NOT NULL AND expiration < NOW()                                 │
│  RETURNING id                                                                        │
│                                                                                      │
│  Log: { event: "expired_cleanup", count: result.rowCount }                           │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Priority Queue Semantics

| Priority | Value | Delivery Behavior |
|----------|-------|-------------------|
| Immediate | 10 | Wake device, deliver now |
| Background | 5 | Deliver during power nap |
| Low | 1 | Batch, deliver opportunistically |

---

## 🔐 Deep Dive: Idempotency and Consistency (5 minutes)

### Multi-Layer Idempotency

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                      NotificationService.processNotification(...)                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Input: token, payload, headers (including apns-id)                                  │
│  notificationId = headers["apns-id"] OR generate UUID                                │
│                                                                                      │
│  Layer 1: Redis Idempotency Check (fast path)                                        │
│  ├── dedupKey = "cache:idem:" + notificationId                                       │
│  ├── existing = redis.GET(dedupKey)                                                  │
│  ├── IF existing ──▶ Return cached result (duplicate detected)                      │
│  └── metrics.duplicateDetected.inc()                                                 │
│                                                                                      │
│  Layer 2: Database UPSERT (durable dedup)                                            │
│  ├── INSERT INTO delivery_log (notification_id, device_id, status)                   │
│  │   VALUES ($1, $2, "pending")                                                      │
│  │   ON CONFLICT (notification_id) DO NOTHING                                        │
│  │   RETURNING notification_id                                                       │
│  ├── IF rowCount = 0 ──▶ Already processed, return existing status                  │
│                                                                                      │
│  Layer 3: Process and cache result                                                   │
│  ├── result = deliverOrQueue(device, payload, headers)                               │
│  ├── redis.SETEX(dedupKey, 86400, JSON.stringify(result))  ◄── 24h TTL              │
│  └── Return result                                                                   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Consistency Model

| Operation | Consistency | Rationale |
|-----------|-------------|-----------|
| Token registration | Strong (PostgreSQL) | Must be immediately queryable |
| Notification delivery | At-least-once | Network failures require retry support |
| Pending queue | Last-write-wins (collapse) | Intentional replacement semantics |
| Delivery log | Eventual | Can lag actual delivery slightly |

---

## 📊 Deep Dive: Observability (5 minutes)

### Prometheus Metrics

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Core Metrics                                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Notification Lifecycle:                                                             │
│  ├── apns_notifications_sent_total                                                   │
│  │   └── Labels: priority, status (delivered/queued/expired/failed)                  │
│  ├── apns_notification_delivery_seconds (Histogram)                                  │
│  │   └── Buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]                                 │
│  └── apns_pending_notifications (Gauge)                                              │
│                                                                                      │
│  Connection Management:                                                              │
│  ├── apns_active_device_connections (Gauge)                                          │
│  └── apns_connection_duration_seconds (Histogram)                                    │
│                                                                                      │
│  Cache Efficiency:                                                                   │
│  └── apns_cache_operations_total                                                     │
│      └── Labels: cache (token/connection), result (hit/miss)                        │
│                                                                                      │
│  Token Registry:                                                                     │
│  └── apns_token_operations_total                                                     │
│      └── Labels: operation (register/invalidate/lookup)                             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Alert Thresholds

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Critical Alerts                                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  DeliverySuccessRateLow (severity: critical)                                         │
│  ├── Condition: delivery_success_rate < 99.99% for 5 minutes                         │
│  ├── Query: sum(rate(sent{status="delivered"})) / sum(rate(sent)) < 0.9999          │
│  └── Action: Page on-call engineer                                                   │
│                                                                                      │
│  HighPriorityLatencyHigh (severity: critical)                                        │
│  ├── Condition: p99 latency for priority-10 > 500ms for 5 minutes                    │
│  ├── Query: histogram_quantile(0.99, rate(delivery_seconds{priority="10"})) > 0.5   │
│  └── Action: Page on-call engineer                                                   │
│                                                                                      │
│  PendingBacklogHigh (severity: warning)                                              │
│  ├── Condition: pending_notifications > 100,000 for 10 minutes                       │
│  └── Action: Notify team Slack channel                                               │
│                                                                                      │
│  CacheHitRatioLow (severity: warning)                                                │
│  ├── Condition: cache hit ratio < 90% for 5 minutes                                  │
│  ├── Query: sum(rate(cache{result="hit"})) / sum(rate(cache)) < 0.90                │
│  └── Action: Investigate cache sizing or TTL configuration                          │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Structured Logging

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           Log Events                                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Notification Delivery Log:                                                          │
│  {                                                                                   │
│    event: "notification_delivery",                                                   │
│    notification_id: "uuid",                                                          │
│    device_id: "uuid",                                                                │
│    priority: 10,                                                                     │
│    status: "delivered" | "queued" | "failed",                                        │
│    latency_ms: 45                                                                    │
│  }                                                                                   │
│                                                                                      │
│  Token Audit Log (security events):                                                  │
│  {                                                                                   │
│    type: "token_audit",                                                              │
│    event: "registered" | "invalidated" | "lookup_failed",                            │
│    token_hash_prefix: "a1b2c3d4",  ◄── First 8 chars only for debugging             │
│    app_bundle_id: "com.example.app",                                                 │
│    actor: "system" | "provider",                                                     │
│    reason: "uninstalled"                                                             │
│  }                                                                                   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Backend Rationale |
|----------|--------|-------------|-------------------|
| Token storage | SHA-256 hash | Plaintext | Security: tokens useless if DB breached |
| Pending queue | PostgreSQL | Redis | Durability trumps speed for offline queue |
| Cache strategy | Cache-aside | Write-through | Simpler invalidation, acceptable latency |
| Collapse handling | DB UPSERT | Application logic | Atomic, conflict-free |
| Connection state | Redis write-through | Cache-aside | Must be immediately consistent |
| Idempotency window | 24 hours | Shorter | Balance memory vs retry protection |

---

## 🔮 Future Backend Enhancements

| Enhancement | Complexity | Value |
|-------------|------------|-------|
| Connection sharding by device ID hash | High | Horizontal scaling |
| Read replicas for token lookups | Medium | Reduce primary DB load |
| Kafka for inter-shard routing | High | Decouple services |
| PgBouncer connection pooling | Low | Reduce DB connection overhead |
| Redis Cluster for cache sharding | Medium | Cache horizontal scaling |
| Batch inserts for high-throughput | Medium | Reduce round-trips |
| Multi-region active-active | High | Global fault tolerance |
| Circuit breakers for Redis failures | Low | Graceful degradation |
| Distributed tracing (OpenTelemetry) | Medium | Request flow visibility |
| Log aggregation (ELK stack) | Medium | Centralized debugging |

---

## 🎤 Interview Wrap-up

> "We've designed a push notification backend that handles 580K notifications per second with sub-500ms latency for high-priority messages. Token security is ensured through SHA-256 hashing. The cache-aside pattern with Redis provides 90%+ hit rates on token lookups while PostgreSQL ensures durability for the pending notification queue. Collapse ID semantics with UPSERT enable atomic notification replacement for offline devices. Multi-layer idempotency prevents duplicate deliveries even with provider retries. The observability stack with Prometheus metrics and structured logging enables proactive alerting on SLO breaches."
