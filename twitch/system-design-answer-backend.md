# Twitch - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## 1. Requirements Clarification (3 minutes)

### Functional Requirements
- **Stream**: Broadcasters publish live video via RTMP to viewers
- **Watch**: Viewers watch streams with low latency via HLS/DASH
- **Chat**: Real-time messaging during streams (100K+ concurrent users per channel)
- **Subscribe**: Paid channel subscriptions and donations
- **VOD**: Record and store live broadcasts for later viewing

### Non-Functional Requirements
- **Latency**: < 5 seconds glass-to-glass (camera to viewer screen)
- **Scale**: 10M concurrent viewers, 100K concurrent streams
- **Chat**: 1M messages per minute during peak events
- **Availability**: 99.99% for video delivery

### Scale Estimates
| Metric | Estimate |
|--------|----------|
| Concurrent Viewers | 10M |
| Concurrent Streams | 100K |
| Average Bitrate | 4 Mbps |
| Peak Chat Messages | 1M/min |
| VOD Storage/Day | 500TB |

---

## 2. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Broadcaster Layer                            │
│              OBS / Streamlabs (RTMP output)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ RTMP
┌─────────────────────────────────────────────────────────────────┐
│                    Ingest Layer                                 │
│    Multiple ingest servers globally (rtmp://ingest.twitch.tv)   │
│    - Authenticate stream key                                    │
│    - Forward to transcoder                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Transcoding Layer                              │
│    FFmpeg/MediaLive clusters                                    │
│    - Source → 1080p60, 720p60, 720p30, 480p, 360p               │
│    - Generate HLS segments (2-4 second chunks)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Origin Layer                                  │
│    - Store HLS manifests (.m3u8) and segments (.ts)             │
│    - Serve to CDN edge nodes                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CDN Edge Layer                              │
│    CloudFront / Fastly / Custom CDN                             │
│    - Cache segments at edge                                     │
│    - Serve to viewers globally                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Layered Approach?

- **Ingest Separation**: Globally distributed so broadcasters connect to nearby servers
- **Transcoding Layer**: Each stream needs dedicated transcoder for isolation
- **CDN**: Essential for 10M viewers - segments cached at edge (>99% cache hit)

---

## 3. Data Model Design (5 minutes)

### PostgreSQL Schema

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **channels** | id (SERIAL PK), user_id (FK to users), name (UNIQUE), stream_key (UNIQUE), title, category_id (FK), follower_count, subscriber_count, is_live (BOOLEAN), current_viewers, version (optimistic locking), created_at | Partial index on is_live WHERE is_live = TRUE; composite index on (category_id, current_viewers DESC) | Version column enables optimistic concurrency control for viewer count updates |
| **streams** | id (SERIAL PK), channel_id (FK), title, started_at, ended_at, peak_viewers, total_views, vod_url | Composite index on (channel_id, started_at DESC) | Each row represents one broadcast session; ended_at is NULL while live |
| **subscriptions** | id (SERIAL PK), user_id (FK), channel_id (FK), tier (1/2/3), started_at, expires_at, is_gift, gifted_by (FK), idempotency_key (UNIQUE) | Unique partial index on (user_id, channel_id) WHERE expires_at > NOW() | Idempotency key prevents duplicate subscription charges |
| **chat_messages** | id (BIGSERIAL), channel_id (FK), user_id (FK), message (TEXT), created_at | Partitioned by RANGE on created_at (monthly partitions) | Composite PK on (id, created_at) to support partitioning; old partitions can be dropped for cleanup |
| **channel_bans** | channel_id + user_id (composite PK), banned_by (FK), reason, expires_at (NULL = permanent), created_at | -- | expires_at being NULL means a permanent ban |

### Redis Data Structures

```
# Viewer tracking per channel
viewers:{channelId}              -> Counter (INCR/DECR on join/leave)

# Chat rate limiting
ratelimit:chat:{channelId}:{userId} -> Counter with TTL

# Chat deduplication (5 min window)
chat_dedup:{channelId}           -> Set of message IDs

# Stream start lock (prevent duplicate go-live)
stream_lock:{channelId}          -> String with 10s TTL

# Idempotency cache for subscriptions
idempotency:{key}                -> JSON result with 24h TTL

# Pub/Sub channels
chat:{channelId}                 -> Pub/Sub for chat messages
```

---

## 4. Deep Dive: Stream Ingestion Pipeline (8 minutes)

### RTMP Server Flow

The RTMP ingest server handles three key events:

**On Connect:**
1. Extract the stream key from the RTMP connection command
2. Validate the stream key against the database; reject the session if invalid
3. Acquire a distributed lock in Redis (`stream_lock:{channelId}` with 10-second TTL) to prevent duplicate go-live events
4. If the lock is already held, check whether the channel is already live -- if so, treat this as a reconnect and allow it without creating a new stream record. Otherwise, reject the session
5. Create a new stream record in the database
6. Update the channel to `is_live = TRUE` and reset `current_viewers` to 0
7. Publish a "stream_start" event via Redis pub/sub to notify the chat system
8. Release the lock

**On Publish:**
1. Assign a transcoder instance to this stream based on the channel ID
2. Pipe the incoming RTMP data to the assigned transcoder

**On Disconnect:**
1. If this was a reconnect session, do nothing (the original session handles cleanup)
2. Wait 5 seconds to allow for potential reconnection (handles brief network drops)
3. Check if the channel has reconnected via another session during that window
4. If still disconnected, mark the stream's `ended_at` timestamp and set the channel to `is_live = FALSE`

### Transcoding Pipeline

The transcoder takes the RTMP input and produces multi-quality HLS output using FFmpeg. It generates three quality tiers simultaneously from a single input stream: 1080p at 6000 kbps, 720p at 3000 kbps, and 480p at 1500 kbps. Each output uses the `veryfast` encoding preset for low latency, produces 2-second HLS segments, keeps only the 5 most recent segments in the playlist (sliding window), and deletes old segments to manage disk usage.

### HLS Master Manifest

```
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480
480p/playlist.m3u8
```

### Why RTMP for Ingest?

| Protocol | Latency | Reliability | Complexity |
|----------|---------|-------------|------------|
| RTMP | ~500ms | Good (TCP) | Low |
| SRT | ~200ms | Better | Medium |
| WebRTC | ~100ms | Complex | High |

**Choice**: RTMP for simplicity and universal support (OBS, Streamlabs, etc.)

---

## 5. Deep Dive: Chat System at Scale (10 minutes)

### Chat Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chat Service Cluster                         │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│  Chat Pod 1 │  Chat Pod 2 │  Chat Pod 3 │  Chat Pod N │   ...   │
│ (WS conns)  │ (WS conns)  │ (WS conns)  │ (WS conns)  │         │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Redis Pub/Sub (or Kafka)                     │
│              chat:{channelId} → all pods subscribed             │
└─────────────────────────────────────────────────────────────────┘
```

### Message Flow with Deduplication

Each incoming chat message goes through a six-step pipeline:

1. **Rate limit check**: Increment a per-user counter in Redis (`ratelimit:chat:{channelId}:{userId}`) with a 1-second TTL. If the count exceeds 1 (or the channel's configured slow mode threshold), reject the message with a "RATE_LIMITED" error and tell the client how many seconds to wait.

2. **Ban check**: Look up whether the user is banned in this channel. If banned, return a "BANNED" error immediately.

3. **Deduplication**: Use a Redis set (`chat_dedup:{channelId}`) with a 5-minute expiry window. Attempt to add the message ID -- if it already exists, the message is a client retry and is silently dropped.

4. **Enrich the message**: Build the full message object with the user's display name, subscriber/mod/admin badges, and a server-side timestamp.

5. **Publish via Redis Pub/Sub**: Publish the enriched message to the `chat:{channelId}` channel. All chat pods subscribed to this channel receive it and broadcast to their local WebSocket connections.

6. **Store asynchronously**: Write the message to PostgreSQL for moderation replay and chat history, but do this asynchronously so it does not block the real-time path.

**Chat Pod Setup**: Each chat pod creates a dedicated Redis subscriber connection. It subscribes to `chat:{channelId}` for every active channel it handles. When a message arrives on any subscribed channel, the pod parses it and broadcasts to all WebSocket connections in that channel's room.

### Rate Limiting Strategies

| Mode | Limit | Use Case |
|------|-------|----------|
| Normal | 1 msg/sec | Default for all users |
| Slow Mode | 5-120 sec | High-volume channels |
| Subscribers Only | N/A | Reduce spam during events |
| Follower Mode | 10min+ follow age | Only followers can chat |
| Emote Only | N/A | Special events |

### Chat Pod Scaling

Channels are partitioned across chat pods using modular hashing: a channel is assigned to pod number `channelId % podCount`. However, large channels (over 50,000 concurrent viewers) get 3 dedicated pods to handle the WebSocket connection load and message fan-out volume. Smaller channels share pods from a pool of 10 shared instances.

---

## 6. Deep Dive: VOD Recording (5 minutes)

### Parallel Recording During Live Stream

As the transcoder outputs HLS segments, each segment is handled in parallel for both live delivery and VOD archival:

1. **CDN upload (primary path)**: The segment is immediately pushed to the CDN for live viewers -- this is latency-critical and takes priority
2. **S3 archival (secondary path)**: The same segment is uploaded to an S3 "vods" bucket at path `{channelId}/{streamId}/{sequence}.ts` with retry logic (up to 5 retries) and an idempotency key (`segment:{streamId}:{sequence}`) to prevent duplicate writes
3. **VOD manifest update**: After archiving the segment, append its entry (duration and filename) to a running HLS manifest file at `{channelId}/{streamId}/vod.m3u8` in S3. If the manifest does not exist yet, create it with an initial header.

### Why Record Segments Directly?

- **Instant VOD**: No post-processing needed after stream ends
- **Same format**: Live and VOD use identical HLS segments
- **Efficient**: Just copy bytes, no re-encoding required
- **Resumable**: If upload fails, retry individual segment

---

## 7. Reliability & Failure Handling (5 minutes)

### Circuit Breaker Pattern

We implement circuit breakers for each external dependency (Redis, database, S3) with configurable thresholds. The circuit breaker maintains three states:

- **CLOSED** (normal): Requests pass through. On each failure, increment a failure counter. When failures reach the threshold (e.g., 5 for Redis, 3 for database), transition to OPEN.
- **OPEN** (tripped): All requests immediately fail or invoke a fallback. After a reset timeout (e.g., 5 seconds for Redis, 10 seconds for database, 30 seconds for S3), transition to HALF_OPEN.
- **HALF_OPEN** (testing): Allow one request through. If it succeeds, return to CLOSED and reset the failure counter. If it fails, return to OPEN.

Each circuit breaker accepts an optional fallback function. For example, the chat broadcast circuit breaker falls back to local-only broadcast (only reaching WebSocket connections on the current pod) when Redis pub/sub is unavailable. This means chat degrades to pod-local delivery rather than failing entirely.

### Idempotency for Subscriptions

The subscription creation flow ensures exactly-once payment processing:

1. **Check idempotency cache**: Look up the idempotency key in Redis. If a cached result exists, return it immediately -- this handles client retries safely.
2. **Begin a database transaction**: All subscription changes happen atomically.
3. **Check for existing active subscription**: Query subscriptions for this user and channel where `expires_at > NOW()`.
4. **If already subscribed**: Extend the existing subscription by 1 month and update the tier.
5. **If new subscription**: Insert a new row with the idempotency key, tier, and expiration set to 1 month from now.
6. **Increment subscriber count**: Update the channel's `subscriber_count` within the same transaction.
7. **Commit the transaction**: If anything fails, roll back entirely.
8. **Cache the result**: Store the success response in Redis under the idempotency key with a 24-hour TTL, so retries within that window return the same result without re-processing.

---

## 8. Observability (3 minutes)

### Prometheus Metrics

We track both infrastructure and business metrics:

**Infrastructure metrics:**
- **HTTP request duration** (histogram): Labeled by method, route, and status code, with buckets at 10ms, 50ms, 100ms, 500ms, 1s, 2s, and 5s

**Business metrics:**
- **Active streams** (gauge): Number of currently live streams
- **Chat messages total** (counter): Total chat messages processed, labeled by channel ID
- **WebSocket connections** (gauge): Current active WebSocket connections across all chat pods
- **Viewer count** (gauge): Total viewers across all live streams
- **Circuit breaker state** (gauge): Numeric state per circuit (0=closed, 1=open, 2=half-open), labeled by circuit name

### Alert Thresholds

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| High API Latency | p95 > 500ms for 5 min | Warning | Check database queries |
| Error Rate Spike | 5xx rate > 1% for 2 min | Critical | Check logs, rollback |
| Redis Connection Lost | Down > 30s | Critical | Chat will degrade |
| No Active Streams | 0 streams for 10 min | Warning | Check ingest service |
| WebSocket Saturation | > 80% limit | Warning | Scale chat pods |

---

## 9. Trade-offs and Alternatives (2 minutes)

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Video protocol | HLS | WebRTC | Scalability over latency |
| Chat transport | WebSocket + Pub/Sub | Kafka | Simplicity for learning |
| VOD storage | Segment archive | Re-encode | Instant availability |
| Transcoding | Per-stream workers | Shared pool | Isolation |
| Stream key auth | Database lookup | JWT | Simpler revocation |

---

## 10. Summary

This backend architecture handles Twitch's core systems:

1. **Video Pipeline**: RTMP ingest with stream key auth, FFmpeg transcoding to HLS, CDN delivery with >99% cache hit ratio

2. **Chat System**: WebSocket pods with Redis Pub/Sub fan-out, deduplication, rate limiting, and circuit breakers for graceful degradation

3. **VOD Recording**: Parallel segment archival during live for instant availability

4. **Reliability**: Idempotency keys for payments, distributed locks for stream start, circuit breakers for dependencies

5. **Observability**: Prometheus metrics for streams, chat, connections with alerting thresholds

The system scales horizontally with dedicated transcoders per stream and partitioned chat pods per channel size.
