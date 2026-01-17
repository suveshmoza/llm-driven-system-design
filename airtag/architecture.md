# Design AirTag - Architecture

## System Overview

AirTag uses the Find My network to locate items using crowd-sourced Bluetooth detection. Core challenges involve privacy-preserving location, key rotation, and anti-stalking measures.

**Learning Goals:**
- Build privacy-preserving location systems
- Design end-to-end encrypted reporting
- Implement key rotation schemes
- Handle crowd-sourced data at scale

---

## Requirements

### Functional Requirements

1. **Track**: Locate items via Find My network
2. **Precision**: UWB-based precise finding
3. **Lost Mode**: Notify when item is found
4. **Anti-Stalking**: Detect unknown trackers
5. **Sound**: Play sound to locate nearby item

### Non-Functional Requirements

- **Privacy**: Apple cannot see locations
- **Scale**: 1B+ Find My network devices
- **Latency**: < 15 minutes for location update
- **Battery**: Years of battery life

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AirTag Device                               │
│         (BLE beacon, UWB, NFC, Speaker, Motion sensor)         │
└─────────────────────────────────────────────────────────────────┘
                              │ BLE
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Find My Network                               │
│              (Billions of Apple devices)                        │
└─────────────────────────────────────────────────────────────────┘
                              │ Encrypted reports
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Apple Servers                                │
│         (Encrypted blob storage, no location access)           │
└─────────────────────────────────────────────────────────────────┘
        │                                           │
        ▼                                           ▼
┌───────────────┐                          ┌───────────────┐
│  Owner Device │                          │Anti-Stalk Svc │
│               │                          │               │
│ - Decrypts    │                          │ - Detection   │
│ - Shows map   │                          │ - Alerts      │
└───────────────┘                          └───────────────┘
```

---

## Core Components

### 1. Key Rotation and Beacon

**Rotating Identity:**
```javascript
class AirTagKeyManager {
  constructor(masterSecret) {
    this.masterSecret = masterSecret // Shared with owner's iCloud
    this.currentPeriod = this.getCurrentPeriod()
  }

  getCurrentPeriod() {
    // Rotate keys every 15 minutes
    return Math.floor(Date.now() / (15 * 60 * 1000))
  }

  deriveCurrentKey() {
    // Derive period-specific key from master secret
    const period = this.getCurrentPeriod()
    return crypto.createHmac('sha256', this.masterSecret)
      .update(`airtag_key_${period}`)
      .digest()
  }

  derivePublicKey() {
    // Generate EC public key for this period
    const privateKey = this.deriveCurrentKey()
    const keyPair = crypto.createECDH('p224')
    keyPair.setPrivateKey(privateKey.slice(0, 28)) // P-224 key size

    return keyPair.getPublicKey()
  }

  // BLE advertisement payload
  getBLEPayload() {
    const publicKey = this.derivePublicKey()

    return {
      // Advertised identifier (derived from public key)
      identifier: crypto.createHash('sha256')
        .update(publicKey)
        .digest()
        .slice(0, 6), // 6 bytes identifier

      // Full public key (for encryption)
      publicKey: publicKey
    }
  }
}
```

### 2. Location Reporting

**Privacy-Preserving Reports:**
```javascript
class FindMyReporter {
  // Called when iPhone detects an AirTag
  async reportSighting(airtag, myLocation) {
    const { identifier, publicKey } = airtag

    // Encrypt location with AirTag's public key
    // Only owner (who knows master secret) can decrypt
    const encryptedLocation = await this.encryptLocation(
      myLocation,
      publicKey
    )

    // Report to Apple servers
    await fetch('https://findmy.apple.com/report', {
      method: 'POST',
      body: JSON.stringify({
        // Hashed identifier (Apple can correlate reports)
        identifierHash: crypto.createHash('sha256')
          .update(identifier)
          .digest('hex'),

        // Encrypted location blob (Apple cannot decrypt)
        encryptedPayload: encryptedLocation,

        // Timestamp (for freshness)
        timestamp: Date.now()
      })
    })
  }

  async encryptLocation(location, publicKey) {
    // ECIES encryption
    // Generate ephemeral key pair
    const ephemeral = crypto.createECDH('p224')
    ephemeral.generateKeys()

    // Derive shared secret
    const sharedSecret = ephemeral.computeSecret(publicKey)

    // Derive encryption key from shared secret
    const encryptionKey = crypto.createHash('sha256')
      .update(sharedSecret)
      .update('encryption')
      .digest()

    // Encrypt location
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)

    const plaintext = JSON.stringify({
      lat: location.latitude,
      lon: location.longitude,
      accuracy: location.accuracy,
      timestamp: Date.now()
    })

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ])

    return {
      ephemeralPublicKey: ephemeral.getPublicKey(),
      iv: iv,
      ciphertext: encrypted,
      authTag: cipher.getAuthTag()
    }
  }
}
```

### 3. Location Retrieval

**Owner Decryption:**
```javascript
class FindMyClient {
  constructor(masterSecret) {
    this.masterSecret = masterSecret
  }

  async getLocations(timeRange) {
    // Generate all possible identifiers for time range
    const identifiers = []
    const startPeriod = Math.floor(timeRange.start / (15 * 60 * 1000))
    const endPeriod = Math.floor(timeRange.end / (15 * 60 * 1000))

    for (let period = startPeriod; period <= endPeriod; period++) {
      const key = this.deriveKeyForPeriod(period)
      const publicKey = this.derivePublicKeyFromPrivate(key)
      const identifier = crypto.createHash('sha256')
        .update(publicKey)
        .digest()
        .slice(0, 6)

      identifiers.push({
        period,
        identifierHash: crypto.createHash('sha256')
          .update(identifier)
          .digest('hex'),
        privateKey: key
      })
    }

    // Query Apple for encrypted reports
    const reports = await this.queryReports(identifiers.map(i => i.identifierHash))

    // Decrypt reports
    const locations = []
    for (const report of reports) {
      const identifier = identifiers.find(i => i.identifierHash === report.identifierHash)
      if (!identifier) continue

      try {
        const location = await this.decryptReport(report, identifier.privateKey)
        locations.push(location)
      } catch (e) {
        // Decryption failed - not our AirTag
        continue
      }
    }

    return locations.sort((a, b) => b.timestamp - a.timestamp)
  }

  async decryptReport(report, privateKey) {
    const { ephemeralPublicKey, iv, ciphertext, authTag } = report.encryptedPayload

    // Derive shared secret
    const keyPair = crypto.createECDH('p224')
    keyPair.setPrivateKey(privateKey.slice(0, 28))
    const sharedSecret = keyPair.computeSecret(ephemeralPublicKey)

    // Derive decryption key
    const decryptionKey = crypto.createHash('sha256')
      .update(sharedSecret)
      .update('encryption')
      .digest()

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ])

    return JSON.parse(decrypted.toString('utf8'))
  }
}
```

### 4. Anti-Stalking Detection

**Unknown Tracker Alerts:**
```javascript
class AntiStalkingService {
  constructor() {
    this.seenTrackers = new Map() // identifier -> sightings
    this.alertThreshold = 3 // sightings
    this.timeWindow = 3 * 60 * 60 * 1000 // 3 hours
  }

  async onTrackerDetected(tracker, myLocation) {
    const { identifier } = tracker

    // Skip if it's one of my registered devices
    if (await this.isMyDevice(identifier)) {
      return
    }

    // Record sighting
    const sightings = this.seenTrackers.get(identifier) || []
    sightings.push({
      location: myLocation,
      timestamp: Date.now()
    })

    // Filter to recent sightings
    const recentSightings = sightings.filter(
      s => Date.now() - s.timestamp < this.timeWindow
    )
    this.seenTrackers.set(identifier, recentSightings)

    // Check for stalking pattern
    if (this.detectStalkingPattern(recentSightings)) {
      await this.alertUser(identifier, recentSightings)
    }
  }

  detectStalkingPattern(sightings) {
    if (sightings.length < this.alertThreshold) {
      return false
    }

    // Check if tracker has been with us across multiple locations
    const locations = sightings.map(s => s.location)

    // Calculate total distance traveled
    let totalDistance = 0
    for (let i = 1; i < locations.length; i++) {
      totalDistance += this.haversineDistance(locations[i-1], locations[i])
    }

    // If we've traveled significant distance with this tracker
    if (totalDistance > 0.5) { // > 500 meters
      return true
    }

    // Check time span
    const timeSpan = sightings[sightings.length - 1].timestamp - sightings[0].timestamp
    if (timeSpan > 60 * 60 * 1000) { // > 1 hour
      return true
    }

    return false
  }

  async alertUser(identifier, sightings) {
    // Send local notification
    await this.sendNotification({
      title: 'Unknown AirTag Detected',
      body: 'An AirTag has been traveling with you. Tap to learn more.',
      data: {
        type: 'unknown_tracker',
        identifier,
        firstSeen: sightings[0].timestamp,
        sightingCount: sightings.length
      }
    })

    // Show option to play sound
    // Show map of where tracker has been seen
    // Provide instructions for disabling
  }
}
```

### 5. Precision Finding

**UWB Directional Finding:**
```javascript
class PrecisionFinder {
  async startPrecisionFinding(airtag) {
    // Establish UWB ranging session
    const session = await this.initUWBSession(airtag.identifier)

    // Continuous ranging loop
    while (session.active) {
      const ranging = await session.measureRange()

      // Calculate distance from time-of-flight
      const distance = this.calculateDistance(ranging.timeOfFlight)

      // Calculate direction from angle-of-arrival
      const direction = this.calculateDirection(ranging.angleOfArrival)

      // Update UI
      this.updateUI({
        distance, // in meters
        direction: {
          azimuth: direction.azimuth, // horizontal angle
          elevation: direction.elevation // vertical angle
        },
        signalStrength: ranging.rssi
      })

      await this.sleep(100) // 10 Hz update rate
    }
  }

  calculateDistance(timeOfFlight) {
    const speedOfLight = 299792458 // m/s
    return (timeOfFlight * speedOfLight) / 2 // Round trip
  }

  calculateDirection(angleOfArrival) {
    // UWB antenna array provides angle measurements
    return {
      azimuth: angleOfArrival.horizontal,
      elevation: angleOfArrival.vertical
    }
  }
}
```

---

## Database Schema

This section documents the complete PostgreSQL database schema for the Find My Network clone, including all tables, relationships, indexes, and design rationale.

### Entity-Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    ENTITY RELATIONSHIPS                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘

                                    ┌─────────────────┐
                                    │     session     │
                                    │─────────────────│
                                    │ sid (PK)        │
                                    │ sess            │
                                    │ expire          │
                                    └─────────────────┘
                                           │
                                           │ (no FK, uses user_id
                                           │  stored in sess JSON)
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                           │
│  ┌─────────────────┐         1:N          ┌─────────────────────┐                        │
│  │      users      │◄─────────────────────│  registered_devices │                        │
│  │─────────────────│                      │─────────────────────│                        │
│  │ id (PK)         │                      │ id (PK)             │                        │
│  │ email (UNIQUE)  │                      │ user_id (FK)────────┼──┐                     │
│  │ password_hash   │                      │ device_type         │  │                     │
│  │ name            │                      │ name                │  │                     │
│  │ role            │                      │ emoji               │  │ CASCADE             │
│  │ created_at      │                      │ master_secret       │  │ DELETE              │
│  │ updated_at      │                      │ current_period      │  │                     │
│  └─────────────────┘                      │ is_active           │  │                     │
│         │                                 │ created_at          │  │                     │
│         │                                 │ updated_at          │◄─┘                     │
│         │ 1:N                             └─────────────────────┘                        │
│         │ CASCADE                                   │                                     │
│         │ DELETE                                    │                                     │
│         ▼                                           │ 1:1                                 │
│  ┌─────────────────┐                               │ CASCADE DELETE                       │
│  │  notifications  │                               ▼                                      │
│  │─────────────────│                      ┌─────────────────────┐                        │
│  │ id (PK)         │                      │     lost_mode       │                        │
│  │ user_id (FK)────┼──► CASCADE           │─────────────────────│                        │
│  │ device_id (FK)──┼──► SET NULL          │ device_id (PK, FK)──┼──► registered_devices  │
│  │ type            │                      │ enabled             │                        │
│  │ title           │                      │ contact_phone       │                        │
│  │ message         │                      │ contact_email       │                        │
│  │ is_read         │                      │ message             │                        │
│  │ data            │                      │ notify_when_found   │                        │
│  │ created_at      │                      │ enabled_at          │                        │
│  └─────────────────┘                      │ created_at          │                        │
│         │                                 │ updated_at          │                        │
│         │ 1:N                             └─────────────────────┘                        │
│         │ CASCADE                                   │                                     │
│         │ DELETE                                    │                                     │
│         ▼                                           │ 1:N                                 │
│  ┌─────────────────┐                               │ CASCADE DELETE                       │
│  │tracker_sightings│                               ▼                                      │
│  │─────────────────│                      ┌─────────────────────┐                        │
│  │ id (PK)         │                      │ decrypted_locations │                        │
│  │ user_id (FK)────┼──► CASCADE           │─────────────────────│                        │
│  │ identifier_hash │                      │ id (PK)             │                        │
│  │ latitude        │                      │ device_id (FK)──────┼──► registered_devices  │
│  │ longitude       │                      │ latitude            │                        │
│  │ seen_at         │                      │ longitude           │                        │
│  └─────────────────┘                      │ accuracy            │                        │
│                                           │ address             │                        │
│                                           │ timestamp           │                        │
│                                           │ created_at          │                        │
│                                           └─────────────────────┘                        │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              STANDALONE TABLE (NO FKs)                                    │
│                                                                                           │
│  ┌─────────────────────┐                                                                 │
│  │  location_reports   │  ◄── Crowd-sourced encrypted reports from Find My network       │
│  │─────────────────────│                                                                 │
│  │ id (PK)             │      No FK to registered_devices because:                       │
│  │ identifier_hash     │      1. Reports come from anonymous network devices             │
│  │ encrypted_payload   │      2. Identifier rotates every 15 minutes                     │
│  │ reporter_region     │      3. Server cannot correlate hash to device (privacy)        │
│  │ created_at          │                                                                 │
│  └─────────────────────┘                                                                 │
│                                                                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Complete Table Definitions

#### 1. users

The central user account table that all other user-owned data references.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique user identifier |
| `email` | `VARCHAR(255)` | `UNIQUE NOT NULL` | Login email, used for authentication |
| `password_hash` | `VARCHAR(255)` | `NOT NULL` | Bcrypt-hashed password |
| `name` | `VARCHAR(100)` | `NOT NULL` | Display name shown in UI |
| `role` | `VARCHAR(20)` | `DEFAULT 'user' CHECK (role IN ('user', 'admin'))` | Access control role |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | Account creation timestamp |
| `updated_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | Last profile update |

```sql
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

#### 2. registered_devices

Devices (AirTags, iPhones, MacBooks, etc.) registered to a user's account.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique device identifier |
| `user_id` | `UUID` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Owner of the device |
| `device_type` | `VARCHAR(50)` | `NOT NULL CHECK (...)` | Type: airtag, iphone, macbook, ipad, airpods |
| `name` | `VARCHAR(100)` | `NOT NULL` | User-assigned name (e.g., "Keys", "Backpack") |
| `emoji` | `VARCHAR(10)` | `DEFAULT '📍'` | Icon shown on map markers |
| `master_secret` | `VARCHAR(64)` | `NOT NULL` | Shared secret for key derivation (encrypted in production) |
| `current_period` | `INTEGER` | `DEFAULT 0` | Current key rotation period counter |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Whether device is actively tracked |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | Device registration timestamp |
| `updated_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | Last settings update |

```sql
CREATE TABLE IF NOT EXISTS registered_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_type VARCHAR(50) NOT NULL CHECK (device_type IN ('airtag', 'iphone', 'macbook', 'ipad', 'airpods')),
    name VARCHAR(100) NOT NULL,
    emoji VARCHAR(10) DEFAULT '📍',
    master_secret VARCHAR(64) NOT NULL,
    current_period INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_devices_user ON registered_devices(user_id);
CREATE INDEX idx_devices_active ON registered_devices(is_active);
```

**Index Strategy:**
- `idx_devices_user`: Optimizes "list all devices for user" query (O(log n) lookup)
- `idx_devices_active`: Optimizes filtering active devices for location polling

---

#### 3. location_reports

Encrypted location blobs from the crowd-sourced Find My network. This is the core privacy-preserving table.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | Auto-incrementing report ID (high volume) |
| `identifier_hash` | `VARCHAR(64)` | `NOT NULL` | SHA-256 hash of device's rotating BLE identifier |
| `encrypted_payload` | `JSONB` | `NOT NULL` | ECIES-encrypted location (ephemeralPubKey, iv, ciphertext, authTag) |
| `reporter_region` | `VARCHAR(10)` | nullable | Coarse region (e.g., "US-CA") for routing/sharding |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | When report was received |

```sql
CREATE TABLE IF NOT EXISTS location_reports (
    id BIGSERIAL PRIMARY KEY,
    identifier_hash VARCHAR(64) NOT NULL,
    encrypted_payload JSONB NOT NULL,
    reporter_region VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reports_identifier ON location_reports(identifier_hash);
CREATE INDEX idx_reports_time ON location_reports(created_at);
CREATE INDEX idx_reports_identifier_time ON location_reports(identifier_hash, created_at DESC);
```

**Index Strategy:**
- `idx_reports_identifier`: Fast lookup by identifier hash (primary query path)
- `idx_reports_time`: Supports time-based cleanup (DELETE WHERE created_at < 7 days ago)
- `idx_reports_identifier_time`: Compound index for "latest reports for identifier" query

**Why No FK to registered_devices:**
This table has NO foreign key to `registered_devices` by design:
1. **Privacy**: Server cannot correlate identifier_hash to a specific device
2. **Anonymity**: Reports come from random network devices, not the owner
3. **Key Rotation**: Identifier changes every 15 minutes; no stable device reference exists
4. **Decryption**: Only the owner (with master_secret) can derive which reports belong to their device

---

#### 4. lost_mode

Settings for lost mode, linked 1:1 with a registered device.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `device_id` | `UUID` | `PRIMARY KEY REFERENCES registered_devices(id) ON DELETE CASCADE` | The device in lost mode |
| `enabled` | `BOOLEAN` | `DEFAULT FALSE` | Whether lost mode is active |
| `contact_phone` | `VARCHAR(50)` | nullable | Phone number to display when found |
| `contact_email` | `VARCHAR(200)` | nullable | Email to display when found |
| `message` | `TEXT` | nullable | Custom message (e.g., "If found, call...") |
| `notify_when_found` | `BOOLEAN` | `DEFAULT TRUE` | Send push notification when device is located |
| `enabled_at` | `TIMESTAMP WITH TIME ZONE` | nullable | When lost mode was enabled |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | Record creation timestamp |
| `updated_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | Last settings update |

```sql
CREATE TABLE IF NOT EXISTS lost_mode (
    device_id UUID PRIMARY KEY REFERENCES registered_devices(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT FALSE,
    contact_phone VARCHAR(50),
    contact_email VARCHAR(200),
    message TEXT,
    notify_when_found BOOLEAN DEFAULT TRUE,
    enabled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Design Decision - 1:1 Relationship:**
- `device_id` is both the PRIMARY KEY and FK, enforcing exactly one lost_mode record per device
- Separate table (vs. columns on registered_devices) allows NULL-able lost mode settings without nullable columns on the device table
- Cleaner separation of concerns: device metadata vs. lost mode state

---

#### 5. notifications

User notifications for device events (found, unknown tracker, low battery, system).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Unique notification ID |
| `user_id` | `UUID` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Notification recipient |
| `device_id` | `UUID` | `REFERENCES registered_devices(id) ON DELETE SET NULL` | Related device (may be null) |
| `type` | `VARCHAR(50)` | `NOT NULL CHECK (...)` | Type: device_found, unknown_tracker, low_battery, system |
| `title` | `VARCHAR(200)` | `NOT NULL` | Notification title |
| `message` | `TEXT` | nullable | Notification body |
| `is_read` | `BOOLEAN` | `DEFAULT FALSE` | Whether user has seen it |
| `data` | `JSONB` | nullable | Extra payload (e.g., location, sighting count) |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | When notification was created |

```sql
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES registered_devices(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('device_found', 'unknown_tracker', 'low_battery', 'system')),
    title VARCHAR(200) NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
```

**Index Strategy:**
- `idx_notifications_user`: Fast lookup of all notifications for a user
- `idx_notifications_unread`: Partial index for unread notifications only (smaller, faster)

**Why SET NULL on device_id:**
- Notifications should persist even if the device is deleted
- Historical record: "Your AirTag was found at X" remains useful
- User can still see past notifications in their history

---

#### 6. tracker_sightings

Anti-stalking data: unknown trackers seen traveling with the user.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | Auto-incrementing sighting ID |
| `user_id` | `UUID` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who detected the tracker |
| `identifier_hash` | `VARCHAR(64)` | `NOT NULL` | Hash of the unknown tracker's BLE identifier |
| `latitude` | `DECIMAL(10, 8)` | `NOT NULL` | Sighting latitude (±90°, 8 decimal places = ~1mm precision) |
| `longitude` | `DECIMAL(11, 8)` | `NOT NULL` | Sighting longitude (±180°, 8 decimal places) |
| `seen_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | When the tracker was detected |

```sql
CREATE TABLE IF NOT EXISTS tracker_sightings (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    identifier_hash VARCHAR(64) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sightings_user_identifier ON tracker_sightings(user_id, identifier_hash);
CREATE INDEX idx_sightings_time ON tracker_sightings(seen_at);
```

**Index Strategy:**
- `idx_sightings_user_identifier`: Optimizes "all sightings of tracker X by user Y" for pattern detection
- `idx_sightings_time`: Supports time-windowed queries (e.g., last 3 hours)

---

#### 7. decrypted_locations

Cache of decrypted locations for the owner's map view.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | Auto-incrementing location ID |
| `device_id` | `UUID` | `NOT NULL REFERENCES registered_devices(id) ON DELETE CASCADE` | The tracked device |
| `latitude` | `DECIMAL(10, 8)` | `NOT NULL` | Decrypted latitude |
| `longitude` | `DECIMAL(11, 8)` | `NOT NULL` | Decrypted longitude |
| `accuracy` | `DECIMAL(10, 2)` | nullable | Location accuracy in meters |
| `address` | `TEXT` | nullable | Reverse-geocoded address |
| `timestamp` | `TIMESTAMP WITH TIME ZONE` | `NOT NULL` | Original report timestamp |
| `created_at` | `TIMESTAMP WITH TIME ZONE` | `DEFAULT NOW()` | When decrypted/cached |

```sql
CREATE TABLE IF NOT EXISTS decrypted_locations (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES registered_devices(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    accuracy DECIMAL(10, 2),
    address TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_decrypted_device ON decrypted_locations(device_id);
CREATE INDEX idx_decrypted_time ON decrypted_locations(device_id, timestamp DESC);
```

**Index Strategy:**
- `idx_decrypted_device`: Fast lookup of all locations for a device
- `idx_decrypted_time`: Compound index for "latest N locations for device" (ORDER BY timestamp DESC)

**Why This Table Exists:**
- **Performance**: Decryption is CPU-intensive; caching results avoids re-decryption
- **Denormalization**: Stores reverse-geocoded address to avoid repeated geocoding API calls
- **History**: Maintains location history even after location_reports are cleaned up (7-day TTL)

---

#### 8. session

Express session storage for authentication (connect-pg-simple).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `sid` | `VARCHAR` | `PRIMARY KEY COLLATE "default"` | Session ID |
| `sess` | `JSON` | `NOT NULL` | Serialized session data (contains user_id) |
| `expire` | `TIMESTAMP(6)` | `NOT NULL` | Session expiration time |

```sql
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (sid)
);

CREATE INDEX idx_session_expire ON session(expire);
```

**Index Strategy:**
- `idx_session_expire`: Supports periodic cleanup of expired sessions

---

### Foreign Key Relationships

| Parent Table | Child Table | FK Column | On Delete | Rationale |
|--------------|-------------|-----------|-----------|-----------|
| `users` | `registered_devices` | `user_id` | **CASCADE** | Device belongs to user; delete user = delete all their devices |
| `users` | `notifications` | `user_id` | **CASCADE** | Notifications are user-specific; delete user = delete notifications |
| `users` | `tracker_sightings` | `user_id` | **CASCADE** | Sightings are user-specific anti-stalking data |
| `registered_devices` | `lost_mode` | `device_id` | **CASCADE** | Lost mode settings are device-specific; delete device = delete settings |
| `registered_devices` | `notifications` | `device_id` | **SET NULL** | Preserve notification history even if device is removed |
| `registered_devices` | `decrypted_locations` | `device_id` | **CASCADE** | Cached locations are useless without the device |

**CASCADE vs SET NULL Decision Tree:**

```
Is the child record meaningful without the parent?
    │
    ├── NO → Use CASCADE (delete child when parent deleted)
    │   Examples:
    │   - registered_devices without user: meaningless
    │   - lost_mode without device: meaningless
    │   - decrypted_locations without device: meaningless
    │
    └── YES → Use SET NULL (preserve child, null the FK)
        Examples:
        - notifications without device: still useful as history
          "Your AirTag 'Keys' was found" → device deleted →
          notification still shows what happened
```

---

### Why Tables Are Structured This Way

#### 1. Separation of Encrypted and Decrypted Data

```
┌─────────────────────┐         ┌─────────────────────┐
│  location_reports   │         │ decrypted_locations │
│  (encrypted blobs)  │   ──►   │   (plain lat/lon)   │
│  No FK to devices   │ decrypt │  FK to device       │
└─────────────────────┘         └─────────────────────┘
```

**Rationale:**
- `location_reports` stores what the server receives from the network (encrypted, anonymous)
- `decrypted_locations` stores what the owner sees (decrypted by client or server with owner's key)
- This separation enforces privacy: server cannot JOIN reports to devices without the master_secret

#### 2. Anti-Stalking as Separate Table

`tracker_sightings` is separate from `location_reports` because:
- It's per-user (which user detected the tracker), not per-device
- It stores plaintext coordinates (user's location when detecting)
- It's used for pattern detection, not location retrieval
- Different retention policy (shorter for privacy)

#### 3. Lost Mode as 1:1 Table

Could have been columns on `registered_devices`, but:
- Avoids nullable columns for contact info on the device table
- Clearer domain separation (device identity vs. lost state)
- Easier to add lost mode features without altering device schema
- Allows future extension (e.g., lost mode history)

#### 4. BIGSERIAL for High-Volume Tables

Tables using `BIGSERIAL` instead of `UUID`:
- `location_reports`: Billions of reports, auto-increment is faster
- `tracker_sightings`: High volume per user
- `decrypted_locations`: Many locations per device

**Trade-off:**
- UUID: Globally unique, no central coordination, larger (16 bytes)
- BIGSERIAL: Compact (8 bytes), faster inserts, requires single-writer

#### 5. JSONB for Flexible Payloads

`encrypted_payload` and `data` columns use JSONB:
- Encrypted payload structure may evolve (new encryption schemes)
- Notification data varies by type (device_found has location, unknown_tracker has sighting count)
- PostgreSQL JSONB is indexable if needed later

---

### Data Flow for Key Operations

#### Operation 1: Submit Location Report (Crowd-Sourced Device)

When an iPhone detects an AirTag and reports its location:

```sql
-- 1. Insert encrypted report (no FK, no device lookup)
INSERT INTO location_reports (identifier_hash, encrypted_payload, reporter_region, created_at)
VALUES (
    'a1b2c3d4e5f6...',  -- SHA-256 of BLE identifier
    '{"ephemeralPubKey": "...", "iv": "...", "ciphertext": "...", "authTag": "..."}',
    'US-CA',
    NOW()
);

-- Note: Server cannot determine which device this belongs to
-- Only the owner (with master_secret) can derive the identifier_hash for their device
```

#### Operation 2: Retrieve Locations (Device Owner)

When owner opens the Find My app:

```sql
-- 1. Get device and master_secret
SELECT id, master_secret, current_period FROM registered_devices
WHERE user_id = $1 AND id = $2;

-- 2. Client derives all possible identifier_hashes for time range
-- (15-minute periods from start to end)
-- identifier_hash = SHA256(SHA256(publicKey derived from master_secret + period))

-- 3. Query for matching reports
SELECT id, identifier_hash, encrypted_payload, created_at
FROM location_reports
WHERE identifier_hash = ANY($1)  -- Array of possible hashes
  AND created_at BETWEEN $2 AND $3
ORDER BY created_at DESC;

-- 4. Client decrypts each payload with derived private key
-- 5. Cache decrypted results
INSERT INTO decrypted_locations (device_id, latitude, longitude, accuracy, timestamp)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT DO NOTHING;
```

#### Operation 3: Enable Lost Mode

```sql
-- 1. Upsert lost mode settings
INSERT INTO lost_mode (device_id, enabled, contact_phone, message, notify_when_found, enabled_at)
VALUES ($1, TRUE, $2, $3, TRUE, NOW())
ON CONFLICT (device_id) DO UPDATE SET
    enabled = TRUE,
    contact_phone = EXCLUDED.contact_phone,
    message = EXCLUDED.message,
    enabled_at = NOW(),
    updated_at = NOW();

-- 2. Create notification for confirmation
INSERT INTO notifications (user_id, device_id, type, title, message, data)
VALUES (
    $1, $2, 'system',
    'Lost Mode Enabled',
    'You will be notified when your device is found.',
    '{"enabled_at": "2024-01-15T10:30:00Z"}'
);
```

#### Operation 4: Detect Unknown Tracker (Anti-Stalking)

```sql
-- 1. Record sighting
INSERT INTO tracker_sightings (user_id, identifier_hash, latitude, longitude, seen_at)
VALUES ($1, $2, $3, $4, NOW());

-- 2. Check for stalking pattern (3+ sightings in 3 hours)
SELECT COUNT(*),
       MIN(seen_at) as first_seen,
       MAX(seen_at) as last_seen,
       array_agg(ARRAY[latitude::text, longitude::text]) as locations
FROM tracker_sightings
WHERE user_id = $1
  AND identifier_hash = $2
  AND seen_at > NOW() - INTERVAL '3 hours';

-- 3. If pattern detected, create alert
INSERT INTO notifications (user_id, type, title, message, data)
VALUES (
    $1,
    'unknown_tracker',
    'Unknown AirTag Detected',
    'An AirTag has been traveling with you for over an hour.',
    '{"identifier_hash": "...", "sighting_count": 5, "first_seen": "...", "last_seen": "..."}'
);
```

#### Operation 5: Delete User Account (GDPR Compliance)

```sql
-- Single DELETE cascades to all user data
DELETE FROM users WHERE id = $1;

-- CASCADE automatically deletes:
-- - registered_devices (and their lost_mode, decrypted_locations)
-- - notifications
-- - tracker_sightings
-- - sessions (via application logic, not FK)

-- location_reports are NOT deleted (they have no FK to user)
-- This is by design: reports are anonymous and cannot be attributed to a user
```

---

### Index Summary

| Table | Index | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| `registered_devices` | `idx_devices_user` | `user_id` | B-tree | List devices by user |
| `registered_devices` | `idx_devices_active` | `is_active` | B-tree | Filter active devices |
| `location_reports` | `idx_reports_identifier` | `identifier_hash` | B-tree | Primary lookup path |
| `location_reports` | `idx_reports_time` | `created_at` | B-tree | Time-based cleanup |
| `location_reports` | `idx_reports_identifier_time` | `(identifier_hash, created_at DESC)` | Compound | Latest reports by identifier |
| `notifications` | `idx_notifications_user` | `user_id` | B-tree | User's notifications |
| `notifications` | `idx_notifications_unread` | `(user_id, is_read)` | Partial (WHERE is_read = FALSE) | Unread count badge |
| `tracker_sightings` | `idx_sightings_user_identifier` | `(user_id, identifier_hash)` | Compound | Pattern detection |
| `tracker_sightings` | `idx_sightings_time` | `seen_at` | B-tree | Time-windowed queries |
| `decrypted_locations` | `idx_decrypted_device` | `device_id` | B-tree | Device's locations |
| `decrypted_locations` | `idx_decrypted_time` | `(device_id, timestamp DESC)` | Compound | Latest locations |
| `session` | `idx_session_expire` | `expire` | B-tree | Session cleanup |

---

### Normalization Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `lost_mode` as separate table | Normalized (1:1) | Avoids nullable columns on device; cleaner domain separation |
| `address` in `decrypted_locations` | Denormalized | Avoids repeated geocoding API calls; address is derived, not source data |
| `encrypted_payload` as JSONB | Semi-structured | Payload format may evolve; JSONB allows schema flexibility |
| `emoji` in `registered_devices` | Denormalized | Simple string, no need for separate emoji table |
| `location_reports` standalone | Intentionally unlinked | Privacy requirement: server cannot correlate reports to devices |

---

## Key Design Decisions

### 1. End-to-End Encryption

**Decision**: Apple cannot decrypt location reports

**Rationale**:
- Maximum privacy protection
- Apple isn't liability for location data
- User maintains full control

### 2. Rotating Identifiers

**Decision**: Change BLE identifier every 15 minutes

**Rationale**:
- Prevents tracking by third parties
- Owner can still correlate
- Balance privacy vs. battery

### 3. Anti-Stalking by Default

**Decision**: Alert users to unknown trackers

**Rationale**:
- Prevent misuse
- Proactive safety
- Balance utility vs. abuse potential

---

## Consistency and Idempotency Semantics

### Write Semantics by Operation

| Operation | Consistency | Idempotency | Rationale |
|-----------|-------------|-------------|-----------|
| Location Report | Eventual | Idempotent (dedupe by hash) | High volume, duplicates harmless |
| Device Registration | Strong | Idempotent (upsert by device_id) | Critical user data |
| Lost Mode Toggle | Strong | Idempotent (last-write-wins) | User expects immediate effect |
| Anti-Stalking Alert | Eventual | At-least-once | Missing alert is worse than duplicate |

### Location Report Handling

Location reports are the highest-volume write operation. We use **eventual consistency** with idempotent processing:

```javascript
// Location reports use composite key for deduplication
async function submitLocationReport(report) {
  // Generate idempotency key from content hash
  const idempotencyKey = crypto.createHash('sha256')
    .update(report.identifierHash)
    .update(report.timestamp.toString())
    .update(report.encryptedPayload)
    .digest('hex')
    .slice(0, 32)

  // Upsert with conflict handling
  await db.query(`
    INSERT INTO location_reports (id, identifier_hash, encrypted_payload, created_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING  -- Ignore duplicate submissions
  `, [idempotencyKey, report.identifierHash, report.encryptedPayload, new Date(report.timestamp)])
}
```

### Replay and Conflict Resolution

**Replay Handling:**
- Reports older than 7 days are rejected at API gateway (prevents replay attacks)
- Timestamp tolerance of +/- 5 minutes for clock drift
- Duplicate detection window: 24 hours (reports with same idempotency key ignored)

**Conflict Resolution Strategy:**
- **Location Reports**: No conflict - duplicates are discarded, all unique reports are stored
- **Device Registration**: Last-write-wins with `updated_at` timestamp; frontend shows optimistic update
- **Lost Mode**: Last-write-wins; toggle operations include client timestamp for ordering

```javascript
// Lost mode uses optimistic locking with version check
async function toggleLostMode(deviceId, enabled, clientVersion) {
  const result = await db.query(`
    UPDATE lost_mode
    SET enabled = $1, enabled_at = NOW(), version = version + 1
    WHERE device_id = $2 AND version = $3
    RETURNING version
  `, [enabled, deviceId, clientVersion])

  if (result.rowCount === 0) {
    throw new ConflictError('Lost mode was modified by another session')
  }
  return result.rows[0].version
}
```

### Local Development Setup

For local testing, run PostgreSQL with synchronous commits enabled (default) to observe strong consistency:

```bash
# Verify synchronous commits in psql
SHOW synchronous_commit;  -- Should be 'on'

# Test idempotency by submitting same report twice
curl -X POST http://localhost:3001/api/v1/reports \
  -H "Content-Type: application/json" \
  -d '{"identifierHash":"abc123","encryptedPayload":"...","timestamp":1700000000000}'
# Second identical request should return 200 but not create duplicate
```

---

## Caching and Edge Strategy

### Cache Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Mobile    │───▶│    CDN      │───▶│   Valkey    │───▶│ PostgreSQL  │
│   Client    │    │  (Static)   │    │   (Cache)   │    │  (Source)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### Cache Layers

| Layer | What's Cached | TTL | Strategy |
|-------|---------------|-----|----------|
| CDN | Static assets, map tiles | 24 hours | Cache-Control headers |
| Valkey L1 | User's device list | 5 minutes | Cache-aside |
| Valkey L2 | Location report lookups | 15 minutes | Cache-aside with write-through hint |
| Local (client) | Recent locations | 1 minute | Stale-while-revalidate |

### Cache-Aside Pattern (Primary)

Used for device list and location queries where reads far exceed writes:

```javascript
class CacheAside {
  constructor(redis, db) {
    this.redis = redis
    this.db = db
  }

  async getDeviceList(userId) {
    const cacheKey = `devices:${userId}`

    // 1. Check cache first
    const cached = await this.redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached)
    }

    // 2. Cache miss - fetch from DB
    const devices = await this.db.query(
      'SELECT * FROM registered_devices WHERE user_id = $1',
      [userId]
    )

    // 3. Populate cache with TTL
    await this.redis.setex(cacheKey, 300, JSON.stringify(devices.rows)) // 5 min TTL

    return devices.rows
  }

  // Invalidate on write
  async registerDevice(userId, device) {
    await this.db.query('INSERT INTO registered_devices ...', [userId, device])
    await this.redis.del(`devices:${userId}`)  // Invalidate cache
  }
}
```

### Write-Through Pattern (Location Reports)

For location reports, we use write-through to pre-warm the cache for owner queries:

```javascript
async function submitAndCacheReport(report) {
  // 1. Write to database
  await db.query('INSERT INTO location_reports ...', [report])

  // 2. Append to cache (for owner's next query)
  const cacheKey = `reports:${report.identifierHash}`
  await redis.lpush(cacheKey, JSON.stringify(report))
  await redis.ltrim(cacheKey, 0, 99)  // Keep last 100 reports
  await redis.expire(cacheKey, 900)   // 15 min TTL (matches key rotation period)
}
```

### Cache Invalidation Rules

| Event | Invalidation Action |
|-------|---------------------|
| Device registered | Delete `devices:{userId}` |
| Device removed | Delete `devices:{userId}` |
| Lost mode toggled | Delete `lostmode:{deviceId}` |
| Key rotation (15 min) | Reports cache expires naturally (TTL = 15 min) |
| User logout | Delete all `*:{userId}` keys |

### Local Development with Valkey

```bash
# Start Valkey via Docker
docker run -d --name airtag-valkey -p 6379:6379 valkey/valkey:latest

# Or via Homebrew
brew install valkey && valkey-server

# Monitor cache operations in real-time
valkey-cli MONITOR

# Check cache hit rates
valkey-cli INFO stats | grep keyspace
```

### CDN Configuration (for Static Assets)

In local development, simulate CDN behavior with Express static middleware:

```javascript
// Simulate CDN cache headers for static assets
app.use('/static', express.static('public', {
  maxAge: '1d',  // Cache-Control: max-age=86400
  etag: true,
  lastModified: true
}))

// Map tiles and images
app.use('/tiles', express.static('tiles', {
  maxAge: '7d',
  immutable: true  // Cache-Control: immutable (content-addressed)
}))
```

---

## Async Queue Architecture (RabbitMQ)

### Queue Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RabbitMQ                                       │
│                                                                          │
│  ┌─────────────┐    ┌─────────────────────────────────────────────────┐ │
│  │  Exchange   │───▶│  location.reports (fanout to workers)           │ │
│  │  (topic)    │    └─────────────────────────────────────────────────┘ │
│  │             │    ┌─────────────────────────────────────────────────┐ │
│  │             │───▶│  antistalk.analyze (stalking pattern check)     │ │
│  │             │    └─────────────────────────────────────────────────┘ │
│  │             │    ┌─────────────────────────────────────────────────┐ │
│  │             │───▶│  notifications.push (alert delivery)            │ │
│  │             │    └─────────────────────────────────────────────────┘ │
│  │             │    ┌─────────────────────────────────────────────────┐ │
│  │             │───▶│  reports.cleanup (TTL expiration)               │ │
│  └─────────────┘    └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Queue Definitions

| Queue | Purpose | Delivery | Backpressure |
|-------|---------|----------|--------------|
| `location.reports` | Store encrypted location blobs | At-least-once | Prefetch = 100 |
| `antistalk.analyze` | Detect stalking patterns | At-least-once | Prefetch = 10 |
| `notifications.push` | Send alerts to users | At-least-once with retry | Prefetch = 50 |
| `reports.cleanup` | Expire old reports (7 days) | At-most-once | Prefetch = 1000 |

### Producer: Location Report Ingestion

```javascript
const amqp = require('amqplib')

class ReportProducer {
  async connect() {
    this.connection = await amqp.connect('amqp://guest:guest@localhost:5672')
    this.channel = await this.connection.createChannel()

    // Declare exchange and queues
    await this.channel.assertExchange('airtag.events', 'topic', { durable: true })
    await this.channel.assertQueue('location.reports', {
      durable: true,
      arguments: {
        'x-message-ttl': 7 * 24 * 60 * 60 * 1000,  // 7 days
        'x-max-length': 1000000  // Backpressure: max 1M messages
      }
    })
    await this.channel.bindQueue('location.reports', 'airtag.events', 'report.location.*')
  }

  async publishReport(report) {
    const message = Buffer.from(JSON.stringify(report))

    // Publish with persistence
    this.channel.publish('airtag.events', 'report.location.new', message, {
      persistent: true,
      messageId: report.idempotencyKey,  // For deduplication
      timestamp: Date.now()
    })
  }
}
```

### Consumer: Anti-Stalking Analysis (Background Job)

```javascript
class AntiStalkConsumer {
  async start() {
    const connection = await amqp.connect('amqp://guest:guest@localhost:5672')
    const channel = await connection.createChannel()

    // Backpressure: only process 10 messages at a time
    await channel.prefetch(10)

    await channel.assertQueue('antistalk.analyze', { durable: true })
    await channel.bindQueue('antistalk.analyze', 'airtag.events', 'report.location.*')

    channel.consume('antistalk.analyze', async (msg) => {
      try {
        const report = JSON.parse(msg.content.toString())
        await this.analyzeForStalking(report)
        channel.ack(msg)  // Acknowledge success
      } catch (err) {
        console.error('Analysis failed:', err)
        // Requeue with delay for retry (dead letter after 3 attempts)
        if (msg.fields.redelivered) {
          channel.nack(msg, false, false)  // Dead letter
        } else {
          channel.nack(msg, false, true)   // Requeue
        }
      }
    })
  }

  async analyzeForStalking(report) {
    // Fetch recent sightings for this identifier
    const sightings = await db.query(`
      SELECT * FROM location_reports
      WHERE identifier_hash = $1
      AND created_at > NOW() - INTERVAL '3 hours'
      ORDER BY created_at
    `, [report.identifierHash])

    // Run pattern detection (see AntiStalkingService above)
    if (this.detectStalkingPattern(sightings.rows)) {
      await this.publishAlert(report.identifierHash, sightings.rows)
    }
  }

  async publishAlert(identifierHash, sightings) {
    // Queue notification for delivery
    this.channel.publish('airtag.events', 'alert.stalking', Buffer.from(JSON.stringify({
      identifierHash,
      sightingCount: sightings.length,
      firstSeen: sightings[0].created_at,
      lastSeen: sightings[sightings.length - 1].created_at
    })), { persistent: true })
  }
}
```

### Backpressure and Flow Control

```javascript
// Monitor queue depth and apply backpressure at API layer
async function checkBackpressure() {
  const queueInfo = await channel.checkQueue('location.reports')

  if (queueInfo.messageCount > 500000) {
    // Shed load: reject new reports temporarily
    console.warn('Queue depth high, applying backpressure')
    return { accept: false, retryAfter: 60 }
  }

  if (queueInfo.messageCount > 100000) {
    // Slow down: add artificial delay
    console.warn('Queue depth elevated, slowing intake')
    return { accept: true, delay: 100 }
  }

  return { accept: true, delay: 0 }
}
```

### Delivery Semantics Summary

| Queue | Semantics | Handling |
|-------|-----------|----------|
| `location.reports` | At-least-once | Idempotent writes (ON CONFLICT DO NOTHING) |
| `antistalk.analyze` | At-least-once | Idempotent analysis (stateless check) |
| `notifications.push` | At-least-once | Dedupe in push service (1 hour window) |
| `reports.cleanup` | At-most-once | Acceptable to miss some (cron backup) |

### Local Development Setup

```bash
# Start RabbitMQ via Docker
docker run -d --name airtag-rabbitmq \
  -p 5672:5672 -p 15672:15672 \
  rabbitmq:3-management

# Or via Homebrew
brew install rabbitmq && brew services start rabbitmq

# Access management UI
open http://localhost:15672  # guest/guest

# Monitor queues from CLI
rabbitmqctl list_queues name messages consumers
```

### docker-compose.yml Addition

```yaml
services:
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

  valkey:
    image: valkey/valkey:latest
    ports:
      - "6379:6379"
    volumes:
      - valkey_data:/data

volumes:
  rabbitmq_data:
  valkey_data:
```

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Encryption | End-to-end | Server-side | Privacy |
| Key rotation | 15 minutes | Hourly | Privacy vs. battery |
| Anti-stalking | Proactive alerts | Manual check | Safety |
| Precision | UWB | BLE only | Accuracy |

---

## Implementation Notes

This section documents the backend implementation improvements and explains **WHY** each change makes the system more reliable, observable, and scalable.

### 1. Structured Logging with Pino

**What**: Replaced `console.log` with Pino structured JSON logging.

**Why This Improves the System**:

1. **Log Aggregation**: JSON logs are machine-parseable, enabling ingestion into ELK Stack, Splunk, or CloudWatch Logs. This allows searching across all server instances with a single query like `component:locationService AND level:error`.

2. **Request Correlation**: Each request gets a unique ID (`req.id`) that flows through all log entries. When investigating an issue, you can filter by request ID to see the complete request lifecycle across services.

3. **Performance**: Pino is 5x faster than Winston/Bunyan because it uses asynchronous I/O and avoids expensive string interpolation. In a high-throughput system processing 100k+ location reports/minute, logging overhead matters.

4. **Context Propagation**: Child loggers inherit parent context, so a log entry from `locationService` automatically includes `component: "locationService"` without manual annotation.

**Files**: `src/shared/logger.ts`, `src/index.ts`

```typescript
// Before (hard to search, no context)
console.error('Submit report error:', error);

// After (structured, searchable, with context)
log.error(
  { error, identifierHash: data.identifier_hash },
  'Failed to submit location report'
);
```

---

### 2. Prometheus Metrics for Observability

**What**: Added Prometheus metrics collection with a `/metrics` endpoint.

**Why This Improves the System**:

1. **SLO Monitoring**: Track the four golden signals (latency, traffic, errors, saturation). Example alert: "P99 latency > 200ms for 5 minutes" triggers before users notice degradation.

2. **Capacity Planning**: `location_reports_total` counter shows ingestion rate over time. If reports increase 10x during a product launch, you know to scale before saturation.

3. **Cache Efficiency**: `cache_operations_total{result="hit|miss"}` reveals cache hit rate. If hit rate drops below 80%, investigate TTL settings or cache invalidation bugs.

4. **Rate Limit Tuning**: `rate_limit_hits_total` shows how often limits are hit per endpoint. If auth limits trigger frequently, either increase limits or investigate credential stuffing attacks.

5. **Database Performance**: `db_query_duration_seconds` histogram with percentiles identifies slow queries. A query with P99 > 100ms is a candidate for indexing.

**Files**: `src/shared/metrics.ts`, `src/index.ts`

**Key Metrics**:
| Metric | Type | Purpose |
|--------|------|---------|
| `http_request_duration_seconds` | Histogram | Latency SLOs, percentile tracking |
| `location_reports_total` | Counter | Ingestion throughput, regional breakdown |
| `cache_operations_total` | Counter | Cache efficiency (hit/miss ratio) |
| `db_query_duration_seconds` | Histogram | Slow query detection |
| `rate_limit_hits_total` | Counter | Abuse detection, limit tuning |

---

### 3. Redis Caching with Cache-Aside Pattern

**What**: Added Redis caching for location queries and device lookups.

**Why This Improves the System**:

1. **Read Scalability**: Location queries involve: (1) device lookup, (2) identifier hash generation for time range, (3) report query, (4) decryption. Caching the final result eliminates all four steps for repeated queries.

2. **Latency Reduction**: Cache hit: ~1ms. Database query + decryption: ~50-200ms. For a user refreshing the map every 30 seconds, caching provides 50x latency improvement.

3. **Database Protection**: During "lost device" scenarios, users may refresh obsessively. Cache absorbs this traffic, protecting PostgreSQL from connection exhaustion.

4. **TTL Alignment**: Cache TTL (15 minutes) matches key rotation period. This ensures cached data expires around the same time new reports become available, balancing freshness vs. efficiency.

**Files**: `src/shared/cache.ts`, `src/services/locationService.ts`

**Cache Strategy**:
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Location Query │────▶│   Redis Check   │────▶│  PostgreSQL     │
│                 │     │   (1ms RTT)     │     │  (50-200ms)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         │     Cache HIT        │                       │
         │◀─────────────────────│                       │
         │                      │      Cache MISS       │
         │◀─────────────────────┼───────────────────────│
         │                      │                       │
         │                      │  Populate cache       │
         │                      │◀──────────────────────│
```

---

### 4. Idempotency for Location Report Submissions

**What**: Added idempotency layer using Redis to prevent duplicate location reports.

**Why This Improves the System**:

1. **Network Reliability**: Mobile devices on cellular networks experience packet loss. Clients retry failed requests, potentially creating duplicate reports. Idempotency ensures retries are safe.

2. **At-Least-Once Delivery**: When we add RabbitMQ for async processing, message redelivery is expected. Idempotent handlers ensure reports are processed exactly once.

3. **Replay Attack Prevention**: An attacker capturing a location report cannot replay it after 7 days (timestamp validation) or within 24 hours (duplicate detection).

4. **Consistent Responses**: Duplicate requests return the same response (same `report_id`), maintaining client-side invariants.

**Files**: `src/shared/idempotency.ts`, `src/services/locationService.ts`

**Idempotency Key Generation**:
```typescript
// Key = hash(identifier + timestamp_rounded + payload_hash)
// - Timestamp rounded to minute: handles clock drift
// - Payload hash: catches identical content
const idempotencyKey = generateIdempotencyKey(
  data.identifier_hash,
  timestamp,
  data.encrypted_payload
);
```

---

### 5. Rate Limiting for API Protection

**What**: Added Redis-backed rate limiting with different limits per endpoint.

**Why This Improves the System**:

1. **DoS Mitigation**: Without rate limits, a single client can exhaust database connections or CPU. Rate limits bound the damage from malicious or buggy clients.

2. **Fair Usage**: In a crowd-sourced network, one device shouldn't consume all server capacity. Rate limits ensure all devices get fair access.

3. **Brute Force Prevention**: Auth endpoint limit (10/min) makes password brute-forcing impractical. At 10 attempts/minute, testing 1000 passwords takes 100 minutes.

4. **Cost Control**: Each API request has a cost (compute, database, bandwidth). Rate limits prevent runaway costs from misconfigured clients or scrapers.

5. **Distributed Enforcement**: Redis-backed limits work across multiple server instances. A client can't bypass limits by hitting different servers.

**Files**: `src/shared/rateLimit.ts`, `src/index.ts`

**Rate Limit Tiers**:
| Endpoint | Limit | Rationale |
|----------|-------|-----------|
| Location Reports | 100/min | High throughput for crowd-sourced ingestion |
| Location Queries | 60/min | Normal user refresh rate (~1/min per device) |
| Authentication | 10/min | Prevent brute force attacks |
| Device Registration | 20/min | Setup-only, prevents device farming |
| Admin | 20/min | Sensitive operations, should be infrequent |

---

### 6. Comprehensive Health Checks

**What**: Added `/health/ready` endpoint that checks PostgreSQL and Redis connectivity.

**Why This Improves the System**:

1. **Kubernetes Integration**: Readiness probes determine if a pod should receive traffic. If Redis is down, the pod is marked unhealthy and removed from the load balancer.

2. **Rolling Deployments**: During deploys, new pods only receive traffic after dependencies are ready. This prevents 503 errors during startup.

3. **Graceful Degradation**: The health check reports "degraded" status if some (but not all) checks fail. This allows traffic to continue while alerting operators.

4. **Dependency Monitoring**: Health checks provide latency measurements for each dependency. Slow Redis response (>10ms) may indicate network issues or memory pressure.

**Files**: `src/shared/health.ts`, `src/index.ts`

**Health Check Endpoints**:
| Endpoint | Type | Use Case |
|----------|------|----------|
| `/health` | Shallow | Kubernetes liveness probe |
| `/health/live` | Shallow | Alias for liveness |
| `/health/ready` | Deep | Kubernetes readiness probe |
| `/metrics` | N/A | Prometheus scraping |

---

### 7. Shared Module Architecture

**What**: Organized infrastructure code into `src/shared/` with a barrel export.

**Why This Improves the System**:

1. **Separation of Concerns**: Business logic (services) is separate from infrastructure (logging, caching, metrics). Services import what they need from `shared/index.js`.

2. **Testability**: Shared modules can be mocked in unit tests. Services don't need real Redis or Prometheus connections during testing.

3. **Reusability**: When adding new services (e.g., anti-stalking worker), they import the same infrastructure. Consistent logging, metrics, and caching across all services.

4. **Configuration Centralization**: Cache TTLs, rate limits, and log levels are defined in one place. Changing a TTL affects all consumers.

**Directory Structure**:
```
src/shared/
├── index.ts       # Barrel export for all shared modules
├── logger.ts      # Pino structured logging
├── metrics.ts     # Prometheus metrics
├── cache.ts       # Redis caching with cache-aside
├── idempotency.ts # Duplicate request prevention
├── rateLimit.ts   # Rate limiting middleware
└── health.ts      # Health check endpoints
```

---

### Summary: Before vs. After

| Aspect | Before | After |
|--------|--------|-------|
| Logging | `console.log` (unstructured) | Pino JSON (structured, searchable) |
| Metrics | None | Prometheus (latency, throughput, errors) |
| Caching | None | Redis cache-aside (15-min TTL) |
| Idempotency | None | Redis-based duplicate detection (24h window) |
| Rate Limiting | None | Redis-backed, per-endpoint limits |
| Health Checks | Basic `/health` | Dependency-aware `/health/ready` |
| Error Handling | Generic 500 | Structured logging with context |

These changes transform the backend from a simple CRUD server into a production-ready service that can:
- Scale horizontally behind a load balancer
- Survive dependency failures gracefully
- Be monitored and alerted on via Grafana dashboards
- Handle network retries and duplicate submissions safely
- Protect itself from abuse and misconfigured clients
