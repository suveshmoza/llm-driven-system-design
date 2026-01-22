# Payment System - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a payment processing system that:
- Processes credit card, debit card, and bank transfer transactions
- Handles refunds with proper double-entry accounting
- Detects fraud in real-time
- Scales to handle 2,000+ transactions per second

## Requirements Clarification

### Functional Requirements
1. **Payment Processing**: Authorize, capture, void, and settle payments
2. **Idempotency**: Retry-safe operations preventing double-charges
3. **Refunds**: Full and partial refunds with ledger reconciliation
4. **Multi-Currency**: Real-time conversion with locked exchange rates
5. **Fraud Detection**: Rule-based and ML-based risk scoring
6. **Webhooks**: Reliable delivery of payment events to merchants

### Non-Functional Requirements
1. **Consistency**: Strong consistency for all ledger operations - no accounting discrepancies
2. **Availability**: 99.99% uptime for payment authorization
3. **Latency**: Authorization < 2 seconds at p99
4. **Durability**: Zero data loss for transaction records
5. **Security**: PCI-DSS compliance, encryption at rest and in transit

### Scale Estimates
- 50M transactions/day = 600 TPS average, 2,000 TPS peak
- Transaction record: ~2 KB per transaction
- 7-year retention (regulatory) = 250 TB
- Read:Write ratio = 3:1 (dashboard queries vs new transactions)

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          Load Balancer (nginx)                              │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  ▼                  ▼                  ▼
          ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
          │ API Server  │    │ API Server  │    │ API Server  │
          │  (Node.js)  │    │  (Node.js)  │    │  (Node.js)  │
          └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
                 │                  │                  │
                 └──────────────────┼──────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│     Valkey      │       │   PostgreSQL    │       │    RabbitMQ     │
│  (Cache/Locks)  │       │   (Primary +    │       │   (Webhooks,    │
│                 │       │   Replicas)     │       │   Settlement)   │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                                             │
                          ┌──────────────────────────────────┤
                          ▼                                  ▼
                 ┌─────────────────┐              ┌─────────────────┐
                 │ Webhook Worker  │              │Settlement Worker│
                 └─────────────────┘              └─────────────────┘
```

## Deep Dive: Data Model Design

### Core Database Schema

```sql
-- Merchants (payment system customers)
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    api_key_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash
    webhook_url TEXT,
    webhook_secret VARCHAR(64),
    default_currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions with idempotency support
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    idempotency_key VARCHAR(255),

    -- Amounts in smallest currency unit (cents)
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    captured_amount BIGINT DEFAULT 0,
    refunded_amount BIGINT DEFAULT 0,

    -- State machine
    status VARCHAR(20) NOT NULL,  -- pending, authorized, captured, voided, failed, refunded
    failure_code VARCHAR(50),

    -- External references
    processor_ref VARCHAR(255),

    -- Fraud scoring
    fraud_score INTEGER,
    fraud_flags JSONB DEFAULT '[]',

    -- Optimistic locking
    version INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(merchant_id, idempotency_key)
);

-- Double-entry ledger
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    entry_type VARCHAR(10) NOT NULL,  -- 'debit' or 'credit'
    account_type VARCHAR(30) NOT NULL,  -- merchant_balance, platform_fee, processor_cost
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance_after BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log for PCI compliance
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    actor_type VARCHAR(20),
    actor_id VARCHAR(255),
    changes JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Index Strategy

```sql
-- Fast idempotency lookups
CREATE INDEX idx_transactions_idempotency
    ON transactions(merchant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Dashboard queries by merchant
CREATE INDEX idx_transactions_merchant_time
    ON transactions(merchant_id, created_at DESC);

-- Pending transactions for settlement
CREATE INDEX idx_transactions_status
    ON transactions(status, created_at)
    WHERE status IN ('authorized', 'captured');

-- Ledger reconciliation queries
CREATE INDEX idx_ledger_account_time
    ON ledger_entries(account_type, created_at);

-- Audit trail queries
CREATE INDEX idx_audit_entity
    ON audit_log(entity_type, entity_id, created_at DESC);
```

### Why PostgreSQL Over Alternatives?

| Consideration | PostgreSQL | Cassandra | MongoDB |
|---------------|------------|-----------|---------|
| ACID transactions | Full | Limited | Limited |
| Ledger consistency | Excellent | Poor | Moderate |
| Complex queries | Excellent | Poor | Moderate |
| Partitioning | Native | Excellent | Good |
| Operational complexity | Low | High | Moderate |

**Decision**: PostgreSQL is ideal for payment systems because:
1. Double-entry accounting requires ACID transactions
2. Reconciliation needs complex aggregate queries
3. Regulatory audits require precise data integrity
4. Read replicas handle dashboard query load

## Deep Dive: Idempotency Implementation

### The Double-Charge Problem

Without idempotency, retries cause duplicate charges:

```
1. Client sends payment request
2. Server processes, charges card successfully
3. Network timeout - client never receives response
4. Client retries with same request
5. Server processes again - customer charged twice!
```

### Idempotency Key Flow

```typescript
async function processPayment(merchantId: string, idempotencyKey: string, payload: PaymentRequest) {
    const cacheKey = `idempotency:${merchantId}:${idempotencyKey}`;

    // Step 1: Check cache for existing response
    const cached = await valkey.get(cacheKey);
    if (cached) {
        return JSON.parse(cached);  // Return same response
    }

    // Step 2: Acquire distributed lock (prevents race conditions)
    const lockKey = `lock:${cacheKey}`;
    const acquired = await valkey.set(lockKey, '1', 'NX', 'EX', 30);
    if (!acquired) {
        throw new ConflictError('Request already in progress');
    }

    try {
        // Step 3: Process payment in database transaction
        const result = await db.transaction(async (tx) => {
            const txn = await tx.insert(transactions).values({
                merchant_id: merchantId,
                idempotency_key: idempotencyKey,
                ...payload
            }).returning();

            // Create ledger entries atomically
            await tx.insert(ledgerEntries).values([
                { transaction_id: txn.id, entry_type: 'debit', account_type: 'customer', amount: payload.amount },
                { transaction_id: txn.id, entry_type: 'credit', account_type: 'merchant_balance', amount: netAmount },
                { transaction_id: txn.id, entry_type: 'credit', account_type: 'platform_fee', amount: fee }
            ]);

            return txn;
        });

        // Step 4: Cache successful response (24h TTL)
        await valkey.setex(cacheKey, 86400, JSON.stringify(result));

        return result;
    } finally {
        // Step 5: Release lock
        await valkey.del(lockKey);
    }
}
```

### Idempotency Design Decisions

| Decision | Choice | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Key scope | Per-merchant | Global | Same key from different merchants = different operations |
| Storage | Valkey (24h TTL) | PostgreSQL | Faster lookups, automatic expiry |
| Lock mechanism | Distributed lock | Optimistic locking | Prevents concurrent processing |
| Failure handling | Don't cache failures | Cache all | Allows retry on transient failures |

## Deep Dive: Double-Entry Ledger

### Accounting Principle

Every transaction must have balanced ledger entries (debits = credits):

```
Customer Payment of $100:
┌──────────────────────────────────────────────────────────────┐
│  Account            │  Debit    │  Credit   │  Balance       │
├──────────────────────────────────────────────────────────────┤
│  Customer Card      │  $100.00  │           │  -$100.00      │
│  Merchant Balance   │           │  $97.10   │  +$97.10       │
│  Platform Fee       │           │  $2.90    │  +$2.90        │
└──────────────────────────────────────────────────────────────┘
  Total:                 $100.00     $100.00   (BALANCED)
```

### SQL Implementation

```sql
-- Record captured payment with balanced entries
CREATE OR REPLACE FUNCTION record_payment_capture(
    p_transaction_id UUID,
    p_amount BIGINT,
    p_fee BIGINT
) RETURNS VOID AS $$
BEGIN
    -- Debit customer (money coming in)
    INSERT INTO ledger_entries (transaction_id, entry_type, account_type, amount)
    VALUES (p_transaction_id, 'debit', 'accounts_receivable', p_amount);

    -- Credit merchant balance (money owed to merchant)
    INSERT INTO ledger_entries (transaction_id, entry_type, account_type, amount)
    VALUES (p_transaction_id, 'credit', 'merchant_balance', p_amount - p_fee);

    -- Credit platform fee (our revenue)
    INSERT INTO ledger_entries (transaction_id, entry_type, account_type, amount)
    VALUES (p_transaction_id, 'credit', 'platform_fee', p_fee);
END;
$$ LANGUAGE plpgsql;
```

### Daily Reconciliation Query

```sql
-- Verify ledger balance (must be zero discrepancy)
SELECT
    DATE(created_at) as date,
    SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debits,
    SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credits,
    SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as discrepancy
FROM ledger_entries
WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY DATE(created_at)
HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) != 0;
```

## Deep Dive: Fraud Detection Service

### Real-Time Risk Scoring

```typescript
interface FraudSignals {
    velocityScore: number;      // Recent transaction frequency
    amountScore: number;        // Deviation from typical amounts
    geoScore: number;           // Distance from usual location
    deviceScore: number;        // Device fingerprint recognition
    mlScore: number;            // ML model prediction
}

async function calculateFraudScore(transaction: Transaction): Promise<number> {
    const signals: FraudSignals = {
        // Velocity: Too many transactions in short time
        velocityScore: await checkVelocity(transaction.card_fingerprint),

        // Amount: Unusual purchase amount for this card
        amountScore: checkAmountAnomaly(transaction.amount, transaction.card_fingerprint),

        // Geography: Far from usual purchase location
        geoScore: await checkGeography(transaction.ip_address, transaction.billing_zip),

        // Device: Never seen this device before
        deviceScore: await checkDeviceFingerprint(transaction.device_id),

        // ML: Trained model prediction
        mlScore: await mlModel.predict(transaction)
    };

    // Weighted combination
    return Math.min(100,
        signals.velocityScore * 0.25 +
        signals.amountScore * 0.20 +
        signals.geoScore * 0.20 +
        signals.deviceScore * 0.15 +
        signals.mlScore * 0.20
    );
}
```

### Decision Thresholds

| Score Range | Action | Rationale |
|-------------|--------|-----------|
| 0-30 | Auto-approve | Low risk, good user experience |
| 30-70 | Approve + log | Monitor for patterns |
| 70-90 | Require 3D Secure | Additional verification |
| 90-100 | Block | High fraud probability |

### Velocity Check with Valkey

```typescript
async function checkVelocity(cardFingerprint: string): Promise<number> {
    const key = `velocity:${cardFingerprint}`;
    const now = Date.now();
    const windowMs = 3600000; // 1 hour

    // Sliding window count
    const multi = valkey.multi();
    multi.zremrangebyscore(key, 0, now - windowMs);
    multi.zadd(key, now, `${now}`);
    multi.zcard(key);
    multi.expire(key, 3600);

    const results = await multi.exec();
    const count = results[2][1];

    // Score based on transaction count
    if (count > 10) return 50;  // Very high velocity
    if (count > 5) return 30;   // High velocity
    if (count > 2) return 15;   // Moderate velocity
    return 0;                   // Normal
}
```

## API Design

### RESTful Endpoints

```
Authentication: Bearer token (API key)
Rate Limit: 100 requests/minute per merchant

POST   /v1/payments              Create and authorize payment
POST   /v1/payments/:id/capture  Capture authorized payment
POST   /v1/payments/:id/void     Void authorized payment
POST   /v1/payments/:id/refund   Refund captured payment
GET    /v1/payments/:id          Get payment details
GET    /v1/payments              List payments (paginated)

Webhooks:
POST   /v1/webhooks/endpoints    Register webhook URL
GET    /v1/webhooks/deliveries   List webhook delivery attempts

Admin (session auth):
GET    /v1/admin/transactions    Search all transactions
GET    /v1/admin/reconciliation  Daily settlement reports
```

### Request/Response Example

```http
POST /v1/payments HTTP/1.1
Authorization: Bearer sk_live_abc123
Idempotency-Key: order_12345
Content-Type: application/json

{
    "amount": 5000,
    "currency": "usd",
    "payment_method_id": "pm_xyz789",
    "capture": true,
    "metadata": { "order_id": "12345" }
}
```

```json
{
    "id": "txn_abc123",
    "status": "captured",
    "amount": 5000,
    "currency": "usd",
    "captured_amount": 5000,
    "refunded_amount": 0,
    "fraud_score": 12,
    "processor_ref": "ch_stripe_xyz",
    "created_at": "2025-01-15T10:30:00Z"
}
```

## Webhook Delivery System

### Guaranteed Delivery Pattern

```typescript
const RETRY_DELAYS = [1000, 5000, 30000, 120000, 600000]; // 1s, 5s, 30s, 2min, 10min

async function deliverWebhook(webhook: Webhook): Promise<void> {
    const signature = crypto
        .createHmac('sha256', webhook.merchant.webhook_secret)
        .update(JSON.stringify(webhook.payload))
        .digest('hex');

    try {
        const response = await fetch(webhook.merchant.webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-ID': webhook.id,
                'X-Signature': `sha256=${signature}`
            },
            body: JSON.stringify(webhook.payload),
            signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
            await db.update(webhooks)
                .set({ status: 'delivered', delivered_at: new Date() })
                .where(eq(webhooks.id, webhook.id));
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        await scheduleRetry(webhook, error);
    }
}

async function scheduleRetry(webhook: Webhook, error: Error): Promise<void> {
    const delay = RETRY_DELAYS[webhook.attempts];

    if (delay) {
        await db.update(webhooks).set({
            attempts: webhook.attempts + 1,
            next_retry_at: new Date(Date.now() + delay),
            last_error: error.message
        }).where(eq(webhooks.id, webhook.id));

        // Re-queue with delay
        await rabbitmq.publish('webhook.delivery', webhook, { delay });
    } else {
        await db.update(webhooks)
            .set({ status: 'failed' })
            .where(eq(webhooks.id, webhook.id));
    }
}
```

## Caching Strategy

### Cache Layers

| Data | Storage | TTL | Invalidation |
|------|---------|-----|--------------|
| Merchant config | Valkey | 5 min | On API update |
| Idempotency keys | Valkey | 24 hours | TTL expiry |
| Rate limit counters | Valkey | 1 min sliding | Automatic |
| Exchange rates | Valkey | 5 min | TTL expiry |
| Transaction cache | None | - | Always read from DB |

### Rate Limiting Implementation

```typescript
async function checkRateLimit(merchantId: string, limit = 100, windowSecs = 60): Promise<void> {
    const key = `ratelimit:${merchantId}`;
    const now = Date.now();
    const windowStart = now - (windowSecs * 1000);

    const count = await valkey
        .multi()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, now, `${now}-${Math.random()}`)
        .zcard(key)
        .expire(key, windowSecs)
        .exec()
        .then(r => r[2][1]);

    if (count > limit) {
        throw new RateLimitError(`Rate limit exceeded: ${count}/${limit}`);
    }
}
```

## Scalability Considerations

### Horizontal Scaling Path

| Component | Current | Scaled | Strategy |
|-----------|---------|--------|----------|
| API servers | 3 instances | 10+ instances | Stateless, add behind LB |
| PostgreSQL | 1 primary | Primary + 3 replicas | Read replicas for dashboards |
| Valkey | 1 instance | 3-node cluster | HA for distributed locks |
| RabbitMQ | 1 instance | Clustered | Mirrored queues |
| Workers | 2 instances | Auto-scale | Based on queue depth |

### Database Partitioning

```sql
-- Partition transactions by month for archival and performance
CREATE TABLE transactions (
    -- columns as defined above
) PARTITION BY RANGE (created_at);

CREATE TABLE transactions_2025_01 PARTITION OF transactions
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Archive old partitions to cold storage
ALTER TABLE transactions DETACH PARTITION transactions_2024_01;
-- Export to S3/MinIO in Parquet format for long-term retention
```

### Connection Pooling

```typescript
// PgBouncer configuration for high connection count
const pool = new Pool({
    max: 20,                          // Per API server
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// With 10 API servers: 200 connections
// PostgreSQL max_connections: 300
// Reserve 100 for admin, workers, maintenance
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| PostgreSQL for ledger | ACID, complex queries | Single write master |
| Valkey for idempotency | Fast, TTL built-in | Additional service |
| Sync fraud check | Immediate blocking | Adds latency (~50ms) |
| Double-entry bookkeeping | Perfect audit trail | Storage overhead |
| RabbitMQ for webhooks | Reliable, DLQ support | Additional complexity |

## Future Backend Enhancements

1. **Event Sourcing**: Store all state changes as immutable events for complete audit trail
2. **Read Replicas**: Route dashboard queries to replicas
3. **Sharding**: Hash-based sharding by merchant_id when transaction volume exceeds single-node capacity
4. **Multi-Region**: Active-passive with PostgreSQL logical replication for disaster recovery
5. **Real-Time Analytics**: ClickHouse for transaction analytics and fraud pattern detection
