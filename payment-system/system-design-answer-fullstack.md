# Payment System - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design a payment processing system that:
- Processes credit card, debit card, and bank transfer transactions
- Provides a merchant dashboard for viewing transactions and analytics
- Handles refunds with proper accounting
- Detects fraud in real-time

This answer covers the end-to-end architecture, emphasizing integration between frontend and backend components.

## Requirements Clarification

### Functional Requirements
1. **Payment Processing**: Authorize, capture, void, and refund payments via API
2. **Merchant Dashboard**: View transactions, analytics, and configure webhooks
3. **Idempotent API**: Retry-safe operations preventing double-charges
4. **Real-time Fraud Detection**: Risk scoring with immediate feedback
5. **Webhook Delivery**: Reliable event notifications to merchants

### Non-Functional Requirements
1. **Consistency**: Strong consistency for ledger operations
2. **Latency**: Authorization < 2s, dashboard loads < 2s
3. **Availability**: 99.99% for payment API, 99.9% for dashboard
4. **Security**: PCI-DSS compliance, encrypted data at rest and in transit

### Scale Estimates
- 50M transactions/day = 600 TPS average, 2,000 TPS peak
- 10,000 active merchants using dashboard
- Read-heavy dashboard: 50:1 read:write ratio

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Browser (React Dashboard)                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │  Views: Login | Transactions | Analytics | Webhooks | Settings         │   │
│  │  State: Zustand stores for transactions, auth, filters                 │   │
│  └───────────────────────────┬───────────────────────────────────────────┘   │
│  ┌───────────────────────────┴───────────────────────────────────────────┐   │
│  │  API Service: fetch wrapper with auth, retry, error handling           │   │
│  └───────────────────────────┬───────────────────────────────────────────┘   │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │ REST API (JSON)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Express API Server                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │  Middleware: cors, session, apiKeyAuth, rateLimit, errorHandler        │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  auth.ts        │  │  payments.ts    │  │  webhooks.ts                │  │
│  │  - login        │  │  - create       │  │  - register endpoint        │  │
│  │  - logout       │  │  - capture      │  │  - list deliveries          │  │
│  │  - me           │  │  - refund       │  │  - test webhook             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │  Services: FraudService, LedgerService, WebhookService                 │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  PostgreSQL   │    │    Valkey     │    │   RabbitMQ    │
│  Transactions │    │  Idempotency  │    │   Webhooks    │
│  Ledger       │    │  Rate limits  │    │   Settlement  │
│  Merchants    │    │  Sessions     │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Data Model

### Database Schema

```sql
-- Merchants (payment system customers)
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,  -- For dashboard login
    api_key_hash VARCHAR(64) NOT NULL,    -- For API auth
    webhook_url TEXT,
    webhook_secret VARCHAR(64),
    default_currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions with idempotency
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    idempotency_key VARCHAR(255),
    amount BIGINT NOT NULL,           -- Cents
    currency VARCHAR(3) NOT NULL,
    captured_amount BIGINT DEFAULT 0,
    refunded_amount BIGINT DEFAULT 0,
    status VARCHAR(20) NOT NULL,      -- pending, authorized, captured, refunded, failed
    fraud_score INTEGER,
    fraud_flags JSONB DEFAULT '[]',
    processor_ref VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(merchant_id, idempotency_key)
);

-- Double-entry ledger
CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    entry_type VARCHAR(10) NOT NULL,  -- debit, credit
    account_type VARCHAR(30) NOT NULL,
    amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_merchant_time ON transactions(merchant_id, created_at DESC);
CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
```

### TypeScript Interfaces (Shared Types)

```typescript
// shared/types.ts - Used by frontend and backend

interface Merchant {
    id: string;
    name: string;
    email: string;
    default_currency: string;
    webhook_url?: string;
}

interface Transaction {
    id: string;
    merchant_id: string;
    amount: number;
    currency: string;
    captured_amount: number;
    refunded_amount: number;
    status: 'pending' | 'authorized' | 'captured' | 'refunded' | 'failed';
    fraud_score?: number;
    fraud_flags: string[];
    processor_ref?: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

interface TransactionFilters {
    status?: string;
    currency?: string;
    dateRange?: { start: string; end: string };
    amountRange?: { min: number; max: number };
    search?: string;
}

interface PaymentRequest {
    amount: number;
    currency: string;
    payment_method_id: string;
    capture?: boolean;
    metadata?: Record<string, unknown>;
}

interface PaymentResponse {
    transaction: Transaction;
    fraud_score: number;
    warnings?: string[];
}
```

## Deep Dive: API Design

### RESTful Endpoints

```
Authentication (Session-based for dashboard):
POST   /api/auth/login         Login with email/password
POST   /api/auth/logout        Destroy session
GET    /api/auth/me            Get current merchant

Payments (API key auth):
POST   /v1/payments             Create payment (Idempotency-Key header)
POST   /v1/payments/:id/capture Capture authorized payment
POST   /v1/payments/:id/refund  Refund captured payment
GET    /v1/payments/:id         Get payment details
GET    /v1/payments             List payments (paginated, filterable)

Webhooks:
PUT    /api/webhooks/endpoint   Update webhook URL
GET    /api/webhooks/deliveries List delivery attempts
POST   /api/webhooks/test       Send test webhook

Analytics:
GET    /api/analytics/revenue   Revenue by day/week/month
GET    /api/analytics/summary   Dashboard summary stats
```

### API Integration Pattern

```typescript
// Frontend: services/api.ts
const api = {
    async login(email: string, password: string): Promise<Merchant> {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });
        if (!res.ok) throw new ApiError(res);
        return res.json();
    },

    async getTransactions(params: TransactionFilters & Pagination): Promise<PaginatedResponse<Transaction>> {
        const qs = new URLSearchParams();
        if (params.status) qs.set('status', params.status);
        if (params.search) qs.set('search', params.search);
        if (params.page) qs.set('page', String(params.page));

        const res = await fetch(`/v1/payments?${qs}`, {
            credentials: 'include'
        });
        if (!res.ok) throw new ApiError(res);
        return res.json();
    },

    async refundTransaction(id: string, amount?: number): Promise<Transaction> {
        const res = await fetch(`/v1/payments/${id}/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ amount })
        });
        if (!res.ok) throw new ApiError(res);
        return res.json();
    }
};
```

```typescript
// Backend: routes/payments.ts
router.post('/', async (req, res) => {
    const merchantId = req.merchant.id;  // From API key auth
    const idempotencyKey = req.headers['idempotency-key'];
    const { amount, currency, payment_method_id, capture } = req.body;

    // Check idempotency
    const cacheKey = `idempotency:${merchantId}:${idempotencyKey}`;
    const cached = await valkey.get(cacheKey);
    if (cached) {
        return res.json(JSON.parse(cached));
    }

    // Acquire distributed lock
    const lockKey = `lock:${cacheKey}`;
    const locked = await valkey.set(lockKey, '1', 'NX', 'EX', 30);
    if (!locked) {
        return res.status(409).json({ error: 'Request in progress' });
    }

    try {
        // Calculate fraud score
        const fraudScore = await fraudService.evaluate({
            amount, currency, payment_method_id,
            ip: req.ip,
            merchant_id: merchantId
        });

        // Process in transaction
        const result = await db.transaction(async (tx) => {
            const txn = await tx.insert(transactions).values({
                merchant_id: merchantId,
                idempotency_key: idempotencyKey,
                amount,
                currency,
                status: capture ? 'captured' : 'authorized',
                captured_amount: capture ? amount : 0,
                fraud_score: fraudScore
            }).returning();

            // Create ledger entries
            if (capture) {
                await ledgerService.recordCapture(tx, txn[0]);
            }

            return txn[0];
        });

        // Cache response
        const response = { transaction: result, fraud_score: fraudScore };
        await valkey.setex(cacheKey, 86400, JSON.stringify(response));

        // Queue webhook
        await rabbitmq.publish('webhook.delivery', {
            merchant_id: merchantId,
            event_type: capture ? 'payment.captured' : 'payment.authorized',
            payload: result
        });

        res.status(201).json(response);
    } finally {
        await valkey.del(lockKey);
    }
});
```

## Deep Dive: Transaction Dashboard (Full Stack Flow)

### Frontend: Transaction List Component

```tsx
// components/transactions/TransactionList.tsx
function TransactionList() {
    const { transactions, isLoading, filters, setFilters, page, setPage, totalCount } =
        useTransactionStore();

    useEffect(() => {
        useTransactionStore.getState().fetchTransactions();
    }, [filters, page]);

    return (
        <div className="flex flex-col h-full">
            {/* Filters */}
            <TransactionFilters
                filters={filters}
                onChange={setFilters}
            />

            {/* Table */}
            <div className="flex-1 overflow-auto">
                {isLoading ? (
                    <TransactionSkeleton />
                ) : (
                    <table className="w-full">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                <th className="px-4 py-3 text-left">ID</th>
                                <th className="px-4 py-3 text-left">Amount</th>
                                <th className="px-4 py-3 text-left">Status</th>
                                <th className="px-4 py-3 text-left">Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.map(txn => (
                                <TransactionRow key={txn.id} transaction={txn} />
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            <Pagination
                page={page}
                total={totalCount}
                pageSize={25}
                onChange={setPage}
            />
        </div>
    );
}
```

### Backend: List Transactions with Filters

```typescript
// routes/payments.ts
router.get('/', async (req, res) => {
    const merchantId = req.merchant?.id || req.session?.merchantId;
    const { status, search, start_date, end_date, page = 1, limit = 25 } = req.query;

    let query = db
        .select()
        .from(transactions)
        .where(eq(transactions.merchant_id, merchantId))
        .orderBy(desc(transactions.created_at))
        .limit(Number(limit))
        .offset((Number(page) - 1) * Number(limit));

    // Apply filters
    if (status) {
        query = query.where(eq(transactions.status, status));
    }
    if (search) {
        query = query.where(
            or(
                ilike(transactions.id, `%${search}%`),
                ilike(transactions.processor_ref, `%${search}%`)
            )
        );
    }
    if (start_date && end_date) {
        query = query.where(
            and(
                gte(transactions.created_at, new Date(start_date)),
                lte(transactions.created_at, new Date(end_date))
            )
        );
    }

    // Get total count for pagination
    const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(eq(transactions.merchant_id, merchantId));

    const results = await query;

    res.json({
        data: results,
        total: Number(countResult[0].count),
        page: Number(page),
        limit: Number(limit)
    });
});
```

## Deep Dive: Refund Flow (Full Stack)

### Frontend: Refund Modal

```tsx
// components/transactions/RefundDialog.tsx
function RefundDialog({ transaction, open, onClose }: RefundDialogProps) {
    const { refundTransaction } = useTransactionStore();
    const [amount, setAmount] = useState(transaction.amount - transaction.refunded_amount);
    const [isFullRefund, setIsFullRefund] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    const maxRefundable = transaction.amount - transaction.refunded_amount;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsProcessing(true);

        try {
            await refundTransaction(transaction.id, isFullRefund ? undefined : amount);
            toast.success('Refund processed successfully');
            onClose();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Refund failed');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Refund Transaction</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="flex gap-4">
                        <label className="flex items-center gap-2">
                            <input
                                type="radio"
                                checked={isFullRefund}
                                onChange={() => setIsFullRefund(true)}
                            />
                            Full refund ({formatCurrency(maxRefundable, transaction.currency)})
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="radio"
                                checked={!isFullRefund}
                                onChange={() => setIsFullRefund(false)}
                            />
                            Partial refund
                        </label>
                    </div>

                    {!isFullRefund && (
                        <CurrencyInput
                            value={amount}
                            max={maxRefundable}
                            currency={transaction.currency}
                            onChange={setAmount}
                        />
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isProcessing}>
                            {isProcessing ? 'Processing...' : 'Refund'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
```

### Backend: Refund Endpoint

```typescript
// routes/payments.ts
router.post('/:id/refund', async (req, res) => {
    const merchantId = req.merchant?.id || req.session?.merchantId;
    const { id } = req.params;
    const { amount } = req.body;

    // Verify ownership and status
    const txn = await db.select().from(transactions)
        .where(and(
            eq(transactions.id, id),
            eq(transactions.merchant_id, merchantId)
        ))
        .limit(1);

    if (!txn.length) {
        return res.status(404).json({ error: 'Transaction not found' });
    }

    if (txn[0].status !== 'captured') {
        return res.status(400).json({ error: 'Transaction cannot be refunded' });
    }

    const refundAmount = amount || (txn[0].amount - txn[0].refunded_amount);
    const maxRefundable = txn[0].amount - txn[0].refunded_amount;

    if (refundAmount > maxRefundable) {
        return res.status(400).json({ error: 'Refund amount exceeds available' });
    }

    // Process refund in transaction
    const updated = await db.transaction(async (tx) => {
        const newRefundedAmount = txn[0].refunded_amount + refundAmount;
        const newStatus = newRefundedAmount >= txn[0].amount ? 'refunded' : 'captured';

        await tx.update(transactions)
            .set({
                refunded_amount: newRefundedAmount,
                status: newStatus,
                updated_at: new Date()
            })
            .where(eq(transactions.id, id));

        // Create ledger entries for refund
        await ledgerService.recordRefund(tx, txn[0], refundAmount);

        // Create audit log
        await tx.insert(auditLog).values({
            entity_type: 'transaction',
            entity_id: id,
            action: 'refunded',
            changes: { refund_amount: refundAmount },
            actor_id: merchantId
        });

        return tx.select().from(transactions).where(eq(transactions.id, id));
    });

    // Queue webhook
    await rabbitmq.publish('webhook.delivery', {
        merchant_id: merchantId,
        event_type: 'refund.created',
        payload: { transaction: updated[0], refund_amount: refundAmount }
    });

    res.json(updated[0]);
});
```

## Deep Dive: Fraud Score Display

### Frontend: Risk Assessment Component

```tsx
// components/transactions/FraudScoreDisplay.tsx
function FraudScoreDisplay({ score, flags }: { score: number; flags: string[] }) {
    const getRiskLevel = (score: number) => {
        if (score < 30) return { label: 'Low Risk', color: 'green' };
        if (score < 70) return { label: 'Medium Risk', color: 'yellow' };
        return { label: 'High Risk', color: 'red' };
    };

    const { label, color } = getRiskLevel(score);

    return (
        <div className="space-y-4">
            {/* Score gauge */}
            <div className="flex items-center gap-4">
                <div className="relative w-32 h-16">
                    <svg viewBox="0 0 100 50" className="w-full h-full">
                        {/* Background arc */}
                        <path
                            d="M 10 50 A 40 40 0 0 1 90 50"
                            fill="none"
                            stroke="#e5e7eb"
                            strokeWidth="8"
                        />
                        {/* Score arc */}
                        <path
                            d="M 10 50 A 40 40 0 0 1 90 50"
                            fill="none"
                            stroke={color === 'green' ? '#22c55e' : color === 'yellow' ? '#eab308' : '#ef4444'}
                            strokeWidth="8"
                            strokeDasharray={`${score * 1.26} 126`}
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-end justify-center pb-1">
                        <span className="text-2xl font-bold">{score}</span>
                    </div>
                </div>
                <div>
                    <span className={cn(
                        'px-2 py-1 rounded text-sm font-medium',
                        color === 'green' && 'bg-green-100 text-green-800',
                        color === 'yellow' && 'bg-yellow-100 text-yellow-800',
                        color === 'red' && 'bg-red-100 text-red-800'
                    )}>
                        {label}
                    </span>
                </div>
            </div>

            {/* Risk flags */}
            {flags.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">Risk Factors</h4>
                    <ul className="space-y-1">
                        {flags.map((flag, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                                {flag}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
```

### Backend: Fraud Service

```typescript
// services/fraudService.ts
interface FraudEvaluationResult {
    score: number;
    flags: string[];
}

export async function evaluate(params: {
    amount: number;
    currency: string;
    payment_method_id: string;
    ip: string;
    merchant_id: string;
}): Promise<FraudEvaluationResult> {
    const flags: string[] = [];
    let score = 0;

    // Velocity check
    const velocityKey = `velocity:${params.payment_method_id}`;
    const recentCount = await valkey.zcard(velocityKey);
    if (recentCount > 10) {
        score += 30;
        flags.push('High transaction velocity');
    } else if (recentCount > 5) {
        score += 15;
        flags.push('Elevated transaction velocity');
    }

    // Amount anomaly check
    const avgAmount = await getAverageAmount(params.payment_method_id);
    if (params.amount > avgAmount * 3) {
        score += 20;
        flags.push('Amount significantly above average');
    }

    // Geo check (simplified)
    const isNewLocation = await checkNewLocation(params.ip, params.payment_method_id);
    if (isNewLocation) {
        score += 15;
        flags.push('New geographic location');
    }

    // Track this transaction
    await valkey.zadd(velocityKey, Date.now(), `${Date.now()}`);
    await valkey.expire(velocityKey, 3600);

    return { score: Math.min(score, 100), flags };
}
```

## Session Management

### Backend: Session Configuration

```typescript
// app.ts
import session from 'express-session';
import RedisStore from 'connect-redis';
import { valkey } from './shared/valkey';

app.use(session({
    store: new RedisStore({ client: valkey }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,  // 24 hours
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));
```

### Frontend: Auth State

```typescript
// stores/authStore.ts
interface AuthState {
    merchant: Merchant | null;
    isAuthenticated: boolean;
    isLoading: boolean;

    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    merchant: null,
    isAuthenticated: false,
    isLoading: true,

    checkAuth: async () => {
        try {
            const merchant = await api.getCurrentMerchant();
            set({ merchant, isAuthenticated: true, isLoading: false });
        } catch {
            set({ merchant: null, isAuthenticated: false, isLoading: false });
        }
    },

    login: async (email, password) => {
        const merchant = await api.login(email, password);
        set({ merchant, isAuthenticated: true });
    },

    logout: async () => {
        await api.logout();
        set({ merchant: null, isAuthenticated: false });
    }
}));
```

## Optimistic Updates

### Refund with Rollback

```typescript
// stores/transactionStore.ts
refundTransaction: async (id, amount) => {
    const { transactions, selectedTransaction } = get();

    // Save original state for rollback
    const originalTransaction = selectedTransaction;
    const originalList = [...transactions];

    // Optimistic update
    set((state) => {
        if (state.selectedTransaction?.id === id) {
            state.selectedTransaction = {
                ...state.selectedTransaction,
                status: 'refunding' as any  // Temporary UI state
            };
        }
    });

    try {
        const updated = await api.refundTransaction(id, amount);

        // Apply actual result
        set((state) => {
            state.selectedTransaction = updated;
            const idx = state.transactions.findIndex(t => t.id === id);
            if (idx !== -1) {
                state.transactions[idx] = updated;
            }
        });
    } catch (error) {
        // Rollback on failure
        set({
            selectedTransaction: originalTransaction,
            transactions: originalList
        });
        throw error;
    }
}
```

## Webhook Configuration Flow

### Frontend: Webhook Settings

```tsx
// routes/webhooks.tsx
function WebhookSettings() {
    const { endpoint, updateEndpoint, testWebhook, deliveries } = useWebhookStore();
    const [url, setUrl] = useState(endpoint?.url || '');
    const [isTesting, setIsTesting] = useState(false);

    const handleSave = async () => {
        await updateEndpoint(url);
        toast.success('Webhook endpoint updated');
    };

    const handleTest = async () => {
        setIsTesting(true);
        try {
            const result = await testWebhook();
            if (result.success) {
                toast.success('Test webhook delivered successfully');
            } else {
                toast.error(`Test failed: ${result.error}`);
            }
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle>Webhook Endpoint</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">URL</label>
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://your-site.com/webhooks"
                            className="w-full p-2 border rounded"
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={handleSave}>Save</Button>
                        <Button variant="outline" onClick={handleTest} disabled={isTesting}>
                            {isTesting ? 'Testing...' : 'Send Test'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Recent Deliveries</CardTitle>
                </CardHeader>
                <CardContent>
                    <WebhookDeliveryList deliveries={deliveries} />
                </CardContent>
            </Card>
        </div>
    );
}
```

### Backend: Webhook Test Endpoint

```typescript
// routes/webhooks.ts
router.post('/test', async (req, res) => {
    const merchantId = req.session.merchantId;

    const merchant = await db.select().from(merchants)
        .where(eq(merchants.id, merchantId))
        .limit(1);

    if (!merchant[0].webhook_url) {
        return res.status(400).json({ error: 'No webhook URL configured' });
    }

    const testPayload = {
        id: `test_${Date.now()}`,
        type: 'test',
        created_at: new Date().toISOString(),
        data: { message: 'This is a test webhook' }
    };

    const signature = crypto
        .createHmac('sha256', merchant[0].webhook_secret)
        .update(JSON.stringify(testPayload))
        .digest('hex');

    try {
        const response = await fetch(merchant[0].webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': `sha256=${signature}`
            },
            body: JSON.stringify(testPayload),
            signal: AbortSignal.timeout(10000)
        });

        res.json({
            success: response.ok,
            status_code: response.status,
            response_time_ms: Date.now() - parseInt(testPayload.id.split('_')[1])
        });
    } catch (error) {
        res.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Session + API key auth | Familiar patterns for both | Two auth systems to maintain |
| Zustand for state | Simple, less boilerplate | No server cache like React Query |
| Optimistic updates | Instant UI feedback | Rollback complexity |
| PostgreSQL sessions | Simpler than Redis | Slower, but acceptable |
| Valkey for idempotency | Fast, TTL built-in | Additional infrastructure |
| RabbitMQ for webhooks | Reliable, DLQ support | More complex than direct HTTP |

## Scalability Path

### Current: Single Server

```
Browser → Express (Node.js) → PostgreSQL + Valkey
```

### Future: Scaled

```
Browser → CDN → Load Balancer → Express (5 nodes) → Read Replicas
                                       ↓
                                 Valkey Cluster
                                       ↓
                                 PostgreSQL Primary
```

1. **Stateless API servers**: Sessions in Valkey enable horizontal scaling
2. **Read replicas**: Route dashboard queries to replicas
3. **CDN**: Cache static assets and potentially API responses
4. **Connection pooling**: PgBouncer for high connection counts

## Future Enhancements

1. **Real-time Updates**: WebSocket for live transaction feed
2. **Export Features**: CSV/PDF export for transaction reports
3. **Multi-Currency Analytics**: Currency conversion in charts
4. **Advanced Fraud Rules**: Custom rule builder in dashboard
5. **Mobile App**: React Native for transaction monitoring
