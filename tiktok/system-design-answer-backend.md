# TikTok - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Opening Statement

"Today I'll design a short-video platform like TikTok, focusing on the backend systems that power the recommendation engine, video processing pipeline, and real-time engagement tracking. The core challenge is building a two-phase recommendation system that scales to 500M daily active users while maintaining sub-100ms feed latency. I'll deep dive into the candidate generation and ranking architecture, embedding-based similarity search with pgvector, video transcoding queues, and the cold start solutions for both new users and new content."

---

## Step 1: Requirements Clarification (3 minutes)

### Functional Requirements

1. **Upload**: Ingest short videos (15-60 seconds), transcode to multiple resolutions
2. **For You Page (FYP)**: Personalized recommendations via two-phase candidate generation + ranking
3. **Engagement**: Track views, likes, comments, shares with real-time counters
4. **Cold Start**: Handle new users (no history) and new videos (no engagement data)
5. **Creator Analytics**: Video performance metrics and audience insights

### Non-Functional Requirements

- **Latency**: < 100ms for feed generation, < 2 minutes upload-to-live
- **Availability**: 99.99% for video delivery via CDN
- **Scale**: 1M videos uploaded/day, 500M DAU, 1000:1 read:write ratio
- **Freshness**: New videos in recommendations within hours

### Backend-Specific Challenges

- Two-phase recommendation at scale (1M to 1K to 50 candidates)
- Video processing pipeline with parallel transcoding workers
- Embedding storage and similarity search with pgvector
- Real-time view counting with Redis aggregation
- Rate limiting to protect transcoding infrastructure

---

## Step 2: High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CDN Layer                                │
│              Video delivery, thumbnails, assets                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway + Rate Limiting                  │
│           (10 uploads/hr, 60 feed requests/min)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Video Service │    │  Rec Service  │    │ User Service  │
│               │    │               │    │               │
│ - Upload API  │    │ - FYP Gen     │    │ - Profiles    │
│ - Transcode   │    │ - Ranking     │    │ - Follows     │
│ - Storage     │    │ - Cold start  │    │ - Activity    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├───────────────┬───────────────┬───────────────┬─────────────────┤
│  PostgreSQL   │    Redis      │    MinIO/S3   │    Kafka        │
│  + pgvector   │               │               │                 │
│  - Metadata   │ - Sessions    │ - Videos      │ - Transcode Q   │
│  - Embeddings │ - Counters    │ - Thumbnails  │ - Analytics     │
│  - Engagement │ - Rate limits │               │                 │
└───────────────┴───────────────┴───────────────┴─────────────────┘
```

---

## Step 3: Core Backend Deep Dives

### Deep Dive 1: Two-Phase Recommendation Engine (12 minutes)

The recommendation engine is the heart of TikTok. It uses a two-phase approach to scale efficiently.

**Phase 1: Candidate Generation**

Narrow from millions of videos to ~1000 candidates using multiple sources:

The candidate generation algorithm works as follows:

1. **Parallel fetch** from four sources simultaneously to build a pool of ~1000 candidates:
   - Source 1: 200 videos from followed creators
   - Source 2: 300 videos matching hashtags the user previously engaged with
   - Source 3: 200 videos using sounds the user liked
   - Source 4: 300 trending videos for exploration
2. **Merge** all candidates into a single list
3. **Deduplicate** by loading the user's recent watch history (last 1000 video IDs) into a set
4. **Filter out** any video the user has already watched

**Why Multiple Sources?**
- **Followed creators**: Strong signal - user explicitly chose to see them
- **Hashtags/Sounds**: Captures interest in topics and trends
- **Trending**: Ensures exploration and surfaces viral content
- **Mix prevents filter bubbles** and keeps feed fresh

**Phase 2: Ranking with Embeddings**

Score each candidate using embedding similarity and engagement signals:

The ranking algorithm scores each candidate by combining embedding similarity with quality signals:

1. **Retrieve the user's embedding vector** (128-dimensional, stored in pgvector)
2. **For each candidate video**, retrieve its embedding vector
3. **Compute cosine similarity** between the user and video vectors as the base score
4. **Multiply by three quality modifiers**:
   - **Video quality score** -- a weighted combination of engagement rates (see table below)
   - **Creator score** -- based on the creator's historical engagement track record
   - **Freshness score** -- applies time decay so older videos rank lower
5. **Sort all candidates by final score** descending and return the top results

The video quality score itself is a weighted blend of four signals:

> "Watch completion rate gets the highest weight at 0.4 because it is the strongest indicator of whether a video is genuinely good -- users who watch to the end are truly engaged. Shares get 0.3 because sharing is the strongest endorsement a user can give. Likes at 0.2 provide an explicit positive signal. Comments at 0.1 capture engagement depth but are noisy."

**Ranking Signal Weights:**

| Signal | Weight | Rationale |
|--------|--------|-----------|
| Watch completion rate | 0.4 | Strongest indicator of quality |
| Share rate | 0.3 | Highest endorsement signal |
| Like ratio | 0.2 | Explicit positive signal |
| Comment rate | 0.1 | Shows engagement depth |

**pgvector for Embedding Storage:**

**pgvector Schema:**

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **video_embeddings** | video_id (PK, FK to videos), embedding VECTOR(128), created_at | IVFFlat index on embedding using vector_cosine_ops with lists=1000 | Stores 128-dimensional content embeddings per video |
| **user_embeddings** | user_id (PK, FK to users), embedding VECTOR(128), updated_at | (same IVFFlat strategy) | Aggregated from watch history; updated on engagement |

To find similar videos, we query by cosine distance: select the nearest video embeddings to a given user vector, excluding videos already in the user's watch history, ordered by ascending cosine distance, limited to 100 results. The IVFFlat index makes this approximate nearest-neighbor search fast -- `lists = sqrt(rows)` is a good starting point for the index configuration.

**Why pgvector over Dedicated Vector DB:**
- Simplicity: One database for relational + vector data
- Transaction support: Embeddings update atomically with metadata
- Good enough for our scale (up to 100M vectors)
- Would switch to Pinecone/Milvus at larger scale

---

### Deep Dive 2: Video Processing Pipeline (8 minutes)

Video uploads trigger an async processing pipeline via Kafka:

```
Upload API → Kafka Queue → Transcoder Workers → CDN Distribution
                              │
                              ├── 1080p encoding
                              ├── 720p encoding
                              ├── 480p encoding
                              ├── 360p encoding
                              ├── Thumbnail extraction
                              ├── Audio extraction
                              └── Content fingerprinting
```

**Upload Handler with Idempotency:**

The upload handler follows these steps:

1. **Require an idempotency key** in the request header; reject the request with 400 if absent
2. **Check Redis** for a previous result under that key; if found, return the cached result (200 OK) to prevent duplicate uploads
3. **Store the raw video** in object storage (MinIO/S3)
4. **Insert a video record** into PostgreSQL with status "processing," capturing the creator ID and raw URL
5. **Enqueue a transcoding job** to Kafka with the video ID, raw path, and target resolutions (1080p, 720p, 480p, 360p)
6. **Cache the result** in Redis under the idempotency key with a 24-hour TTL
7. **Return 202 Accepted** with the video ID and "processing" status

**Transcoder Worker with Retry:**

Each transcoding job follows this processing flow:

1. **Transcode in parallel** to all target resolutions (1080p, 720p, 480p, 360p) simultaneously
2. **Generate thumbnails** at multiple timestamps (1s, 3s, 5s into the video)
3. **Extract audio fingerprint** for sound matching across videos
4. **Generate a content embedding** for the recommendation engine
5. **Update the database atomically** within a transaction -- set the video URL to the 1080p version, mark status as "published," store the duration, and insert the embedding into video_embeddings
6. **Queue for initial exposure** via the "new-video-boost" Kafka topic to kick off cold start distribution

On failure, the worker distinguishes between retryable and permanent errors. Retryable errors (connection resets, timeouts, temporary transcoding failures) trigger exponential backoff: starting at 1 second, doubling up to 30 seconds, with a maximum of 3 retries. Permanent failures send the job to a dead letter queue and mark the video status as "failed" in the database.

**Rate Limiting for Upload Protection:**

Video transcoding is expensive - each upload triggers 2-5 minutes of CPU time. Rate limiting protects infrastructure:

We apply a Redis-backed rate limiter on the upload endpoint: 10 uploads per hour per user, keyed by session user ID. When the limit is reached, the request returns a "try again later" error. The upload route requires the "creator" role and passes through this limiter before reaching the upload handler.

---

### Deep Dive 3: Cold Start Solutions (7 minutes)

Two distinct cold start problems require different approaches:

**Cold Start: New User (No Watch History)**

For a new user with no watch history, the cold start feed is built from two sources:

1. **Demographic-popular content (70%)**: Query videos published in the last 7 days, scored by how many users in the same country and age bracket watched them. This leverages the insight that users in similar demographics tend to enjoy similar content. Results are ordered by demographic score, then by raw view count as a tiebreaker.

2. **Diverse exploration content (30%)**: Select one top video per distinct primary hashtag from videos published in the last 3 days. This ensures category diversity -- the user sees comedy, cooking, dance, and sports rather than a feed dominated by a single genre.

3. **Shuffle the combined results** to prevent predictable ordering and give each category a fair chance of catching the user's attention.

**Learning Phase Strategy:**
1. Show diverse content from different categories
2. Track every signal (watch time, replays, skips, likes)
3. After 10-20 videos, start building user embedding
4. Gradually shift from demographic to personalized

**Update User Embedding After Engagement:**

User embeddings are updated after each engagement using an exponential moving average:

1. **Calculate an engagement weight**: start with the video's completion rate, add 0.3 if the user liked it, add 0.5 if they shared it
2. **Retrieve the video's embedding** vector
3. **Upsert into user_embeddings**: if the user has no embedding yet, insert the weighted video embedding directly. If they already have one, blend it using an exponential moving average -- retain 95% of the existing embedding and mix in 5% of the new weighted video embedding. This ensures the embedding evolves gradually rather than being dominated by a single interaction.

**Cold Start: New Video (No Engagement Data)**

The new video boost process works in two stages:

**Stage 1 -- Initial Exposure:**
1. Retrieve the new video's content embedding
2. Use pgvector nearest-neighbor search to find the 1000 users whose interest embeddings are closest to the video's embedding -- these are the predicted target audience
3. Add the video ID to each target user's exploration set in Redis (with a 1-hour TTL so it expires naturally)
4. Schedule a performance check via Kafka for 1 hour later

**Stage 2 -- Early Performance Evaluation:**
1. After 1 hour, query watch_history for the video's metrics: total views, average completion rate, and like count
2. If the video shows strong performance (average completion > 70% AND like-to-view ratio > 10%), expand exposure to 10x more users (10,000 users)
3. If the video performs poorly, its exploration pool entries simply expire after the 1-hour TTL -- no additional exposure is given

> "This approach mimics how TikTok gives every video a 'fair shot' by showing it to a small initial audience, then amplifying winners. The 1-hour window is short enough to surface viral content quickly but long enough to gather statistically meaningful engagement signals."

---

### Deep Dive 4: Real-Time Engagement Tracking (5 minutes)

View counting at scale requires Redis aggregation:

The engagement tracking system uses a two-tier approach:

**Fast path (Redis):** When a user views a video, we immediately increment a Redis counter at `views:{videoId}` using the atomic INCR command. This handles burst traffic without touching the database.

**Async path (Kafka):** Simultaneously, we publish a detailed engagement event to Kafka containing the user ID, video ID, watch duration in milliseconds, completion rate, and timestamp. Downstream consumers process these events for recommendation updates, analytics, and creator dashboards.

**Periodic flush (every 5 minutes):** A background job scans all `views:*` keys in Redis, reads and atomically deletes each counter, then batch-updates the corresponding `view_count` in the PostgreSQL videos table. This batches what could be thousands of individual increments into a single database write per video.

**Why Redis for Counters:**
- INCR is O(1) and atomic
- Handles burst traffic without database load
- Eventually consistent is acceptable for view counts
- Periodic flush batches writes efficiently

---

## Step 4: Circuit Breaker for Recommendation Service (3 minutes)

The recommendation service is the highest-traffic endpoint. Circuit breaker prevents cascading failures:

The recommendation service uses a circuit breaker pattern to prevent cascading failures:

- **Timeout**: 5 seconds -- if the recommendation engine takes longer, fail fast
- **Error threshold**: 50% failure rate trips the breaker open
- **Recovery window**: After 15 seconds, allow a test request through (half-open state)
- **Volume threshold**: Require at least 20 requests before the circuit can trip

When the circuit opens, the system logs a warning and alerts operations. The API handler implements graceful degradation: it first attempts the personalized FYP through the circuit breaker. If the breaker is open, it falls back to serving trending videos -- a simpler, more reliable query. The response includes a `source` field ("personalized" or "trending") so clients can adjust their UI accordingly.

**Fallback Hierarchy:**
1. Personalized FYP (primary)
2. Trending videos (circuit open)
3. Cached popular videos (database down)

---

## Step 5: Database Schema (3 minutes)

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **videos** | id (BIGSERIAL PK), creator_id (FK to users), raw_url, url (transcoded), duration_seconds, description, hashtags (TEXT[]), sound_id (FK to sounds), view_count (BIGINT), like_count, comment_count, share_count, avg_completion_rate (FLOAT), status (default "processing"), created_at | GIN on hashtags; partial index on created_at DESC WHERE status = 'published' | Engagement counters are denormalized here for fast read access; view_count uses BIGINT for high-volume videos |
| **watch_history** | id (BIGSERIAL PK), user_id (FK to users), video_id (FK to videos), watch_duration_ms, completion_rate (FLOAT), liked (BOOLEAN), shared (BOOLEAN), created_at | Composite index on (user_id, created_at DESC) | Powers recommendations, analytics, and cold start evaluation |

---

## Step 6: Key Design Decisions & Trade-offs (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Rec architecture | Two-phase | Single model | O(candidates) ranking vs O(all videos) |
| Primary metric | Watch time | Views | Quality signal, harder to game |
| Vector storage | pgvector | Pinecone/Milvus | Simpler ops, good enough at scale |
| View counting | Redis + flush | Direct DB | Handles burst, eventually consistent |
| Processing queue | Kafka | RabbitMQ | Replay capability, higher throughput |
| Cold start | Demographic + exploration | Random | Faster personalization convergence |

---

## Closing Summary

I've designed the backend for a TikTok-like platform with four key systems:

1. **Two-Phase Recommendation**: Candidate generation (1M to 1K) pulls from followed creators, hashtags, sounds, and trending. Ranking uses pgvector embeddings with cosine similarity and engagement-weighted scoring.

2. **Video Processing Pipeline**: Async transcoding via Kafka workers, multi-resolution output (1080p-360p), idempotent uploads, exponential backoff retry, and rate limiting to protect infrastructure.

3. **Cold Start Solutions**: Demographic-based content for new users with gradual embedding updates. Initial exposure pools for new videos with early performance evaluation.

4. **Resilience Patterns**: Circuit breakers on recommendation service with trending fallback, Redis-based rate limiting, idempotency keys for uploads.

**Scale considerations:**
- pgvector handles embeddings up to 100M rows
- Kafka provides replay capability for reprocessing
- Redis aggregation handles view count bursts
- Circuit breakers prevent cascading failures
