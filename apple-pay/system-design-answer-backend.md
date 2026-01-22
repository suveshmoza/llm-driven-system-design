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

```sql
-- Provisioned Cards (token references only)
CREATE TABLE provisioned_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    device_id UUID NOT NULL,
    token_ref VARCHAR(100) NOT NULL,  -- Reference to network token
    network VARCHAR(20) NOT NULL,      -- visa, mastercard, amex
    last4 VARCHAR(4) NOT NULL,
    card_type VARCHAR(20),             -- credit, debit
    status VARCHAR(20) DEFAULT 'active',
    suspended_at TIMESTAMPTZ,
    suspend_reason VARCHAR(100),
    provisioned_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_card_device UNIQUE (user_id, device_id, last4, network)
);

-- Transactions
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_ref VARCHAR(100) NOT NULL,
    terminal_id VARCHAR(100),
    terminal_reference VARCHAR(100),
    merchant_name VARCHAR(200),
    merchant_category VARCHAR(10),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(20) NOT NULL,
    auth_code VARCHAR(20),
    decline_reason VARCHAR(100),
    transaction_type VARCHAR(20),  -- nfc, in_app, web
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Application Transaction Counter tracking
CREATE TABLE token_atc (
    token_ref VARCHAR(100) PRIMARY KEY,
    last_atc INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log for compliance
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(100),
    result VARCHAR(20),
    ip_address VARCHAR(45),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cards_user ON provisioned_cards(user_id);
CREATE INDEX idx_cards_device ON provisioned_cards(device_id);
CREATE INDEX idx_cards_token ON provisioned_cards(token_ref);
CREATE INDEX idx_transactions_token ON transactions(token_ref, created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
```

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

```typescript
class ProvisioningService {
    async provisionCard(userId: string, deviceId: string, cardData: CardData) {
        // Step 1: Identify card network from BIN
        const network = this.identifyNetwork(cardData.pan);

        // Step 2: Encrypt PAN for network (Apple never stores raw PAN)
        const encryptedPAN = await this.encryptForNetwork(
            cardData.pan,
            network.publicKey
        );

        // Step 3: Request token from network's TSP
        const tokenRequest = {
            encryptedPAN,
            expiry: cardData.expiry,
            cvv: cardData.cvv,  // Only for initial verification
            deviceId,
            deviceType: 'iphone',
            walletId: userId
        };

        const tokenResponse = await this.networkClient[network.name]
            .requestToken(tokenRequest);

        if (tokenResponse.requiresVerification) {
            return {
                status: 'verification_required',
                methods: tokenResponse.verificationMethods,
                verificationId: tokenResponse.verificationId
            };
        }

        // Step 4: Store token reference (not the actual token)
        await db.query(`
            INSERT INTO provisioned_cards
                (user_id, device_id, token_ref, network, last4, card_type, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'active')
        `, [
            userId,
            deviceId,
            tokenResponse.tokenRef,
            network.name,
            cardData.pan.slice(-4),
            tokenResponse.cardType
        ]);

        // Step 5: Push token to device's Secure Element
        await this.provisionToSecureElement(deviceId, {
            token: tokenResponse.token,
            cryptogramKey: tokenResponse.cryptogramKey
        });

        return {
            success: true,
            cardType: tokenResponse.cardType,
            network: network.name,
            last4: cardData.pan.slice(-4)
        };
    }
}
```

### Network Integration Pattern

```typescript
interface NetworkClient {
    requestToken(request: TokenRequest): Promise<TokenResponse>;
    validateCryptogram(params: CryptogramParams): Promise<boolean>;
    suspendToken(tokenRef: string, reason: string): Promise<void>;
    resumeToken(tokenRef: string): Promise<void>;
}

class NetworkClientFactory {
    private clients: Map<string, NetworkClient> = new Map();
    private circuitBreakers: Map<string, CircuitBreaker> = new Map();

    getClient(network: string): NetworkClient {
        const client = this.clients.get(network);
        const breaker = this.circuitBreakers.get(network);

        // Wrap with circuit breaker for resilience
        return new CircuitBreakerWrapper(client, breaker);
    }
}
```

## Deep Dive: Transaction Processing

### Cryptogram Validation

The cryptogram is a one-time value that proves the transaction is legitimate:

```typescript
class TransactionService {
    async processNFCTransaction(terminalData: TerminalData) {
        const { token, cryptogram, atc, amount, merchantId } = terminalData;

        // Step 1: Validate Application Transaction Counter
        const lastATC = await this.getLastATC(token);
        if (atc <= lastATC) {
            return { approved: false, reason: 'ATC_REPLAY' };
        }

        // Step 2: Route to appropriate card network
        const network = this.identifyNetworkFromToken(token);

        // Step 3: Validate cryptogram with network (with circuit breaker)
        const cryptogramValid = await this.circuitBreaker.execute(
            network,
            () => this.networkClient[network].validateCryptogram({
                token,
                cryptogram,
                atc,
                amount,
                merchantId
            })
        );

        if (!cryptogramValid) {
            return { approved: false, reason: 'INVALID_CRYPTOGRAM' };
        }

        // Step 4: Network routes to issuing bank
        const authResult = await this.circuitBreaker.execute(
            network,
            () => this.networkClient[network].authorize({
                token,
                amount,
                merchantId,
                cryptogramVerified: true
            })
        );

        // Step 5: Update ATC watermark
        await this.updateATC(token, atc);

        // Step 6: Record transaction
        await this.recordTransaction(terminalData, authResult);

        return {
            approved: authResult.approved,
            authCode: authResult.authCode,
            network
        };
    }
}
```

### Idempotency Implementation

Payment processing must be idempotent to handle retries safely:

```typescript
class IdempotencyService {
    private redis: Redis;
    private TTL_SECONDS = 86400; // 24 hours

    async executeOnce<T>(
        idempotencyKey: string,
        operation: () => Promise<T>
    ): Promise<{ replayed: boolean; result: T }> {
        const cacheKey = `idempotency:${idempotencyKey}`;

        // Check for existing result
        const cached = await this.redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.status === 'completed') {
                return { replayed: true, result: parsed.result };
            }
            if (parsed.status === 'in_progress') {
                throw new ConflictError('Request already in progress');
            }
        }

        // Acquire lock
        const lockAcquired = await this.redis.set(
            cacheKey,
            JSON.stringify({ status: 'in_progress', startedAt: Date.now() }),
            'NX', 'EX', 60
        );

        if (!lockAcquired) {
            throw new ConflictError('Request already in progress');
        }

        try {
            const result = await operation();

            // Store completed result
            await this.redis.set(
                cacheKey,
                JSON.stringify({ status: 'completed', result }),
                'EX', this.TTL_SECONDS
            );

            return { replayed: false, result };
        } catch (error) {
            await this.redis.del(cacheKey);
            throw error;
        }
    }
}
```

## Deep Dive: Circuit Breaker Pattern

Card networks are external dependencies that can fail:

```typescript
class CircuitBreaker {
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    private failureCount = 0;
    private lastFailureTime: number = 0;

    private readonly threshold = 5;
    private readonly timeout = 30000; // 30 seconds

    async execute<T>(
        network: string,
        operation: () => Promise<T>,
        fallback?: () => T
    ): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'half-open';
            } else {
                metrics.circuitBreakerRejection.inc({ network });
                if (fallback) return fallback();
                throw new NetworkUnavailableError(network);
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            if (fallback) return fallback();
            throw error;
        }
    }

    private onSuccess() {
        this.failureCount = 0;
        this.state = 'closed';
    }

    private onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.threshold) {
            this.state = 'open';
        }
    }
}
```

## API Design

### RESTful Endpoints

```
Card Provisioning:
POST   /api/cards                    Provision new card
GET    /api/cards                    List user's cards
DELETE /api/cards/:id                Remove card
POST   /api/cards/:id/suspend        Suspend card
POST   /api/cards/:id/reactivate     Reactivate card

Payments:
POST   /api/payments/nfc             Process NFC payment
POST   /api/payments/in-app          Process in-app payment

Transactions:
GET    /api/transactions             List transaction history
GET    /api/transactions/:id         Get transaction details

Device Management:
POST   /api/devices/:id/lost         Mark device as lost
POST   /api/devices/:id/found        Mark device as found
```

### Request/Response Examples

**Process NFC Payment**:

```http
POST /api/payments/nfc
Idempotency-Key: terminal-123-txn-456
Content-Type: application/json

{
    "token": "DPAN1234567890123456",
    "cryptogram": "A1B2C3D4E5F6G7H8",
    "atc": 42,
    "amount": 25.99,
    "currency": "USD",
    "merchantId": "MERCH123",
    "terminalId": "TERM456"
}
```

Response (200 OK):
```json
{
    "approved": true,
    "authCode": "AUTH789",
    "network": "visa",
    "transactionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Caching Strategy

### Cache Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Request Flow                            │
│                                                              │
│  Token Lookup ──► Valkey (5 min TTL) ──► PostgreSQL         │
│  ATC Watermark ──► Valkey (write-through) ──► PostgreSQL    │
│  Idempotency ──► Valkey (24h TTL)                           │
│  Session ──► Valkey (7 day TTL)                             │
└─────────────────────────────────────────────────────────────┘
```

### Cache Key Design

```typescript
const CACHE_KEYS = {
    // Active token lookup
    token: (tokenRef: string) => `token:${tokenRef}`,

    // ATC watermark (write-through)
    atc: (tokenRef: string) => `atc:${tokenRef}`,

    // User's card list
    userCards: (userId: string) => `cards:${userId}`,

    // Idempotency results
    idempotency: (key: string) => `idempotency:${key}`
};
```

### Cache Invalidation

```typescript
class CacheInvalidationService {
    async onTokenStatusChange(tokenRef: string, userId: string) {
        await Promise.all([
            this.redis.del(`token:${tokenRef}`),
            this.redis.del(`cards:${userId}`)
        ]);
    }

    async onDeviceLost(userId: string, deviceId: string) {
        // Get all affected tokens
        const tokens = await db.query(
            'SELECT token_ref FROM provisioned_cards WHERE device_id = $1',
            [deviceId]
        );

        const pipeline = this.redis.pipeline();
        for (const token of tokens.rows) {
            pipeline.del(`token:${token.token_ref}`);
        }
        pipeline.del(`cards:${userId}`);
        await pipeline.exec();
    }
}
```

## Scalability Considerations

### Read Scaling

1. **Read Replicas**: Route transaction history queries to replicas
2. **Connection Pooling**: PgBouncer for connection management
3. **Caching**: Valkey for frequently accessed token lookups

### Write Scaling

1. **Partitioning**: Shard transactions by token_ref hash
   ```sql
   CREATE TABLE transactions_p0 PARTITION OF transactions
       FOR VALUES WITH (MODULUS 16, REMAINDER 0);
   ```

2. **Async Processing**: Queue non-critical operations
   ```
   Transaction Auth (sync) → Result
                         → Queue → Audit Log (async)
                                → Notifications (async)
   ```

### Estimated Capacity

| Component | Single Node | Scaled (16x) |
|-----------|-------------|--------------|
| PostgreSQL writes | 5K/sec | 80K/sec (sharded) |
| PostgreSQL reads | 20K/sec | 320K/sec (replicas) |
| Valkey cache | 200K/sec | 200K/sec |
| API servers | 10K req/sec | 160K req/sec |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| PostgreSQL + Serializable | Financial accuracy | Lower throughput |
| Per-device tokens | Easy revocation | More tokens to manage |
| Circuit breaker per network | Isolated failures | More complex |
| Idempotency in Redis | Fast duplicate detection | Redis dependency |
| Write-through ATC | Replay protection | Extra write per txn |
| Audit logging | Compliance ready | Storage overhead |

## Future Backend Enhancements

1. **Event Sourcing**: Store transaction events for replay and audit
2. **Multi-Region**: Active-active for global availability
3. **Real-time Fraud Detection**: ML-based transaction scoring
4. **Webhook Delivery**: Reliable merchant notifications
5. **Rate Limiting**: Per-user and per-merchant quotas
