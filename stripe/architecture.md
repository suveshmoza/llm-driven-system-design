# Design Stripe - Architecture

## System Overview

Stripe is a payment processing platform with APIs for accepting payments. Core challenges involve transaction integrity, fraud prevention, and financial accuracy.

**Learning Goals:**
- Build idempotent payment APIs
- Design double-entry ledger systems
- Implement real-time fraud detection
- Handle settlement and reconciliation

---

## Requirements

### Functional Requirements

1. **Charge**: Process credit card payments
2. **Refund**: Return funds to customers
3. **Merchants**: Onboard and manage merchants
4. **Webhooks**: Notify merchants of events
5. **Disputes**: Handle chargebacks

### Non-Functional Requirements

- **Latency**: < 500ms for payment authorization
- **Availability**: 99.999% for payment processing
- **Accuracy**: Zero tolerance for financial errors
- **Security**: PCI DSS Level 1 compliance

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│        Merchant Server │ Mobile SDK │ Web Integration           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
│            (Rate limiting, Auth, Idempotency)                   │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│Payment Service│    │ Fraud Service │    │Webhook Service│
│               │    │               │    │               │
│ - Intents     │    │ - Risk score  │    │ - Delivery    │
│ - Charges     │    │ - Rules       │    │ - Retry       │
│ - Refunds     │    │ - ML models   │    │ - Signatures  │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Ledger Service                               │
│              (Double-entry bookkeeping)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────────────────────────────────┤
│   PostgreSQL    │              Card Networks                    │
│   - Ledger      │              - Visa, MC, Amex                 │
│   - Merchants   │              - Authorization                  │
│   - Accounts    │              - Settlement                     │
└─────────────────┴───────────────────────────────────────────────┘
```

---

## Core Components

### 1. Payment Intent Flow

**Two-Phase Payment:**
```javascript
// Step 1: Create Payment Intent
async function createPaymentIntent(merchantId, amount, currency, idempotencyKey) {
  // Check idempotency
  const existing = await redis.get(`idempotency:${idempotencyKey}`)
  if (existing) {
    return JSON.parse(existing)
  }

  const intent = await db.transaction(async (tx) => {
    // Create intent record
    const intent = await tx.query(`
      INSERT INTO payment_intents (merchant_id, amount, currency, status)
      VALUES ($1, $2, $3, 'requires_payment_method')
      RETURNING *
    `, [merchantId, amount, currency])

    return intent.rows[0]
  })

  // Store for idempotency (24 hours)
  await redis.setex(`idempotency:${idempotencyKey}`, 86400, JSON.stringify(intent))

  return intent
}

// Step 2: Confirm Payment Intent
async function confirmPaymentIntent(intentId, paymentMethodId) {
  const intent = await getPaymentIntent(intentId)

  if (intent.status !== 'requires_payment_method') {
    throw new Error('Invalid intent state')
  }

  // Get payment method (tokenized card)
  const paymentMethod = await getPaymentMethod(paymentMethodId)

  // Risk assessment
  const riskScore = await fraudService.assessRisk({
    intent,
    paymentMethod,
    merchantId: intent.merchant_id
  })

  if (riskScore > 0.8) {
    await updateIntent(intentId, 'requires_action') // 3D Secure
    return { status: 'requires_action', action: '3ds_redirect' }
  }

  // Authorize with card network
  const authResult = await cardNetwork.authorize({
    amount: intent.amount,
    currency: intent.currency,
    cardToken: paymentMethod.card_token,
    merchantId: intent.merchant_id
  })

  if (authResult.approved) {
    await db.transaction(async (tx) => {
      // Update intent
      await tx.query(`
        UPDATE payment_intents
        SET status = 'succeeded', auth_code = $2
        WHERE id = $1
      `, [intentId, authResult.authCode])

      // Create ledger entries
      await createLedgerEntries(tx, {
        type: 'charge',
        amount: intent.amount,
        merchantId: intent.merchant_id,
        intentId
      })
    })

    // Send webhook
    await webhookService.send(intent.merchant_id, 'payment_intent.succeeded', intent)

    return { status: 'succeeded' }
  }

  await updateIntent(intentId, 'failed', authResult.declineCode)
  return { status: 'failed', declineCode: authResult.declineCode }
}
```

### 2. Double-Entry Ledger

**Accounting Entries:**
```javascript
async function createLedgerEntries(tx, { type, amount, merchantId, intentId }) {
  const entries = []

  if (type === 'charge') {
    // Debit customer funds receivable
    entries.push({
      account: 'funds_receivable',
      debit: amount,
      credit: 0
    })

    // Credit merchant payable (minus fees)
    const fee = Math.round(amount * 0.029 + 30) // 2.9% + 30¢
    entries.push({
      account: `merchant:${merchantId}:payable`,
      debit: 0,
      credit: amount - fee
    })

    // Credit revenue (fees)
    entries.push({
      account: 'revenue:transaction_fees',
      debit: 0,
      credit: fee
    })
  }

  // Insert all entries atomically
  for (const entry of entries) {
    await tx.query(`
      INSERT INTO ledger_entries
        (account, debit, credit, intent_id, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [entry.account, entry.debit, entry.credit, intentId])
  }

  // Verify debits = credits (invariant)
  const totals = entries.reduce((acc, e) => ({
    debit: acc.debit + e.debit,
    credit: acc.credit + e.credit
  }), { debit: 0, credit: 0 })

  if (totals.debit !== totals.credit) {
    throw new Error('Ledger imbalance detected')
  }
}
```

### 3. Idempotency Handling

**Preventing Duplicate Charges:**
```javascript
class IdempotencyMiddleware {
  async handle(req, res, next) {
    const idempotencyKey = req.headers['idempotency-key']

    if (!idempotencyKey) {
      return next()
    }

    const cacheKey = `idempotency:${req.merchantId}:${idempotencyKey}`

    // Try to acquire lock
    const acquired = await redis.set(cacheKey + ':lock', '1', 'NX', 'EX', 60)

    if (!acquired) {
      // Another request is processing
      return res.status(409).json({ error: 'Request in progress' })
    }

    try {
      // Check for cached response
      const cached = await redis.get(cacheKey)
      if (cached) {
        const { statusCode, body } = JSON.parse(cached)
        return res.status(statusCode).json(body)
      }

      // Capture response
      const originalJson = res.json.bind(res)
      res.json = (body) => {
        // Cache successful responses for 24 hours
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis.setex(cacheKey, 86400, JSON.stringify({
            statusCode: res.statusCode,
            body
          }))
        }
        return originalJson(body)
      }

      next()
    } finally {
      // Release lock
      await redis.del(cacheKey + ':lock')
    }
  }
}
```

### 4. Fraud Detection

**Risk Scoring:**
```javascript
class FraudService {
  async assessRisk(context) {
    const { intent, paymentMethod, merchantId } = context
    const scores = []

    // Velocity checks
    const recentCharges = await this.getRecentCharges(paymentMethod.id, '1 hour')
    if (recentCharges > 3) {
      scores.push({ rule: 'velocity_1h', score: 0.4 })
    }

    // Geographic checks
    const cardCountry = paymentMethod.card_country
    const ipCountry = await geoip.lookup(context.ipAddress)
    if (cardCountry !== ipCountry) {
      scores.push({ rule: 'geo_mismatch', score: 0.3 })
    }

    // Amount checks
    const avgAmount = await this.getMerchantAvgAmount(merchantId)
    if (intent.amount > avgAmount * 5) {
      scores.push({ rule: 'high_amount', score: 0.2 })
    }

    // Device fingerprint
    const deviceRisk = await this.checkDeviceReputation(context.deviceFingerprint)
    scores.push({ rule: 'device', score: deviceRisk })

    // ML model
    const mlScore = await this.mlPredict({
      amount: intent.amount,
      merchantCategory: context.merchantCategory,
      cardBin: paymentMethod.card_bin,
      hourOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay()
    })
    scores.push({ rule: 'ml_model', score: mlScore * 0.5 })

    // Combine scores
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0)
    const normalizedScore = Math.min(totalScore, 1)

    // Log for analysis
    await this.logRiskAssessment(intent.id, scores, normalizedScore)

    return normalizedScore
  }
}
```

### 5. Webhook Delivery

**Reliable Event Delivery:**
```javascript
class WebhookService {
  async send(merchantId, eventType, data) {
    const merchant = await getMerchant(merchantId)
    if (!merchant.webhook_url) return

    const event = {
      id: `evt_${uuid()}`,
      type: eventType,
      data,
      created: Date.now()
    }

    // Sign payload
    const signature = this.signPayload(event, merchant.webhook_secret)

    // Queue for delivery with retries
    await queue.add('webhook_delivery', {
      merchantId,
      url: merchant.webhook_url,
      event,
      signature
    }, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 1000 // 1s, 2s, 4s, 8s, 16s
      }
    })
  }

  async deliverWebhook(job) {
    const { url, event, signature } = job.data

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature
      },
      body: JSON.stringify(event),
      timeout: 30000
    })

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`)
    }

    // Log successful delivery
    await db.query(`
      INSERT INTO webhook_deliveries (event_id, merchant_id, status, delivered_at)
      VALUES ($1, $2, 'delivered', NOW())
    `, [event.id, job.data.merchantId])
  }

  signPayload(payload, secret) {
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${JSON.stringify(payload)}`
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')

    return `t=${timestamp},v1=${signature}`
  }
}
```

---

## Database Schema

```sql
-- Merchants
CREATE TABLE merchants (
  id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) NOT NULL,
  webhook_url VARCHAR(500),
  webhook_secret VARCHAR(100),
  api_key_hash VARCHAR(100),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Payment Intents
CREATE TABLE payment_intents (
  id UUID PRIMARY KEY,
  merchant_id UUID REFERENCES merchants(id),
  amount INTEGER NOT NULL, -- In cents
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(30) NOT NULL,
  payment_method_id UUID,
  auth_code VARCHAR(50),
  decline_code VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Payment Methods (tokenized cards)
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY,
  customer_id UUID,
  card_token VARCHAR(100), -- Encrypted
  card_last4 VARCHAR(4),
  card_brand VARCHAR(20),
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  card_country VARCHAR(2),
  card_bin VARCHAR(6),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Ledger Entries (double-entry)
CREATE TABLE ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  account VARCHAR(100) NOT NULL,
  debit INTEGER DEFAULT 0,
  credit INTEGER DEFAULT 0,
  intent_id UUID REFERENCES payment_intents(id),
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT positive_amounts CHECK (debit >= 0 AND credit >= 0)
);

CREATE INDEX idx_ledger_account ON ledger_entries(account);
CREATE INDEX idx_ledger_intent ON ledger_entries(intent_id);

-- Refunds
CREATE TABLE refunds (
  id UUID PRIMARY KEY,
  payment_intent_id UUID REFERENCES payment_intents(id),
  amount INTEGER NOT NULL,
  reason VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Disputes (chargebacks)
CREATE TABLE disputes (
  id UUID PRIMARY KEY,
  payment_intent_id UUID REFERENCES payment_intents(id),
  amount INTEGER NOT NULL,
  reason VARCHAR(100),
  status VARCHAR(20) DEFAULT 'needs_response',
  evidence_due_by TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook Deliveries
CREATE TABLE webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(100) NOT NULL,
  merchant_id UUID REFERENCES merchants(id),
  status VARCHAR(20) NOT NULL,
  attempts INTEGER DEFAULT 1,
  last_error TEXT,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Key Design Decisions

### 1. Idempotency Keys

**Decision**: Require idempotency keys for all mutating operations

**Rationale**:
- Prevents duplicate charges from network retries
- Allows safe retry logic in client SDKs
- Critical for financial accuracy

### 2. Double-Entry Ledger

**Decision**: Use double-entry bookkeeping for all financial movements

**Rationale**:
- Every transaction balances (debits = credits)
- Complete audit trail
- Easy reconciliation

### 3. Webhook Signatures

**Decision**: Sign all webhook payloads with HMAC

**Rationale**:
- Merchants can verify authenticity
- Prevents replay attacks (timestamp in signature)
- Industry standard pattern

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Idempotency | Per-request key | Database constraints | Flexibility, reliability |
| Ledger | Double-entry | Single-entry | Accuracy, auditability |
| Webhooks | Async with retry | Sync callbacks | Reliability, decoupling |
| Card storage | Tokenization | Encryption | PCI scope reduction |
