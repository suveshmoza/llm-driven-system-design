# PayPal - P2P Payment Platform Architecture

## System Overview

A peer-to-peer payment platform enabling users to send money, request payments, and manage digital wallets. The system implements double-entry bookkeeping for financial integrity, idempotent payment processing, and optimistic locking for concurrent wallet access. Learning goals: financial transaction atomicity, ledger consistency, idempotency patterns, and wallet management.

## Requirements

### Functional Requirements
- User registration and authentication
- Digital wallet with deposit, withdrawal, and balance inquiry
- P2P money transfers between users
- Money request flow (request, pay, decline, cancel)
- Payment method management (bank accounts, cards)
- Transaction history with filtering
- User search for sending/requesting money

### Non-Functional Requirements
- **Consistency**: All money transfers must be ACID -- no partial transfers, no double-spending
- **Availability**: 99.99% uptime target for payment processing
- **Latency**: p99 < 200ms for balance queries, p99 < 500ms for transfers
- **Idempotency**: Every payment operation must be safely retryable
- **Auditability**: Complete ledger trail for every balance change

## High-Level Architecture

```
┌──────────────┐        ┌──────────────┐        ┌──────────────────────┐
│              │        │              │        │   Payment Service    │
│   React SPA  │───────▶│  API Gateway │───────▶│                      │
│   (Vite)     │        │  (Rate Limit │        │  ┌────────────────┐  │
│              │        │   + Auth)    │        │  │ Transfer Engine│  │
└──────────────┘        └──────────────┘        │  │ (Double-entry) │  │
                                                │  └────────────────┘  │
                                                │  ┌────────────────┐  │
                                                │  │ Wallet Service │  │
                                                │  │ (Opt. locking) │  │
                                                │  └────────────────┘  │
                                                │  ┌────────────────┐  │
                                                │  │ Idempotency    │  │
                                                │  │ Service        │  │
                                                │  └────────────────┘  │
                                                └──────────┬───────────┘
                                                           │
                              ┌─────────────────────────────┼──────────────────┐
                              │                             │                  │
                              ▼                             ▼                  ▼
                    ┌──────────────────┐          ┌──────────────┐    ┌──────────────┐
                    │   PostgreSQL     │          │    Valkey     │    │  Prometheus  │
                    │                  │          │   (Redis)     │    │  + Grafana   │
                    │  ┌────────────┐  │          │               │    │              │
                    │  │   Users    │  │          │  Sessions     │    │  Metrics     │
                    │  │  Wallets   │  │          │  Rate limits  │    │  Dashboards  │
                    │  │  Txns      │  │          │  Cache        │    │              │
                    │  │  Ledger    │  │          │               │    │              │
                    │  │  Requests  │  │          │               │    │              │
                    │  └────────────┘  │          └──────────────┘    └──────────────┘
                    └──────────────────┘
```

## Core Components

### Transfer Engine (Double-Entry Bookkeeping)

Every balance change creates exactly two ledger entries -- a debit and a credit. For P2P transfers, the sender's wallet is debited and the recipient's wallet is credited within a single database transaction. This ensures the total money in the system is always conserved.

```
Transfer Flow:
┌──────────┐     ┌────────────┐     ┌───────────┐     ┌──────────────┐
│  Client   │────▶│ Idempotency│────▶│   Lock    │────▶│  Execute     │
│  Request  │     │   Check    │     │  Wallets  │     │  Transfer    │
└──────────┘     └────────────┘     └───────────┘     └──────┬───────┘
                                                              │
                      ┌───────────────────────────────────────┘
                      │
                      ▼
               ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
               │ Debit Sender │────▶│Credit Recip. │────▶│   Create     │
               │   Wallet     │     │   Wallet     │     │ Ledger Entries│
               └──────────────┘     └──────────────┘     └──────────────┘
```

For a $50 transfer from Alice to Bob:
1. **Debit entry**: Alice's wallet -$50, `balance_after = previous - 50`
2. **Credit entry**: Bob's wallet +$50, `balance_after = previous + 50`
3. Both entries reference the same `transaction_id`
4. Sum of all debits always equals sum of all credits

### Wallet Service (Optimistic Locking)

Wallet balances use optimistic locking via a `version` column. Each update includes `WHERE version = $expectedVersion` in the UPDATE statement. If another transaction has modified the wallet between our read and write, the update affects zero rows and we detect the conflict immediately. This prevents double-spending without holding long-lived locks.

### Idempotency Service

Payment operations accept an optional `idempotency_key`. Before executing a transfer, the system checks the `idempotency_keys` table. If the key exists and hasn't expired, the cached response is returned without re-executing the payment. The key is stored within the same database transaction as the transfer, ensuring atomicity between the payment and the idempotency record.

Keys expire after 24 hours to prevent unbounded table growth.

### Request Flow

Money requests create a `transfer_requests` record with status `pending`. The payer can pay (which triggers a transfer) or decline. The requester can cancel. Status transitions:

```
pending ──▶ paid       (payer pays)
pending ──▶ declined   (payer declines)
pending ──▶ cancelled  (requester cancels)
```

## Database Schema

```sql
-- Users table with role-based access
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(30) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets with optimistic locking (version column)
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL UNIQUE,
  balance_cents BIGINT DEFAULT 0 CHECK (balance_cents >= 0),
  currency VARCHAR(3) DEFAULT 'USD',
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions (the business event)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) UNIQUE,
  sender_id UUID REFERENCES users(id),
  recipient_id UUID REFERENCES users(id) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) DEFAULT 'USD',
  type VARCHAR(20) NOT NULL,  -- 'transfer', 'deposit', 'withdrawal'
  status VARCHAR(20) DEFAULT 'completed',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Double-entry ledger (the accounting record)
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) NOT NULL,
  wallet_id UUID REFERENCES wallets(id) NOT NULL,
  entry_type VARCHAR(10) NOT NULL,  -- 'debit' or 'credit'
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Money request flow
CREATE TABLE transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID REFERENCES users(id) NOT NULL,
  payer_id UUID REFERENCES users(id) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) DEFAULT 'USD',
  note TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotency key storage
CREATE TABLE idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);
```

Key indexes: `(sender_id, created_at DESC)`, `(recipient_id, created_at DESC)`, `(wallet_id, created_at DESC)` for efficient history queries.

## API Design

### Authentication
```
POST /api/auth/register     Register new user + create wallet
POST /api/auth/login        Login with session
POST /api/auth/logout       Destroy session
GET  /api/auth/me           Current user info
```

### Wallet
```
GET  /api/wallet             Get balance and wallet info
POST /api/wallet/deposit     Deposit funds (creates credit entry)
POST /api/wallet/withdraw    Withdraw funds (creates debit entry)
```

### Transfers
```
POST /api/transfers          Send money (P2P transfer with idempotency key)
GET  /api/transfers          Transaction history with type filter
```

### Requests
```
POST /api/requests           Request money from another user
GET  /api/requests           List incoming/outgoing requests
POST /api/requests/:id/pay   Pay a pending request
POST /api/requests/:id/decline  Decline or cancel a request
```

### Payment Methods
```
GET    /api/payment-methods          List payment methods
POST   /api/payment-methods          Add a payment method
DELETE /api/payment-methods/:id      Remove a payment method
PUT    /api/payment-methods/:id/default  Set as default
```

### Users
```
GET /api/users/search?q=    Search users by name/email
```

## Key Design Decisions

### Double-Entry vs. Single-Entry Bookkeeping

**Chosen: Double-entry bookkeeping.** Every balance change creates paired debit/credit ledger entries. This provides a complete audit trail and enables balance verification by summing all ledger entries for a wallet. If `wallet.balance_cents` ever disagrees with `SUM(credits) - SUM(debits)`, we know something went wrong. The alternative -- directly updating a balance column without ledger entries -- is simpler but loses auditability and makes reconciliation impossible.

### Optimistic Locking vs. Pessimistic Locking

**Chosen: Optimistic locking with version numbers.** For wallet updates, we use `WHERE version = $expected` to detect concurrent modifications. In a P2P payment app, contention on a single wallet is relatively low (a user doesn't send hundreds of payments per second). Pessimistic locking (`SELECT ... FOR UPDATE`) would work but holds row-level locks longer, reducing throughput under moderate concurrency. We still use `FOR UPDATE` when locking both wallets for a transfer to prevent deadlocks, ordering the locks by user_id.

### Integer Cents vs. Decimal

**Chosen: BIGINT cents.** Storing amounts as integer cents avoids floating-point rounding errors that plague `DECIMAL` in application code. `$10.50` is stored as `1050`. The database enforces `CHECK (balance_cents >= 0)` to prevent negative balances at the schema level.

## Consistency and Idempotency

### Idempotency Pattern

Clients generate an idempotency key for each transfer attempt. The backend:
1. Checks `idempotency_keys` table for existing key
2. If found and not expired, returns the cached response (no re-execution)
3. If not found, executes the transfer within a database transaction
4. Stores the idempotency key and response in the same transaction
5. Returns the result

This guarantees exactly-once semantics even if the client retries due to network timeouts.

### Wallet Consistency

The `CHECK (balance_cents >= 0)` constraint ensures the database rejects any update that would make a balance negative. Combined with optimistic locking and transaction isolation, this prevents double-spending even under concurrent access.

## Security

- **Session-based auth** with Redis-backed sessions (express-session + connect-redis)
- **bcrypt** password hashing (10 rounds)
- **Rate limiting** on auth endpoints (50/15min) and transfer endpoints (30/min)
- **CSRF protection** via sameSite cookie attribute
- **Input validation** on all amounts (positive integers, maximum limits)
- **Authorization checks** on request pay/decline (only payer or requester)

## Observability

- **Prometheus metrics**: HTTP request duration/count, transfer duration/count, wallet operations, idempotency cache hits
- **Structured logging**: Pino JSON logger with request context
- **Health check**: `/api/health` endpoint tests database connectivity
- **Metrics endpoint**: `/metrics` for Prometheus scraping

## Failure Handling

- **Circuit breaker** (Opossum) for external service calls
- **Database transaction rollback** on any error during transfer
- **Graceful shutdown** with SIGTERM/SIGINT handlers
- **Connection pool** with configurable timeouts and max connections
- **Redis retry strategy** with exponential backoff

## Scalability Considerations

### What Breaks First
1. **Single PostgreSQL** -- partition transactions and ledger by date range; read replicas for balance queries
2. **Hot wallet contention** -- users with high transaction volume. Solution: queue-based processing or wallet sharding
3. **Idempotency table growth** -- periodic cleanup of expired keys (24-hour TTL)

### Scaling Strategy
- Horizontal API scaling behind load balancer (stateless with Redis sessions)
- PostgreSQL read replicas for transaction history queries
- Wallet sharding by user_id hash for high-throughput users
- Event-driven architecture (Kafka) for notification and analytics pipelines
- CDN for frontend static assets

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Bookkeeping | Double-entry ledger | Direct balance update | Complete audit trail, reconciliation |
| Concurrency control | Optimistic locking | Pessimistic locks | Lower contention for P2P workload |
| Amount storage | BIGINT cents | DECIMAL | No floating-point errors in app code |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler |
| Idempotency | DB-stored keys | Redis-stored keys | Atomicity with transfer in same txn |
| Auth | Session-based | OAuth/JWT | Simpler for learning, immediate revocation |

## Implementation Notes

### Production-Grade Patterns Implemented
1. **Double-entry bookkeeping** -- Every balance change creates paired debit/credit ledger entries within a single database transaction. See `src/services/transferService.ts`.
2. **Idempotency** -- Transfer endpoint accepts idempotency keys stored atomically with the payment. See `src/services/idempotencyService.ts`.
3. **Optimistic locking** -- Wallet updates use version numbers to detect concurrent modifications. See the `WHERE version = $expected` pattern in `src/services/transferService.ts`.
4. **Circuit breaker** -- Opossum-based circuit breaker for external service calls. See `src/services/circuitBreaker.ts`.
5. **Prometheus metrics** -- Custom metrics for transfers, wallet operations, idempotency hits. See `src/services/metrics.ts`.
6. **Structured logging** -- Pino JSON logger. See `src/services/logger.ts`.
7. **Rate limiting** -- Separate limits for auth (50/15min) and transfers (30/min). See `src/services/rateLimiter.ts`.

### What Was Simplified
- Single PostgreSQL instance instead of sharded cluster
- Session auth instead of OAuth with multi-factor
- No real payment gateway integration (deposits/withdrawals are simulated)
- Single currency (USD) instead of multi-currency support

### What Was Omitted
- CDN for frontend assets
- Multi-region deployment
- Kubernetes orchestration
- Fraud detection ML pipeline
- Notification service (email/push for transfers)
- Currency conversion service
- Compliance/KYC verification
