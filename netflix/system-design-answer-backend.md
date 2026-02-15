# Design Netflix - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design Netflix, a video streaming platform serving hundreds of millions of subscribers globally. The backend challenge focuses on adaptive bitrate streaming, CDN architecture, viewing history at scale, and A/B testing infrastructure.

## Requirements Clarification

### Functional Requirements
- **Streaming API**: Generate DASH manifests with quality tiers
- **Progress Tracking**: Store viewing position for resume across devices
- **Personalization API**: Generate personalized homepage rows
- **A/B Testing**: Allocate users to experiments consistently

### Non-Functional Requirements
- **Latency**: < 2 seconds to start playback
- **Availability**: 99.99% for streaming service
- **Scale**: 200M subscribers, 15% of global internet traffic
- **Throughput**: Handle millions of progress updates per second

### Scale Estimates
- **Peak Concurrent Viewers**: 50 million
- **Progress Updates**: 50M viewers x 1 update/10s = 5M writes/second
- **Daily Playback Starts**: 500 million
- **Video Catalog**: 15,000+ titles

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│    Smart TV │ Mobile │ Web │ Gaming Console │ Set-top Box       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Open Connect CDN                             │
│         (Netflix's custom CDN, ISP-embedded appliances)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway (Kong/Zuul)                      │
│              Rate Limiting │ Auth │ Routing                     │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Playback Svc  │    │Personalization│    │ Experiment Svc│
│               │    │    Service    │    │               │
│ - Manifest    │    │ - Homepage    │    │ - Allocation  │
│ - DRM         │    │ - Ranking     │    │ - A/B tests   │
│ - Progress    │    │ - Rows        │    │ - Metrics     │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├──────────────┬──────────────────┬───────────────────────────────┤
│  PostgreSQL  │    Cassandra     │         Redis + Kafka         │
│  - Catalog   │  - View History  │    - Sessions, Cache          │
│  - Accounts  │  - Progress      │    - Events                   │
└──────────────┴──────────────────┴───────────────────────────────┘
```

## Deep Dives

### 1. Playback Service Architecture

**DASH Manifest Generation:**

The manifest generation function produces a playback manifest containing video metadata, available quality tiers, subtitle tracks, and audio tracks. It proceeds through five steps:

1. **Get video metadata**: Query PostgreSQL for the video record, joining with episodes and seasons tables if the content is a series
2. **Get available encodings**: Query video_encodings filtered by the device's supported codecs and maximum resolution, ordered by bandwidth descending
3. **Get resume position**: Query Cassandra's viewing_progress table for the profile's last known position on this content
4. **Generate CDN URLs**: For each encoding, create a signed CDN URL with a 1-hour expiry token. The URL uses a segment template pattern (e.g., `seg-$Number$.m4s`) so the client can request individual segments by index
5. **Get subtitles and audio**: Fetch subtitle and audio track metadata in parallel

The manifest includes: videoId, title, duration, resumePosition, an array of quality tiers (each with resolution, bandwidth, codec, segment duration, and base URL), plus subtitle and audio track arrays.

**CDN URL Signing:**

Each CDN URL is signed with an HMAC token containing the video ID, encoding ID, profile ID, and a 1-hour expiry timestamp. The client embeds this token as a query parameter when requesting segments, and the CDN validates it before serving content. This prevents unauthorized access and link sharing.

### 2. Viewing Progress at Scale

**Cassandra Schema for High-Write Throughput:**

| Table | Partition Key | Clustering Columns | Key Columns | Notes |
|-------|--------------|-------------------|-------------|-------|
| **viewing_progress** | profile_id | last_watched_at DESC, content_id | content_type, video_id, episode_id, position_seconds, duration_seconds, progress_percent, completed | Keyspace uses NetworkTopologyStrategy with RF=3 across us-east, us-west, eu-west. 90-day TTL. Ordered by last_watched_at DESC for "Continue Watching" queries |
| **watch_history** | profile_id | watched_at DESC, content_id | content_type, title (denormalized), genres (SET, denormalized for recommendations) | 1-year TTL. Title and genres denormalized to avoid cross-database joins when displaying history |

> "Cassandra is chosen over PostgreSQL for viewing progress because we need to handle 5M writes/second at peak. Each viewer sends a progress update every 10 seconds, and Cassandra's write-optimized LSM tree architecture handles this without the write amplification that would cripple PostgreSQL. The trade-off is we lose cross-table joins -- that's why we denormalize title and genres into watch_history."

**Progress Update Handler:**

The progress update function performs four operations:

1. **Write to Cassandra**: Insert the current position, duration, progress percentage, and completion flag (>95% = completed) into the viewing_progress table
2. **Invalidate cache**: Delete the Redis key `continue_watching:{profileId}` so the next homepage request fetches fresh data
3. **Emit analytics event**: Publish a progress_update message to the `viewing-events` Kafka topic, keyed by profileId for partition affinity
4. **Handle completion**: If the viewer passed the 95% threshold, record the content in watch_history and update genre preference weights for the profile

**Progress Batching:**

To reduce Cassandra write load, a ProgressBatcher class buffers updates in memory, keyed by `{profileId}:{contentId}`. Only the latest position for each profile-content pair is kept. A timer flushes the buffer every 5 seconds as a Cassandra batch insert. This reduces write volume by roughly 2x since most viewers generate multiple updates between flushes, and only the final position matters.

### 3. Continue Watching API

**Efficient Query Pattern:**

The Continue Watching API builds a personalized list of in-progress content through six steps:

1. **Check cache**: Look up `continue_watching:{profileId}` in Redis. If found, return the cached list immediately
2. **Query Cassandra**: Fetch recent viewing progress for the profile, ordered by last_watched_at descending, over-fetching at 2x the limit to account for filtering
3. **Filter**: Keep only items where progress is between 5% and 95% (started but not completed)
4. **Enrich with metadata**: Batch-fetch video metadata (title, poster, episode info) from PostgreSQL using the content IDs from the filtered results
5. **Build response**: Combine Cassandra progress data with PostgreSQL metadata into response objects containing: contentId, title, episode info (e.g., "S2:E5"), poster URL, progress percentage, resume position, and last watched timestamp
6. **Cache**: Store the assembled list in Redis with a 5-minute TTL

> "We over-fetch from Cassandra (2x limit) because filtering out completed and barely-started content reduces the set. The metadata enrichment is a single PostgreSQL query using ANY($1) rather than N+1 queries -- this keeps the cross-database join efficient."

### 4. A/B Testing Framework

**Experiment Configuration:**

Each experiment contains: id, name, description, status (draft/running/paused/completed), traffic allocation percentage (0-100), an array of variants (each with id, name, weight, and config map), targeting groups (by country, device, plan, or tenure), tracked metrics, and start/end dates.

**Consistent Allocation with MurmurHash:**

The allocation algorithm ensures each user always sees the same variant for a given experiment, without storing per-user assignments:

1. **Experiment population check**: Hash `{userId}:{experimentId}` with MurmurHash v3 and take modulo 10,000 (0.01% granularity). If the result exceeds the experiment's allocation percentage x 100, the user is not in the experiment
2. **Variant assignment**: Hash `{userId}:{experimentId}:variant` separately and map the result to variant weights. Iterate through variants, accumulating weights until the hash falls within a variant's range

This approach is deterministic -- the same user always gets the same variant, even across different server instances and restarts.

**Getting all experiments for a user:**

The system queries all running experiments from PostgreSQL, checks targeting rules against the user's context (country, device type, subscription plan, tenure), runs the allocation algorithm for each eligible experiment, and caches the full allocation map in Redis with a 1-hour TTL.

**Using Experiments in Application Code:**

Feature flags are consumed by checking the user's experiment allocations against specific experiment names. For example, an artwork experiment might have three variants: "personalized" (returns ML-ranked artwork), "genre_based" (returns genre-themed artwork), or control (returns default artwork). Similarly, homepage row ordering experiments can test different strategies like "continue watching first" vs "trending first" vs "personalized order."

### 5. Rate Limiting Strategy

**Tiered Rate Limits:**

| Endpoint Category | Limit | Window | Rationale |
|-------------------|-------|--------|-----------|
| browse | 100 req | 60s | Normal browsing patterns |
| playbackStart | 30 req | 60s | Streaming is expensive |
| progressUpdate | 60 req | 60s | Frequent automated updates |
| search | 50 req | 60s | Prevent catalog scraping |
| auth | 5 req | 300s | Credential stuffing protection |

The rate limiter uses a **sliding window** implemented with Redis sorted sets. For each request:

1. Remove entries older than the window start from the sorted set
2. Add the current timestamp as a new entry
3. Count remaining entries in the set
4. Set a TTL on the key equal to the window duration

If the count exceeds the limit, the request is rejected with HTTP 429 and a Retry-After header. Response headers include X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset on every request.

The rate limit key is scoped to `ratelimit:{category}:{accountId}` (or IP for unauthenticated requests), allowing different limits per endpoint category while using the same middleware.

### 6. Circuit Breaker for External Services

**Implementation with Fallback:**

The circuit breaker tracks three states (CLOSED, OPEN, HALF_OPEN), a rolling window of failure timestamps, and the last failure time. Configuration includes failure threshold, recovery timeout, and monitoring window duration.

Execution flow:

1. **OPEN state**: If the recovery timeout has elapsed, transition to HALF_OPEN. Otherwise, execute the fallback function (if provided) or throw an error
2. **CLOSED / HALF_OPEN state**: Execute the operation. On success in HALF_OPEN, transition to CLOSED and clear failures. On failure, record the timestamp. If recent failures (within the monitoring window) exceed the threshold, transition to OPEN

Each external service gets its own circuit breaker instance with tuned thresholds: personalization (5 failures), recommendations (3 failures, more sensitive), CDN (10 failures, more tolerant).

**Graceful degradation example**: When the personalization circuit opens, the homepage falls back to cached personalized rows if available, or a generic trending-for-all-users homepage if not. The user sees content either way -- just less personalized during outages.

### 7. Observability

**Key Metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| streaming_starts_total | Counter | Total playback starts, labeled by quality, content_type, device |
| streaming_playback_errors_total | Counter | Playback errors by error_type and content_type |
| manifest_generation_seconds | Histogram | Time to generate playback manifest (buckets: 50ms to 2.5s) |
| progress_write_seconds | Histogram | Time to write viewing progress (buckets: 10ms to 500ms) |
| experiment_allocations_total | Counter | Experiment allocations by experiment_id and variant_id |
| circuit_breaker_state | Gauge | Circuit breaker state per service (0=closed, 1=half_open, 2=open) |

**Structured Logging:**

Each log entry is serialized as single-line JSON with: timestamp (ISO 8601), level (info/warn/error), service name, requestId, optional profileId, event name, and a metadata object. For example, a `manifest_generated` event logs the videoId, quality count, and latency in milliseconds. This structured format enables correlation by requestId across services and filtering by event type for monitoring.

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| CDN | Custom (Open Connect) | Third-party CDN | Cost at scale, ISP integration, control |
| Progress Storage | Cassandra | PostgreSQL | High write throughput, time-series access |
| Session Storage | Redis | Database | Low latency, easy revocation |
| Streaming Protocol | DASH | HLS | More flexibility, industry standard |
| Experiment Allocation | MurmurHash | Random | Consistent allocation across requests |
| Rate Limiting | Sliding window | Token bucket | Smoother limiting, prevents burst abuse |

## Future Enhancements

1. **Per-Title Encoding**: Custom encoding ladders based on content complexity
2. **Predictive Prefetch**: Pre-fetch likely next content during credits
3. **Multi-Region Active-Active**: Cassandra cross-region replication
4. **ML-Based ABR**: Neural network for bandwidth prediction
5. **Real-Time Experiment Analysis**: Streaming metrics with Flink/Spark
6. **Content-Based Embeddings**: Video fingerprinting for similar titles
7. **Chaos Engineering**: Automated failure injection testing
8. **Edge Computing**: Personalization at CDN edge nodes
