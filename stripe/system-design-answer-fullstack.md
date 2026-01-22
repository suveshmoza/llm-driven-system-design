# Stripe - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Introduction (2 minutes)

"Thank you for the opportunity. Today I'll design Stripe, a payment processing platform. As a full-stack engineer, I'm particularly interested in the end-to-end flow:

1. **Payment flow** - From frontend form to database ledger entry
2. **Idempotency** - How frontend retries interact with backend deduplication
3. **Webhooks** - Server-to-server event delivery with frontend status display
4. **Shared types** - TypeScript contracts between frontend and backend

Let me clarify the requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our core payment platform:

1. **Charge**: Process payments via API with idempotency guarantees
2. **Merchant Dashboard**: View payments, manage keys, configure webhooks
3. **Payment Elements**: Embeddable card input for merchant websites
4. **Webhooks**: Notify merchants with reliable delivery
5. **Refunds**: Full and partial refunds with ledger entries

I'll focus on the end-to-end payment flow and webhook system."

### Non-Functional Requirements

"Financial systems have critical requirements spanning both frontend and backend:

- **Accuracy**: Zero duplicate charges - idempotency across the stack
- **Latency**: < 500ms authorization, < 1.5s frontend first paint
- **Availability**: 99.999% for payment processing
- **Security**: PCI compliance, secure card input isolation"

---

## High-Level Architecture (8 minutes)

### End-to-End Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Merchant Website                                   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                       Payment Form (React)                           │   │
│   │   ┌──────────────────┐  ┌────────────────────────────────────────┐  │   │
│   │   │  CardElement     │  │  Customer Info                         │  │   │
│   │   │  (Stripe iframe) │  │  (Email, Name, Address)                │  │   │
│   │   └────────┬─────────┘  └─────────────────┬──────────────────────┘  │   │
│   │            │                              │                          │   │
│   │            └──────────────┬───────────────┘                          │   │
│   │                           ▼                                          │   │
│   │                    ┌──────────────┐                                  │   │
│   │                    │ Pay Button   │                                  │   │
│   │                    └──────┬───────┘                                  │   │
│   └───────────────────────────┼──────────────────────────────────────────┘   │
│                               │                                              │
└───────────────────────────────┼──────────────────────────────────────────────┘
                                │
    ┌───────────────────────────┼───────────────────────────────────────────┐
    │                           │                                           │
    │  ① Create PaymentIntent   │  ④ Confirm with Stripe.js                │
    │     (Merchant Server)     │     (Direct to Stripe)                    │
    │                           │                                           │
    │           ▼               │               ▼                           │
    │   ┌───────────────┐       │       ┌───────────────┐                   │
    │   │    Merchant   │       │       │   Stripe.js   │                   │
    │   │    Backend    │◄──────┼───────│   SDK         │                   │
    │   └───────┬───────┘       │       └───────┬───────┘                   │
    │           │               │               │                           │
    └───────────┼───────────────┼───────────────┼───────────────────────────┘
                │               │               │
                ▼               │               ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Stripe API                                        │
│                                                                                │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                    │
│   │   ② Create   │    │  ③ Return    │    │  ⑤ Authorize │                    │
│   │   Intent     │───►│  client_     │    │  with Card   │                    │
│   │              │    │  secret      │    │  Network     │                    │
│   └──────────────┘    └──────────────┘    └──────────────┘                    │
│                                                   │                            │
│                                           ┌───────▼───────┐                    │
│                                           │  ⑥ Create     │                    │
│                                           │  Ledger       │                    │
│                                           │  Entries      │                    │
│                                           └───────┬───────┘                    │
│                                                   │                            │
│                                           ┌───────▼───────┐                    │
│                                           │  ⑦ Send       │                    │
│                                           │  Webhook      │──────┐             │
│                                           └───────────────┘      │             │
│                                                                  │             │
└──────────────────────────────────────────────────────────────────┼─────────────┘
                                                                   │
                               ┌───────────────────────────────────┼─────────┐
                               │          Merchant Backend         │         │
                               │                                   ▼         │
                               │   ┌─────────────────────────────────────┐   │
                               │   │  ⑧ Webhook Handler                  │   │
                               │   │  - Verify signature                 │   │
                               │   │  - Update order status              │   │
                               │   │  - Send confirmation email          │   │
                               │   └─────────────────────────────────────┘   │
                               │                                              │
                               └──────────────────────────────────────────────┘
```

### Shared Type Definitions

**PaymentIntent**: id (pi_xxx format), object, amount (cents), currency, status, client_secret, payment_method, metadata, created (timestamp)

**PaymentIntentStatus**: requires_payment_method | requires_confirmation | requires_action | processing | succeeded | failed | canceled

**CreatePaymentIntentRequest**: amount, currency, metadata (optional)

**CreatePaymentIntentResponse**: id, client_secret, status

**WebhookEvent**: id (evt_xxx format), type (e.g., payment_intent.succeeded), data (object + previous_attributes), created, api_version

**Merchant**: id, name, email, webhook_url

**LedgerEntry**: id, account, debit, credit, intent_id, created_at

---

## Deep Dive: Payment Flow (12 minutes)

### Frontend: Payment Form Component

The PaymentForm component uses Stripe Elements for PCI-compliant card input:

```
┌───────────────────────────────────────────────────────────────────┐
│                     Payment Form Component                         │
├───────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Total Display: $XX.XX (formatted from cents)                │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ CardElement (Stripe iframe - handles tokenization)          │  │
│  │ - 16px font, gray placeholder styling                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Error Display (red background, border)                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Pay Button (disabled during processing, shows spinner)      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

**Payment Flow Steps:**

1. User submits form
2. Frontend POSTs to `/api/v1/payment-intents` with Idempotency-Key header
3. Backend creates intent, returns client_secret
4. Frontend calls `stripe.confirmCardPayment(client_secret, { payment_method: { card } })`
5. If requires_action: 3D Secure authentication needed
6. If succeeded: call onSuccess callback

### Backend: Payment Intent Endpoint

**POST /v1/payment-intents** - Create Payment Intent:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Create Payment Intent Flow                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. VALIDATE REQUEST                                                │
│     ├── amount: positive integer (cents)                            │
│     ├── currency: 3-char string                                     │
│     └── metadata: optional key-value pairs                          │
│                                                                      │
│  2. CHECK IDEMPOTENCY                                               │
│     ├── Key: merchantId + idempotency header                        │
│     ├── If cached: return cached response (200 OK)                  │
│     └── If new: proceed with creation                               │
│                                                                      │
│  3. DATABASE TRANSACTION                                            │
│     ├── BEGIN                                                        │
│     ├── INSERT payment_intent (status: requires_payment_method)     │
│     ├── Generate client_secret (signed token)                       │
│     └── COMMIT                                                       │
│                                                                      │
│  4. POST-TRANSACTION                                                │
│     ├── Cache response for idempotency                              │
│     ├── Audit log (IP address, trace ID)                            │
│     └── Return 201 with { id, client_secret, status }               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**POST /v1/payment-intents/:id/confirm** - Confirm and Charge:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Confirm Payment Intent Flow                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. BEGIN SERIALIZABLE TRANSACTION                                  │
│     └── SELECT intent FOR UPDATE (lock row)                         │
│                                                                      │
│  2. STATE MACHINE VALIDATION                                        │
│     ├── Must be: requires_payment_method OR requires_confirmation   │
│     └── Other states: return 400 invalid_state                      │
│                                                                      │
│  3. FRAUD CHECK                                                     │
│     ├── Call fraudService.assessRisk(intent, paymentMethod, IP)     │
│     ├── If risk > 0.8: set status = requires_action (3DS)           │
│     └── Return next_action: redirect_to_3ds                         │
│                                                                      │
│  4. CARD NETWORK AUTHORIZATION                                      │
│     ├── Call cardNetworkGateway.authorize(amount, currency, token)  │
│     ├── If declined: set status = failed, return decline_code       │
│     └── If approved: proceed to ledger                              │
│                                                                      │
│  5. CREATE LEDGER ENTRIES (double-entry)                            │
│     ├── Debit: funds_receivable = amount                            │
│     ├── Credit: merchant:{id}:payable = amount - fee                │
│     ├── Credit: revenue:transaction_fees = fee (2.9% + 30c)         │
│     └── Verify: total_debit == total_credit                         │
│                                                                      │
│  6. UPDATE & COMMIT                                                 │
│     ├── Set status = succeeded, auth_code                           │
│     └── COMMIT                                                       │
│                                                                      │
│  7. ASYNC WEBHOOK                                                   │
│     └── webhookService.send(merchant_id, payment_intent.succeeded)  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Fee Calculation**: 2.9% + 30 cents per transaction

---

## Deep Dive: Webhook System (10 minutes)

### Backend: Webhook Delivery Service

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Webhook Delivery Pipeline                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. WEBHOOK SERVICE (send method)                                   │
│     ├── Query merchant webhook_url and webhook_secret               │
│     ├── Create WebhookEvent object:                                 │
│     │   - id: evt_{uuid}                                            │
│     │   - type: event type (e.g., payment_intent.succeeded)         │
│     │   - data: { object: payload }                                 │
│     │   - created: unix timestamp                                   │
│     │   - api_version: 2024-01-01                                   │
│     ├── Generate HMAC-SHA256 signature:                             │
│     │   signedPayload = `${timestamp}.${JSON.stringify(event)}`     │
│     │   signature = hmac(webhook_secret, signedPayload)             │
│     ├── Log event to webhook_events table (status: pending)         │
│     └── Queue job with Bull/BullMQ                                  │
│                                                                      │
│  2. QUEUE CONFIGURATION                                             │
│     ├── attempts: 5                                                 │
│     └── backoff: exponential (1s, 2s, 4s, 8s, 16s)                  │
│                                                                      │
│  3. WEBHOOK WORKER (processes queue)                                │
│     ├── POST to merchant URL with:                                  │
│     │   - Content-Type: application/json                            │
│     │   - Stripe-Signature: t={timestamp},v1={signature}            │
│     │   - User-Agent: Stripe/1.0                                    │
│     ├── Timeout: 30 seconds (abort controller)                      │
│     ├── On success (2xx):                                           │
│     │   - Update status = delivered, delivered_at = NOW()           │
│     └── On failure:                                                 │
│         - Update status = failed, last_error, attempts++            │
│         - Let Bull handle retry                                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend: Webhook Events Dashboard

```
┌───────────────────────────────────────────────────────────────────┐
│                     Webhook Events Page                            │
├───────────────────────────────────────────────────────────────────┤
│  Header: "Webhook Events"              Filter: [All|Delivered|Failed]│
├───────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Table: Event ID | Type | Status | Created                  │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │ evt_abc123 | payment_intent.succeeded | ● Delivered | 2m ago│  │
│  │ evt_def456 | charge.refunded          | ● Failed (3) | 5m ago│  │
│  │ evt_ghi789 | payment_intent.failed    | ○ Pending   | 10m ago│  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Click row → Event Detail Modal                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Event Detail Modal:**
- Metadata grid: Type, Status (with attempt count), Created, Delivered
- Error message (red box if failed)
- Payload display (JSON in dark code block)
- Retry button (for failed events)

**React Query Configuration:**
- refetchInterval: 10 seconds for live updates
- Filter state controls query key

### Merchant-Side Webhook Handler

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Merchant Webhook Verification                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. RECEIVE POST /webhooks/stripe (raw body)                        │
│                                                                      │
│  2. PARSE SIGNATURE HEADER                                          │
│     ├── Format: t={timestamp},v1={signature}                        │
│     └── Extract timestamp and signature values                      │
│                                                                      │
│  3. VALIDATE TIMESTAMP                                              │
│     ├── Current time - timestamp < 5 minutes                        │
│     └── Reject old requests (replay protection)                     │
│                                                                      │
│  4. VERIFY SIGNATURE                                                │
│     ├── signedPayload = `${timestamp}.${payload}`                   │
│     ├── expected = hmac-sha256(webhook_secret, signedPayload)       │
│     └── Compare: signature === expected                             │
│                                                                      │
│  5. HANDLE EVENT BY TYPE                                            │
│     ├── payment_intent.succeeded → Update order, send email         │
│     ├── payment_intent.failed → Notify customer                     │
│     └── charge.refunded → Process refund                            │
│                                                                      │
│  6. RESPOND { received: true }                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Deep Dive: Merchant Dashboard (5 minutes)

### Balance with Ledger Integration

```
┌───────────────────────────────────────────────────────────────────┐
│                        Balance Page                                │
├───────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐    │
│  │  Available  │  │   Pending   │  │      Total Volume       │    │
│  │   $X,XXX    │  │    $XXX     │  │        $XX,XXX          │    │
│  │   (green)   │  │   (gray)    │  │        (gray)           │    │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘    │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Ledger Summary                                              │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │ Funds Receivable     (debit)     $XX,XXX                   │  │
│  │ Merchant Payable     (credit)    $XX,XXX                   │  │
│  │ Transaction Fees     (credit)    $X,XXX                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### Backend Balance Endpoint

**GET /v1/balance** calculates:
- Ledger balances: `SUM(debit) - SUM(credit)` grouped by account
- Pending: payments succeeded in last 2 days (settlement window)
- Available: total_payable - pending
- Returns: { available, pending, currency, ledger_summary }

---

## Trade-offs and Alternatives (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| **Shared types** | TypeScript definitions | OpenAPI/Swagger | Simpler, compile-time safety |
| **Payment confirmation** | Client-side Stripe.js | Server-side only | PCI scope reduction, 3DS support |
| **Webhook delivery** | Bull queue | Direct HTTP | Reliable retry, backoff, monitoring |
| **Ledger queries** | PostgreSQL SUM | Materialized views | Simplicity for current scale |
| **Real-time updates** | Polling | WebSocket | Simpler, sufficient for dashboard |

---

## Integration Points Summary

### Frontend to Backend

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/payment-intents` | POST | Create payment intent |
| `/api/v1/payment-intents/:id/confirm` | POST | Confirm and charge |
| `/api/v1/balance` | GET | Get merchant balance |
| `/api/v1/webhook-events` | GET | List webhook events |
| `/api/v1/webhook-events/:id/retry` | POST | Retry failed webhook |

### Backend to External

| Service | Integration | Purpose |
|---------|-------------|---------|
| Card Network | REST API | Authorization, capture |
| Webhook Endpoints | HTTP POST | Event delivery |
| Fraud ML Service | gRPC | Risk scoring |

---

## Future Enhancements

1. **GraphQL API**: Flexible queries for dashboard
2. **WebSocket real-time**: Live payment updates
3. **Multi-currency**: FX conversion at payment time
4. **Subscription billing**: Recurring payments
5. **Connect platform**: Multi-party payments

---

## Summary

"I've designed Stripe's full-stack payment system with:

1. **Shared TypeScript types** ensuring API contract consistency
2. **Two-phase payment flow** - intent creation on backend, confirmation via Stripe.js
3. **Idempotency middleware** preventing duplicate charges across retries
4. **Double-entry ledger** with balance invariant checking
5. **Webhook system** with Bull queue, exponential backoff, and signature verification
6. **Dashboard integration** showing real-time balance from ledger

The design ensures financial accuracy from frontend form submission to ledger entry, with proper error handling and audit trails at every step."
