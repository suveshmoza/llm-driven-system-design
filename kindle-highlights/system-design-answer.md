# Kindle Community Highlights - System Design Interview Answer

## Opening Statement (1 minute)

"I'll design a Kindle Community Highlights system - a social reading platform that enables users to highlight passages in books, sync highlights across devices in real-time, and discover popular highlights from the community.

The key challenges are: real-time multi-device synchronization with offline support, large-scale aggregation across millions of readers, and privacy-preserving social features that share community data without exposing individuals."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Highlight Management** - Create, edit, delete highlights with notes and colors
- **Cross-device Sync** - Real-time synchronization across Kindle, iOS, Android, Web
- **Community Discovery** - View popular/trending highlights in any book
- **Social Features** - Follow readers, share highlights, friends-only sharing
- **Export** - Export personal highlights to Markdown, CSV, or PDF

### Non-Functional Requirements
- **Sync Latency** - < 2 seconds cross-device propagation
- **Scale** - 10M users, 1B highlights, 100K highlight views/second
- **Availability** - 99.9% uptime
- **Privacy** - Community highlights are anonymized, opt-out available

### Scale Estimates
- 10M daily active users
- Average 50 highlights per user = 500M personal highlights
- 1B community highlights across all books
- 100K read QPS for popular highlights

## High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Devices                               │
│      Kindle | iOS App | Android App | Web Reader                 │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  Local DB     │  │  Sync Engine  │  │  UI Layer     │       │
│  │  (SQLite)     │  │  (WebSocket)  │  │               │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway                                  │
│              (Authentication, Rate Limiting)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Sync Service │    │  Highlight    │    │  Aggregation  │
│               │    │  Service      │    │  Service      │
│ - WebSocket   │    │               │    │               │
│ - Push sync   │    │ - CRUD ops    │    │ - Popular     │
│ - Conflict    │    │ - Search      │    │   highlights  │
│   resolution  │    │ - Export      │    │ - Trending    │
└───────────────┘    └───────────────┘    └───────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  PostgreSQL   │    │    Redis      │    │ Elasticsearch │
│               │    │               │    │               │
│ - Highlights  │    │ - Presence    │    │ - Search      │
│ - Users       │    │ - Sync state  │    │ - Full text   │
│ - Books       │    │ - Counters    │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

### Core Components

1. **Sync Service** - WebSocket-based real-time sync with conflict resolution
2. **Highlight Service** - CRUD operations, search, and export
3. **Aggregation Service** - Community highlights with anonymization
4. **Client Sync Engine** - Offline-first with local SQLite, operation queue

## Deep Dive: Real-time Sync System (8 minutes)

### The Challenge
Users read on multiple devices. A highlight created on Kindle should appear on their phone within seconds, even if the phone was offline.

### Sync Protocol

```javascript
class SyncService {
  constructor() {
    this.connections = new Map() // userId -> Set<WebSocket>
  }

  async handleConnection(ws, userId, deviceId) {
    // Register device
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set())
    }
    this.connections.get(userId).add(ws)

    // Send pending changes since last sync
    const lastSyncTime = await this.getLastSyncTime(userId, deviceId)
    const pendingChanges = await this.getChangesSince(userId, lastSyncTime)

    ws.send(JSON.stringify({
      type: 'sync_batch',
      changes: pendingChanges
    }))
  }

  async pushHighlight(userId, operation) {
    // Store in operation log (source of truth)
    await db.query(`
      INSERT INTO sync_operations
        (user_id, operation_type, entity_type, entity_id, data, timestamp)
      VALUES ($1, $2, 'highlight', $3, $4, NOW())
    `, [userId, operation.action, operation.highlight.id, JSON.stringify(operation)])

    // Push to all connected devices
    const connections = this.connections.get(userId) || new Set()
    for (const ws of connections) {
      ws.send(JSON.stringify({
        type: 'operation',
        operation
      }))
    }

    // Queue push notification for offline devices
    await this.queuePushNotification(userId, operation)
  }
}
```

### Conflict Resolution

Last-write-wins with user override for conflicts:

```javascript
async resolveConflict(localVersion, serverVersion) {
  // Compare timestamps
  if (localVersion.updatedAt > serverVersion.updatedAt) {
    // Local is newer - push to server
    return { winner: 'local', action: 'push' }
  } else if (localVersion.updatedAt < serverVersion.updatedAt) {
    // Server is newer - accept
    return { winner: 'server', action: 'accept' }
  } else {
    // Same timestamp - content-based merge or user choice
    if (localVersion.text !== serverVersion.text) {
      // Create conflict copy
      return { winner: 'both', action: 'fork' }
    }
    return { winner: 'server', action: 'accept' }
  }
}
```

### Offline Queue

```javascript
class OfflineQueue {
  async enqueue(operation) {
    await localDb.exec(`
      INSERT INTO pending_operations (id, operation, created_at)
      VALUES (?, ?, ?)
    `, [uuid(), JSON.stringify(operation), Date.now()])
  }

  async sync() {
    const pending = await localDb.query(`
      SELECT * FROM pending_operations ORDER BY created_at ASC
    `)

    for (const op of pending) {
      try {
        await api.pushOperation(JSON.parse(op.operation))
        await localDb.exec(`DELETE FROM pending_operations WHERE id = ?`, [op.id])
      } catch (e) {
        if (e.code === 'CONFLICT') {
          const resolved = await this.resolveConflict(op, e.serverVersion)
          // Handle resolution...
        }
        break // Stop on error, retry later
      }
    }
  }
}
```

## Deep Dive: Community Aggregation (7 minutes)

### The Challenge
Show "547 other readers highlighted this passage" without exposing who those readers are.

### Passage Normalization

Different devices report slightly different character positions. We normalize:

```javascript
function normalizePassage(bookId, text, locationStart, locationEnd) {
  // Create a fingerprint of the passage
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  // Hash for grouping similar highlights
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${bookId}:${normalized}`)
    .digest('hex')
    .substring(0, 16)

  return {
    fingerprint,
    normalized,
    // Keep original for display
    original: text
  }
}
```

### Real-time Counters with Redis

```javascript
class AggregationService {
  async incrementHighlightCount(bookId, fingerprint) {
    const key = `highlights:${bookId}:${fingerprint}`

    // Increment counter
    await redis.incr(key)

    // Add to book's sorted set (for "most highlighted")
    await redis.zincrby(`book:${bookId}:popular`, 1, fingerprint)

    // Expire after 30 days of inactivity (batch job refreshes active ones)
    await redis.expire(key, 30 * 24 * 60 * 60)
  }

  async getPopularHighlights(bookId, limit = 10) {
    // Get top passages by count
    const fingerprints = await redis.zrevrange(
      `book:${bookId}:popular`, 0, limit - 1, 'WITHSCORES'
    )

    // Fetch passage details
    const highlights = []
    for (let i = 0; i < fingerprints.length; i += 2) {
      const fingerprint = fingerprints[i]
      const count = parseInt(fingerprints[i + 1])

      // Get a representative highlight text
      const passage = await db.query(`
        SELECT highlighted_text, location_start, location_end
        FROM highlights
        WHERE book_id = $1 AND fingerprint = $2
        LIMIT 1
      `, [bookId, fingerprint])

      if (passage.rows[0]) {
        highlights.push({
          text: passage.rows[0].highlighted_text,
          count,
          location: {
            start: passage.rows[0].location_start,
            end: passage.rows[0].location_end
          }
        })
      }
    }

    return highlights
  }
}
```

### Batch Aggregation Job

Redis counters handle real-time, but we persist to PostgreSQL periodically:

```javascript
async function aggregationJob() {
  // Scan all book keys
  let cursor = '0'
  do {
    const [newCursor, keys] = await redis.scan(cursor, 'MATCH', 'book:*:popular', 'COUNT', 100)
    cursor = newCursor

    for (const key of keys) {
      const bookId = key.split(':')[1]
      const passages = await redis.zrangebyscore(key, 1, '+inf', 'WITHSCORES')

      for (let i = 0; i < passages.length; i += 2) {
        const fingerprint = passages[i]
        const count = parseInt(passages[i + 1])

        await db.query(`
          INSERT INTO highlight_aggregates (book_id, fingerprint, count, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (book_id, fingerprint)
          DO UPDATE SET count = $3, updated_at = NOW()
        `, [bookId, fingerprint, count])
      }
    }
  } while (cursor !== '0')
}
```

## Deep Dive: Privacy Controls (5 minutes)

### Per-User Privacy Settings

```javascript
const privacySettings = {
  community: {
    contributeToPopular: true,    // Include my highlights in aggregates
    showMyHighlightsToFollowers: false,
    allowFriendRequests: true
  },
  sync: {
    syncNotes: true,              // Sync personal notes
    syncHighlights: true
  },
  export: {
    includeNotes: true,
    includeTimestamps: false
  }
}
```

### Anonymized Aggregation

```javascript
async function contributeToAggregate(userId, highlight) {
  // Check user's privacy setting
  const settings = await getPrivacySettings(userId)

  if (!settings.community.contributeToPopular) {
    return // Don't include in community data
  }

  // Only contribute the fingerprint and count - no user data
  await aggregationService.incrementHighlightCount(
    highlight.bookId,
    highlight.fingerprint
  )
  // userId is NOT stored in aggregate tables
}
```

### Friends-Only Sharing

```javascript
async function getSharedHighlights(requesterId, targetUserId) {
  // Check relationship
  const friendship = await db.query(`
    SELECT * FROM friendships
    WHERE user_id = $1 AND friend_id = $2 AND status = 'accepted'
  `, [requesterId, targetUserId])

  if (!friendship.rows[0]) {
    throw new ForbiddenError('Not friends')
  }

  // Check target's privacy settings
  const settings = await getPrivacySettings(targetUserId)
  if (!settings.community.showMyHighlightsToFollowers) {
    return [] // User doesn't share with followers
  }

  // Return only public highlights (not private notes)
  return await db.query(`
    SELECT id, book_id, highlighted_text, created_at
    FROM highlights
    WHERE user_id = $1 AND is_private = false
    ORDER BY created_at DESC
    LIMIT 50
  `, [targetUserId])
}
```

## Trade-offs and Alternatives (5 minutes)

### 1. Sync Protocol: WebSocket vs Polling
**Chose: WebSocket**
- Pro: Real-time, low latency, bidirectional
- Con: Connection management, reconnection logic
- Alternative: Long polling (simpler but higher latency)

### 2. Conflict Resolution: Last-Write-Wins vs CRDT
**Chose: Last-Write-Wins with conflict detection**
- Pro: Simple, works for most cases
- Con: Can lose data in rare conflicts
- Alternative: CRDTs (complex but conflict-free)

### 3. Aggregation: Real-time vs Batch
**Chose: Hybrid (Redis real-time + PostgreSQL batch)**
- Pro: Fast reads, accurate over time
- Con: Slight inconsistency during batch windows
- Alternative: Pure streaming (Kafka + Flink) for exact counts

### 4. Storage: Single DB vs Sharding
**Chose: PostgreSQL with book-based sharding**
- Pro: Simple queries within a book
- Con: Cross-book queries require fan-out
- Alternative: DynamoDB (managed scaling) or Cassandra (write-heavy)

### 5. Privacy: Opt-out vs Opt-in
**Chose: Opt-out (contribute by default)**
- Pro: More community data, better popular highlights
- Con: Some users may not realize they're contributing
- Alternative: Opt-in (fewer contributions, clearer consent)

## Potential Improvements

1. **Reading Insights** - Analytics on reading patterns and highlight trends
2. **AI Summaries** - Generate book summaries from popular highlights
3. **Highlight Recommendations** - "Readers who highlighted this also highlighted..."
4. **Collaborative Annotations** - Book clubs with shared annotations
5. **Author Dashboard** - Show authors which passages resonate

## Closing Summary (1 minute)

"The Kindle Community Highlights system is built around three pillars:

1. **Real-time sync** using WebSocket with offline queue and conflict resolution
2. **Scalable aggregation** using Redis for real-time counts and PostgreSQL for persistence
3. **Privacy-first design** with anonymized aggregates and per-user controls

Key trade-offs include using last-write-wins for simplicity over CRDTs, and hybrid real-time/batch aggregation for the balance of speed and accuracy. The system scales by sharding on book_id and caching popular highlights aggressively."
