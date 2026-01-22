# Spotify - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Introduction (2 minutes)

"Thank you. Today I'll design Spotify, a music streaming platform. As a backend engineer, I'll focus on the core challenges of audio delivery at scale, recommendation engine architecture, and playback analytics for royalty attribution.

The key backend challenges are:
1. CDN-based audio streaming with signed URLs and adaptive bitrate
2. Hybrid recommendation engine using collaborative and content-based filtering
3. Event streaming for accurate playback analytics
4. Idempotent operations for reliable playlist management

Let me start by clarifying the requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our core product:

1. **Streaming**: Play music with adaptive bitrate based on network quality
2. **Library**: Browse artists, albums, songs with search
3. **Playlists**: Create, manage, and share playlists (including collaborative)
4. **Discovery**: Personalized recommendations - Discover Weekly, Daily Mixes
5. **Offline**: Download music for offline listening with DRM

From a backend perspective, streaming and recommendations are the most technically interesting."

### Non-Functional Requirements

"For scale and performance:

- **Playback Start Latency**: Under 200ms from tap to audio playing
- **Availability**: 99.99% for the streaming service
- **Scale**: 500 million users, 100 million songs in the catalog
- **Audio Quality**: Up to 320 kbps for premium users
- **Analytics**: Accurate stream counting for royalty payments"

---

## High-Level Design (8 minutes)

### Architecture Overview

```
                              ┌─────────────────────────┐
                              │         CDN             │
                              │   (Audio + Album Art)   │
                              └───────────▲─────────────┘
                                          │
┌──────────────────────────────────────────────────────────────────┐
│                          API Gateway                              │
│            (Rate Limiting, Auth, Request Routing)                 │
└──────────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  Catalog Service  │ │ Playback Service  │ │   Rec Service     │
│                   │ │                   │ │                   │
│ - Artists CRUD    │ │ - Signed URLs     │ │ - Discover Weekly │
│ - Albums CRUD     │ │ - Play state sync │ │ - Daily Mixes     │
│ - Track metadata  │ │ - Device handoff  │ │ - Similar tracks  │
│ - Search indexing │ │ - Stream counting │ │ - Radio stations  │
└─────────┬─────────┘ └─────────┬─────────┘ └─────────┬─────────┘
          │                     │                     │
          ▼                     ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                         Data Layer                                │
├──────────────────┬─────────────────┬────────────────────────────┤
│    PostgreSQL    │     Valkey      │    Feature Store + ML      │
│                  │                 │                            │
│ - Catalog data   │ - Sessions      │ - User embeddings (128d)   │
│ - Playlists      │ - Rate limits   │ - Track embeddings (128d)  │
│ - User library   │ - Idempotency   │ - Listening history        │
│ - Audit logs     │ - Stream URLs   │ - Vector similarity (ANN)  │
└──────────────────┴─────────────────┴────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │       Kafka         │
                    │  (Playback Events)  │
                    └─────────────────────┘
```

### Service Boundaries

"Three main services:

**Catalog Service**: Manages the music library - artists, albums, tracks, and their metadata. This is read-heavy with relatively infrequent updates from label ingestion pipelines.

**Playback Service**: Handles streaming requests. Generates signed URLs for CDN, tracks play state across devices, and collects analytics for royalties. This is the hot path.

**Recommendation Service**: Powers Discover Weekly, Radio, and similar artist features. Uses ML models with a feature store for user and track embeddings."

---

## Deep Dive: Database Schema (10 minutes)

### Core Tables

```sql
-- Artists with denormalized monthly listeners
CREATE TABLE artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  bio TEXT,
  image_url VARCHAR(500),
  verified BOOLEAN DEFAULT FALSE,
  monthly_listeners INTEGER DEFAULT 0,  -- Denormalized, updated hourly
  created_at TIMESTAMP DEFAULT NOW()
);

-- Albums linked to artists
CREATE TABLE albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID REFERENCES artists(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  release_date DATE,
  cover_url VARCHAR(500),
  album_type VARCHAR(20) CHECK (album_type IN ('album', 'single', 'ep', 'compilation')),
  total_tracks INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_albums_artist ON albums(artist_id);
CREATE INDEX idx_albums_release ON albums(release_date DESC);

-- Tracks with audio features for ML
CREATE TABLE tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id UUID REFERENCES albums(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  duration_ms INTEGER NOT NULL,
  track_number INTEGER,
  disc_number INTEGER DEFAULT 1,
  explicit BOOLEAN DEFAULT FALSE,
  preview_url VARCHAR(500),
  stream_count BIGINT DEFAULT 0,
  audio_features JSONB,  -- tempo, energy, danceability, acousticness
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_tracks_album ON tracks(album_id);
CREATE INDEX idx_tracks_stream_count ON tracks(stream_count DESC);

-- Playlists with collaborative support
CREATE TABLE playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  cover_url VARCHAR(500),
  is_public BOOLEAN DEFAULT TRUE,
  is_collaborative BOOLEAN DEFAULT FALSE,
  follower_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_playlists_owner ON playlists(owner_id);

-- Playlist tracks with position ordering
CREATE TABLE playlist_tracks (
  playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
  track_id UUID REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);

-- User library (polymorphic saves)
CREATE TABLE user_library (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  item_type VARCHAR(20) CHECK (item_type IN ('track', 'album', 'artist', 'playlist')),
  item_id UUID NOT NULL,
  saved_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX idx_user_library_type ON user_library(user_id, item_type, saved_at DESC);

-- Listening history for recommendations
CREATE TABLE listening_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  track_id UUID REFERENCES tracks(id) ON DELETE CASCADE,
  played_at TIMESTAMP DEFAULT NOW(),
  duration_played_ms INTEGER,
  completed BOOLEAN DEFAULT FALSE,
  context_type VARCHAR(20),  -- 'playlist', 'album', 'artist', 'search'
  context_id UUID
);
CREATE INDEX idx_listening_user_time ON listening_history(user_id, played_at DESC);

-- Playback events for royalty attribution
CREATE TABLE playback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  track_id UUID REFERENCES tracks(id),
  event_type VARCHAR(20) CHECK (event_type IN ('start', 'progress', 'complete', 'skip', 'seek')),
  position_ms INTEGER,
  device_type VARCHAR(20),
  timestamp TIMESTAMP DEFAULT NOW(),
  idempotency_key VARCHAR(100) UNIQUE  -- Prevents duplicate stream counts
);
CREATE INDEX idx_playback_track ON playback_events(track_id, timestamp);
CREATE INDEX idx_playback_user ON playback_events(user_id, timestamp);
```

### Audio Features JSONB Structure

```json
{
  "tempo": 120.0,
  "energy": 0.85,
  "danceability": 0.72,
  "acousticness": 0.15,
  "valence": 0.65,
  "speechiness": 0.04,
  "instrumentalness": 0.02,
  "liveness": 0.12,
  "loudness": -5.2,
  "key": 7,
  "mode": 1,
  "time_signature": 4
}
```

"Audio features are extracted during track ingestion and stored as JSONB for flexible querying. This powers content-based recommendations."

---

## Deep Dive: Audio Streaming Architecture (10 minutes)

### Adaptive Bitrate Encoding

"Audio files are encoded at multiple quality levels during ingestion:

```
Track 123:
├── track_123_96kbps.ogg    (Low quality, mobile data)
├── track_123_160kbps.ogg   (Normal quality)
├── track_123_320kbps.ogg   (High quality, premium only)
```

Unlike video ABR which switches mid-stream, audio typically picks quality at start. Songs are short enough that mid-stream switching adds complexity without significant benefit."

### Signed URL Generation

```javascript
async function getStreamUrl(trackId, userId) {
  // 1. Check subscription level
  const user = await redis.hgetall(`user:${userId}`)
  const maxQuality = user.isPremium === 'true' ? 320 : 160

  // 2. Determine quality based on client-reported network
  const quality = determineQuality(req.headers['x-connection-type'], maxQuality)

  // 3. Generate signed URL with expiry
  const expiresAt = Math.floor(Date.now() / 1000) + 3600  // 1 hour
  const signature = crypto
    .createHmac('sha256', CDN_SECRET)
    .update(`${trackId}/${quality}/${userId}/${expiresAt}`)
    .digest('hex')

  const url = `${CDN_BASE}/tracks/${trackId}_${quality}kbps.ogg?` +
    `user=${userId}&expires=${expiresAt}&sig=${signature}`

  // 4. Cache URL for quick retry (short TTL)
  await redis.setex(`stream:${userId}:${trackId}`, 300, url)

  return { url, quality, expiresAt: expiresAt * 1000 }
}
```

### CDN Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Origin Storage (S3/MinIO)                 │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│   │ 96kbps  │  │ 160kbps │  │ 320kbps │  │ Album   │       │
│   │ Tracks  │  │ Tracks  │  │ Tracks  │  │  Art    │       │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    CDN Edge Network                          │
│                                                              │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐          │
│  │ NYC  │  │ LAX  │  │ LDN  │  │ TYO  │  │ SYD  │  ...     │
│  │ POP  │  │ POP  │  │ POP  │  │ POP  │  │ POP  │          │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘          │
└─────────────────────────────────────────────────────────────┘
```

"Popular tracks have 90%+ cache hit rate at edge locations. The CDN validates signed URLs before serving, rejecting expired or invalid signatures."

---

## Deep Dive: Recommendation Engine (8 minutes)

### Hybrid Approach

"We combine two recommendation strategies:

**Collaborative Filtering**: 'Users like you also listened to X'
- Find users with similar listening patterns
- Recommend what they listen to that you haven't

**Content-Based Filtering**: 'Because this sounds like what you like'
- Analyze audio features: tempo, energy, acousticness
- Recommend tracks with similar characteristics"

### Track Embeddings

```typescript
interface TrackEmbedding {
  trackId: string
  embedding: number[]  // 128 dimensions
  // Derived from:
  // - Audio features (tempo, energy, danceability)
  // - Genre tags
  // - User interaction patterns
  // - Co-occurrence in playlists
}
```

### Discover Weekly Generation

```javascript
async function generateDiscoverWeekly(userId) {
  // 1. Get user's listening history (last 28 days)
  const history = await db.query(`
    SELECT track_id, COUNT(*) as plays,
           AVG(CASE WHEN completed THEN 1.0 ELSE 0.5 END) as engagement
    FROM listening_history
    WHERE user_id = $1 AND played_at > NOW() - INTERVAL '28 days'
    GROUP BY track_id
  `, [userId])

  const historyTrackIds = history.rows.map(r => r.track_id)

  // 2. Collaborative: Find similar users, get their tracks
  const userEmbedding = await featureStore.getUserEmbedding(userId)
  const similarUsers = await vectorDb.query({
    vector: userEmbedding,
    topK: 100,
    filter: { userId: { $ne: userId } }
  })

  const collaborativeTracks = await getTopTracksFromUsers(
    similarUsers.map(u => u.userId),
    { exclude: historyTrackIds, limit: 50 }
  )

  // 3. Content-based: Find similar-sounding tracks
  const likedTracks = history.rows.filter(h => h.engagement > 0.7)
  const likedEmbeddings = await featureStore.getTrackEmbeddings(
    likedTracks.map(t => t.track_id)
  )
  const avgEmbedding = averageEmbeddings(likedEmbeddings)

  const contentBasedTracks = await vectorDb.query({
    vector: avgEmbedding,
    topK: 50,
    filter: { trackId: { $nin: historyTrackIds } }
  })

  // 4. Blend results (60% collaborative, 40% content)
  const blended = blendResults(collaborativeTracks, contentBasedTracks, 0.6)

  // 5. Diversify (avoid too many from same artist)
  const diversified = diversify(blended, { maxPerArtist: 2, totalCount: 30 })

  // 6. Cache the result (regenerate weekly)
  await redis.setex(
    `discover_weekly:${userId}`,
    7 * 24 * 3600,
    JSON.stringify(diversified)
  )

  return diversified
}
```

---

## Deep Dive: Playback Analytics (5 minutes)

### Stream Counting for Royalties

"Accurate play counts are critical for royalty payments. Industry standard: 30 seconds of playback OR 50% of track duration (whichever is less)."

```javascript
// Client reports playback events
async function handlePlaybackEvent(event) {
  const { userId, trackId, eventType, position, idempotencyKey } = event

  // Idempotency check - prevent duplicate stream counts
  const processed = await redis.get(`playback:${idempotencyKey}`)
  if (processed) return { deduplicated: true }

  // Atomic set with NX flag
  const acquired = await redis.set(
    `playback:${idempotencyKey}`,
    'processing',
    'NX', 'EX', 86400  // 24 hour TTL
  )
  if (!acquired) return { deduplicated: true }

  // Send to Kafka for async processing
  await kafka.send('playback_events', {
    userId,
    trackId,
    eventType,
    position,
    timestamp: Date.now(),
    idempotencyKey
  })

  return { success: true }
}

// Kafka consumer processes stream counts
async function processPlaybackEvent(event) {
  if (event.eventType === 'progress' && event.position >= 30000) {
    // Count as a stream
    await db.query(`
      UPDATE tracks SET stream_count = stream_count + 1
      WHERE id = $1
    `, [event.trackId])

    // Record for royalty attribution
    await db.query(`
      INSERT INTO playback_events
        (user_id, track_id, event_type, position_ms, timestamp, idempotency_key)
      VALUES ($1, $2, 'stream_counted', $3, $4, $5)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [event.userId, event.trackId, event.position,
        new Date(event.timestamp), event.idempotencyKey])
  }
}
```

### Why Kafka?

"We process billions of playback events daily. Kafka provides:
- High throughput for event ingestion
- Durability - events aren't lost if a consumer is down
- Multiple consumers - analytics, royalties, recommendations all read from the same stream"

---

## Caching Strategy

### Multi-Layer Caching

```javascript
const CACHE_TTLS = {
  trackMetadata: 3600,      // 1 hour - rarely changes
  albumMetadata: 3600,      // 1 hour
  artistMetadata: 1800,     // 30 min - monthly listeners update
  userLibrary: 300,         // 5 min - user actions are frequent
  playlistTracks: 300,      // 5 min - collaborative edits
  streamUrl: 300,           // 5 min - quick retry
  discoverWeekly: 604800,   // 1 week - regenerated weekly
}

async function getTrack(trackId) {
  // Check cache first
  const cached = await redis.get(`track:${trackId}`)
  if (cached) {
    metrics.cacheHits.inc({ type: 'track' })
    return JSON.parse(cached)
  }

  // Miss - fetch from database
  metrics.cacheMisses.inc({ type: 'track' })
  const track = await db.query(`
    SELECT t.*, al.title as album_title, ar.name as artist_name
    FROM tracks t
    JOIN albums al ON t.album_id = al.id
    JOIN artists ar ON al.artist_id = ar.id
    WHERE t.id = $1
  `, [trackId])

  if (track.rows[0]) {
    await redis.setex(
      `track:${trackId}`,
      CACHE_TTLS.trackMetadata,
      JSON.stringify(track.rows[0])
    )
  }

  return track.rows[0]
}
```

---

## Rate Limiting

### Configuration by Endpoint

| Endpoint Category | Limit | Window | Scope |
|-------------------|-------|--------|-------|
| Auth (login/register) | 5 | 15 min | IP |
| Search | 60 | 1 min | User |
| Playback (stream URLs) | 300 | 1 min | User |
| Library writes | 100 | 1 min | User |
| Recommendations | 30 | 1 min | User |
| Admin endpoints | 1000 | 1 min | User |

### Sliding Window Implementation

```javascript
async function rateLimit(key, limit, windowSec) {
  const now = Date.now()
  const windowStart = now - (windowSec * 1000)

  const multi = redis.multi()
  multi.zremrangebyscore(key, 0, windowStart)
  multi.zadd(key, now, `${now}:${crypto.randomUUID()}`)
  multi.zcard(key)
  multi.expire(key, windowSec)

  const results = await multi.exec()
  const count = results[2][1]

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(now + windowSec * 1000)
  }
}
```

---

## Observability

### Key Metrics (Prometheus)

```javascript
const metrics = {
  httpLatency: new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
  }),

  playbackEvents: new Counter({
    name: 'playback_events_total',
    help: 'Total playback events',
    labelNames: ['event_type', 'device_type']
  }),

  streamCounts: new Counter({
    name: 'stream_counts_total',
    help: 'Streams counted for royalties',
    labelNames: ['subscription_type']
  }),

  recLatency: new Histogram({
    name: 'recommendation_generation_seconds',
    help: 'Recommendation generation latency',
    labelNames: ['algorithm'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10]
  }),

  cacheHits: new Counter({
    name: 'cache_hits_total',
    labelNames: ['cache_type']
  }),

  cacheMisses: new Counter({
    name: 'cache_misses_total',
    labelNames: ['cache_type']
  })
}
```

### SLI Dashboard Queries

```promql
# Availability SLI
sum(rate(http_request_duration_seconds_count{status_code!~"5.."}[5m]))
/ sum(rate(http_request_duration_seconds_count[5m]))

# Stream start latency p95
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket{route="/api/playback/stream"}[5m])) by (le))

# Cache hit ratio
sum(rate(cache_hits_total[5m]))
/ (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m])))
```

---

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Audio Delivery | CDN + signed URLs | Direct streaming | Global scale, 90%+ cache hit rate |
| Recommendations | Hybrid CF + CB | Pure collaborative | Handles cold start, long tail genres |
| Event Processing | Kafka | Direct DB writes | Throughput, durability, multi-consumer |
| Session Storage | Redis/Valkey | JWT tokens | Simpler revocation, sliding expiration |
| Stream Counting | Idempotent events | Direct counters | Prevents duplicate royalty attribution |
| Audio Quality | Fixed per-request | Mid-stream switching | Complexity not worth it for 3-min songs |

---

## Future Enhancements (Backend Focus)

1. **Spotify Connect**: Cross-device playback handoff using WebSocket pub/sub
2. **Collaborative Playlist Conflict Resolution**: CRDT-based position ordering
3. **Audio Fingerprinting**: Content-based deduplication and matching
4. **Real-time Recommendations**: Stream processing for "because you just listened to"
5. **Geo-based CDN Routing**: Anycast for optimal edge selection
6. **Batch Royalty Processing**: ClickHouse for aggregating stream counts per territory/label

---

## Summary

"To summarize the backend architecture:

1. **CDN-based streaming** with signed URLs, multi-quality encoding, and 1-hour expiration
2. **PostgreSQL** for catalog, playlists, and user library with JSONB audio features
3. **Kafka event streaming** for playback analytics with idempotent stream counting
4. **Hybrid recommendation engine** using vector embeddings for collaborative and content-based filtering
5. **Redis caching** with tiered TTLs and sliding window rate limiting

The architecture prioritizes low-latency playback while ensuring accurate royalty attribution through idempotent event processing.

What aspects would you like to explore further?"
