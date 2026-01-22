# Apple Pay - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a mobile wallet application that:
- Displays and manages provisioned payment cards
- Presents payment sheets for NFC and in-app payments
- Shows transaction history with merchant details
- Provides biometric authentication flows

## Requirements Clarification

### Functional Requirements
1. **Card Management**: Display cards with visual representations, add/remove cards
2. **Payment Sheet**: Present payment options during checkout
3. **Transaction History**: Searchable list with filtering
4. **Device Management**: View and manage connected devices
5. **Settings**: Card preferences, default card selection

### Non-Functional Requirements
1. **Responsive**: Works on various device sizes
2. **Performance**: Card selection < 100ms, smooth animations
3. **Accessibility**: VoiceOver/screen reader support
4. **Offline Resilience**: Show cached cards and history when offline

### UI/UX Requirements
- Apple-like design language with clean aesthetics
- Card stack visualization with realistic card art
- Haptic feedback simulation for interactions
- Clear status indicators for card states

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          React Application                               │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        TanStack Router                               ││
│  │    /                  → Wallet View (card list)                      ││
│  │    /card/:id          → Card Detail                                  ││
│  │    /transactions      → Transaction History                         ││
│  │    /add-card          → Card Provisioning Flow                       ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌───────────────────────┐  ┌────────────────────────────────────────┐  │
│  │   Card Stack View     │  │         Payment Sheet Modal             │  │
│  │  ┌─────────────────┐  │  │  ┌──────────────────────────────────┐  │  │
│  │  │ Interactive     │  │  │  │  Card Selection                  │  │  │
│  │  │ card carousel   │  │  │  │  Amount Display                  │  │  │
│  │  │ with gestures   │  │  │  │  Biometric Prompt                │  │  │
│  │  └─────────────────┘  │  │  └──────────────────────────────────┘  │  │
│  └───────────────────────┘  └────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Zustand Store                                    ││
│  │  cards[] | transactions[] | selectedCardId | paymentSheet | auth    ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: State Management with Zustand

### Store Design

```typescript
// stores/walletStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Card {
    id: string;
    last4: string;
    network: 'visa' | 'mastercard' | 'amex';
    cardType: 'credit' | 'debit';
    status: 'active' | 'suspended';
    cardArtUrl: string;
    isDefault: boolean;
}

interface Transaction {
    id: string;
    merchantName: string;
    merchantCategory: string;
    amount: number;
    currency: string;
    status: 'approved' | 'declined' | 'pending';
    timestamp: string;
    cardId: string;
}

interface WalletState {
    // Data
    cards: Card[];
    transactions: Transaction[];
    selectedCardId: string | null;

    // Payment sheet
    isPaymentSheetOpen: boolean;
    paymentRequest: PaymentRequest | null;

    // Loading states
    isLoading: boolean;
    isSyncing: boolean;

    // Actions
    setCards: (cards: Card[]) => void;
    addCard: (card: Card) => void;
    removeCard: (cardId: string) => void;
    setDefaultCard: (cardId: string) => void;
    suspendCard: (cardId: string) => void;

    openPaymentSheet: (request: PaymentRequest) => void;
    closePaymentSheet: () => void;
    selectCard: (cardId: string) => void;

    // Computed
    getDefaultCard: () => Card | undefined;
    getCardById: (id: string) => Card | undefined;
    getTransactionsForCard: (cardId: string) => Transaction[];
}

export const useWalletStore = create<WalletState>()(
    persist(
        (set, get) => ({
            cards: [],
            transactions: [],
            selectedCardId: null,
            isPaymentSheetOpen: false,
            paymentRequest: null,
            isLoading: false,
            isSyncing: false,

            setCards: (cards) => set({ cards }),

            addCard: (card) => set((state) => ({
                cards: [...state.cards, card]
            })),

            removeCard: (cardId) => set((state) => ({
                cards: state.cards.filter(c => c.id !== cardId)
            })),

            setDefaultCard: (cardId) => set((state) => ({
                cards: state.cards.map(c => ({
                    ...c,
                    isDefault: c.id === cardId
                }))
            })),

            openPaymentSheet: (request) => set({
                isPaymentSheetOpen: true,
                paymentRequest: request,
                selectedCardId: get().getDefaultCard()?.id || null
            }),

            closePaymentSheet: () => set({
                isPaymentSheetOpen: false,
                paymentRequest: null
            }),

            getDefaultCard: () => {
                return get().cards.find(c => c.isDefault && c.status === 'active');
            },

            getCardById: (id) => {
                return get().cards.find(c => c.id === id);
            },

            getTransactionsForCard: (cardId) => {
                return get().transactions.filter(t => t.cardId === cardId);
            }
        }),
        {
            name: 'wallet-storage',
            partialize: (state) => ({
                cards: state.cards,
                transactions: state.transactions.slice(0, 50) // Cache last 50
            })
        }
    )
);
```

### Why Zustand with Persistence?

| Factor | Zustand + Persist | React Query | Redux Toolkit |
|--------|-------------------|-------------|---------------|
| Offline support | Built-in persist | Manual | Redux Persist |
| Boilerplate | Minimal | Minimal | Moderate |
| Re-renders | Selective | Automatic | Selective |
| Cache invalidation | Manual | Automatic | Manual |

**Decision**: Zustand with persist middleware provides offline-first experience essential for a wallet app.

## Deep Dive: Card Stack Component

### 3D Card Carousel

```tsx
// components/wallet/CardStack.tsx
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';

function CardStack() {
    const { cards, selectedCardId, selectCard } = useWalletStore();
    const activeCards = cards.filter(c => c.status === 'active');

    const [currentIndex, setCurrentIndex] = useState(0);
    const x = useMotionValue(0);

    const handleDragEnd = (_: any, info: PanInfo) => {
        const threshold = 100;
        if (info.offset.x > threshold && currentIndex > 0) {
            setCurrentIndex(currentIndex - 1);
        } else if (info.offset.x < -threshold && currentIndex < activeCards.length - 1) {
            setCurrentIndex(currentIndex + 1);
        }
    };

    return (
        <div className="relative h-64 w-full overflow-hidden">
            {activeCards.map((card, index) => {
                const offset = index - currentIndex;

                return (
                    <motion.div
                        key={card.id}
                        className="absolute inset-0 flex items-center justify-center"
                        style={{
                            zIndex: activeCards.length - Math.abs(offset),
                        }}
                        initial={false}
                        animate={{
                            x: offset * 40,
                            scale: 1 - Math.abs(offset) * 0.1,
                            rotateY: offset * -15,
                            opacity: 1 - Math.abs(offset) * 0.3,
                        }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        drag={offset === 0 ? 'x' : false}
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={handleDragEnd}
                        onClick={() => offset === 0 && selectCard(card.id)}
                    >
                        <PaymentCard card={card} isSelected={card.id === selectedCardId} />
                    </motion.div>
                );
            })}
        </div>
    );
}
```

### Payment Card Component

```tsx
// components/wallet/PaymentCard.tsx
function PaymentCard({ card, isSelected }: PaymentCardProps) {
    return (
        <motion.div
            className={cn(
                'w-80 h-48 rounded-2xl p-6 shadow-2xl',
                'bg-gradient-to-br transform-gpu perspective-1000',
                getCardGradient(card.network),
                isSelected && 'ring-4 ring-blue-400'
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
        >
            {/* Card Art Background */}
            {card.cardArtUrl && (
                <img
                    src={card.cardArtUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover rounded-2xl opacity-30"
                />
            )}

            {/* Card Content */}
            <div className="relative z-10 h-full flex flex-col justify-between text-white">
                <div className="flex justify-between items-start">
                    <NetworkLogo network={card.network} className="h-8" />
                    {card.status === 'suspended' && (
                        <span className="px-2 py-1 bg-red-500 rounded text-xs">
                            Suspended
                        </span>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="text-lg tracking-widest font-mono">
                        •••• •••• •••• {card.last4}
                    </div>
                    <div className="text-sm opacity-80 uppercase">
                        {card.cardType}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function getCardGradient(network: string): string {
    switch (network) {
        case 'visa':
            return 'from-blue-600 to-blue-800';
        case 'mastercard':
            return 'from-orange-500 to-red-600';
        case 'amex':
            return 'from-slate-600 to-slate-800';
        default:
            return 'from-gray-600 to-gray-800';
    }
}
```

## Deep Dive: Payment Sheet Modal

### Payment Flow Component

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

    const [authState, setAuthState] = useState<'idle' | 'authenticating' | 'success' | 'error'>('idle');
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

            // Process payment
            await api.processPayment({
                cardId: selectedCard.id,
                amount: paymentRequest.amount,
                currency: paymentRequest.currency,
                merchantId: paymentRequest.merchantId
            });

            setAuthState('success');
            await new Promise(resolve => setTimeout(resolve, 1500));
            closePaymentSheet();
        } catch (error) {
            setAuthState('error');
        }
    };

    if (!isPaymentSheetOpen || !paymentRequest) return null;

    return (
        <motion.div
            className="fixed inset-0 bg-black/50 flex items-end justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div
                className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-10"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25 }}
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <button onClick={closePaymentSheet} className="text-blue-500">
                        Cancel
                    </button>
                    <div className="text-center">
                        <div className="text-sm text-gray-500">Pay with Apple Pay</div>
                        <div className="font-semibold">{paymentRequest.merchantName}</div>
                    </div>
                    <div className="w-16" />
                </div>

                {/* Amount */}
                <div className="text-center mb-8">
                    <div className="text-4xl font-bold">
                        {formatCurrency(paymentRequest.amount, paymentRequest.currency)}
                    </div>
                </div>

                {/* Card Selection */}
                <div className="mb-6">
                    <div className="text-sm text-gray-500 mb-2">Pay with</div>
                    <CardSelector
                        cards={cards.filter(c => c.status === 'active')}
                        selectedId={selectedCardId}
                        onSelect={selectCard}
                    />
                </div>

                {/* Payment Button */}
                <PaymentButton
                    state={authState}
                    onPress={handlePayment}
                    card={selectedCard}
                />
            </motion.div>
        </motion.div>
    );
}
```

### Biometric Authentication UI

```tsx
// components/payment/PaymentButton.tsx
function PaymentButton({ state, onPress, card }: PaymentButtonProps) {
    return (
        <motion.button
            className={cn(
                'w-full py-4 rounded-2xl font-semibold text-white',
                'flex items-center justify-center gap-3',
                state === 'success' ? 'bg-green-500' :
                state === 'error' ? 'bg-red-500' :
                'bg-black'
            )}
            whileTap={{ scale: 0.98 }}
            onClick={onPress}
            disabled={state === 'authenticating'}
        >
            {state === 'idle' && (
                <>
                    <FaceIdIcon className="w-8 h-8" />
                    <span>Pay with Face ID</span>
                </>
            )}

            {state === 'authenticating' && (
                <>
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1 }}
                    >
                        <LoadingIcon className="w-6 h-6" />
                    </motion.div>
                    <span>Authenticating...</span>
                </>
            )}

            {state === 'success' && (
                <>
                    <CheckIcon className="w-6 h-6" />
                    <span>Payment Successful</span>
                </>
            )}

            {state === 'error' && (
                <>
                    <XIcon className="w-6 h-6" />
                    <span>Try Again</span>
                </>
            )}
        </motion.button>
    );
}
```

## Deep Dive: Transaction History

### Virtualized Transaction List

```tsx
// components/transactions/TransactionList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function TransactionList() {
    const { transactions } = useWalletStore();
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: transactions.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 72, // Estimated row height
        overscan: 5
    });

    return (
        <div
            ref={parentRef}
            className="h-[calc(100vh-200px)] overflow-auto"
        >
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: 'relative'
                }}
            >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                    const transaction = transactions[virtualRow.index];
                    return (
                        <div
                            key={transaction.id}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`
                            }}
                        >
                            <TransactionRow transaction={transaction} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

### Transaction Row Component

```tsx
function TransactionRow({ transaction }: { transaction: Transaction }) {
    const card = useWalletStore(state => state.getCardById(transaction.cardId));

    return (
        <div className="flex items-center p-4 border-b hover:bg-gray-50">
            {/* Merchant Icon */}
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mr-4">
                <MerchantIcon category={transaction.merchantCategory} />
            </div>

            {/* Details */}
            <div className="flex-1">
                <div className="font-medium">{transaction.merchantName}</div>
                <div className="text-sm text-gray-500">
                    {format(new Date(transaction.timestamp), 'MMM d, h:mm a')}
                    {card && ` • ••••${card.last4}`}
                </div>
            </div>

            {/* Amount */}
            <div className={cn(
                'font-semibold',
                transaction.status === 'declined' && 'text-red-500 line-through'
            )}>
                {transaction.status === 'pending' && (
                    <span className="text-orange-500 text-sm mr-1">Pending</span>
                )}
                {formatCurrency(transaction.amount, transaction.currency)}
            </div>
        </div>
    );
}
```

## Deep Dive: Card Provisioning Flow

### Multi-Step Form

```tsx
// components/add-card/AddCardFlow.tsx
type Step = 'scan' | 'details' | 'verify' | 'complete';

function AddCardFlow() {
    const [step, setStep] = useState<Step>('scan');
    const [cardData, setCardData] = useState<Partial<CardData>>({});
    const [verificationMethods, setVerificationMethods] = useState<string[]>([]);

    const handleScanComplete = (scannedData: CardScanResult) => {
        setCardData({
            pan: scannedData.pan,
            expiry: scannedData.expiry,
            network: identifyNetwork(scannedData.pan)
        });
        setStep('details');
    };

    const handleDetailsSubmit = async (details: CardDetails) => {
        try {
            const result = await api.provisionCard({
                ...cardData,
                ...details
            });

            if (result.status === 'verification_required') {
                setVerificationMethods(result.methods);
                setStep('verify');
            } else {
                setStep('complete');
            }
        } catch (error) {
            // Handle error
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Progress Indicator */}
            <ProgressSteps
                steps={['Scan', 'Details', 'Verify', 'Complete']}
                currentStep={step}
            />

            <AnimatePresence mode="wait">
                {step === 'scan' && (
                    <CardScanner onComplete={handleScanComplete} />
                )}
                {step === 'details' && (
                    <CardDetailsForm
                        initialData={cardData}
                        onSubmit={handleDetailsSubmit}
                    />
                )}
                {step === 'verify' && (
                    <VerificationStep
                        methods={verificationMethods}
                        onComplete={() => setStep('complete')}
                    />
                )}
                {step === 'complete' && (
                    <CompletionScreen cardData={cardData} />
                )}
            </AnimatePresence>
        </div>
    );
}
```

## Performance Optimizations

### 1. Image Optimization for Card Art

```tsx
// components/wallet/CardArt.tsx
function CardArt({ url, alt }: { url: string; alt: string }) {
    const [loaded, setLoaded] = useState(false);

    return (
        <div className="relative w-full h-full">
            {!loaded && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 animate-pulse rounded-2xl" />
            )}
            <img
                src={url}
                alt={alt}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                className={cn(
                    'w-full h-full object-cover rounded-2xl transition-opacity',
                    loaded ? 'opacity-100' : 'opacity-0'
                )}
            />
        </div>
    );
}
```

### 2. Selective Store Subscriptions

```tsx
// Only re-render when specific data changes
function CardCount() {
    const count = useWalletStore(state => state.cards.length);
    return <span>{count} cards</span>;
}

function DefaultCardDisplay() {
    const defaultCard = useWalletStore(state =>
        state.cards.find(c => c.isDefault && c.status === 'active')
    );
    // Only re-renders when default card changes
    return defaultCard ? <MiniCard card={defaultCard} /> : null;
}
```

### 3. Animation Performance

```tsx
// Use transform instead of position for smooth 60fps
const cardVariants = {
    selected: {
        scale: 1.05,
        y: -10,
        transition: { type: 'spring', stiffness: 300 }
    },
    unselected: {
        scale: 1,
        y: 0
    }
};

// Enable hardware acceleration
<motion.div
    className="transform-gpu will-change-transform"
    variants={cardVariants}
    animate={isSelected ? 'selected' : 'unselected'}
/>
```

## Accessibility (a11y)

### Screen Reader Support

```tsx
<div
    role="listbox"
    aria-label="Payment cards"
    aria-activedescendant={selectedCardId}
>
    {cards.map(card => (
        <div
            key={card.id}
            role="option"
            aria-selected={card.id === selectedCardId}
            aria-label={`${card.network} ${card.cardType} ending in ${card.last4}${
                card.status === 'suspended' ? ', suspended' : ''
            }${card.isDefault ? ', default' : ''}`}
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    selectCard(card.id);
                }
            }}
        >
            <PaymentCard card={card} />
        </div>
    ))}
</div>
```

### Focus Management

```tsx
function PaymentSheet() {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const { isPaymentSheetOpen } = useWalletStore();

    useEffect(() => {
        if (isPaymentSheetOpen) {
            // Focus the close button when sheet opens
            closeButtonRef.current?.focus();
        }
    }, [isPaymentSheetOpen]);

    // Trap focus inside modal
    useFocusTrap(isPaymentSheetOpen);

    return (
        <div role="dialog" aria-modal="true" aria-label="Payment">
            <button ref={closeButtonRef}>Cancel</button>
            {/* ... */}
        </div>
    );
}
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand + persist | Offline support | Manual cache invalidation |
| Framer Motion | Smooth animations | Bundle size (+40KB) |
| CSS gradients | Fast, no images | Limited design options |
| Virtualized list | Handles 1000s of txns | Setup complexity |
| Optimistic updates | Instant feedback | Rollback complexity |

## Future Frontend Enhancements

1. **Card Scanning**: Camera-based OCR for card details
2. **Haptic Feedback**: Simulate tactile response on payment
3. **Widget Support**: iOS widget for quick payments
4. **Watch App**: Companion app for Apple Watch
5. **NFC Simulation**: Visual feedback during tap-to-pay
