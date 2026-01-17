# Design Stripe - Development with Claude

## Project Context

Building a payment processing platform to understand financial systems, idempotency, and fraud prevention.

**Key Learning Goals:**
- Build idempotent payment APIs
- Design double-entry ledger systems
- Implement real-time fraud detection
- Handle webhooks reliably

---

## Key Challenges to Explore

### 1. Idempotency at Scale

**Challenge**: Prevent duplicate charges with distributed systems

**Approaches:**
- Idempotency keys with Redis locking
- Database unique constraints
- Request deduplication windows
- Distributed locks

### 2. Ledger Consistency

**Problem**: Financial accuracy across failures

**Solutions:**
- Transactions for atomicity
- Event sourcing for ledger
- Periodic reconciliation
- Invariant checking (debits = credits)

### 3. Webhook Reliability

**Challenge**: Guarantee delivery to merchant endpoints

**Solutions:**
- Exponential backoff retry
- Dead letter queues
- Webhook logs for debugging
- Signature verification

---

## Development Phases

### Phase 1: Payment Flow
- [ ] Payment intents
- [ ] Card tokenization
- [ ] Authorization flow
- [ ] Basic refunds

### Phase 2: Merchant Platform
- [ ] Merchant onboarding
- [ ] API key management
- [ ] Dashboard basics
- [ ] Webhook configuration

### Phase 3: Financial Accuracy
- [ ] Double-entry ledger
- [ ] Settlement batching
- [ ] Reconciliation reports
- [ ] Dispute handling

### Phase 4: Risk & Compliance
- [ ] Fraud scoring
- [ ] Velocity rules
- [ ] Audit logging
- [ ] PCI patterns

---

## Resources

- [Stripe Engineering Blog](https://stripe.com/blog/engineering)
- [Designing Data-Intensive Applications](https://dataintensive.net/) (Ledger patterns)
- [Idempotency Keys](https://stripe.com/docs/api/idempotent_requests)
