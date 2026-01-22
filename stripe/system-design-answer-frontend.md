# Stripe - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Introduction (2 minutes)

"Thank you for the opportunity. Today I'll design Stripe's frontend interfaces. As a frontend engineer, I'm particularly interested in the unique challenges of building payment UIs:

1. **Merchant Dashboard** - Real-time payment analytics, API key management, webhook configuration
2. **Payment Elements** - Embeddable, accessible card input components
3. **Trust signals** - Visual security indicators that increase conversion
4. **Error handling** - Clear, actionable feedback for failed payments

Let me clarify the requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For Stripe's frontend interfaces:

1. **Merchant Dashboard**: View payments, manage API keys, configure webhooks
2. **Payment Elements**: Embeddable card input for merchant websites
3. **Checkout Pages**: Hosted payment pages for merchants
4. **Developer Portal**: API documentation and testing tools

I'll focus on the Merchant Dashboard and Payment Elements since they represent the most interesting frontend challenges."

### Non-Functional Requirements

"Payment UIs have critical requirements:

- **Accessibility**: WCAG 2.1 AA compliance for all payment forms
- **Performance**: First paint < 1.5s, Time to Interactive < 3s
- **Cross-browser**: Support all modern browsers plus 2 versions back
- **Security**: XSS prevention, CSP headers, secure iframe isolation
- **Mobile**: Responsive design, touch-friendly payment inputs"

---

## High-Level Design (8 minutes)

### Application Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Merchant Dashboard                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │  Payments   │  │  Developers │  │   Balance   │  │  Settings   │       │
│   │   Module    │  │    Module   │  │   Module    │  │   Module    │       │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘       │
│          │                │                │                │               │
│   ┌──────▼────────────────▼────────────────▼────────────────▼──────┐       │
│   │                      Shared Components                          │       │
│   │   DataTable │ Chart │ Modal │ Form │ Notification │ Skeleton   │       │
│   └────────────────────────────────────────────────────────────────┘       │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────┐       │
│   │                         State Layer                             │       │
│   │              Zustand (Global) + React Query (Server)           │       │
│   └────────────────────────────────────────────────────────────────┘       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          Payment Elements                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                        │
│   │ CardElement │  │ PaymentForm │  │ AddressForm │                        │
│   │  (iframe)   │  │  (React)    │  │  (React)    │                        │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                        │
│          │                │                │                                │
│   ┌──────▼────────────────▼────────────────▼───────┐                       │
│   │            Stripe.js SDK                        │                       │
│   │   - Tokenization - Validation - Styles         │                       │
│   └────────────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Route Structure

| Route | Purpose |
|-------|---------|
| `/` | Dashboard overview |
| `/payments` | Payment list with filters |
| `/payments/:id` | Payment detail view |
| `/developers` | API keys and webhooks |
| `/developers/webhooks` | Webhook configuration |
| `/balance` | Balance and payouts |
| `/settings` | Account settings |
| `/settings/team` | Team management |
| `/login` | Authentication |

---

## Deep Dive: Merchant Dashboard (12 minutes)

### Payments List with Virtualization

```
┌─────────────────────────────────────────────────────────────────┐
│ Payments                              [Filters] [Date Range ▼] │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│ │ $12,450  │  │  $8,230  │  │   156    │  │   12     │        │
│ │  Today   │  │ Pending  │  │ Payments │  │  Failed  │        │
│ └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
├─────────────────────────────────────────────────────────────────┤
│ Amount    │ Status    │ Customer      │ Card      │ Date      │
├───────────┼───────────┼───────────────┼───────────┼───────────┤
│ $99.00    │ ●Succeeded│ alice@ex.com  │ ●●●● 4242 │ 2 min ago │
│ $45.50    │ ●Failed   │ bob@ex.com    │ ●●●● 1234 │ 5 min ago │
│ $200.00   │ ●Pending  │ carol@ex.com  │ ●●●● 5678 │ 10 min    │
│           │           │               │           │           │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ (loading) │
└─────────────────────────────────────────────────────────────────┘
```

**PaymentIntent Data Model:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Payment identifier (pi_xxx) |
| `amount` | number | Amount in cents |
| `currency` | string | ISO currency code |
| `status` | enum | succeeded / failed / pending / canceled |
| `customer_email` | string | Customer email |
| `created_at` | string | ISO timestamp |
| `payment_method.brand` | string | Card brand (visa, mastercard) |
| `payment_method.last4` | string | Last 4 digits |

**Virtualization Strategy:**
- Uses `@tanstack/react-virtual` for efficient rendering
- Row height: 64px, overscan: 10 items
- Infinite query with cursor-based pagination
- Auto-fetches when 5 items from bottom
- Stale time: 30 seconds

**Status Badge Colors:**

| Status | Background | Text |
|--------|------------|------|
| succeeded | green-100 | green-800 |
| failed | red-100 | red-800 |
| pending | yellow-100 | yellow-800 |
| canceled | gray-100 | gray-800 |

---

### API Key Management

```
┌─────────────────────────────────────────────────────────────────┐
│ Developers                                                       │
│ Manage your API keys and webhook endpoints                      │
├─────────────────────────────────────────────────────────────────┤
│ API Keys                                                         │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ [publishable] pk_test_abc1●●●●●●●●                        │   │
│ │               Last used 2 hours ago           [Reveal]    │   │
│ └───────────────────────────────────────────────────────────┘   │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ [secret]      sk_test_xyz9●●●●●●●●    [Reveal] [Roll Key] │   │
│ │               Last used 5 minutes ago                      │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ ┌─ ⚠ Warning ───────────────────────────────────────────────┐   │
│ │ Keep your secret key secure                                │   │
│ │ Never expose your secret key in client-side code.         │   │
│ │ Only use the publishable key in your frontend.            │   │
│ └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**API Key Model:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Key identifier |
| `name` | string | Descriptive name |
| `prefix` | string | First 8 characters |
| `last_used` | string | ISO timestamp |
| `created_at` | string | ISO timestamp |
| `type` | enum | publishable / secret |

**Key Management Actions:**
- **Reveal**: Shows full key (secret keys only, one at a time)
- **Roll Key**: Generates new key, invalidates current immediately
- Rolling requires confirmation dialog

---

### Real-time Balance Display

```
┌─────────────────────────────────────────────────────────────────┐
│ Balance                                          ○ Updating...  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│ │ ████████████████ │ │                  │ │                  │ │
│ │    $24,560.00    │ │    $3,200.00     │ │     $500.00      │ │
│ │    Available     │ │     Pending      │ │    Reserved      │ │
│ │  Ready to pay out│ │  Arriving soon   │ │   For disputes   │ │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘ │
│       (primary)           (secondary)          (muted)          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Next Payout                                                      │
│                                                                  │
│       $8,450.00                            ●───────○ Arriving   │
│       Arriving March 15, 2024                      in 2 days    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Balance Data Model:**

| Field | Type | Description |
|-------|------|-------------|
| `available` | number | Ready to pay out (cents) |
| `pending` | number | Processing payments (cents) |
| `currency` | string | ISO currency code |
| `reserved` | number | Held for disputes (cents) |
| `next_payout.amount` | number | Next payout amount |
| `next_payout.arrival_date` | string | Expected arrival date |

**Real-time Updates:**
- SSE connection to `/api/v1/balance/stream`
- On message: triggers React Query refetch
- Shows "Updating..." indicator during refresh
- Fallback polling every 60 seconds

---

## Deep Dive: Payment Elements (10 minutes)

### Embeddable Card Element

```
┌─────────────────────────────────────────────────────────────────┐
│ Card Input Component (iframe isolated)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ 4242 4242 4242 4242    12/28    123    12345           │   │
│   │ Card number            MM/YY    CVC    ZIP              │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   States:                                                        │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│   │   Default    │  │   Focused    │  │   Invalid    │         │
│   │ border-gray  │  │ border-indigo│  │  border-red  │         │
│   │              │  │  ring-indigo │  │   ring-red   │         │
│   └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│   ⚠ Your card number is incomplete                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**CardElement Props:**

| Prop | Type | Description |
|------|------|-------------|
| `publishableKey` | string | Stripe publishable API key |
| `onReady` | function | Called when element mounts |
| `onChange` | function | Card change events |
| `onFocus` | function | Focus event handler |
| `onBlur` | function | Blur event handler |
| `style` | object | Custom styling options |

**CardChangeEvent:**

| Field | Type | Description |
|-------|------|-------------|
| `complete` | boolean | All fields valid |
| `error.type` | string | 'validation_error' |
| `error.code` | string | Error code |
| `error.message` | string | User-facing message |
| `brand` | string | Detected card brand |

**Stripe.js Integration Flow:**
1. Load Stripe.js script dynamically
2. Initialize with publishable key
3. Create Elements instance
4. Mount card element to container ref
5. Attach event listeners (ready, change, focus, blur)
6. Cleanup on unmount

---

### Payment Form with Accessibility

```
┌─────────────────────────────────────────────────────────────────┐
│ Payment Form                                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    Amount due                            │   │
│   │                     $99.00                               │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   Email *                                                        │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ you@example.com                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│   Receipt will be sent to this email                            │
│                                                                  │
│   Name on card *                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Jane Doe                                                 │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   Card details                                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ [CardElement - iframe]                                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │         🔒 Pay $99.00          (or ○ Processing...)     │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│              🛡 Secure payment    🔒 SSL encrypted               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Payment Flow:**
1. User fills email, name, card details
2. Submit creates PaymentIntent on server
3. Receives `client_secret` from server
4. Calls `stripe.confirmCardPayment()` with client_secret
5. On success: invoke `onSuccess` callback
6. On error: display error, invoke `onError` callback

**Accessibility Features:**
- Unique IDs generated with `useId()` hook
- All inputs have associated `<label>` elements
- Hint text linked via `aria-describedby`
- `autocomplete` attributes for autofill
- `aria-busy` on submit button during processing
- `aria-hidden` on decorative icons

---

### Card Brand Icons

| Brand | Colors | Distinctive Elements |
|-------|--------|---------------------|
| Visa | #1A1F71 (blue) | White text/paths |
| Mastercard | #000 background | Red/orange overlapping circles |
| Amex | #016FD0 (blue) | White "AMEX" styling |
| Default | #6B7280 (gray) | Generic card shape |

All icons include `aria-label` for screen reader identification.

---

## Deep Dive: Webhook Configuration UI (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│ Webhooks                                       [Add endpoint]   │
│ Receive real-time notifications about events in your account   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ ● active  https://api.merchant.com/webhooks               │   │
│ │                                                            │   │
│ │ [payment_intent.succeeded] [charge.refunded] [payout.paid]│   │
│ │                                                 ✓ 200     │   │
│ │                                            2 minutes ago   │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ ○ disabled https://old-api.merchant.com/hooks             │   │
│ │                                                            │   │
│ │ [payment_intent.failed]                          ✗ 500    │   │
│ │                                                 1 hour ago │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Empty State:
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         📡                                       │
│              No webhook endpoints configured                    │
│              [Add your first endpoint]                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**WebhookEndpoint Model:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Endpoint identifier |
| `url` | string | Delivery URL |
| `status` | enum | active / disabled |
| `events` | string[] | Subscribed event types |
| `created_at` | string | ISO timestamp |
| `last_delivery.status` | enum | success / failed |
| `last_delivery.timestamp` | string | ISO timestamp |
| `last_delivery.response_code` | number | HTTP status code |

**Available Events:**

| Event | Category | Description |
|-------|----------|-------------|
| `payment_intent.succeeded` | Payments | Payment completed |
| `payment_intent.failed` | Payments | Payment failed |
| `charge.refunded` | Refunds | Refund processed |
| `charge.dispute.created` | Disputes | Dispute opened |
| `payout.paid` | Payouts | Payout sent |

---

## State Management (3 minutes)

### Zustand Store Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ MerchantStore (Zustand + persist middleware)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ State:                                                           │
│ ├── merchant: { id, name, email } | null                        │
│ ├── isLiveMode: boolean (default: false for safety)             │
│ └── sidebarOpen: boolean                                        │
│                                                                  │
│ Actions:                                                         │
│ ├── setMerchant(merchant) → updates merchant                    │
│ ├── toggleLiveMode() → switches test/live                       │
│ ├── toggleSidebar() → expands/collapses                         │
│ └── logout() → clears merchant, resets to test mode             │
│                                                                  │
│ Persistence:                                                     │
│ └── partialize: { sidebarOpen, isLiveMode }                     │
│     (merchant NOT persisted - requires fresh auth)              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Trade-offs and Alternatives (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| **Card input** | Stripe Elements iframe | Custom inputs | PCI scope reduction, security isolation |
| **State management** | Zustand + React Query | Redux | Simpler API, built-in persistence |
| **Virtualization** | TanStack Virtual | react-window | Better TypeScript support, dynamic heights |
| **Real-time updates** | SSE | WebSocket | Simpler, sufficient for dashboard updates |
| **Styling** | Tailwind CSS | CSS-in-JS | Utility-first, consistent design system |

---

## Accessibility Considerations

1. **Form labels**: All inputs have associated labels with proper `htmlFor`
2. **Error states**: Errors announced via `role="alert"` and `aria-live`
3. **Focus management**: Modal traps focus, returns focus on close
4. **Keyboard navigation**: All interactive elements keyboard accessible
5. **Color contrast**: All text meets WCAG 2.1 AA requirements
6. **Screen readers**: Card brands and icons have proper aria-labels

---

## Future Enhancements

1. **Dark mode**: System preference detection with manual toggle
2. **Keyboard shortcuts**: Quick actions (N for new, S for search)
3. **Offline support**: Service worker for dashboard caching
4. **Mobile app**: React Native with shared business logic
5. **Analytics dashboard**: Interactive charts with D3/Recharts

---

## Summary

"I've designed Stripe's frontend with:

1. **Merchant Dashboard** with virtualized payment list, real-time balance updates
2. **API key management** with secure reveal/roll workflows
3. **Payment Elements** using Stripe.js with accessible card inputs
4. **Webhook configuration** UI with event selection and delivery status
5. **State management** using Zustand for global state, React Query for server state

The design prioritizes security (iframe isolation for card inputs), accessibility (WCAG 2.1 AA), and performance (virtualization for large lists)."
