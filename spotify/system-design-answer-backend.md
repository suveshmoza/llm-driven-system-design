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

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **artists** | id (UUID PK), name, bio, image_url, verified, monthly_listeners (denormalized, updated hourly), created_at | PK index | Monthly listeners count updated hourly by background job |
| **albums** | id (UUID PK), artist_id (FK), title, release_date, cover_url, album_type (album/single/ep/compilation), total_tracks, created_at | idx_albums_artist (artist_id), idx_albums_release (release_date DESC) | Album type constrained to four values |
| **tracks** | id (UUID PK), album_id (FK), title, duration_ms, track_number, disc_number, explicit, preview_url, stream_count (BIGINT), audio_features (JSONB), created_at | idx_tracks_album (album_id), idx_tracks_stream_count (stream_count DESC) | Audio features stored as JSONB for ML recommendations |
| **playlists** | id (UUID PK), owner_id (FK), name, description, cover_url, is_public, is_collaborative, follower_count, created_at, updated_at | idx_playlists_owner (owner_id) | Collaborative flag enables multi-user editing |
| **playlist_tracks** | playlist_id + track_id (composite PK), position, added_by (FK), added_at | idx_playlist_tracks_position (playlist_id, position) | Position integer for ordering within playlist |
| **user_library** | user_id + item_type + item_id (composite PK), saved_at | idx_user_library_type (user_id, item_type, saved_at DESC) | Polymorphic saves - item_type is track/album/artist/playlist |
| **listening_history** | id (UUID PK), user_id (FK), track_id (FK), played_at, duration_played_ms, completed, context_type (playlist/album/artist/search), context_id | idx_listening_user_time (user_id, played_at DESC) | Powers recommendation engine |
| **playback_events** | id (UUID PK), user_id (FK), track_id (FK), event_type (start/progress/complete/skip/seek), position_ms, device_type, timestamp, idempotency_key (unique) | idx_playback_track (track_id, timestamp), idx_playback_user (user_id, timestamp) | Idempotency key prevents duplicate stream counts for royalties |

### Audio Features JSONB Structure

The audio_features JSONB column on each track stores machine-extracted properties: tempo (BPM), energy (0-1), danceability (0-1), acousticness (0-1), valence (musical positivity, 0-1), speechiness, instrumentalness, liveness, loudness (dB), key (0-11 pitch class), mode (major/minor), and time signature. These features are extracted during track ingestion and power content-based recommendations.

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

The stream URL generation flow works in four steps:

1. **Check subscription level** - Look up the user in Redis to determine if they are premium (max 320 kbps) or free (max 160 kbps)
2. **Determine quality** - Select quality based on the client-reported network connection type, capped at the subscription maximum
3. **Generate signed URL** - Create an HMAC-SHA256 signature over the track ID, quality, user ID, and expiry timestamp (1 hour from now) using a CDN secret. The URL points to the CDN with the signature and expiry as query parameters
4. **Cache the URL** - Store the signed URL in Redis with a 5-minute TTL for quick retries

The response includes the URL, selected quality level, and expiration timestamp.

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

Each track has a 128-dimensional embedding vector derived from multiple signals: audio features (tempo, energy, danceability), genre tags, user interaction patterns, and co-occurrence in playlists. These embeddings are stored in a feature store and used for approximate nearest neighbor (ANN) searches to find similar tracks.

### Discover Weekly Generation

The Discover Weekly algorithm runs in six steps:

1. **Gather listening history** (last 28 days) - Aggregate track plays with engagement scores (1.0 for completed listens, 0.5 for partial)
2. **Collaborative filtering** - Retrieve the user's 128-dimensional embedding from the feature store, perform an ANN query to find the 100 most similar users, then collect their top tracks excluding anything the target user has already heard (limit 50 candidates)
3. **Content-based filtering** - Identify tracks the user engaged with strongly (engagement > 0.7), average their track embeddings, then ANN-query for the 50 nearest tracks not in the user's history
4. **Blend results** - Merge collaborative and content-based candidates with a 60/40 weighting toward collaborative filtering
5. **Diversify** - Enforce a maximum of 2 tracks per artist and select the top 30 tracks to avoid repetitive artist-heavy playlists
6. **Cache** - Store the final playlist in Redis with a 7-day TTL, regenerated weekly

---

## Deep Dive: Playback Analytics (5 minutes)

### Stream Counting for Royalties

"Accurate play counts are critical for royalty payments. Industry standard: 30 seconds of playback OR 50% of track duration (whichever is less)."

**Client-side event reporting**: When the client reports a playback event, the service first performs an idempotency check using Redis SET NX with a 24-hour TTL. If the idempotency key already exists, the event is deduplicated. Otherwise, the event is sent to Kafka's `playback_events` topic for async processing.

**Kafka consumer processing**: The consumer checks if the event is a "progress" event with position >= 30 seconds. If so, it atomically increments the track's stream_count in PostgreSQL and inserts a `stream_counted` playback event record with ON CONFLICT DO NOTHING on the idempotency key to prevent duplicate royalty attribution.

### Why Kafka?

"We process billions of playback events daily. Kafka provides:
- High throughput for event ingestion
- Durability - events aren't lost if a consumer is down
- Multiple consumers - analytics, royalties, recommendations all read from the same stream"

---

## Caching Strategy

### Multi-Layer Caching

Cache TTLs are tiered by data volatility:

| Cache Key Pattern | TTL | Rationale |
|-------------------|-----|-----------|
| Track metadata | 1 hour | Rarely changes after ingestion |
| Album metadata | 1 hour | Rarely changes |
| Artist metadata | 30 min | Monthly listeners update periodically |
| User library | 5 min | User actions are frequent |
| Playlist tracks | 5 min | Collaborative edits possible |
| Stream URL | 5 min | Quick retry on playback failures |
| Discover Weekly | 1 week | Regenerated weekly by batch job |

The read path follows a standard cache-aside pattern: check Redis first (incrementing a cache hit metric), and on miss, query PostgreSQL with a JOIN across tracks, albums, and artists, then populate the cache. Cache misses are tracked separately for monitoring hit ratios.

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

The rate limiter uses Redis sorted sets with the same sliding window algorithm across all endpoints. Within an atomic MULTI/EXEC pipeline: remove entries outside the current window (ZREMRANGEBYSCORE), add the current request with a unique member name (ZADD), count entries (ZCARD), and set key expiry. The response includes whether the request is allowed, remaining quota, and reset timestamp.

---

## Observability

### Key Metrics (Prometheus)

We track six core metric families:

| Metric | Type | Labels | Purpose |
|--------|------|--------|---------|
| http_request_duration_seconds | Histogram (buckets: 10ms to 5s) | method, route, status_code | API latency SLI |
| playback_events_total | Counter | event_type, device_type | Volume of playback activity |
| stream_counts_total | Counter | subscription_type | Streams counted for royalties |
| recommendation_generation_seconds | Histogram (buckets: 100ms to 10s) | algorithm | Rec engine performance |
| cache_hits_total | Counter | cache_type | Cache effectiveness |
| cache_misses_total | Counter | cache_type | Cache miss rate |

### SLI Dashboard Queries

Key observability queries:

- **Availability SLI**: Ratio of non-5xx requests to total requests over a 5-minute window
- **Stream start latency p95**: 95th percentile of request duration for the `/api/playback/stream` route
- **Cache hit ratio**: cache_hits / (cache_hits + cache_misses) over a 5-minute window

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
