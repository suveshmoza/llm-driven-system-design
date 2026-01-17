# Design APNs - Architecture

## System Overview

APNs is Apple's push notification service for iOS, macOS, and other Apple platforms. Core challenges involve reliable delivery, connection management, and scale.

**Learning Goals:**
- Build push notification infrastructure
- Design connection pooling at scale
- Implement store-and-forward delivery
- Handle device token lifecycle

---

## Requirements

### Functional Requirements

1. **Push**: Deliver notifications to devices
2. **Register**: Manage device tokens
3. **Topics**: Subscribe to notification topics
4. **Feedback**: Report undeliverable tokens
5. **Priority**: Handle urgent vs background notifications

### Non-Functional Requirements

- **Latency**: < 500ms for high-priority notifications
- **Scale**: 50B+ notifications per day
- **Reliability**: 99.99% delivery to online devices
- **Efficiency**: Minimal battery impact on devices

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Provider Layer                              │
│              App Servers sending notifications                  │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP/2
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    APNs Gateway                                 │
│         (Auth, Rate Limiting, Connection Management)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Routing Layer                                 │
│          (Topic resolution, Device lookup, Sharding)           │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Push Service │    │ Store Service │    │Token Registry │
│               │    │               │    │               │
│ - Delivery    │    │ - Queue       │    │ - Tokens      │
│ - Connections │    │ - Retry       │    │ - Invalidation│
│ - QoS         │    │ - Expiry      │    │ - Topics      │
└───────────────┘    └───────────────┘    └───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Device Layer                               │
│               Persistent connections to all devices             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Provider API (HTTP/2)

**Receiving Notifications from App Servers:**
```javascript
const http2 = require('http2')

class APNsGateway {
  constructor() {
    this.server = http2.createSecureServer({
      key: fs.readFileSync('server.key'),
      cert: fs.readFileSync('server.crt'),
      allowHTTP1: false
    })

    this.server.on('stream', (stream, headers) => {
      this.handleRequest(stream, headers)
    })
  }

  async handleRequest(stream, headers) {
    const method = headers[':method']
    const path = headers[':path']

    // POST /3/device/{device_token}
    if (method === 'POST' && path.startsWith('/3/device/')) {
      const deviceToken = path.split('/')[3]

      // Validate JWT
      const authHeader = headers['authorization']
      const validAuth = await this.validateJWT(authHeader)
      if (!validAuth) {
        stream.respond({ ':status': 403 })
        stream.end(JSON.stringify({ reason: 'InvalidProviderToken' }))
        return
      }

      // Read notification payload
      let payload = ''
      stream.on('data', chunk => payload += chunk)
      stream.on('end', async () => {
        try {
          const notification = JSON.parse(payload)

          // Validate payload
          if (!this.validatePayload(notification, headers)) {
            stream.respond({ ':status': 400 })
            stream.end(JSON.stringify({ reason: 'BadPayload' }))
            return
          }

          // Queue for delivery
          const result = await this.queueNotification(
            deviceToken,
            notification,
            headers
          )

          stream.respond({
            ':status': 200,
            'apns-id': result.notificationId
          })
          stream.end()

        } catch (error) {
          stream.respond({ ':status': 500 })
          stream.end(JSON.stringify({ reason: 'InternalServerError' }))
        }
      })
    }
  }

  async queueNotification(deviceToken, notification, headers) {
    const notificationId = headers['apns-id'] || uuid()
    const priority = headers['apns-priority'] || 10
    const expiration = headers['apns-expiration'] || 0
    const topic = headers['apns-topic']
    const collapseId = headers['apns-collapse-id']

    // Look up device
    const device = await this.tokenRegistry.lookup(deviceToken)
    if (!device) {
      throw new Error('Unregistered')
    }

    // Create notification record
    const notificationRecord = {
      id: notificationId,
      deviceToken,
      deviceId: device.id,
      payload: notification,
      priority,
      expiration: expiration > 0 ? new Date(expiration * 1000) : null,
      topic,
      collapseId,
      createdAt: Date.now()
    }

    // Route to appropriate push service
    const shardId = this.getShardForDevice(device.id)
    await this.routeToShard(shardId, notificationRecord)

    return { notificationId }
  }
}
```

### 2. Device Token Management

**Token Lifecycle:**
```javascript
class TokenRegistry {
  async registerToken(token, deviceInfo) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // Check if token already exists
    const existing = await db.query(`
      SELECT * FROM device_tokens WHERE token_hash = $1
    `, [tokenHash])

    if (existing.rows.length > 0) {
      // Update last seen
      await db.query(`
        UPDATE device_tokens SET last_seen = NOW(), device_info = $2
        WHERE token_hash = $1
      `, [tokenHash, deviceInfo])

      return { deviceId: existing.rows[0].device_id, isNew: false }
    }

    // Create new token
    const deviceId = uuid()
    await db.query(`
      INSERT INTO device_tokens (device_id, token_hash, app_bundle_id, device_info, created_at, last_seen)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
    `, [deviceId, tokenHash, deviceInfo.bundleId, deviceInfo])

    return { deviceId, isNew: true }
  }

  async invalidateToken(token, reason) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    await db.query(`
      UPDATE device_tokens
      SET is_valid = false, invalidated_at = NOW(), invalidation_reason = $2
      WHERE token_hash = $1
    `, [tokenHash, reason])

    // Notify feedback service
    await this.feedbackService.reportInvalidToken(token, reason)
  }

  async lookup(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const result = await db.query(`
      SELECT * FROM device_tokens
      WHERE token_hash = $1 AND is_valid = true
    `, [tokenHash])

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0]
  }

  // Topic subscriptions
  async subscribeToTopic(deviceToken, topic) {
    const device = await this.lookup(deviceToken)
    if (!device) throw new Error('Invalid token')

    await db.query(`
      INSERT INTO topic_subscriptions (device_id, topic)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [device.device_id, topic])
  }

  async getDevicesForTopic(topic) {
    return db.query(`
      SELECT dt.* FROM device_tokens dt
      JOIN topic_subscriptions ts ON dt.device_id = ts.device_id
      WHERE ts.topic = $1 AND dt.is_valid = true
    `, [topic])
  }
}
```

### 3. Push Delivery Service

**Delivery to Devices:**
```javascript
class PushService {
  constructor(shardId) {
    this.shardId = shardId
    this.connections = new Map() // deviceId -> connection
    this.pendingQueue = new PriorityQueue() // For offline devices
  }

  async deliverNotification(notification) {
    const { deviceId, payload, priority, collapseId } = notification

    // Check if device is connected
    const connection = this.connections.get(deviceId)

    if (connection && connection.isAlive()) {
      // Immediate delivery
      return this.pushToDevice(connection, notification)
    }

    // Device offline - store for later
    return this.storeForDelivery(notification)
  }

  async pushToDevice(connection, notification) {
    const { id, payload, priority, collapseId } = notification

    // Handle collapse (replace previous notification with same ID)
    if (collapseId) {
      await this.collapseNotification(connection.deviceId, collapseId)
    }

    try {
      await connection.send({
        type: 'notification',
        id,
        payload,
        priority
      })

      // Mark as delivered
      await this.markDelivered(id)

      return { delivered: true }
    } catch (error) {
      // Connection failed, store for retry
      await this.storeForDelivery(notification)
      return { delivered: false, queued: true }
    }
  }

  async storeForDelivery(notification) {
    const { expiration, priority, collapseId } = notification

    // Check expiration
    if (expiration && expiration < Date.now()) {
      return { expired: true }
    }

    // Store in queue with priority
    await db.query(`
      INSERT INTO pending_notifications
        (id, device_id, payload, priority, expiration, collapse_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (device_id, collapse_id)
      DO UPDATE SET payload = $3, priority = $4, created_at = NOW()
    `, [notification.id, notification.deviceId, notification.payload,
        priority, expiration, collapseId])

    return { queued: true }
  }

  // Called when device connects
  async onDeviceConnect(deviceId, connection) {
    this.connections.set(deviceId, connection)

    // Deliver pending notifications
    const pending = await db.query(`
      SELECT * FROM pending_notifications
      WHERE device_id = $1
      AND (expiration IS NULL OR expiration > NOW())
      ORDER BY priority DESC, created_at ASC
    `, [deviceId])

    for (const notification of pending.rows) {
      await this.pushToDevice(connection, notification)
    }

    // Clean up delivered
    await db.query(`
      DELETE FROM pending_notifications WHERE device_id = $1
    `, [deviceId])
  }

  // Connection management
  handleConnection(socket, deviceId) {
    const connection = new DeviceConnection(socket, deviceId)

    connection.on('close', () => {
      this.connections.delete(deviceId)
    })

    connection.on('ack', (notificationId) => {
      this.markDelivered(notificationId)
    })

    this.onDeviceConnect(deviceId, connection)
  }
}
```

### 4. Feedback Service

**Reporting Invalid Tokens:**
```javascript
class FeedbackService {
  async reportInvalidToken(token, reason) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // Get app info for the token
    const tokenInfo = await db.query(`
      SELECT app_bundle_id, invalidated_at FROM device_tokens
      WHERE token_hash = $1
    `, [tokenHash])

    if (tokenInfo.rows.length === 0) return

    const { app_bundle_id, invalidated_at } = tokenInfo.rows[0]

    // Store in feedback queue for providers
    await db.query(`
      INSERT INTO feedback_queue (token_hash, app_bundle_id, reason, timestamp)
      VALUES ($1, $2, $3, $4)
    `, [tokenHash, app_bundle_id, reason, invalidated_at])
  }

  // Provider polls for feedback
  async getFeedback(appBundleId, since) {
    const feedback = await db.query(`
      SELECT token_hash, reason, timestamp FROM feedback_queue
      WHERE app_bundle_id = $1 AND timestamp > $2
      ORDER BY timestamp ASC
      LIMIT 1000
    `, [appBundleId, since])

    return feedback.rows
  }
}
```

### 5. Quality of Service

**Priority and Rate Limiting:**
```javascript
class QoSManager {
  constructor() {
    // Priority 10: Immediate delivery (user-facing)
    // Priority 5: Background updates (power nap)
    // Priority 1: Low priority (can be delayed)
    this.priorityQueues = {
      10: new PriorityQueue(),
      5: new PriorityQueue(),
      1: new PriorityQueue()
    }
  }

  async enqueue(notification) {
    const priority = notification.priority || 10
    const queue = this.priorityQueues[priority]

    queue.enqueue(notification, notification.createdAt)

    // Rate limit per device
    const deviceRateKey = `rate:device:${notification.deviceId}`
    const deviceRate = await redis.incr(deviceRateKey)
    if (deviceRate === 1) {
      await redis.expire(deviceRateKey, 60) // 1 minute window
    }

    if (deviceRate > 100) {
      // Too many notifications to this device
      throw new Error('TooManyRequestsToDevice')
    }
  }

  async dequeue() {
    // Process high priority first
    for (const priority of [10, 5, 1]) {
      const queue = this.priorityQueues[priority]
      if (!queue.isEmpty()) {
        return queue.dequeue()
      }
    }
    return null
  }

  shouldDeliverNow(notification) {
    // Priority 10: Always deliver immediately
    if (notification.priority === 10) return true

    // Priority 5: Deliver if device is awake or will wake soon
    if (notification.priority === 5) {
      return this.isDeviceAwake(notification.deviceId)
    }

    // Priority 1: Batch and deliver during power nap
    return false
  }
}
```

---

## Database Schema

```sql
-- Device Tokens
CREATE TABLE device_tokens (
  device_id UUID PRIMARY KEY,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  app_bundle_id VARCHAR(200) NOT NULL,
  device_info JSONB,
  is_valid BOOLEAN DEFAULT TRUE,
  invalidated_at TIMESTAMP,
  invalidation_reason VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tokens_app ON device_tokens(app_bundle_id);
CREATE INDEX idx_tokens_valid ON device_tokens(is_valid) WHERE is_valid = true;

-- Topic Subscriptions
CREATE TABLE topic_subscriptions (
  device_id UUID REFERENCES device_tokens(device_id),
  topic VARCHAR(200) NOT NULL,
  subscribed_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (device_id, topic)
);

CREATE INDEX idx_subscriptions_topic ON topic_subscriptions(topic);

-- Pending Notifications (for offline devices)
CREATE TABLE pending_notifications (
  id UUID PRIMARY KEY,
  device_id UUID REFERENCES device_tokens(device_id),
  payload JSONB NOT NULL,
  priority INTEGER DEFAULT 10,
  expiration TIMESTAMP,
  collapse_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (device_id, collapse_id)
);

CREATE INDEX idx_pending_device ON pending_notifications(device_id);
CREATE INDEX idx_pending_expiration ON pending_notifications(expiration);

-- Delivery Log
CREATE TABLE delivery_log (
  notification_id UUID PRIMARY KEY,
  device_id UUID,
  status VARCHAR(20) NOT NULL,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Feedback Queue
CREATE TABLE feedback_queue (
  id BIGSERIAL PRIMARY KEY,
  token_hash VARCHAR(64) NOT NULL,
  app_bundle_id VARCHAR(200) NOT NULL,
  reason VARCHAR(50),
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_feedback_app ON feedback_queue(app_bundle_id, timestamp);
```

---

## Key Design Decisions

### 1. HTTP/2 for Provider API

**Decision**: Use HTTP/2 multiplexed connections

**Rationale**:
- Single connection per provider
- Multiplexed streams
- Binary protocol efficiency
- Header compression

### 2. Store-and-Forward

**Decision**: Queue notifications for offline devices

**Rationale**:
- Guarantee delivery when device comes online
- Handle intermittent connectivity
- Support expiration policies

### 3. Collapse IDs

**Decision**: Replace old notifications with same collapse ID

**Rationale**:
- Reduce notification spam
- Show only latest update
- Save device resources

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Provider protocol | HTTP/2 | WebSocket | Standard, tooling |
| Device connection | Long-lived TCP | Polling | Latency, efficiency |
| Storage | Store-and-forward | Drop if offline | Delivery guarantee |
| Token storage | Hashed | Plain | Security |
