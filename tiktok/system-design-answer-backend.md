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

```javascript
async function generateCandidates(userId, count = 1000) {
  const candidates = []

  // Parallel fetches from multiple sources
  const [followed, hashtag, sounds, trending] = await Promise.all([
    // Source 1: Videos from followed creators (200)
    getFollowedCreatorVideos(userId, 200),

    // Source 2: Videos with hashtags user engaged with (300)
    getHashtagVideos(userId, 300),

    // Source 3: Videos using sounds user liked (200)
    getSoundVideos(userId, 200),

    // Source 4: Trending videos for exploration (300)
    getTrendingVideos(300)
  ])

  candidates.push(...followed, ...hashtag, ...sounds, ...trending)

  // Deduplicate and filter already-watched
  const seen = await getWatchedVideoIds(userId, 1000)
  const seenSet = new Set(seen)

  return candidates.filter(v => !seenSet.has(v.id))
}
```

**Why Multiple Sources?**
- **Followed creators**: Strong signal - user explicitly chose to see them
- **Hashtags/Sounds**: Captures interest in topics and trends
- **Trending**: Ensures exploration and surfaces viral content
- **Mix prevents filter bubbles** and keeps feed fresh

**Phase 2: Ranking with Embeddings**

Score each candidate using embedding similarity and engagement signals:

```javascript
async function rankVideos(userId, candidates) {
  const userVector = await getUserEmbedding(userId)

  // Score each candidate
  const scored = await Promise.all(candidates.map(async video => {
    const videoVector = await getVideoEmbedding(video.id)

    // Cosine similarity as base score
    let score = cosineSimilarity(userVector, videoVector)

    // Multiply by quality signals
    score *= videoQualityScore(video)      // Based on engagement rates
    score *= creatorScore(video.creatorId) // Creator track record
    score *= freshnessScore(video.createdAt) // Decay for older videos

    return { video, score }
  }))

  return scored.sort((a, b) => b.score - a.score)
}

function videoQualityScore(video) {
  // Watch completion rate is the strongest signal
  const completionWeight = 0.4
  const likeWeight = 0.2
  const shareWeight = 0.3  // Shares are strongest endorsement
  const commentWeight = 0.1

  return (
    video.avgCompletionRate * completionWeight +
    (video.likeCount / video.viewCount) * likeWeight +
    (video.shareCount / video.viewCount) * shareWeight +
    (video.commentCount / video.viewCount) * commentWeight
  )
}
```

**Ranking Signal Weights:**

| Signal | Weight | Rationale |
|--------|--------|-----------|
| Watch completion rate | 0.4 | Strongest indicator of quality |
| Share rate | 0.3 | Highest endorsement signal |
| Like ratio | 0.2 | Explicit positive signal |
| Comment rate | 0.1 | Shows engagement depth |

**pgvector for Embedding Storage:**

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Video embeddings (128-dimensional)
CREATE TABLE video_embeddings (
  video_id BIGINT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  embedding VECTOR(128),
  created_at TIMESTAMP DEFAULT NOW()
);

-- User interest embeddings (aggregated from watch history)
CREATE TABLE user_embeddings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embedding VECTOR(128),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- IVFFlat index for approximate nearest neighbor search
-- Lists = sqrt(rows) is a good starting point
CREATE INDEX idx_video_embeddings_ivfflat
ON video_embeddings USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 1000);

-- Find similar videos using cosine distance
SELECT video_id, embedding <=> $1 as distance
FROM video_embeddings
WHERE video_id NOT IN (SELECT video_id FROM watch_history WHERE user_id = $2)
ORDER BY embedding <=> $1
LIMIT 100;
```

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

```javascript
async function handleVideoUpload(req, res) {
  const idempotencyKey = req.headers['x-idempotency-key']
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency key required' })
  }

  // Check for duplicate upload
  const existing = await redis.get(`idem:upload:${idempotencyKey}`)
  if (existing) {
    return res.status(200).json(JSON.parse(existing))
  }

  // Store raw video in object storage
  const rawPath = await minio.uploadVideo(req.file)

  // Create video record with 'processing' status
  const video = await db.query(`
    INSERT INTO videos (creator_id, raw_url, status, created_at)
    VALUES ($1, $2, 'processing', NOW())
    RETURNING id, status
  `, [req.session.userId, rawPath])

  // Queue for transcoding
  await kafka.send('video-transcoding', {
    videoId: video.rows[0].id,
    rawPath,
    resolutions: ['1080p', '720p', '480p', '360p']
  })

  // Store result for idempotency (24 hour TTL)
  await redis.setex(
    `idem:upload:${idempotencyKey}`,
    86400,
    JSON.stringify(video.rows[0])
  )

  return res.status(202).json({
    videoId: video.rows[0].id,
    status: 'processing'
  })
}
```

**Transcoder Worker with Retry:**

```javascript
async function processTranscodingJob(message) {
  const { videoId, rawPath, resolutions } = message

  try {
    // Transcode to all resolutions in parallel
    const transcodedUrls = await Promise.all(
      resolutions.map(res => transcodeVideo(rawPath, res))
    )

    // Generate thumbnails at multiple timestamps
    const thumbnails = await generateThumbnails(rawPath, [1, 3, 5])

    // Extract audio for sound matching
    const audioFingerprint = await extractAudioFingerprint(rawPath)

    // Generate content embedding for recommendations
    const embedding = await generateVideoEmbedding(rawPath)

    // Update database atomically
    await db.query(`
      BEGIN;
      UPDATE videos
      SET url = $1, status = 'published', duration_seconds = $2
      WHERE id = $3;

      INSERT INTO video_embeddings (video_id, embedding)
      VALUES ($3, $4);

      COMMIT;
    `, [transcodedUrls['1080p'], duration, videoId, embedding])

    // Queue for initial exposure (cold start)
    await kafka.send('new-video-boost', { videoId })

  } catch (error) {
    if (isRetryableError(error)) {
      throw error // Worker will retry with backoff
    }
    // Permanent failure - move to dead letter queue
    await kafka.send('transcoding-dlq', { videoId, error: error.message })
    await db.query(
      `UPDATE videos SET status = 'failed' WHERE id = $1`,
      [videoId]
    )
  }
}

const retryPolicy = {
  maxRetries: 3,
  initialDelay: 1000,       // 1 second
  maxDelay: 30000,          // 30 seconds
  backoffMultiplier: 2,     // Exponential backoff
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'TRANSCODING_TEMP_FAILURE']
}
```

**Rate Limiting for Upload Protection:**

Video transcoding is expensive - each upload triggers 2-5 minutes of CPU time. Rate limiting protects infrastructure:

```javascript
const uploadLimiter = rateLimit({
  store: new RedisStore({ client: redis, prefix: 'rl:upload:' }),
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 10,                    // 10 uploads per hour
  keyGenerator: (req) => req.session.userId,
  message: { error: 'Upload limit reached. Try again later.' }
})

app.post('/api/v1/videos', uploadLimiter, requireRole('creator'), handleVideoUpload)
```

---

### Deep Dive 3: Cold Start Solutions (7 minutes)

Two distinct cold start problems require different approaches:

**Cold Start: New User (No Watch History)**

```javascript
async function coldStartFeed(userId, demographics, limit = 50) {
  // No embeddings yet - use demographic-based popular content
  const popular = await db.query(`
    SELECT v.*,
           COUNT(wh.id) FILTER (WHERE wh.user_id IN (
             SELECT id FROM users
             WHERE country = $1 AND age_bracket = $2
           )) as demographic_score
    FROM videos v
    LEFT JOIN watch_history wh ON v.id = wh.video_id
    WHERE v.status = 'published'
      AND v.created_at > NOW() - INTERVAL '7 days'
    GROUP BY v.id
    ORDER BY demographic_score DESC, v.view_count DESC
    LIMIT $3
  `, [demographics.country, demographics.ageBracket, limit * 0.7])

  // Add diverse exploration content (30%)
  const diverse = await db.query(`
    SELECT DISTINCT ON (hashtags[1]) v.*
    FROM videos v
    WHERE v.status = 'published'
      AND v.created_at > NOW() - INTERVAL '3 days'
    ORDER BY hashtags[1], v.view_count DESC
    LIMIT $1
  `, [limit * 0.3])

  // Shuffle to prevent predictable ordering
  return shuffle([...popular.rows, ...diverse.rows])
}
```

**Learning Phase Strategy:**
1. Show diverse content from different categories
2. Track every signal (watch time, replays, skips, likes)
3. After 10-20 videos, start building user embedding
4. Gradually shift from demographic to personalized

**Update User Embedding After Engagement:**

```javascript
async function updateUserEmbedding(userId, videoId, engagement) {
  const { completionRate, liked, shared } = engagement

  // Weight by engagement strength
  let weight = completionRate
  if (liked) weight += 0.3
  if (shared) weight += 0.5

  const videoEmbedding = await getVideoEmbedding(videoId)

  // Exponential moving average update
  await db.query(`
    INSERT INTO user_embeddings (user_id, embedding, updated_at)
    VALUES ($1, $2 * $3, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      embedding = user_embeddings.embedding * 0.95 + $2 * $3 * 0.05,
      updated_at = NOW()
  `, [userId, videoEmbedding, weight])
}
```

**Cold Start: New Video (No Engagement Data)**

```javascript
async function boostNewVideo(videoId) {
  // Predict target audience from content embedding
  const videoEmbedding = await getVideoEmbedding(videoId)

  // Find users with similar interest embeddings
  const targetUsers = await db.query(`
    SELECT user_id
    FROM user_embeddings
    ORDER BY embedding <=> $1
    LIMIT 1000
  `, [videoEmbedding])

  // Add to exploration pool for target users
  const pipeline = redis.pipeline()
  for (const { user_id } of targetUsers.rows) {
    pipeline.sadd(`exploration:${user_id}`, videoId)
    pipeline.expire(`exploration:${user_id}`, 3600) // 1 hour TTL
  }
  await pipeline.exec()

  // Schedule early performance check
  await kafka.send('video-performance-check', {
    videoId,
    checkAt: Date.now() + 3600000 // Check in 1 hour
  })
}

async function evaluateEarlyPerformance(videoId) {
  const metrics = await db.query(`
    SELECT
      COUNT(*) as views,
      AVG(completion_rate) as avg_completion,
      COUNT(*) FILTER (WHERE liked) as likes
    FROM watch_history
    WHERE video_id = $1
      AND created_at > NOW() - INTERVAL '1 hour'
  `, [videoId])

  const { views, avg_completion, likes } = metrics.rows[0]

  // High performers get more exposure
  if (avg_completion > 0.7 && likes / views > 0.1) {
    await expandExposure(videoId, 10000) // 10x more users
  }
  // Low performers fade naturally (exploration pool expires)
}
```

---

### Deep Dive 4: Real-Time Engagement Tracking (5 minutes)

View counting at scale requires Redis aggregation:

```javascript
// Track view with watch duration
async function trackView(userId, videoId, watchDurationMs, totalDurationMs) {
  const completionRate = watchDurationMs / totalDurationMs

  // Increment Redis counter (fast path)
  await redis.incr(`views:${videoId}`)

  // Store detailed engagement in Kafka for async processing
  await kafka.send('engagement-events', {
    type: 'view',
    userId,
    videoId,
    watchDurationMs,
    completionRate,
    timestamp: Date.now()
  })
}

// Periodic flush to PostgreSQL (every 5 minutes)
async function flushViewCounts() {
  const keys = await redis.keys('views:*')

  for (const key of keys) {
    const videoId = key.split(':')[1]
    const count = await redis.getdel(key)

    if (count > 0) {
      await db.query(`
        UPDATE videos
        SET view_count = view_count + $1
        WHERE id = $2
      `, [count, videoId])
    }
  }
}
```

**Why Redis for Counters:**
- INCR is O(1) and atomic
- Handles burst traffic without database load
- Eventually consistent is acceptable for view counts
- Periodic flush batches writes efficiently

---

## Step 4: Circuit Breaker for Recommendation Service (3 minutes)

The recommendation service is the highest-traffic endpoint. Circuit breaker prevents cascading failures:

```javascript
const CircuitBreaker = require('opossum')

const recommendationBreaker = new CircuitBreaker(
  async (userId, limit) => getPersonalizedFeedInternal(userId, limit),
  {
    timeout: 5000,                    // Fail fast if > 5s
    errorThresholdPercentage: 50,     // Open at 50% failure rate
    resetTimeout: 15000,              // Test recovery after 15s
    volumeThreshold: 20               // Need 20 requests before tripping
  }
)

recommendationBreaker.on('open', () => {
  console.warn('Recommendation circuit OPEN - serving trending fallback')
  alertOps('recommendation-circuit-open')
})

// API handler with graceful degradation
async function getFeed(req, res) {
  const { userId } = req.session
  const limit = parseInt(req.query.limit) || 20

  try {
    const videos = await recommendationBreaker.fire(userId, limit)
    return res.json({ videos, source: 'personalized' })
  } catch (error) {
    if (error.message === 'Breaker is open') {
      // Fallback to trending (simple, reliable)
      const trending = await getTrendingVideos(limit)
      return res.json({ videos: trending, source: 'trending' })
    }
    throw error
  }
}
```

**Fallback Hierarchy:**
1. Personalized FYP (primary)
2. Trending videos (circuit open)
3. Cached popular videos (database down)

---

## Step 5: Database Schema (3 minutes)

```sql
-- Core videos table with engagement metrics
CREATE TABLE videos (
  id BIGSERIAL PRIMARY KEY,
  creator_id INTEGER REFERENCES users(id),
  raw_url VARCHAR(500),
  url VARCHAR(500),           -- Transcoded URL
  duration_seconds INTEGER,
  description TEXT,
  hashtags TEXT[],
  sound_id INTEGER REFERENCES sounds(id),
  view_count BIGINT DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  avg_completion_rate FLOAT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'processing',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Watch history for recommendations and analytics
CREATE TABLE watch_history (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  video_id BIGINT REFERENCES videos(id),
  watch_duration_ms INTEGER,
  completion_rate FLOAT,
  liked BOOLEAN DEFAULT FALSE,
  shared BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Composite index for user feed history
CREATE INDEX idx_watch_history_user_time
ON watch_history(user_id, created_at DESC);

-- GIN index for hashtag search
CREATE INDEX idx_videos_hashtags ON videos USING GIN(hashtags);

-- Partial index for active videos only
CREATE INDEX idx_videos_active_created
ON videos(created_at DESC)
WHERE status = 'published';
```

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
