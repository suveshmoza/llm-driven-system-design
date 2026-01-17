# Design Apple Pay - Architecture

## System Overview

Apple Pay is a mobile payment system using tokenization and biometric authentication. Core challenges involve secure tokenization, NFC transactions, and network integration.

**Learning Goals:**
- Build payment tokenization systems
- Design hardware-backed security
- Implement NFC payment protocols
- Handle multi-network integration

---

## Requirements

### Functional Requirements

1. **Provision**: Add cards to wallet
2. **Pay**: NFC and in-app payments
3. **Authenticate**: Biometric verification
4. **Track**: Transaction history
5. **Manage**: Card lifecycle

### Non-Functional Requirements

- **Security**: Hardware-backed token storage
- **Latency**: < 500ms for NFC payment
- **Availability**: 99.99% for transactions
- **Privacy**: Card number never shared with merchant

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     iPhone/Apple Watch                          │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  Wallet App   │  │ Secure Element│  │   NFC Radio   │       │
│  │               │  │               │  │               │       │
│  │ - Cards       │  │ - Token store │  │ - Contactless │       │
│  │ - History     │  │ - Crypto ops  │  │ - Reader comm │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Apple Pay Servers                            │
│         (Token provisioning, Transaction routing)               │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Card Networks │    │  Token Vault  │    │   Issuing     │
│               │    │               │    │   Banks       │
│ - Visa        │    │ - Token mgmt  │    │               │
│ - Mastercard  │    │ - Cryptograms │    │ - Auth        │
│ - Amex        │    │               │    │ - Settle      │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## Core Components

### 1. Card Provisioning

**Token Generation Flow:**
```javascript
class ProvisioningService {
  async provisionCard(userId, deviceId, cardData) {
    // Validate card with network
    const cardNetwork = this.identifyNetwork(cardData.pan)

    // Request token from network's Token Service Provider (TSP)
    const tokenRequest = {
      pan: await this.encryptForNetwork(cardData.pan, cardNetwork),
      expiry: cardData.expiry,
      deviceId,
      deviceType: 'iphone',
      walletId: this.getWalletId(userId)
    }

    const tokenResponse = await this.requestToken(cardNetwork, tokenRequest)

    // Store token reference (not the actual token - that's in Secure Element)
    await db.query(`
      INSERT INTO provisioned_cards
        (id, user_id, device_id, token_ref, network, last4, card_type, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
    `, [
      uuid(),
      userId,
      deviceId,
      tokenResponse.tokenRef,
      cardNetwork,
      cardData.pan.slice(-4),
      tokenResponse.cardType
    ])

    // Provision token to Secure Element on device
    await this.provisionToSecureElement(deviceId, {
      token: tokenResponse.token,
      cryptogramKey: tokenResponse.cryptogramKey,
      network: cardNetwork
    })

    return {
      success: true,
      last4: cardData.pan.slice(-4),
      cardType: tokenResponse.cardType,
      network: cardNetwork
    }
  }

  async provisionToSecureElement(deviceId, tokenData) {
    // Establish secure channel to device's Secure Element
    const session = await this.establishSecureChannel(deviceId)

    // Send token data encrypted for Secure Element
    const encryptedPayload = await this.encryptForSE(
      tokenData,
      session.ephemeralKey
    )

    await this.pushToDevice(deviceId, {
      type: 'provision_token',
      sessionId: session.id,
      payload: encryptedPayload
    })
  }
}
```

### 2. NFC Payment

**Contactless Transaction:**
```javascript
class NFCPaymentHandler {
  // Runs on device when near payment terminal
  async handlePayment(merchantData) {
    const { amount, currency, merchantId, merchantName } = merchantData

    // Request biometric auth
    const authenticated = await this.requestBiometricAuth()
    if (!authenticated) {
      throw new Error('Authentication failed')
    }

    // Get default card from Wallet
    const card = await this.getDefaultCard()

    // Generate payment cryptogram in Secure Element
    const cryptogram = await this.secureElement.generateCryptogram({
      tokenId: card.tokenId,
      amount,
      currency,
      merchantId,
      transactionId: uuid(),
      unpredictableNumber: merchantData.unpredictableNumber
    })

    // Build EMV payment data
    const paymentData = {
      token: card.token, // Device-specific token, not real PAN
      cryptogram: cryptogram.value,
      eci: '07', // Electronic Commerce Indicator
      applicationExpiryDate: card.expiryDate,
      applicationInterchangeProfile: '1900',
      applicationTransactionCounter: cryptogram.atc
    }

    // Transmit via NFC
    await this.nfcRadio.transmit(paymentData)

    // Log transaction locally
    await this.logTransaction({
      merchantName,
      amount,
      currency,
      timestamp: Date.now(),
      status: 'pending'
    })

    return paymentData
  }
}

// Secure Element operations (hardware)
class SecureElement {
  async generateCryptogram(params) {
    // This runs in secure hardware
    const { tokenId, amount, merchantId, unpredictableNumber } = params

    // Get token's cryptogram key (never leaves SE)
    const key = await this.getKey(tokenId)

    // Increment Application Transaction Counter
    const atc = await this.incrementATC(tokenId)

    // Build cryptogram input
    const input = Buffer.concat([
      Buffer.from(amount.toString().padStart(12, '0')),
      Buffer.from(merchantId),
      Buffer.from(unpredictableNumber, 'hex'),
      Buffer.from(atc.toString(16).padStart(4, '0'), 'hex')
    ])

    // Generate cryptogram using 3DES or AES
    const cryptogram = await this.mac(key, input)

    return {
      value: cryptogram.slice(0, 8).toString('hex'), // First 8 bytes
      atc
    }
  }
}
```

### 3. In-App Payment

**Apple Pay JS Integration:**
```javascript
class InAppPaymentService {
  async processPayment(merchantId, paymentRequest) {
    const { amount, currency, items } = paymentRequest

    // Create payment session
    const session = await ApplePaySession.create(3, {
      countryCode: 'US',
      currencyCode: currency,
      merchantCapabilities: ['supports3DS'],
      supportedNetworks: ['visa', 'masterCard', 'amex'],
      total: {
        label: 'Total',
        amount: amount.toString()
      },
      lineItems: items
    })

    return new Promise((resolve, reject) => {
      session.onpaymentauthorized = async (event) => {
        const payment = event.payment

        // Payment token is encrypted for merchant
        const token = payment.token

        // Send to server for processing
        try {
          const result = await this.processWithServer(merchantId, token)

          if (result.success) {
            session.completePayment(ApplePaySession.STATUS_SUCCESS)
            resolve(result)
          } else {
            session.completePayment(ApplePaySession.STATUS_FAILURE)
            reject(new Error(result.error))
          }
        } catch (error) {
          session.completePayment(ApplePaySession.STATUS_FAILURE)
          reject(error)
        }
      }

      session.begin()
    })
  }

  async processWithServer(merchantId, paymentToken) {
    // Decrypt payment token with merchant's private key
    const decrypted = await this.decryptPaymentToken(
      paymentToken,
      merchantId
    )

    // Extract payment data
    const { token, cryptogram, eci, transactionId } = decrypted

    // Process with payment processor
    const result = await this.paymentProcessor.authorize({
      token,
      cryptogram,
      eci,
      amount: paymentToken.paymentData.amount,
      currency: paymentToken.paymentData.currency,
      merchantId
    })

    return result
  }
}
```

### 4. Transaction Processing

**Server-Side Processing:**
```javascript
class TransactionService {
  async processNFCTransaction(terminalData) {
    const { token, cryptogram, amount, merchantId, terminalId } = terminalData

    // Look up token
    const tokenInfo = await this.tokenVault.lookup(token)
    if (!tokenInfo) {
      return { approved: false, reason: 'Invalid token' }
    }

    // Validate cryptogram with network
    const cryptogramValid = await this.validateCryptogram(
      tokenInfo.network,
      token,
      cryptogram,
      {
        amount,
        merchantId,
        transactionId: terminalData.transactionId
      }
    )

    if (!cryptogramValid) {
      return { approved: false, reason: 'Cryptogram validation failed' }
    }

    // Get real PAN from token vault (only network has this)
    // Route authorization to issuing bank
    const authResult = await this.routeToIssuer(tokenInfo, {
      amount,
      merchantId,
      terminalId,
      cryptogramVerified: true
    })

    // Log transaction
    await db.query(`
      INSERT INTO transactions
        (id, token_ref, merchant_id, amount, currency, status, auth_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      uuid(),
      tokenInfo.tokenRef,
      merchantId,
      amount,
      terminalData.currency,
      authResult.approved ? 'approved' : 'declined',
      authResult.authCode
    ])

    return authResult
  }

  async validateCryptogram(network, token, cryptogram, context) {
    // Send to network's cryptogram validation service
    const response = await this.networkClient[network].validateCryptogram({
      token,
      cryptogram,
      ...context
    })

    return response.valid
  }
}
```

### 5. Token Lifecycle

**Token Management:**
```javascript
class TokenLifecycleService {
  async suspendToken(userId, cardId, reason) {
    const card = await this.getCard(userId, cardId)

    // Notify network to suspend token
    await this.networkClient[card.network].suspendToken(card.tokenRef, reason)

    // Update local state
    await db.query(`
      UPDATE provisioned_cards
      SET status = 'suspended', suspended_at = NOW(), suspend_reason = $3
      WHERE id = $1 AND user_id = $2
    `, [cardId, userId, reason])

    // Notify device to disable token in Secure Element
    await this.pushToDevice(card.deviceId, {
      type: 'token_status_change',
      tokenRef: card.tokenRef,
      newStatus: 'suspended'
    })
  }

  async handleDeviceLost(userId, deviceId) {
    // Suspend all tokens on lost device
    const cards = await db.query(`
      SELECT * FROM provisioned_cards
      WHERE user_id = $1 AND device_id = $2 AND status = 'active'
    `, [userId, deviceId])

    for (const card of cards.rows) {
      await this.suspendToken(userId, card.id, 'device_lost')
    }

    return { suspendedCount: cards.rows.length }
  }

  async refreshToken(userId, cardId) {
    const card = await this.getCard(userId, cardId)

    // Request new token from network
    const newToken = await this.networkClient[card.network].refreshToken(
      card.tokenRef
    )

    // Update Secure Element with new token
    await this.provisionToSecureElement(card.deviceId, {
      token: newToken.token,
      cryptogramKey: newToken.cryptogramKey,
      replaces: card.tokenRef
    })

    // Update reference
    await db.query(`
      UPDATE provisioned_cards
      SET token_ref = $3, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
    `, [cardId, userId, newToken.tokenRef])
  }
}
```

---

## Database Schema

```sql
-- Provisioned Cards
CREATE TABLE provisioned_cards (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  device_id UUID NOT NULL,
  token_ref VARCHAR(100) NOT NULL, -- Reference to token (actual token in SE)
  network VARCHAR(20) NOT NULL, -- visa, mastercard, amex
  last4 VARCHAR(4) NOT NULL,
  card_type VARCHAR(20), -- credit, debit
  card_art_url VARCHAR(500),
  status VARCHAR(20) DEFAULT 'active',
  suspended_at TIMESTAMP,
  suspend_reason VARCHAR(100),
  provisioned_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cards_user ON provisioned_cards(user_id);
CREATE INDEX idx_cards_device ON provisioned_cards(device_id);

-- Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  token_ref VARCHAR(100) NOT NULL,
  merchant_id VARCHAR(100),
  merchant_name VARCHAR(200),
  terminal_id VARCHAR(100),
  amount DECIMAL NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL,
  auth_code VARCHAR(20),
  decline_reason VARCHAR(100),
  transaction_type VARCHAR(20), -- nfc, in_app, web
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_transactions_token ON transactions(token_ref, created_at DESC);

-- Merchants
CREATE TABLE merchants (
  id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category_code VARCHAR(4),
  public_key BYTEA, -- For encrypting payment tokens
  webhook_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Key Design Decisions

### 1. Device-Specific Tokens

**Decision**: Each device gets unique token for same card

**Rationale**:
- Losing one device doesn't compromise others
- Easy per-device revocation
- Network knows which device transacted

### 2. Secure Element Storage

**Decision**: Store tokens and keys in hardware SE

**Rationale**:
- Keys never leave secure hardware
- Protected from OS-level attacks
- Tamper-resistant

### 3. Dynamic Cryptograms

**Decision**: One-time cryptogram per transaction

**Rationale**:
- Token alone is useless without cryptogram
- Prevents replay attacks
- Verifiable by network

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Token storage | Secure Element | Software keychain | Security |
| Token scope | Per-device | Shared across devices | Revocation |
| Auth method | Biometric + SE | PIN only | Security + UX |
| Cryptogram | Network-specific | Universal | Compatibility |
