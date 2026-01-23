# Apple Pay - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a mobile payment system that:
- Provisions credit/debit cards through tokenization
- Processes NFC contactless payments under 500ms
- Integrates with multiple card networks (Visa, Mastercard, Amex)
- Manages token lifecycle across devices

## Requirements Clarification

### Functional Requirements
1. **Card Provisioning**: Register cards with network Token Service Providers (TSPs)
2. **Payment Processing**: Validate cryptograms and route transactions
3. **Token Management**: Suspend, reactivate, and refresh tokens
4. **Transaction History**: Record and query payment history
5. **Multi-Network Support**: Integrate with Visa VTS, Mastercard MDES, Amex

### Non-Functional Requirements
1. **Latency**: < 500ms for NFC transaction authorization
2. **Security**: PCI-DSS compliance, no raw PANs stored
3. **Availability**: 99.99% uptime for payment processing
4. **Consistency**: Strong consistency for financial transactions

### Scale Estimates
- 500M+ Apple Pay users globally
- 1B+ provisioned cards
- 500M transactions/day at peak
- 20K TPS peak transaction processing

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Load Balancer (nginx)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ API Server  │ │ API Server  │ │ API Server  │
            │   (Node)    │ │   (Node)    │ │   (Node)    │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   └───────────────┼───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │    Valkey    │      │  PostgreSQL  │      │  Card Network│
    │   (Cache +   │      │   (Primary)  │      │     APIs     │
    │ Idempotency) │      │              │      │              │
    └──────────────┘      └──────────────┘      └──────────────┘
```

## Deep Dive: Tokenization Data Model

### Database Schema

> "I'm storing token references, not actual tokens or PANs. The actual cryptographic tokens live in the Secure Element on device and at the card network's TSP. Our database only maintains a reference for lifecycle management."

**provisioned_cards table:** user_id, device_id, token_ref (reference to network token), network (visa/mastercard/amex), last4, card_type, status, suspended_at, and suspend_reason. A unique constraint on (user_id, device_id, last4, network) prevents duplicate provisioning. Indexes on user_id, device_id, and token_ref enable fast lookups.

**transactions table:** token_ref, terminal_id, merchant details (name, category), amount, currency, status, auth_code, decline_reason, and transaction_type (nfc/in_app/web). Index on (token_ref, created_at DESC) supports efficient transaction history queries.

**token_atc table:** Tracks Application Transaction Counter watermarks per token. The last_atc field prevents replay attacks—we reject any transaction with an ATC ≤ the recorded watermark.

**audit_logs table:** user_id, action, resource_type, resource_id, result, ip_address, and metadata JSONB. Required for PCI-DSS compliance and forensic analysis.

### Why PostgreSQL?

| Consideration | PostgreSQL | Cassandra | DynamoDB |
|---------------|------------|-----------|----------|
| ACID transactions | Full | Limited | Limited |
| Financial accuracy | Excellent | Risky | Risky |
| Query flexibility | Excellent | Limited | Limited |
| Audit requirements | Native | Complex | Complex |
| Operational complexity | Low | High | Medium |

**Decision**: PostgreSQL with serializable isolation for financial transactions. Strong consistency is non-negotiable for payment systems.

## Deep Dive: Card Provisioning Flow

### Token Request Service

> "I'm using a multi-step provisioning flow where we never store the raw PAN. The card number is encrypted client-side with the network's public key, passed through Apple's servers, and only the network's TSP can decrypt it."

**Provisioning algorithm:**
1. Identify card network from BIN (first 6 digits)
2. Encrypt PAN using the network's public key (Apple never sees the raw PAN)
3. Request token from network's Token Service Provider (Visa VTS, Mastercard MDES, Amex)
4. If network requires additional verification (SMS, bank app, call), return verification options to user
5. Once verified, store only the token_ref, network, last4, and card_type in our database
6. Push the actual token and cryptogram key to the device's Secure Element via secure channel

**Green-path vs Yellow-path provisioning:** Green-path cards (high-confidence matching) provision immediately. Yellow-path cards require step-up verification through the issuing bank before activation.

### Network Integration Pattern

> "I'm wrapping each network client with a circuit breaker. If Visa's API starts timing out, we fail fast rather than blocking all provisioning requests. Each network has independent failure isolation."

The NetworkClientFactory maintains separate clients for each card network (Visa, Mastercard, Amex). Each client exposes: requestToken, validateCryptogram, suspendToken, and resumeToken. Circuit breakers wrap each client to prevent cascade failures when a network experiences issues.

## Deep Dive: Transaction Processing

### Cryptogram Validation

> "The cryptogram is the core security mechanism. It's a one-time value generated by the Secure Element using keys only the card network can verify. Even if intercepted, it can't be reused because the Application Transaction Counter increments with each tap."

**NFC transaction processing flow:**
1. **ATC validation**: Check that the incoming ATC > last recorded watermark. Reject with ATC_REPLAY if not
2. **Network routing**: Identify the card network from the token prefix
3. **Cryptogram verification**: Send token, cryptogram, ATC, amount, and merchantId to the network for validation (wrapped in circuit breaker)
4. **Authorization**: If cryptogram is valid, network routes to issuing bank for approval
5. **ATC watermark update**: Atomically update the token's ATC watermark in both cache and database
6. **Transaction recording**: Persist transaction with status, auth_code, and merchant details

**Why ATC matters:** The Application Transaction Counter is a monotonically increasing value. Each NFC tap increments it on the Secure Element. By tracking the last-seen ATC per token, we detect replay attacks where an attacker tries to reuse a captured cryptogram.

### Idempotency Implementation

> "I'm using a three-layer idempotency pattern: Redis cache check, distributed lock, then database verification. Payment retries are inevitable with network instability, so every transaction endpoint must be idempotent."

**Idempotency algorithm:**
1. Generate cache key from idempotency header: `idempotency:{key}`
2. Check Redis for existing result—if found with status='completed', return cached result immediately (replay)
3. If found with status='in_progress', throw ConflictError (concurrent request)
4. Acquire lock with SET NX EX (60-second TTL prevents deadlock)
5. Execute the payment operation
6. On success: store result in Redis with 24-hour TTL
7. On failure: delete the lock key so retries can proceed

**Lock vs cache TTL:** The lock has a short TTL (60s) so that crashed processes don't block retries indefinitely. The result cache has a long TTL (24h) so that delayed retries still get the correct response.

## Deep Dive: Circuit Breaker Pattern

> "Card networks are external dependencies that can fail. I'm implementing per-network circuit breakers so a Mastercard outage doesn't affect Visa transactions. The breaker opens after 5 consecutive failures, waits 30 seconds, then enters half-open state to probe recovery."

**Circuit breaker states:**
- **Closed (normal)**: Requests flow through. Track failure count.
- **Open (tripped)**: Reject immediately without calling network. Return cached fallback or error.
- **Half-open (probing)**: Allow one request through to test if network recovered.

**Configuration:**
- Error threshold: 5 consecutive failures to trip
- Timeout: 30 seconds before transitioning to half-open
- Fallback: Return stale cached data for reads, fail fast for writes

**Per-network isolation:** Each network (Visa, Mastercard, Amex) has its own circuit breaker. Metrics track rejection counts per network for alerting. When a breaker trips, only transactions for that specific network are affected.

## API Design

### RESTful Endpoints

**Card Provisioning:**
- POST /api/cards — Provision new card
- GET /api/cards — List user's cards
- DELETE /api/cards/:id — Remove card
- POST /api/cards/:id/suspend — Suspend card
- POST /api/cards/:id/reactivate — Reactivate card

**Payments:**
- POST /api/payments/nfc — Process NFC payment
- POST /api/payments/in-app — Process in-app payment

**Transactions:**
- GET /api/transactions — List transaction history
- GET /api/transactions/:id — Get transaction details

**Device Management:**
- POST /api/devices/:id/lost — Mark device as lost (suspends all cards)
- POST /api/devices/:id/found — Mark device as found

### Idempotency Header

> "Every payment endpoint requires an Idempotency-Key header. The terminal generates this as a combination of terminal ID and transaction sequence number, ensuring retries are safe."

The NFC payment request includes: token (DPAN), cryptogram, atc, amount, currency, merchantId, and terminalId. Response includes: approved status, authCode, network, and transactionId.

## Caching Strategy

### Cache Layers

> "I'm using Valkey (Redis-compatible) for four distinct purposes: token lookups, ATC watermarks, idempotency results, and sessions. Each has different TTL characteristics based on consistency requirements."

**Cache key patterns:**
- Token lookup: `token:{tokenRef}` — 5 min TTL, speeds up transaction validation
- ATC watermark: `atc:{tokenRef}` — Write-through, critical for replay prevention
- User's cards: `cards:{userId}` — 5 min TTL, invalidated on card changes
- Idempotency: `idempotency:{key}` — 24h TTL, enables safe retries

### Cache Invalidation

> "I'm using event-driven invalidation. When a token status changes or a device is marked lost, we immediately delete all affected cache keys. For lost devices, we batch-delete using a Redis pipeline."

**Invalidation triggers:**
- Token status change (suspend/reactivate): Delete `token:{tokenRef}` and `cards:{userId}`
- Device lost: Query all tokens for that device, pipeline-delete all token keys and the user's card list
- Card removal: Delete `token:{tokenRef}` and `cards:{userId}`

**Write-through for ATC:** The ATC watermark is always written to both cache and database. This ensures replay protection even if the cache fails—we always check the database as the source of truth.

## Scalability Considerations

### Read Scaling

> "Read scaling is straightforward: add PostgreSQL read replicas for transaction history queries and PgBouncer for connection pooling. Valkey handles the hot path for token lookups."

1. **Read Replicas**: Route transaction history queries to replicas
2. **Connection Pooling**: PgBouncer for connection management
3. **Caching**: Valkey for frequently accessed token lookups

### Write Scaling

> "Write scaling is more nuanced. I'm partitioning the transactions table by token_ref hash into 16 partitions. This distributes writes across shards while keeping all transactions for a token co-located for efficient history queries."

1. **Hash Partitioning**: Transactions partitioned by MODULUS 16 on token_ref hash
2. **Async Processing**: Non-critical operations (audit logs, notifications) queued for async processing
3. **Write batching**: Audit logs aggregated and batch-inserted to reduce write amplification

**Async pipeline:** Transaction authorization is synchronous (must return result to terminal). Audit logging and push notifications are queued and processed asynchronously.

### Estimated Capacity

| Component | Single Node | Scaled (16x) |
|-----------|-------------|--------------|
| PostgreSQL writes | 5K/sec | 80K/sec (sharded) |
| PostgreSQL reads | 20K/sec | 320K/sec (replicas) |
| Valkey cache | 200K/sec | 200K/sec |
| API servers | 10K req/sec | 160K req/sec |

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Database | ✅ PostgreSQL + Serializable | ❌ Cassandra/DynamoDB | Financial accuracy requires ACID; lower throughput acceptable |
| Token storage | ✅ Per-device tokens | ❌ Shared tokens | Easy revocation on device loss; more tokens to manage |
| Resilience | ✅ Per-network circuit breaker | ❌ Shared breaker | Isolated failures; slightly more complexity |
| Idempotency | ✅ Redis-based | ❌ Database constraints | Fast duplicate detection; adds Redis dependency |
| ATC tracking | ✅ Write-through cache | ❌ Cache-aside | Guaranteed replay protection; extra write per transaction |
| Compliance | ✅ Comprehensive audit logs | ❌ Minimal logging | PCI-DSS ready; storage overhead acceptable |

## Future Backend Enhancements

1. **Event Sourcing**: Store transaction events for replay and audit
2. **Multi-Region**: Active-active for global availability
3. **Real-time Fraud Detection**: ML-based transaction scoring
4. **Webhook Delivery**: Reliable merchant notifications
5. **Rate Limiting**: Per-user and per-merchant quotas
