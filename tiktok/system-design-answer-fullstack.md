# TikTok - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Opening Statement

"Today I'll design a short-video platform like TikTok, taking a full-stack perspective that emphasizes the integration between frontend and backend systems. The core challenge is building an end-to-end recommendation experience where personalized content appears instantly, user engagement flows seamlessly from UI to data pipeline, and cold start problems are solved through coordinated frontend/backend strategies. I'll focus on shared TypeScript types for API contracts, real-time watch tracking that feeds the recommendation engine, and the complete flow from video upload to appearing in personalized feeds."

---

## Step 1: Requirements Clarification (3 minutes)

### Functional Requirements

1. **For You Page (FYP)**: Personalized infinite scroll with instant video playback
2. **Upload Flow**: Capture/select, preview, publish with real-time processing status
3. **Engagement**: Like, comment, share with optimistic UI and backend sync
4. **Cold Start**: Onboard new users and boost new videos effectively
5. **Creator Analytics**: Real-time metrics dashboard synced with backend data

### Non-Functional Requirements

- **Latency**: < 100ms for feed API, < 500ms for video start
- **Consistency**: Engagement counts eventually consistent (5-minute window)
- **Type Safety**: Shared types between frontend and backend
- **Real-time**: Processing status updates, live engagement counts

### Full-Stack Integration Challenges

- Shared TypeScript types for API contracts
- Watch time tracking with client-side precision and server-side aggregation
- Optimistic updates with rollback on API failure
- Cold start coordination between onboarding UI and recommendation engine
- Upload progress and transcoding status across the stack

---

## Step 2: End-to-End Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              React Frontend                                  │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────┐    │
│  │  Virtualized Feed │  │    Upload Flow    │  │  Creator Analytics    │    │
│  └─────────┬─────────┘  └─────────┬─────────┘  └───────────┬───────────┘    │
│            │                      │                        │                 │
│            ▼                      ▼                        ▼                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         Zustand Stores                                │   │
│  │        feedStore  │  uploadStore  │  engagementStore  │  userStore   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ API Layer (shared types)
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Express Backend                                 │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────┐    │
│  │     Feed API      │  │    Video API      │  │    Analytics API      │    │
│  │    /api/feed      │  │   /api/videos     │  │   /api/analytics      │    │
│  └─────────┬─────────┘  └─────────┬─────────┘  └───────────┬───────────┘    │
│            │                      │                        │                 │
│            ▼                      ▼                        ▼                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      Recommendation Engine                            │   │
│  │     Candidate Gen  │  Ranking  │  Cold Start Handler  │  pgvector   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               Data Layer                                     │
│      PostgreSQL + pgvector  │  Redis Cache  │  MinIO Storage  │  Kafka     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Core Full-Stack Deep Dives

### Deep Dive 1: Shared TypeScript Types & API Contracts (8 minutes)

**Shared Types Package:**

Types defined once, used by both frontend and backend:
- `User`: id, username, displayName, avatarUrl, role, createdAt
- `Video`: id, creatorId, creator, url, thumbnailUrl, description, hashtags, durationSeconds, viewCount, likeCount, commentCount, shareCount, isLiked (personalized), status, createdAt
- `FeedResponse`: videos array, nextCursor, source ('personalized' | 'trending' | 'following')
- `UploadResponse`: videoId, status ('processing'), uploadedAt
- `EngagementEvent`: videoId, watchDurationMs, completionRate, liked, shared
- `AnalyticsData`: date, views, likes, shares, comments, avgCompletionRate
- `FeedRequest`: limit, cursor, source ('fyp' | 'following' | 'trending')
- `TrackWatchRequest`: videoId, watchDurationMs, totalDurationMs, completed

**Backend API Handler Flow:**

```
┌────────────────────┐    ┌─────────────────────┐    ┌────────────────────┐
│   GET /api/feed    │───▶│  Check user session │───▶│  Has userId?       │
└────────────────────┘    └─────────────────────┘    └─────────┬──────────┘
                                                               │
                          ┌────────────────────────────────────┼────────────────┐
                          │                                    │                │
                          ▼                                    ▼                │
               ┌──────────────────────┐             ┌──────────────────────┐    │
               │  getPersonalizedFeed │             │   getTrendingFeed    │    │
               │  source: personalized│             │   source: trending   │    │
               └──────────┬───────────┘             └──────────┬───────────┘    │
                          │                                    │                │
                          └────────────────┬───────────────────┘                │
                                           ▼                                    │
                                ┌──────────────────────┐                        │
                                │ Compute nextCursor   │                        │
                                │ Return FeedResponse  │                        │
                                └──────────────────────┘                        │
                                           │                                    │
                                           ▼                                    │
                          ┌────────────────────────────────────┐                │
                          │  On error: Circuit breaker fallback │◀──────────────┘
                          │  Return trending as degraded mode   │
                          └────────────────────────────────────┘
```

**Frontend Store Pattern:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         FeedStore                                │
├─────────────────────────────────────────────────────────────────┤
│  State:                                                          │
│  - videos: Video[]                                               │
│  - cursor: string | null                                         │
│  - source: 'personalized' | 'trending' | 'following' | null     │
│  - isLoading: boolean                                            │
│  - hasMore: boolean                                              │
├─────────────────────────────────────────────────────────────────┤
│  Actions:                                                        │
│  - fetchNextPage(): Append new videos, update cursor             │
│  - updateVideo(id, updates): Optimistic update single video     │
└─────────────────────────────────────────────────────────────────┘
```

---

### Deep Dive 2: End-to-End Watch Tracking (10 minutes)

Watch time is the primary signal for recommendations. The full-stack flow coordinates precise client-side measurement with server-side aggregation.

**Frontend Watch Tracking Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        useWatchTracking Hook                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Video becomes ACTIVE                Video becomes INACTIVE                 │
│         │                                      │                             │
│         ▼                                      ▼                             │
│   ┌──────────────┐                    ┌──────────────────────┐              │
│   │ startTimeRef │                    │ Accumulate watch time│              │
│   │ = Date.now() │                    │ watchedMs += elapsed │              │
│   └──────────────┘                    └──────────┬───────────┘              │
│                                                  │                           │
│                                                  ▼                           │
│                                       ┌──────────────────────┐              │
│                                       │ Queue tracking event │              │
│                                       │ to batch sender      │              │
│                                       └──────────────────────┘              │
├─────────────────────────────────────────────────────────────────────────────┤
│   On beforeunload:                                                           │
│   ┌───────────────────────────────────────────────────────────────────┐     │
│   │ Use navigator.sendBeacon() for reliable delivery on page close    │     │
│   └───────────────────────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────────────────────────┤
│   Event Batching:                                                            │
│   ┌───────────────────┐    2s timer    ┌───────────────────────────────┐    │
│   │ pendingEvents[]   │───────────────▶│ POST /api/engagement/track-batch│   │
│   └───────────────────┘                └───────────────────────────────┘    │
│                                                  │                           │
│                                                  ▼ On failure               │
│                                        Re-queue failed events               │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Backend Watch Event Processing:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    processWatchEvent(userId, event)                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │ 1. Fast Path: Increment view count in Redis                     │    │
│   │    redis.incr(`views:${videoId}`)                               │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                              │                                            │
│                              ▼                                            │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │ 2. If authenticated: Send to Kafka 'watch-events' topic         │    │
│   │    { userId, videoId, watchDurationMs, completionRate }         │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                              │                                            │
│                              ▼                                            │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │ 3. Update real-time metrics hash in Redis                       │    │
│   │    video:${videoId}:metrics { totalWatchMs, watchCount }        │    │
│   └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Background Worker: Embedding Updates:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Embedding Updater Worker                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Kafka 'watch-events' ──▶ Consumer                                      │
│                              │                                           │
│                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │ Calculate engagement weight = completionRate + (completed? 0.2)  │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │ Get video embedding from video_embeddings table                  │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │ Update user embedding with exponential moving average:           │  │
│   │   user_embedding = 0.95 * old + 0.05 * video_embedding * weight  │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Deep Dive 3: Optimistic Engagement with Backend Sync (8 minutes)

**Frontend Optimistic Like Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Optimistic Like Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   User clicks LIKE                                                           │
│         │                                                                    │
│         ▼                                                                    │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 1. Set pendingLikes.set(videoId, 'liking')                           │  │
│   │ 2. Optimistically update feed: isLiked=true, likeCount++             │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│         │                                                                    │
│         ▼                                                                    │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ POST /api/videos/${videoId}/like                                     │  │
│   │ Headers: X-Idempotency-Key: like-${videoId}-${timestamp}             │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│         │                                                                    │
│         ├──────────────── SUCCESS ─────────────────┐                        │
│         │                                          │                        │
│         ▼                                          ▼                        │
│   ┌─────────────────┐                    ┌─────────────────────────────┐   │
│   │    FAILURE      │                    │ Clear pending state         │   │
│   └────────┬────────┘                    │ pendingLikes.delete(videoId)│   │
│            │                             └─────────────────────────────┘   │
│            ▼                                                                │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ ROLLBACK: isLiked=false, likeCount--                                 │  │
│   │ Add to failedLikes set for retry UI                                  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Backend Idempotent Like Handler:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    POST /api/videos/:id/like                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Check idempotency key in Redis                                   │   │
│   │    If exists: return cached response (prevents duplicate likes)     │   │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              ▼                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 2. Check existing like in database                                  │   │
│   │    If already liked: return { success: true, alreadyLiked: true }   │   │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              ▼                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 3. Transaction:                                                     │   │
│   │    - INSERT INTO likes (user_id, video_id)                          │   │
│   │    - UPDATE videos SET like_count = like_count + 1                  │   │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              ▼                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 4. Store idempotency result (24h TTL)                               │   │
│   │ 5. Update watch_history.liked = true for recommendations            │   │
│   └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Deep Dive 4: Cold Start Coordination (8 minutes)

**Frontend Onboarding Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Onboarding Page                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Interest Categories                               │   │
│   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │   │
│   │  │ Comedy │ │ Music  │ │ Dance  │ │  Food  │ │ Sports │            │   │
│   │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘            │   │
│   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │   │
│   │  │  Pets  │ │  DIY   │ │ Beauty │ │ Gaming │ │ Travel │            │   │
│   │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼ User selects >= 3 interests                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ POST /api/users/me/interests { interests: ['comedy', 'music', ...] } │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Loading: "Personalizing your feed..."                                │   │
│   │ Then redirect to FYP with personalized content                       │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Backend Interest-to-Embedding Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│               POST /api/users/me/interests                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Interests: ['comedy', 'music', 'gaming']                                   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Map to hashtags:                                                     │   │
│   │   comedy  -> ['funny', 'comedy', 'humor', 'jokes', 'lol']           │   │
│   │   music   -> ['music', 'song', 'singing', 'musician', 'cover']      │   │
│   │   gaming  -> ['gaming', 'gamer', 'videogames', 'streamer']          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Find top 100 published videos with matching hashtags                 │   │
│   │ SELECT embedding FROM videos WHERE hashtags && $1 ORDER BY views    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Compute average embedding across all matched video embeddings        │   │
│   │ Store as initial user_embedding in user_embeddings table             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**New Video Boost Worker:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    New Video Boost Worker                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Kafka 'video-published' ──▶ Consumer                                       │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Get video embedding and hashtags                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ├─────────────────────────────────────────────────────────────┐     │
│         │                                                             │     │
│         ▼                                                             ▼     │
│   ┌───────────────────────────┐                    ┌───────────────────────┐│
│   │ Find 1000 users with      │                    │ Find 500 users who    ││
│   │ similar embeddings        │                    │ engage with hashtags  ││
│   │ ORDER BY embedding <=> $1 │                    │ (completion > 50%)    ││
│   └───────────────────────────┘                    └───────────────────────┘│
│         │                                                   │               │
│         └─────────────────────┬─────────────────────────────┘               │
│                               ▼                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Dedupe and add videoId to each user's exploration pool in Redis     │   │
│   │ SADD exploration:${userId} ${videoId}  (TTL: 1 hour)                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Schedule performance check in 1 hour via Kafka                       │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Deep Dive 5: Upload Flow with Processing Status (8 minutes)

**Frontend Upload Component Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Upload Page States                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   IDLE ──▶ User selects file                                                 │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ UPLOADING                                                            │   │
│   │ ┌───────────────────────────────────────────┐                       │   │
│   │ │ XHR with progress tracking                │                       │   │
│   │ │ ████████████████░░░░░░░░░░░░  67%        │                       │   │
│   │ └───────────────────────────────────────────┘                       │   │
│   │ Headers: X-Idempotency-Key: UUID                                    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼ Receive videoId                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ PROCESSING                                                           │   │
│   │ "Your video is being optimized for all devices"                      │   │
│   │ Poll GET /api/videos/${videoId}/status every 2 seconds               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ├──────────── status: 'published' ──────────┐                       │
│         │                                           │                       │
│         ▼                                           ▼                       │
│   ┌─────────────────┐                    ┌─────────────────────────────┐   │
│   │ status: 'failed'│                    │ PUBLISHED                   │   │
│   │      ERROR      │                    │ "Video published!"          │   │
│   │ [Retry button]  │                    │ Redirect to feed in 2s      │   │
│   └─────────────────┘                    └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Backend Upload Pipeline:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    POST /api/videos (Upload Endpoint)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Check idempotency key - return cached if exists                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 2. Store raw video to MinIO: raw/${userId}/${timestamp}-${name}     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 3. Create video record in PostgreSQL (status: 'processing')         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 4. Queue to Kafka 'video-transcoding':                               │   │
│   │    { videoId, rawKey, resolutions: [1080p, 720p, 480p, 360p] }      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 5. Store idempotency result, return 202 Accepted                     │   │
│   │    { videoId, status: 'processing', uploadedAt }                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    GET /api/videos/:id/status                                │
├─────────────────────────────────────────────────────────────────────────────┤
│   Returns: { status: 'processing' | 'published' | 'failed' }                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 4: Key Design Decisions & Trade-offs (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Type sharing | Shared package | OpenAPI codegen | Simpler, works with TypeScript |
| Watch tracking | Client timer + batch | Server-side only | More accurate, handles tab switches |
| Optimistic UI | Zustand with pending state | React Query mutations | Finer control over rollback |
| Cold start | Interests + implicit learning | Implicit only | Faster personalization convergence |
| Upload status | Polling | WebSocket | Simpler, fewer connections |
| Idempotency | Client-generated UUID | Server nonce | Works offline, no extra roundtrip |

---

## Step 5: Error Handling Across the Stack (2 minutes)

**Frontend Error Handling:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Error Handler Hook                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   API Error received                                                         │
│         │                                                                    │
│         ├──── 401 Unauthorized ────▶ Redirect to /login                     │
│         │                                                                    │
│         ├──── 429 Rate Limited ────▶ Toast: "Too many requests"             │
│         │                                                                    │
│         └──── Other errors ────────▶ Set error state for UI display         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Backend Error Response Format:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Consistent API Error Response                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   { error: string, code: string, details?: object }                          │
│                                                                              │
│   ValidationError  ──▶  400 { error: "Validation failed", code: "VALIDATION"}│
│   RateLimitError   ──▶  429 { error: "Rate limit exceeded", code: "RATE_LIM"}│
│   UnknownError     ──▶  500 { error: "Internal server error", code: "INTERNAL"}│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Closing Summary

I've designed a full-stack TikTok-like platform with focus on five integration areas:

1. **Shared TypeScript Types**: API contracts defined once, used in both frontend and backend. Ensures type safety across the network boundary.

2. **End-to-End Watch Tracking**: Client-side timer with batch sending, server-side aggregation in Redis, background worker updates to user embeddings for personalization.

3. **Optimistic Engagement**: Zustand stores with pending state management, idempotent backend handlers, automatic rollback on failure.

4. **Cold Start Coordination**: Frontend interest selector initializes user embedding on backend. New video boost worker finds target users via embedding similarity.

5. **Upload Flow**: XHR with progress tracking, idempotent upload handler, Kafka transcoding queue, status polling until published.

**Full-stack trade-offs:**
- Shared types require build coordination but eliminate drift
- Client-side watch tracking is more accurate but adds complexity
- Polling for upload status is simpler than WebSocket but higher latency
