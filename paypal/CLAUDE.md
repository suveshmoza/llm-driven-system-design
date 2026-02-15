# PayPal - Development Notes

## Project Context

This project implements a simplified P2P payment platform inspired by PayPal. It demonstrates financial transaction patterns: double-entry bookkeeping, idempotent payment processing, optimistic locking for wallet balances, and money request workflows.

## Development Phases

### Phase 1: Architecture and Design
- Defined double-entry bookkeeping model with ledger entries
- Designed wallet schema with optimistic locking (version column)
- Planned idempotency key storage within the same database transaction as payments
- Established transfer flow: lock wallets in user_id order, debit sender, credit recipient

### Phase 2: Backend Implementation
- Express API with session auth (Redis-backed)
- Wallet service: deposit, withdraw, balance query with transactional integrity
- Transfer service: P2P sends with double-entry ledger, optimistic locking, deadlock prevention
- Idempotency service: check/store keys with 24-hour TTL
- Request flow: create request, pay, decline, cancel with authorization checks
- Payment method CRUD with default management
- User search for send/request flows

### Phase 3: Frontend Implementation
- Dashboard with wallet balance card, pending requests, recent activity
- Send money flow: user search (debounced), amount input, note, idempotency key generation
- Request money flow: similar UX to send
- Activity page with type filters (all/transfer/deposit/withdrawal)
- Payment method management with add modal
- PayPal brand colors and gradient wallet card

## Key Design Decisions

### Double-Entry Bookkeeping
Every balance change creates paired debit/credit ledger entries within a single database transaction. The `transactions` table records the business event; the `ledger_entries` table records the accounting impact. This enables reconciliation: SUM(credits) - SUM(debits) per wallet should equal `wallet.balance_cents`.

### Optimistic Locking for Wallets
Wallet updates use `WHERE version = $expected` to detect concurrent modifications. For P2P transfers specifically, we use `SELECT ... FOR UPDATE` with consistent lock ordering (by user_id) to prevent deadlocks while still getting atomic read-modify-write.

### Idempotency in Same Transaction
The idempotency key is stored in the same PostgreSQL transaction as the payment. This guarantees atomicity -- it's impossible to have the key stored without the payment completing, or vice versa. Redis-based idempotency keys would risk divergence on crash.

### BIGINT Cents for Amounts
All monetary amounts stored as integer cents (BIGINT). Eliminates floating-point arithmetic errors in application code. Database CHECK constraints prevent negative balances.

### Session Auth over JWT
HTTP-only session cookies prevent XSS-based session theft, which is critical for a financial application. Redis session store enables immediate revocation.

## Open Questions

- Should wallet balance be cached in Redis with a short TTL for read-heavy dashboards?
- How to handle multi-currency transfers (exchange rate service)?
- Should transfer requests have an expiration time?
- How to implement dispute resolution and refund flows?
- Would a notification service (WebSocket) improve the request pay/decline experience?

## Learnings

- Double-entry bookkeeping adds write amplification (2 ledger entries per transfer) but is essential for financial systems -- the reconciliation capability justifies the overhead
- Idempotency key storage location matters: same transaction as the payment guarantees consistency
- Lock ordering is critical for preventing deadlocks in multi-wallet transfers
- Frontend financial UX is about trust: clear feedback, confirmation steps, and honest error messages when uncertain about payment status
