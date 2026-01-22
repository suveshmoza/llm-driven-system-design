# Payment System - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a payment system dashboard that allows:
- Merchants to view transactions, settlements, and analytics
- Real-time transaction monitoring with filters and search
- Secure payment form integration (Stripe-style)
- Webhook configuration and delivery monitoring

## Requirements Clarification

### Functional Requirements
1. **Transaction Dashboard**: Filterable, searchable transaction list with pagination
2. **Transaction Details**: Detailed view with timeline, refund actions, and audit log
3. **Analytics Dashboard**: Charts for revenue, refund rates, and fraud metrics
4. **Webhook Management**: Configure endpoints, view delivery status and payloads
5. **Embedded Payment Form**: Secure, PCI-compliant card input component

### Non-Functional Requirements
1. **Responsive**: Desktop-first, tablet support for dashboard
2. **Performance**: Dashboard loads in < 2 seconds, real-time updates
3. **Security**: No sensitive data in frontend state, secure iframe for card input
4. **Accessibility**: WCAG 2.1 AA compliance for all dashboard features

### UI/UX Requirements
- Clean, professional design suitable for financial data
- Visual status indicators (success/pending/failed)
- Optimistic updates for refund actions
- Real-time transaction feed updates

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         React Application                                     │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        TanStack Router                                   │ │
│  │    /login            → Login Page                                        │ │
│  │    /dashboard        → Overview Analytics                                │ │
│  │    /transactions     → Transaction List                                  │ │
│  │    /transactions/:id → Transaction Details                               │ │
│  │    /webhooks         → Webhook Configuration                             │ │
│  │    /settings         → Merchant Settings                                 │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │                         Zustand Stores                                    ││
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          ││
│  │  │   authStore     │  │  transactionStore│  │   webhookStore  │          ││
│  │  │ - merchant      │  │ - transactions  │  │ - endpoints     │          ││
│  │  │ - isAuthed      │  │ - filters       │  │ - deliveries    │          ││
│  │  │ - permissions   │  │ - pagination    │  │ - testResults   │          ││
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘          ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│                                                                               │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │                         API Service Layer                                 ││
│  │  api.ts: fetch wrapper with auth, error handling, retry logic            ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: State Management with Zustand

### Transaction Store Design

```typescript
// stores/transactionStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface TransactionFilters {
    status?: 'authorized' | 'captured' | 'refunded' | 'failed';
    currency?: string;
    dateRange?: { start: Date; end: Date };
    amountRange?: { min: number; max: number };
    search?: string;
}

interface TransactionState {
    // Data
    transactions: Transaction[];
    selectedTransaction: Transaction | null;
    totalCount: number;

    // Pagination
    page: number;
    pageSize: number;

    // Filters
    filters: TransactionFilters;

    // Loading states
    isLoading: boolean;
    isLoadingDetails: boolean;

    // Actions
    setFilters: (filters: TransactionFilters) => void;
    setPage: (page: number) => void;
    fetchTransactions: () => Promise<void>;
    fetchTransactionDetails: (id: string) => Promise<void>;
    refundTransaction: (id: string, amount?: number) => Promise<void>;
}

export const useTransactionStore = create<TransactionState>()(
    immer((set, get) => ({
        transactions: [],
        selectedTransaction: null,
        totalCount: 0,
        page: 1,
        pageSize: 25,
        filters: {},
        isLoading: false,
        isLoadingDetails: false,

        setFilters: (filters) => {
            set({ filters, page: 1 });
            get().fetchTransactions();
        },

        setPage: (page) => {
            set({ page });
            get().fetchTransactions();
        },

        fetchTransactions: async () => {
            set({ isLoading: true });
            try {
                const { page, pageSize, filters } = get();
                const response = await api.getTransactions({
                    page,
                    limit: pageSize,
                    ...filters
                });
                set({
                    transactions: response.data,
                    totalCount: response.total,
                    isLoading: false
                });
            } catch (error) {
                set({ isLoading: false });
                throw error;
            }
        },

        refundTransaction: async (id, amount) => {
            const { selectedTransaction } = get();

            // Optimistic update
            if (selectedTransaction?.id === id) {
                set((state) => {
                    state.selectedTransaction!.status = 'refunding';
                });
            }

            try {
                const updated = await api.refundTransaction(id, { amount });
                set((state) => {
                    state.selectedTransaction = updated;
                    // Update in list too
                    const idx = state.transactions.findIndex(t => t.id === id);
                    if (idx !== -1) {
                        state.transactions[idx] = updated;
                    }
                });
            } catch (error) {
                // Rollback on failure
                if (selectedTransaction) {
                    set({ selectedTransaction });
                }
                throw error;
            }
        }
    }))
);
```

### Why Zustand with Immer?

| Factor | Zustand + Immer | Redux Toolkit | React Query |
|--------|-----------------|---------------|-------------|
| Boilerplate | Minimal | Moderate | Minimal |
| Immutable updates | Immer syntax | Built-in | N/A |
| Devtools | Yes | Yes | Yes |
| Server state | Manual | Manual | Excellent |
| Bundle size | ~3KB | ~12KB | ~12KB |

**Decision**: Zustand with Immer for complex dashboard state (filters, pagination, optimistic updates). Could add React Query for server state caching if needed.

## Deep Dive: Transaction Dashboard Components

### Transaction List with Virtualization

```tsx
// components/transactions/TransactionList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function TransactionList() {
    const { transactions, isLoading, page, setPage, totalCount, pageSize } =
        useTransactionStore();
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: transactions.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 72,  // Row height
        overscan: 5
    });

    if (isLoading && transactions.length === 0) {
        return <TransactionListSkeleton />;
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-gray-50 border-b text-sm font-medium text-gray-500">
                <div className="col-span-3">Transaction ID</div>
                <div className="col-span-2">Amount</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Customer</div>
                <div className="col-span-3">Date</div>
            </div>

            {/* Virtualized rows */}
            <div ref={parentRef} className="flex-1 overflow-auto">
                <div
                    style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
                >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const transaction = transactions[virtualRow.index];
                        return (
                            <TransactionRow
                                key={transaction.id}
                                transaction={transaction}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`
                                }}
                            />
                        );
                    })}
                </div>
            </div>

            {/* Pagination */}
            <Pagination
                page={page}
                pageSize={pageSize}
                total={totalCount}
                onPageChange={setPage}
            />
        </div>
    );
}
```

### Transaction Row Component

```tsx
// components/transactions/TransactionRow.tsx
function TransactionRow({ transaction, style }: TransactionRowProps) {
    const navigate = useNavigate();

    return (
        <div
            style={style}
            className="grid grid-cols-12 gap-4 px-4 py-4 border-b hover:bg-gray-50 cursor-pointer items-center"
            onClick={() => navigate(`/transactions/${transaction.id}`)}
            role="row"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate(`/transactions/${transaction.id}`)}
        >
            <div className="col-span-3 font-mono text-sm">
                {transaction.id.slice(0, 8)}...
            </div>
            <div className="col-span-2">
                <AmountDisplay
                    amount={transaction.amount}
                    currency={transaction.currency}
                />
            </div>
            <div className="col-span-2">
                <StatusBadge status={transaction.status} />
            </div>
            <div className="col-span-2 text-sm text-gray-600 truncate">
                {transaction.customer_email || 'Guest'}
            </div>
            <div className="col-span-3 text-sm text-gray-500">
                {formatDistanceToNow(new Date(transaction.created_at), { addSuffix: true })}
            </div>
        </div>
    );
}
```

### Status Badge Component

```tsx
// components/ui/StatusBadge.tsx
const STATUS_STYLES = {
    pending: 'bg-yellow-100 text-yellow-800',
    authorized: 'bg-blue-100 text-blue-800',
    captured: 'bg-green-100 text-green-800',
    refunded: 'bg-purple-100 text-purple-800',
    failed: 'bg-red-100 text-red-800',
    voided: 'bg-gray-100 text-gray-800'
};

function StatusBadge({ status }: { status: TransactionStatus }) {
    return (
        <span className={cn(
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
            STATUS_STYLES[status]
        )}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
    );
}
```

## Deep Dive: Transaction Filters

### Filter Panel Component

```tsx
// components/transactions/TransactionFilters.tsx
function TransactionFilters() {
    const { filters, setFilters } = useTransactionStore();
    const [localFilters, setLocalFilters] = useState(filters);

    // Debounce search input
    const debouncedSearch = useDebouncedCallback((value: string) => {
        setFilters({ ...localFilters, search: value });
    }, 300);

    return (
        <div className="flex flex-wrap gap-4 p-4 bg-white border-b">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by ID, email, or amount..."
                        className="w-full pl-10 pr-4 py-2 border rounded-lg"
                        defaultValue={filters.search}
                        onChange={(e) => debouncedSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Status filter */}
            <Select
                value={localFilters.status || 'all'}
                onValueChange={(value) => {
                    const newFilters = {
                        ...localFilters,
                        status: value === 'all' ? undefined : value
                    };
                    setLocalFilters(newFilters);
                    setFilters(newFilters);
                }}
            >
                <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="authorized">Authorized</SelectItem>
                    <SelectItem value="captured">Captured</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
            </Select>

            {/* Date range picker */}
            <DateRangePicker
                value={localFilters.dateRange}
                onChange={(range) => {
                    const newFilters = { ...localFilters, dateRange: range };
                    setLocalFilters(newFilters);
                    setFilters(newFilters);
                }}
            />

            {/* Amount range */}
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline">
                        Amount {localFilters.amountRange && '(filtered)'}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium">Minimum</label>
                            <CurrencyInput
                                value={localFilters.amountRange?.min}
                                onChange={(min) => setLocalFilters({
                                    ...localFilters,
                                    amountRange: { ...localFilters.amountRange, min }
                                })}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium">Maximum</label>
                            <CurrencyInput
                                value={localFilters.amountRange?.max}
                                onChange={(max) => setLocalFilters({
                                    ...localFilters,
                                    amountRange: { ...localFilters.amountRange, max }
                                })}
                            />
                        </div>
                        <Button onClick={() => setFilters(localFilters)}>
                            Apply
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>

            {/* Clear all */}
            {Object.keys(filters).length > 0 && (
                <Button
                    variant="ghost"
                    onClick={() => {
                        setLocalFilters({});
                        setFilters({});
                    }}
                >
                    Clear all
                </Button>
            )}
        </div>
    );
}
```

## Deep Dive: Transaction Details with Timeline

### Transaction Details Page

```tsx
// routes/transactions.$id.tsx
function TransactionDetails() {
    const { id } = useParams();
    const { selectedTransaction, fetchTransactionDetails, isLoadingDetails } =
        useTransactionStore();

    useEffect(() => {
        fetchTransactionDetails(id);
    }, [id]);

    if (isLoadingDetails) {
        return <TransactionDetailsSkeleton />;
    }

    if (!selectedTransaction) {
        return <NotFound message="Transaction not found" />;
    }

    const txn = selectedTransaction;

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        {formatCurrency(txn.amount, txn.currency)}
                        <StatusBadge status={txn.status} />
                    </h1>
                    <p className="text-gray-500 font-mono">{txn.id}</p>
                </div>

                {txn.status === 'captured' && txn.refunded_amount < txn.amount && (
                    <RefundButton transaction={txn} />
                )}
            </div>

            <div className="grid grid-cols-3 gap-8">
                {/* Details panel */}
                <div className="col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Payment Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <DetailRow label="Amount" value={formatCurrency(txn.amount, txn.currency)} />
                            <DetailRow label="Currency" value={txn.currency.toUpperCase()} />
                            <DetailRow label="Captured" value={formatCurrency(txn.captured_amount, txn.currency)} />
                            <DetailRow label="Refunded" value={formatCurrency(txn.refunded_amount, txn.currency)} />
                            <DetailRow label="Processor Ref" value={txn.processor_ref || '-'} />
                        </CardContent>
                    </Card>

                    {txn.fraud_score !== null && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Risk Assessment</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <FraudScoreDisplay score={txn.fraud_score} flags={txn.fraud_flags} />
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Timeline */}
                <div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Timeline</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <TransactionTimeline events={txn.events} />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
```

### Transaction Timeline Component

```tsx
// components/transactions/TransactionTimeline.tsx
const EVENT_ICONS = {
    created: Clock,
    authorized: CheckCircle,
    captured: DollarSign,
    refunded: RotateCcw,
    failed: XCircle,
    voided: Slash
};

function TransactionTimeline({ events }: { events: TransactionEvent[] }) {
    return (
        <ol className="relative border-l border-gray-200">
            {events.map((event, index) => {
                const Icon = EVENT_ICONS[event.type] || Clock;
                const isFirst = index === 0;

                return (
                    <li key={event.id} className="mb-6 ml-6">
                        <span className={cn(
                            'absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full',
                            isFirst ? 'bg-blue-100 ring-4 ring-white' : 'bg-gray-100'
                        )}>
                            <Icon className={cn(
                                'w-3 h-3',
                                isFirst ? 'text-blue-600' : 'text-gray-500'
                            )} />
                        </span>
                        <h3 className="font-medium text-gray-900 capitalize">
                            {event.type.replace('_', ' ')}
                        </h3>
                        <time className="text-sm text-gray-500">
                            {format(new Date(event.created_at), 'MMM d, yyyy h:mm a')}
                        </time>
                        {event.metadata && (
                            <p className="text-sm text-gray-600 mt-1">
                                {formatEventMetadata(event)}
                            </p>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}
```

## Deep Dive: Refund Modal

### Refund Dialog Component

```tsx
// components/transactions/RefundDialog.tsx
function RefundDialog({ transaction, open, onOpenChange }: RefundDialogProps) {
    const { refundTransaction } = useTransactionStore();
    const [amount, setAmount] = useState(transaction.amount - transaction.refunded_amount);
    const [isFullRefund, setIsFullRefund] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const maxRefundable = transaction.amount - transaction.refunded_amount;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsProcessing(true);

        try {
            await refundTransaction(
                transaction.id,
                isFullRefund ? undefined : amount
            );
            onOpenChange(false);
            toast.success('Refund processed successfully');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to process refund');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Refund Transaction</DialogTitle>
                    <DialogDescription>
                        Issue a refund for transaction {transaction.id.slice(0, 8)}...
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Refund type toggle */}
                    <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                checked={isFullRefund}
                                onChange={() => setIsFullRefund(true)}
                                className="text-blue-600"
                            />
                            <span>Full refund ({formatCurrency(maxRefundable, transaction.currency)})</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                checked={!isFullRefund}
                                onChange={() => setIsFullRefund(false)}
                                className="text-blue-600"
                            />
                            <span>Partial refund</span>
                        </label>
                    </div>

                    {/* Amount input for partial refund */}
                    {!isFullRefund && (
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Amount (max: {formatCurrency(maxRefundable, transaction.currency)})
                            </label>
                            <CurrencyInput
                                value={amount}
                                currency={transaction.currency}
                                max={maxRefundable}
                                onChange={setAmount}
                            />
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isProcessing}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isProcessing}>
                            {isProcessing ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : null}
                            Process Refund
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
```

## Deep Dive: Analytics Dashboard

### Revenue Chart Component

```tsx
// components/analytics/RevenueChart.tsx
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function RevenueChart({ data, period }: { data: RevenueData[]; period: string }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Revenue</CardTitle>
                <PeriodSelector value={period} onChange={() => {}} />
            </CardHeader>
            <CardContent>
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis
                                dataKey="date"
                                tickFormatter={(value) => format(new Date(value), 'MMM d')}
                                tick={{ fontSize: 12 }}
                            />
                            <YAxis
                                tickFormatter={(value) => `$${(value / 100).toLocaleString()}`}
                                tick={{ fontSize: 12 }}
                            />
                            <Tooltip
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const data = payload[0].payload;
                                    return (
                                        <div className="bg-white p-3 border rounded shadow-lg">
                                            <p className="font-medium">
                                                {format(new Date(data.date), 'MMMM d, yyyy')}
                                            </p>
                                            <p className="text-blue-600 font-bold">
                                                {formatCurrency(data.amount, 'USD')}
                                            </p>
                                            <p className="text-sm text-gray-500">
                                                {data.count} transactions
                                            </p>
                                        </div>
                                    );
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="amount"
                                stroke="#3B82F6"
                                fill="url(#colorRevenue)"
                                strokeWidth={2}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
```

## Deep Dive: Secure Payment Form (Embedded)

### Payment Element Component

```tsx
// components/checkout/PaymentForm.tsx
// PCI-compliant form using iframe isolation

function PaymentForm({ clientSecret, onSuccess, onError }: PaymentFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [cardComplete, setCardComplete] = useState({
        number: false,
        expiry: false,
        cvc: false
    });

    const allComplete = Object.values(cardComplete).every(Boolean);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            // Post to secure iframe, get token back
            const tokenResponse = await cardIframeRef.current?.tokenize();
            if (!tokenResponse?.token) {
                throw new Error('Failed to tokenize card');
            }

            // Submit token to our backend
            const result = await api.confirmPayment(clientSecret, {
                payment_method_token: tokenResponse.token
            });

            onSuccess(result);
        } catch (err) {
            onError(err instanceof Error ? err : new Error('Payment failed'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium mb-1">Card number</label>
                <CardNumberInput
                    onComplete={(complete) => setCardComplete(c => ({ ...c, number: complete }))}
                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Expiry</label>
                    <CardExpiryInput
                        onComplete={(complete) => setCardComplete(c => ({ ...c, expiry: complete }))}
                        className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">CVC</label>
                    <CardCvcInput
                        onComplete={(complete) => setCardComplete(c => ({ ...c, cvc: complete }))}
                        className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            </div>

            <Button
                type="submit"
                className="w-full"
                disabled={!allComplete || isLoading}
            >
                {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    'Pay now'
                )}
            </Button>
        </form>
    );
}
```

## Accessibility (a11y)

### Semantic Structure

```tsx
<main role="main" aria-label="Transaction Dashboard">
    <nav aria-label="Dashboard navigation">
        {/* Sidebar navigation */}
    </nav>

    <section aria-label="Transaction filters">
        <h2 className="sr-only">Filter transactions</h2>
        {/* Filter controls */}
    </section>

    <section aria-label="Transaction list">
        <h2 className="sr-only">Transactions</h2>
        <div role="table" aria-label="Transaction data">
            <div role="rowgroup">
                <div role="row" aria-label="Column headers">
                    <div role="columnheader">Transaction ID</div>
                    {/* ... */}
                </div>
            </div>
            <div role="rowgroup">
                {/* Transaction rows */}
            </div>
        </div>
    </section>
</main>
```

### Keyboard Navigation

```tsx
// hooks/useTableKeyboardNav.ts
function useTableKeyboardNav(rowCount: number, onSelect: (index: number) => void) {
    const [focusedRow, setFocusedRow] = useState(-1);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setFocusedRow(r => Math.min(r + 1, rowCount - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setFocusedRow(r => Math.max(r - 1, 0));
                    break;
                case 'Enter':
                    if (focusedRow >= 0) {
                        onSelect(focusedRow);
                    }
                    break;
                case 'Home':
                    setFocusedRow(0);
                    break;
                case 'End':
                    setFocusedRow(rowCount - 1);
                    break;
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [rowCount, focusedRow, onSelect]);

    return focusedRow;
}
```

## Performance Optimizations

### 1. Virtual Scrolling for Large Lists

Already implemented with `@tanstack/react-virtual` for transaction list.

### 2. Debounced Search

```tsx
const debouncedSearch = useDebouncedCallback((value: string) => {
    setFilters({ ...filters, search: value });
}, 300);
```

### 3. Selective Store Subscriptions

```tsx
// Only re-render when specific state changes
const transactions = useTransactionStore(state => state.transactions);
const isLoading = useTransactionStore(state => state.isLoading);
```

### 4. Lazy Loading Routes

```tsx
// routes/__root.tsx
const TransactionDetails = lazy(() => import('./transactions.$id'));
const Analytics = lazy(() => import('./analytics'));
const Webhooks = lazy(() => import('./webhooks'));
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand over Context | Less boilerplate, selectors | Extra dependency |
| Virtual scrolling | Handles 1000s of rows | More complex implementation |
| Optimistic updates | Instant feedback | Rollback complexity |
| Debounced search | Fewer API calls | Slight input lag |
| Iframe for card input | PCI compliant | Cross-origin complexity |

## Future Frontend Enhancements

1. **Real-time Updates**: WebSocket connection for live transaction feed
2. **Offline Support**: Service worker for dashboard caching
3. **Export Features**: CSV/PDF export for transaction reports
4. **Dark Mode**: Theme toggle with system preference detection
5. **Mobile App**: React Native version for transaction monitoring
