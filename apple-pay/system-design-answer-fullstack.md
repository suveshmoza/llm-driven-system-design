# Apple Pay - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design a mobile payment system that allows users to:
- Add credit/debit cards to a digital wallet
- Make contactless NFC payments at terminals
- Complete in-app and web payments
- Manage cards across multiple devices

This answer covers the end-to-end architecture, emphasizing the integration between frontend and backend components.

## Requirements Clarification

### Functional Requirements
1. **Card Provisioning**: Add cards with tokenization through card networks
2. **NFC Payment**: Tap-to-pay at contactless terminals
3. **In-App Payment**: Payment sheet for app/web checkout
4. **Card Management**: Suspend, remove, set default card
5. **Transaction History**: View past payments with merchant details

### Non-Functional Requirements
1. **Latency**: < 500ms for NFC transaction
2. **Security**: PCI-DSS compliance, no raw card numbers stored
3. **Availability**: 99.99% for payment processing
4. **Offline Resilience**: Show cached cards when offline

### Scale Estimates
- 500M+ Apple Pay users
- 500M transactions/day
- 1B+ provisioned cards

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Browser/Mobile (React Application)                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Views: Wallet | CardDetail | Transactions | AddCard               │  │
│  │  Components: CardStack, PaymentSheet, TransactionList              │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  Zustand Store: cards[], transactions[], paymentSheet, auth        │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  API Service: fetch wrapper with auth, idempotency keys            │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │ REST API (JSON)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Express API Server                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Middleware: cors, session, auth, idempotency, metrics             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │  cards.ts      │  │  payments.ts      │  │  transactions.ts      │   │
│  │  - provision   │  │  - nfc            │  │  - list               │   │
│  │  - suspend     │  │  - in-app         │  │  - detail             │   │
│  │  - remove      │  │  - cryptogram     │  │                       │   │
│  └────────────────┘  └──────────────────┘  └───────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Services: NetworkClient, TokenLifecycle, CircuitBreaker          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Valkey      │    │  PostgreSQL   │    │ Card Networks │
│  (Cache +     │    │   (Source     │    │   (TSPs)      │
│  Idempotency) │    │   of Truth)   │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Data Model

### Database Schema

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE provisioned_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    device_id UUID NOT NULL,
    token_ref VARCHAR(100) NOT NULL,
    network VARCHAR(20) NOT NULL,
    last4 VARCHAR(4) NOT NULL,
    card_type VARCHAR(20),
    card_art_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'active',
    is_default BOOLEAN DEFAULT FALSE,
    suspended_at TIMESTAMPTZ,
    suspend_reason VARCHAR(100),
    provisioned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_ref VARCHAR(100) NOT NULL,
    merchant_name VARCHAR(200),
    merchant_category VARCHAR(10),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(20) NOT NULL,
    auth_code VARCHAR(20),
    transaction_type VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cards_user ON provisioned_cards(user_id);
CREATE INDEX idx_transactions_token ON transactions(token_ref, created_at DESC);
```

### TypeScript Interfaces (Shared Types)

```typescript
// shared/types.ts - Used by both frontend and backend

interface Card {
    id: string;
    userId: string;
    deviceId: string;
    tokenRef: string;
    network: 'visa' | 'mastercard' | 'amex';
    last4: string;
    cardType: 'credit' | 'debit';
    cardArtUrl?: string;
    status: 'active' | 'suspended';
    isDefault: boolean;
}

interface Transaction {
    id: string;
    merchantName: string;
    merchantCategory: string;
    amount: number;
    currency: string;
    status: 'approved' | 'declined' | 'pending';
    transactionType: 'nfc' | 'in_app' | 'web';
    createdAt: string;
}

interface PaymentRequest {
    amount: number;
    currency: string;
    merchantId: string;
    merchantName: string;
}

interface PaymentResult {
    approved: boolean;
    authCode?: string;
    network: string;
    transactionId: string;
}
```

## Deep Dive: Card Provisioning Flow (Full Stack)

### Frontend: Add Card Form

```tsx
// components/add-card/AddCardFlow.tsx
function AddCardFlow() {
    const [step, setStep] = useState<'input' | 'verify' | 'complete'>('input');
    const [cardData, setCardData] = useState<CardInput | null>(null);
    const [verificationMethods, setVerificationMethods] = useState<string[]>([]);
    const { addCard } = useWalletStore();

    const handleSubmit = async (data: CardInput) => {
        setCardData(data);

        try {
            const result = await api.provisionCard({
                pan: data.pan,
                expiry: data.expiry,
                cvv: data.cvv
            });

            if (result.status === 'verification_required') {
                setVerificationMethods(result.methods);
                setStep('verify');
            } else if (result.status === 'success') {
                addCard(result.card);
                setStep('complete');
            }
        } catch (error) {
            showToast('Failed to add card');
        }
    };

    const handleVerification = async (method: string, code: string) => {
        const result = await api.completeVerification({
            verificationId: cardData?.verificationId,
            method,
            code
        });

        if (result.success) {
            addCard(result.card);
            setStep('complete');
        }
    };

    return (
        <AnimatePresence mode="wait">
            {step === 'input' && <CardInputForm onSubmit={handleSubmit} />}
            {step === 'verify' && (
                <VerificationStep
                    methods={verificationMethods}
                    onVerify={handleVerification}
                />
            )}
            {step === 'complete' && <SuccessScreen card={cardData} />}
        </AnimatePresence>
    );
}
```

### Backend: Provisioning Endpoint

```typescript
// routes/cards.ts
router.post('/', idempotencyMiddleware, async (req, res) => {
    const userId = req.session.userId!;
    const { pan, expiry, cvv } = req.body;

    // Step 1: Identify card network from BIN
    const network = identifyNetwork(pan);

    // Step 2: Encrypt PAN for network
    const encryptedPAN = await encryptForNetwork(pan, network);

    // Step 3: Request token from network's TSP
    const tokenResponse = await circuitBreaker.execute(
        network,
        () => networkClient[network].requestToken({
            encryptedPAN,
            expiry,
            cvv,
            deviceId: req.headers['x-device-id'],
            walletId: userId
        })
    );

    // Handle verification requirement
    if (tokenResponse.requiresVerification) {
        return res.json({
            status: 'verification_required',
            verificationId: tokenResponse.verificationId,
            methods: tokenResponse.verificationMethods
        });
    }

    // Step 4: Store token reference
    const result = await pool.query(`
        INSERT INTO provisioned_cards
            (user_id, device_id, token_ref, network, last4, card_type, card_art_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
    `, [
        userId,
        req.headers['x-device-id'],
        tokenResponse.tokenRef,
        network,
        pan.slice(-4),
        tokenResponse.cardType,
        tokenResponse.cardArtUrl
    ]);

    // Step 5: Invalidate user's card cache
    await redis.del(`cards:${userId}`);

    res.status(201).json({
        status: 'success',
        card: mapToCardResponse(result.rows[0])
    });
});
```

## Deep Dive: Payment Processing (Full Stack)

### Frontend: Payment Sheet

```tsx
// components/payment/PaymentSheet.tsx
function PaymentSheet() {
    const {
        isPaymentSheetOpen,
        paymentRequest,
        selectedCardId,
        cards,
        selectCard,
        closePaymentSheet
    } = useWalletStore();

    const [authState, setAuthState] = useState<AuthState>('idle');
    const selectedCard = cards.find(c => c.id === selectedCardId);

    const handlePayment = async () => {
        if (!selectedCard || !paymentRequest) return;

        setAuthState('authenticating');

        try {
            // Simulate biometric authentication
            const authenticated = await requestBiometricAuth();
            if (!authenticated) {
                setAuthState('error');
                return;
            }

            // Generate idempotency key
            const idempotencyKey = `pay-${paymentRequest.merchantId}-${Date.now()}`;

            // Process payment
            const result = await api.processPayment({
                cardId: selectedCard.id,
                amount: paymentRequest.amount,
                currency: paymentRequest.currency,
                merchantId: paymentRequest.merchantId
            }, { idempotencyKey });

            if (result.approved) {
                setAuthState('success');
                // Add transaction optimistically
                addTransaction(result.transaction);
                await new Promise(resolve => setTimeout(resolve, 1500));
                closePaymentSheet();
            } else {
                setAuthState('error');
            }
        } catch (error) {
            setAuthState('error');
        }
    };

    if (!isPaymentSheetOpen) return null;

    return (
        <Modal>
            <PaymentHeader merchant={paymentRequest?.merchantName} />
            <AmountDisplay amount={paymentRequest?.amount} currency={paymentRequest?.currency} />
            <CardSelector cards={cards} selected={selectedCardId} onSelect={selectCard} />
            <PaymentButton state={authState} onPress={handlePayment} />
        </Modal>
    );
}
```

### Backend: Payment Endpoint

```typescript
// routes/payments.ts
router.post('/in-app', idempotencyMiddleware, async (req, res) => {
    const userId = req.session.userId!;
    const { cardId, amount, currency, merchantId } = req.body;

    // Step 1: Get card and verify ownership
    const cardResult = await pool.query(`
        SELECT * FROM provisioned_cards
        WHERE id = $1 AND user_id = $2 AND status = 'active'
    `, [cardId, userId]);

    if (cardResult.rows.length === 0) {
        return res.status(404).json({ error: 'Card not found or inactive' });
    }

    const card = cardResult.rows[0];

    // Step 2: Generate cryptogram (simulated - real SE would do this)
    const cryptogram = generateCryptogram({
        tokenRef: card.token_ref,
        amount,
        merchantId
    });

    // Step 3: Process with card network (with circuit breaker)
    const authResult = await circuitBreaker.execute(
        card.network,
        () => networkClient[card.network].authorize({
            token: card.token_ref,
            cryptogram: cryptogram.value,
            atc: cryptogram.atc,
            amount,
            currency,
            merchantId
        }),
        // Fallback for open circuit
        () => ({
            approved: false,
            reason: 'Network temporarily unavailable'
        })
    );

    // Step 4: Record transaction
    const txResult = await pool.query(`
        INSERT INTO transactions
            (token_ref, merchant_name, amount, currency, status, auth_code, transaction_type)
        VALUES ($1, $2, $3, $4, $5, $6, 'in_app')
        RETURNING *
    `, [
        card.token_ref,
        req.body.merchantName,
        amount,
        currency,
        authResult.approved ? 'approved' : 'declined',
        authResult.authCode
    ]);

    // Step 5: Audit log
    await auditLog({
        userId,
        action: authResult.approved ? 'payment.approved' : 'payment.declined',
        resourceType: 'transaction',
        resourceId: txResult.rows[0].id,
        metadata: { amount, currency, merchantId }
    });

    res.json({
        approved: authResult.approved,
        authCode: authResult.authCode,
        transaction: mapToTransactionResponse(txResult.rows[0])
    });
});
```

## Deep Dive: Token Lifecycle Management

### Frontend: Card Management

```tsx
// components/wallet/CardActions.tsx
function CardActions({ card }: { card: Card }) {
    const { suspendCard, removeCard } = useWalletStore();

    const handleSuspend = async () => {
        const confirmed = await showConfirm('Suspend this card?');
        if (!confirmed) return;

        try {
            await api.suspendCard(card.id);
            suspendCard(card.id);
            showToast('Card suspended');
        } catch (error) {
            showToast('Failed to suspend card');
        }
    };

    const handleRemove = async () => {
        const confirmed = await showConfirm('Remove this card permanently?');
        if (!confirmed) return;

        try {
            await api.removeCard(card.id);
            removeCard(card.id);
            showToast('Card removed');
        } catch (error) {
            showToast('Failed to remove card');
        }
    };

    return (
        <div className="space-y-2">
            {card.status === 'active' ? (
                <button onClick={handleSuspend} className="w-full py-3 bg-yellow-500 rounded-xl">
                    Suspend Card
                </button>
            ) : (
                <button onClick={handleReactivate} className="w-full py-3 bg-green-500 rounded-xl">
                    Reactivate Card
                </button>
            )}
            <button onClick={handleRemove} className="w-full py-3 bg-red-500 rounded-xl">
                Remove Card
            </button>
        </div>
    );
}
```

### Backend: Token Lifecycle Service

```typescript
// services/tokenLifecycle.ts
class TokenLifecycleService {
    async suspendCard(userId: string, cardId: string, reason: string) {
        // Get card
        const card = await this.getCard(userId, cardId);

        // Suspend at network
        await networkClient[card.network].suspendToken(card.tokenRef, reason);

        // Update database
        await pool.query(`
            UPDATE provisioned_cards
            SET status = 'suspended', suspended_at = NOW(), suspend_reason = $3
            WHERE id = $1 AND user_id = $2
        `, [cardId, userId, reason]);

        // Invalidate cache
        await redis.del(`token:${card.tokenRef}`);
        await redis.del(`cards:${userId}`);

        // Audit log
        await auditLog({
            userId,
            action: 'card.suspended',
            resourceType: 'card',
            resourceId: cardId,
            metadata: { reason }
        });
    }

    async handleDeviceLost(userId: string, deviceId: string) {
        // Get all cards on device
        const cards = await pool.query(`
            SELECT * FROM provisioned_cards
            WHERE user_id = $1 AND device_id = $2 AND status = 'active'
        `, [userId, deviceId]);

        // Suspend each card
        for (const card of cards.rows) {
            await this.suspendCard(userId, card.id, 'device_lost');
        }

        return { suspendedCount: cards.rows.length };
    }
}
```

## API Design

### RESTful Endpoints

```
POST   /api/auth/login              - Create session
POST   /api/auth/logout             - Destroy session
GET    /api/auth/me                 - Get current user

GET    /api/cards                   - List user's cards
POST   /api/cards                   - Provision new card
DELETE /api/cards/:id               - Remove card
POST   /api/cards/:id/suspend       - Suspend card
POST   /api/cards/:id/reactivate    - Reactivate card
PUT    /api/cards/:id/default       - Set as default

POST   /api/payments/in-app         - Process in-app payment

GET    /api/transactions            - List transactions
GET    /api/transactions/:id        - Get transaction detail

POST   /api/devices/:id/lost        - Mark device as lost
```

### API Client with Idempotency

```typescript
// Frontend: services/api.ts
const api = {
    async provisionCard(data: CardInput): Promise<ProvisionResult> {
        const idempotencyKey = `provision-${data.pan.slice(-4)}-${Date.now()}`;

        const res = await fetch('/api/cards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey
            },
            credentials: 'include',
            body: JSON.stringify(data)
        });

        return res.json();
    },

    async processPayment(
        data: PaymentData,
        options: { idempotencyKey: string }
    ): Promise<PaymentResult> {
        const res = await fetch('/api/payments/in-app', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': options.idempotencyKey
            },
            credentials: 'include',
            body: JSON.stringify(data)
        });

        if (!res.ok) throw new ApiError(res);
        return res.json();
    }
};
```

## Session & Authentication

### Backend Configuration

```typescript
// app.ts
import session from 'express-session';
import RedisStore from 'connect-redis';

app.use(session({
    store: new RedisStore({ client: redis }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));
```

### Frontend Auth State

```typescript
// stores/authStore.ts
interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (credentials: Credentials) => Promise<void>;
    logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,

    login: async ({ email, password }) => {
        const user = await api.login(email, password);
        set({ user, isAuthenticated: true });
    },

    logout: async () => {
        await api.logout();
        set({ user: null, isAuthenticated: false });
        // Clear wallet data
        useWalletStore.getState().clear();
    }
}));
```

## Caching Strategy

### Cache Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend: Zustand persist → localStorage (offline support)  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Backend: Valkey/Redis                                        │
│  - Token lookups: 5 min TTL                                  │
│  - User's cards: 2 min TTL                                   │
│  - Idempotency: 24h TTL                                      │
│  - Sessions: 7 day TTL                                       │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  PostgreSQL: Source of Truth                                  │
└──────────────────────────────────────────────────────────────┘
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand + persist | Offline card viewing | Manual sync on reconnect |
| Idempotency middleware | Safe retries | Redis dependency |
| Circuit breaker per network | Isolated failures | Complexity |
| Serializable transactions | Financial accuracy | Lower throughput |
| Card network tokens | Security | Integration complexity |
| Optimistic UI updates | Instant feedback | Rollback needed on error |

## Scalability Path

### Current: Single Server

```
Browser → Express (Node.js) → PostgreSQL + Valkey
                           → Card Networks
```

### Future: Scaled

```
Browser → CDN (static) → Load Balancer → Express (N nodes)
                                      → Read Replicas
                                      → Valkey Cluster
                                      → PostgreSQL (sharded)
                                      → Card Networks (circuit breaker)
```

## Future Enhancements

1. **Real-time Updates**: WebSocket for transaction notifications
2. **Multi-Region**: Active-active for global availability
3. **Fraud Detection**: ML-based transaction scoring
4. **Apple Watch**: Companion app for wrist payments
5. **Recurring Payments**: Subscription management
