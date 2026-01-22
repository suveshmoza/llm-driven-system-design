# YouTube - Video Platform - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Opening Statement

"I'll be designing the backend infrastructure for a video hosting and streaming platform like YouTube. This is one of the most challenging backend systems to design because it involves massive object storage, asynchronous transcoding pipelines, adaptive bitrate streaming with HLS, sophisticated recommendation algorithms, and global content delivery. Let me start by scoping the problem with a focus on the backend services."

---

## 1. Requirements Clarification (3-4 minutes)

### Functional Requirements

1. **Video Upload Pipeline**
   - Chunked upload handling for large files (up to 5GB)
   - Resumable uploads with S3 multipart
   - Validation and malware scanning
   - Queue-based transcoding workflow

2. **Transcoding Service**
   - Convert to multiple resolutions (1080p, 720p, 480p, 360p)
   - Generate HLS segments and manifests
   - Thumbnail generation at multiple timestamps
   - Status tracking and notifications

3. **Streaming Infrastructure**
   - HLS manifest generation and delivery
   - CDN integration for segment caching
   - Adaptive bitrate support
   - Resume playback position tracking

4. **Engagement APIs**
   - Comments with threading (parent/child relationships)
   - Like/dislike reactions with counter updates
   - Subscriptions with notification preferences
   - Watch history for recommendations

5. **Recommendation Engine**
   - Collaborative filtering based on watch patterns
   - Content-based filtering using categories/tags
   - Trending algorithm with time decay
   - Personalized home feed generation

### Non-Functional Requirements

- **Scale**: 500 hours video/minute upload, 1B views/day
- **Latency**: API responses < 200ms p95, video start < 2s
- **Throughput**: 17 Tbps streaming bandwidth
- **Consistency**: Eventual for view counts, strong for user actions

---

## 2. Scale Estimation (2-3 minutes)

### Storage Requirements

```
Daily video uploads: 500 hours/min x 60 min x 24 hours = 720,000 hours/day
Average video duration: 10 minutes
Daily uploads: 4.3 million videos

Raw storage per video: 1GB average
Daily raw storage: 4.3 PB

After transcoding (10% compression + multi-resolution):
- 1080p: 500k bitrate x 10 min = 375 MB
- 720p: 250k bitrate x 10 min = 187 MB
- 480p: 100k bitrate x 10 min = 75 MB
- 360p: 50k bitrate x 10 min = 37 MB
Total processed per video: ~674 MB average

Daily processed storage: ~2.9 PB
Annual storage growth: ~1 EB
```

### Bandwidth Calculations

```
Daily views: 1 billion
Average watch duration: 5 minutes
Average bitrate: 5 Mbps (720p)

Total daily bandwidth: 1B x 5 min x 60s x 5 Mbps
                     = 1.5 Exabits/day
                     = 17.4 Tbps continuous

CDN cache hit rate: 95% (popular content)
Origin bandwidth: 17.4 Tbps x 5% = 870 Gbps
```

### Database Scale

```
Video metadata: 1B videos x 10KB = 10 TB
User accounts: 2B users x 5KB = 10 TB
Comments: 100B comments x 500 bytes = 50 TB
Watch history: 500B entries x 100 bytes = 50 TB
```

---

## 3. High-Level Backend Architecture (8-10 minutes)

```
                                    ┌──────────────────────────────────────────┐
                                    │              CDN Edge Layer              │
                                    │    (Cloudflare/Akamai/Custom POPs)       │
                                    └──────────────────┬───────────────────────┘
                                                       │
                                    ┌──────────────────▼───────────────────────┐
                                    │            API Gateway / Nginx           │
                                    │   (Authentication, Rate Limiting, TLS)   │
                                    └────────────────────┬─────────────────────┘
                                                         │
           ┌─────────────────────┬───────────────────────┼───────────────────────┬──────────────────────┐
           │                     │                       │                       │                      │
  ┌────────▼────────┐  ┌────────▼────────┐  ┌───────────▼──────────┐  ┌────────▼────────┐  ┌──────────▼─────────┐
  │  Upload Service │  │ Metadata Service│  │   Streaming Service  │  │ Comment Service │  │ Recommendation Svc │
  │                 │  │                 │  │                      │  │                 │  │                    │
  │ - Chunked upload│  │ - Video CRUD    │  │ - Manifest generation│  │ - Thread mgmt   │  │ - Collaborative    │
  │ - S3 multipart  │  │ - Channel mgmt  │  │ - Segment routing    │  │ - Reactions     │  │ - Content-based    │
  │ - Validation    │  │ - Subscription  │  │ - Progress tracking  │  │ - Moderation    │  │ - Trending         │
  └────────┬────────┘  └────────┬────────┘  └───────────┬──────────┘  └────────┬────────┘  └──────────┬─────────┘
           │                    │                       │                      │                      │
           │                    │                       │                      │                      │
  ┌────────▼────────┐           │                       │                      │                      │
  │   Kafka/RMQ     │           │                       │                      │                      │
  │  (Job Queue)    │           │                       │                      │                      │
  └────────┬────────┘           │                       │                      │                      │
           │                    │                       │                      │                      │
  ┌────────▼────────┐           │                       │                      │                      │
  │ Transcoding     │           │                       │                      │                      │
  │ Workers (K8s)   │           │                       │                      │                      │
  │                 │           │                       │                      │                      │
  │ - FFmpeg encode │           │                       │                      │                      │
  │ - HLS segment   │           │                       │                      │                      │
  │ - Thumbnails    │           │                       │                      │                      │
  └────────┬────────┘           │                       │                      │                      │
           │                    │                       │                      │                      │
           └────────────────────┴───────────────────────┴──────────────────────┴──────────────────────┘
                                                        │
                     ┌──────────────────────────────────┼──────────────────────────────────┐
                     │                                  │                                  │
            ┌────────▼────────┐               ┌────────▼────────┐               ┌─────────▼────────┐
            │   PostgreSQL    │               │     Redis       │               │      MinIO       │
            │    (Primary)    │               │   (Cluster)     │               │   (S3 Storage)   │
            │                 │               │                 │               │                  │
            │ - Video metadata│               │ - Session store │               │ - Raw videos     │
            │ - Users/channels│               │ - View counters │               │ - HLS segments   │
            │ - Comments      │               │ - Cache layer   │               │ - Thumbnails     │
            │ - Watch history │               │ - Rate limits   │               │ - Avatars        │
            └─────────────────┘               └─────────────────┘               └──────────────────┘
```

### Service Responsibilities

| Service | Technology | Key Responsibilities |
|---------|------------|---------------------|
| Upload Service | Express + Multer | Chunked upload, S3 multipart, validation |
| Metadata Service | Express | Video/channel CRUD, subscriptions |
| Streaming Service | Express/Nginx | HLS manifests, segment routing |
| Comment Service | Express | Threading, reactions, moderation |
| Recommendation Service | Express + ML | Personalization, trending |
| Transcode Workers | Node/Python + FFmpeg | Video processing, HLS packaging |

---

## 4. Deep Dive: Chunked Upload and Transcoding Pipeline (10-12 minutes)

### Chunked Upload with S3 Multipart

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Upload Flow                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────────┐     ┌───────────────────────────┐ │
│  │   Client    │────▶│ Upload Service  │────▶│ S3 Multipart Upload Init  │ │
│  └─────────────┘     └─────────────────┘     └───────────────────────────┘ │
│        │                     │                           │                  │
│        │                     ▼                           │                  │
│        │           ┌─────────────────────┐               │                  │
│        │           │ Create Upload       │               │                  │
│        │           │ Session in DB       │◀──────────────┘                  │
│        │           └─────────────────────┘                                  │
│        │                                                                    │
│        └─────────────── For each 5MB chunk ──────────────────────────┐     │
│                              │                                        │     │
│                              ▼                                        │     │
│                    ┌─────────────────────┐                            │     │
│                    │   S3.uploadPart()   │                            │     │
│                    │   + Store ETag      │                            │     │
│                    │   in Redis          │                            │     │
│                    └─────────────────────┘                            │     │
│                                                                       │     │
│        ┌──────────────────────────────────────────────────────────────┘     │
│        │                                                                    │
│        ▼  On completion:                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  1. Verify all chunks received (compare Redis count to expected)    │   │
│  │  2. Call S3.completeMultipartUpload() with sorted ETags             │   │
│  │  3. Create video record with status='processing'                    │   │
│  │  4. Publish transcode job to message queue                          │   │
│  │  5. Cleanup Redis keys and update session status                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Upload Implementation Details:**

- **Chunk size**: 5MB per chunk for optimal parallelism
- **File validation**: Check MIME type against allowed types, enforce 5GB limit
- **Session management**: Store upload session in DB with 24-hour expiry
- **Parallel tracking**: Use Redis HSET for chunk ETags, HINCRBY for completion counter
- **Atomic completion**: S3 multipart requires sorted parts with ETags for final assembly
- **Video ID generation**: YouTube-style 11-character alphanumeric ID

### Transcoding Worker Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Transcoding Pipeline                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐                                                       │
│  │  Message Queue   │ consume job                                           │
│  │  (Kafka/RMQ)     │────────────────────┐                                  │
│  └──────────────────┘                    │                                  │
│                                          ▼                                  │
│                           ┌──────────────────────────────┐                  │
│                           │  1. Download raw video from  │                  │
│                           │     S3 to local temp         │                  │
│                           └──────────────┬───────────────┘                  │
│                                          │                                  │
│                                          ▼                                  │
│                           ┌──────────────────────────────┐                  │
│                           │  2. FFprobe: Extract source  │                  │
│                           │     resolution + duration    │                  │
│                           └──────────────┬───────────────┘                  │
│                                          │                                  │
│                                          ▼                                  │
│                           ┌──────────────────────────────┐                  │
│                           │  3. Generate thumbnails at   │                  │
│                           │     multiple timestamps      │                  │
│                           └──────────────┬───────────────┘                  │
│                                          │                                  │
│                        ┌─────────────────┼─────────────────┐                │
│                        ▼                 ▼                 ▼                │
│              ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│              │ Transcode    │  │ Transcode    │  │ Transcode    │           │
│              │ 1080p        │  │ 720p         │  │ 480p, 360p   │           │
│              │ (if source   │  │              │  │              │           │
│              │  supports)   │  │              │  │              │           │
│              └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│                     │                 │                 │                   │
│                     └─────────────────┼─────────────────┘                   │
│                                       │                                     │
│                                       ▼                                     │
│                           ┌──────────────────────────────┐                  │
│                           │  4. For each resolution:     │                  │
│                           │     - Segment into HLS .ts   │                  │
│                           │     - Generate playlist.m3u8 │                  │
│                           │     - Upload to S3           │                  │
│                           └──────────────┬───────────────┘                  │
│                                          │                                  │
│                                          ▼                                  │
│                           ┌──────────────────────────────┐                  │
│                           │  5. Generate master.m3u8     │                  │
│                           │     (links all qualities)    │                  │
│                           └──────────────┬───────────────┘                  │
│                                          │                                  │
│                                          ▼                                  │
│                           ┌──────────────────────────────┐                  │
│                           │  6. Update DB: status=ready  │                  │
│                           │     Publish video.published  │                  │
│                           │     event for notifications  │                  │
│                           └──────────────────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Resolution Configurations:**

| Resolution | Width | Height | Video Bitrate | Audio Bitrate |
|------------|-------|--------|---------------|---------------|
| 1080p | 1920 | 1080 | 5000k | 192k |
| 720p | 1280 | 720 | 2500k | 128k |
| 480p | 854 | 480 | 1000k | 96k |
| 360p | 640 | 360 | 500k | 64k |

**FFmpeg Transcoding Parameters:**
- Codec: libx264 with medium preset
- Rate control: VBR with maxrate = bitrate, bufsize = 2x bitrate
- Audio: AAC codec
- Flags: +faststart for progressive download

**HLS Segment Generation:**
- Segment duration: 4 seconds
- Playlist type: VOD (includes all segments)
- File pattern: segment_0000.ts, segment_0001.ts, etc.

### HLS Manifest Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HLS Manifest Hierarchy                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  master.m3u8 (Master Playlist)                                      │   │
│  │  ──────────────────────────────                                     │   │
│  │  #EXTM3U                                                            │   │
│  │  #EXT-X-VERSION:3                                                   │   │
│  │                                                                     │   │
│  │  #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080           │   │
│  │  1080p/playlist.m3u8                                                │   │
│  │                                                                     │   │
│  │  #EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720            │   │
│  │  720p/playlist.m3u8                                                 │   │
│  │                                                                     │   │
│  │  #EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480             │   │
│  │  480p/playlist.m3u8                                                 │   │
│  │                                                                     │   │
│  │  #EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360              │   │
│  │  360p/playlist.m3u8                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│              ┌───────────────┼───────────────┐                             │
│              ▼               ▼               ▼                             │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐        │
│  │ 720p/playlist.m3u8│ │ 480p/playlist.m3u8│ │ ...               │        │
│  │ ──────────────────│ │                   │ │                   │        │
│  │ #EXTM3U           │ │                   │ │                   │        │
│  │ #EXT-X-VERSION:3  │ │                   │ │                   │        │
│  │ #TARGETDURATION:4 │ │                   │ │                   │        │
│  │ #PLAYLIST-TYPE:VOD│ │                   │ │                   │        │
│  │                   │ │                   │ │                   │        │
│  │ #EXTINF:4.000,    │ │                   │ │                   │        │
│  │ segment_0000.ts   │ │                   │ │                   │        │
│  │ #EXTINF:4.000,    │ │                   │ │                   │        │
│  │ segment_0001.ts   │ │                   │ │                   │        │
│  │ ...               │ │                   │ │                   │        │
│  │ #EXT-X-ENDLIST    │ │                   │ │                   │        │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Deep Dive: View Counting and CDN Caching (6-8 minutes)

### Batched View Count Updates

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     View Count Batching Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User watches video                                                         │
│        │                                                                    │
│        ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Redis INCR views:pending:{videoId}                                 │   │
│  │  (Atomic increment, no DB hit)                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│        │                                                                    │
│        ├───▶ Optionally store view metadata for analytics                   │
│        │     (userId, timestamp, quality) in Redis list                     │
│        │                                                                    │
│        ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Background Job (every 60 seconds)                                  │   │
│  │  ─────────────────────────────────                                  │   │
│  │                                                                     │   │
│  │  1. SCAN for all views:pending:* keys                               │   │
│  │  2. For each key:                                                   │   │
│  │     - GETSET key to 0 (atomically get current and reset)           │   │
│  │     - If count > 0:                                                 │   │
│  │       - UPDATE videos SET view_count = view_count + count           │   │
│  │       - Invalidate video cache                                      │   │
│  │       - Update trending score                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Trending Score Calculation                                         │   │
│  │  ─────────────────────────────                                      │   │
│  │                                                                     │   │
│  │  Score = viewDelta * decayFactor                                    │   │
│  │                                                                     │   │
│  │  decayFactor = 0.5^(ageHours/24)                                    │   │
│  │  (Score halves every 24 hours)                                      │   │
│  │                                                                     │   │
│  │  Store in Redis sorted sets:                                        │   │
│  │  - ZINCRBY trending:global score videoId                            │   │
│  │  - ZINCRBY trending:{category} score videoId                        │   │
│  │  - ZREMRANGEBYRANK trending:global 0 -1001 (keep top 1000)          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Multi-Tier CDN Caching Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CDN Caching Architecture                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Edge Tier (Closest to users)                                       │   │
│  │  ────────────────────────────                                       │   │
│  │  TTL: 1 hour                                                        │   │
│  │  Stale-while-revalidate: 5 minutes                                  │   │
│  │  Cacheable responses: 200, 206 (partial content)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼ Cache miss                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Regional Tier (POPs)                                               │   │
│  │  ────────────────────                                               │   │
│  │  TTL: 24 hours                                                      │   │
│  │  Min freshness: 1 hour                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼ Cache miss                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Origin Shield (Single cache layer facing origin)                   │   │
│  │  ─────────────────────────────────────────────────                  │   │
│  │  Aggregates requests from all regional POPs                         │   │
│  │  Reduces origin load by 95%                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Origin (MinIO/S3)                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Nginx HLS Caching Configuration:**

| Content Type | Cache Path | Cache Duration | Notes |
|--------------|------------|----------------|-------|
| HLS Segments (.ts) | /var/cache/nginx/hls | 7 days | Immutable, long cache |
| Manifests (.m3u8) | /var/cache/nginx/hls | 5 minutes | Short cache, can regenerate |

**Key Caching Features:**
- Range request support for video seeking
- Stale-while-revalidate for graceful degradation
- Cache status header (X-Cache-Status) for debugging
- Cache key includes URI and query args

**Pre-warming Popular Content:**
1. Get list of edge POP locations
2. Prefetch master.m3u8 and quality playlists
3. Prefetch first 10 segments of each quality (~40 seconds of video)
4. Issue prefetch requests to all edge locations

---

## 6. Deep Dive: Recommendation System (5-6 minutes)

### Hybrid Recommendation Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Recommendation Flow                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User requests home feed                                                    │
│        │                                                                    │
│        ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Parallel Candidate Generation                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│        │                                                                    │
│        ├──────────────┬──────────────┬──────────────┐                      │
│        ▼              ▼              ▼              ▼                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │Collabor- │  │Content-  │  │Subscrib- │  │Trending  │                   │
│  │ative     │  │Based     │  │tion Feed │  │          │                   │
│  │Filter    │  │Filter    │  │          │  │          │                   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘                   │
│       │             │             │             │                          │
│       └─────────────┴─────────────┴─────────────┘                          │
│                          │                                                  │
│                          ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Merge & Deduplicate                                                │   │
│  │  - Build candidate map by videoId                                   │   │
│  │  - Track which sources contributed each video                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                          │                                                  │
│                          ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Score & Rank                                                       │   │
│  │  - Apply source weights                                             │   │
│  │  - Calculate engagement quality                                     │   │
│  │  - Apply freshness decay                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                          │                                                  │
│                          ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Return top N videos                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Collaborative Filtering

**Goal:** Find videos watched by users with similar taste

**Algorithm:**
1. Get current user's last 100 watched videos (with >50% completion)
2. Find similar users who watched the same videos with high completion
3. Require at least 5 overlapping videos
4. Rank by overlap count and average completion
5. Get videos those similar users watched that current user hasn't
6. Score by: sum(overlap * watch_percentage) across similar users

### Content-Based Filtering

**Goal:** Find videos in categories the user prefers

**Algorithm:**
1. Extract category preferences from last 30 days of watch history
2. Weight categories by total watch percentage
3. Find videos in preferred categories user hasn't seen
4. Score by: category weight match * engagement ratio (likes/views)

### Final Scoring Formula

| Source | Weight |
|--------|--------|
| Subscribed channel | +100 |
| Collaborative filter | +50 |
| Content-based filter | +30 |
| Trending | +20 |

**Additional Factors:**
- Engagement quality: likeCount / (likeCount + dislikeCount + 1) * 40
- Freshness decay: score *= e^(-ageHours/48) (half-life of 48 hours)

---

## 7. Database Schema and Indexes (4-5 minutes)

### Core Tables

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PostgreSQL Schema                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  videos                                                              │   │
│  │  ──────                                                              │   │
│  │  id VARCHAR(11) PRIMARY KEY       -- YouTube-style 11-char ID       │   │
│  │  channel_id UUID FK → users                                          │   │
│  │  title VARCHAR(100)                                                  │   │
│  │  description TEXT                                                    │   │
│  │  duration_seconds INTEGER                                            │   │
│  │  status VARCHAR(20) DEFAULT 'processing'                             │   │
│  │  visibility VARCHAR(20) DEFAULT 'public'                             │   │
│  │  view_count BIGINT DEFAULT 0                                         │   │
│  │  like_count, dislike_count, comment_count BIGINT                     │   │
│  │  categories TEXT[]                                                   │   │
│  │  tags TEXT[]                                                         │   │
│  │  thumbnail_url TEXT                                                  │   │
│  │  published_at TIMESTAMP                                              │   │
│  │                                                                     │   │
│  │  Indexes:                                                           │   │
│  │  - (channel_id, published_at DESC)          -- Channel videos       │   │
│  │  - (published_at DESC) WHERE status='ready' -- Public feed          │   │
│  │  - GIN(categories)                          -- Category search      │   │
│  │  - GIN(tags)                                -- Tag search           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  video_resolutions                                                  │   │
│  │  ─────────────────                                                  │   │
│  │  video_id VARCHAR(11) FK                                            │   │
│  │  resolution VARCHAR(10)                                             │   │
│  │  manifest_url TEXT                                                  │   │
│  │  bitrate INTEGER                                                    │   │
│  │  width, height INTEGER                                              │   │
│  │  PRIMARY KEY (video_id, resolution)                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  comments                                                            │   │
│  │  ────────                                                            │   │
│  │  id UUID PRIMARY KEY                                                 │   │
│  │  video_id VARCHAR(11) FK                                             │   │
│  │  user_id UUID FK                                                     │   │
│  │  parent_id UUID FK → comments (nullable, for threading)              │   │
│  │  text TEXT                                                           │   │
│  │  like_count INTEGER DEFAULT 0                                        │   │
│  │  is_edited BOOLEAN DEFAULT FALSE                                     │   │
│  │                                                                     │   │
│  │  Indexes:                                                           │   │
│  │  - (video_id, created_at DESC)              -- Video comments       │   │
│  │  - (parent_id) WHERE parent_id IS NOT NULL  -- Replies              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  watch_history                                                      │   │
│  │  ─────────────                                                      │   │
│  │  id UUID PRIMARY KEY                                                 │   │
│  │  user_id UUID FK                                                     │   │
│  │  video_id VARCHAR(11) FK                                             │   │
│  │  watch_duration_seconds INTEGER DEFAULT 0                            │   │
│  │  watch_percentage DECIMAL(5,2)                                       │   │
│  │  last_position_seconds INTEGER DEFAULT 0                             │   │
│  │  watched_at TIMESTAMP                                                │   │
│  │                                                                     │   │
│  │  Indexes:                                                           │   │
│  │  - (user_id, watched_at DESC)               -- User history         │   │
│  │  - (video_id, watch_percentage)             -- Recommendation query │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Redis Data Structures

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| views:pending:{videoId} | STRING | Buffered view count (flushed every minute) |
| trending:global | ZSET | Global trending videos (score = views * decay) |
| trending:{category} | ZSET | Category-specific trending |
| session:{sessionId} | HASH | User session (userId, username, role, expiresAt) |
| video:{videoId} | JSON | Cached video metadata |
| upload:{uploadId} | HASH | Upload progress (completedChunks, status) |
| upload:{uploadId}:parts | HASH | Chunk ETags (partNumber: etag) |
| ratelimit:{ip}:{endpoint} | STRING | Rate limit counter with TTL |

---

## 8. Trade-offs and Alternatives (4-5 minutes)

### Storage Architecture

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| S3/MinIO | Scalable, cheap per GB, durable | Latency, needs CDN | **Chosen** - CDN solves latency |
| Custom distributed FS | Low latency, control | Complex ops, expensive | Avoid unless massive scale |
| Block storage + NFS | Simple | Not scalable | Local dev only |

### Video Format Strategy

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| HLS only | Wide support, Apple native | Older standard | **Chosen** - best compatibility |
| DASH only | Open standard, modern | Less iOS support | Good alternative |
| Both HLS + DASH | Maximum reach | 2x storage | Justified at scale |

### Transcoding Architecture

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Sync transcoding | Simple | Blocks upload, slow | Never for video |
| Async with RabbitMQ | Reliable, retries | Single queue bottleneck | **Chosen** for learning |
| Kafka + workers | Parallel, scalable | More complex | Production at scale |
| Serverless (Lambda) | Auto-scale | Cold start, duration limits | Good for burst |

### View Count Consistency

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Sync DB update | Accurate | DB bottleneck at scale | Never |
| Redis buffer + batch | Fast, scalable | Eventual consistency | **Chosen** |
| HyperLogLog | Very low memory | Approximate only | For unique views |

---

## 9. Monitoring and Observability (3-4 minutes)

### Key Backend Metrics

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Prometheus Metrics                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Upload Metrics                                                             │
│  ──────────────                                                             │
│  video_uploads_total{status}          Counter    initiated/completed/failed │
│  video_upload_size_bytes              Histogram  1MB to 5GB buckets         │
│                                                                             │
│  Transcoding Metrics                                                        │
│  ───────────────────                                                        │
│  transcode_queue_depth                Gauge      Pending jobs               │
│  transcode_duration_seconds{res,stat} Histogram  1min to 1hour buckets      │
│                                                                             │
│  Streaming Metrics                                                          │
│  ─────────────────                                                          │
│  video_views_total{quality}           Counter    Views by quality           │
│  video_watch_duration_seconds         Histogram  Watch time per session     │
│                                                                             │
│  Cache Metrics                                                              │
│  ─────────────                                                              │
│  cache_hit_ratio{cache_type}          Gauge      Redis cache effectiveness  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Alerting Rules

| Metric | Warning | Critical |
|--------|---------|----------|
| Transcode queue depth | > 50 jobs | > 200 jobs |
| Transcode failure rate | > 5% | > 15% |
| API p95 latency | > 500ms | > 2s |
| Upload failure rate | > 2% | > 10% |
| CDN cache hit ratio | < 90% | < 70% |
| DB connection pool | > 80% used | > 95% used |

---

## 10. Summary

The backend architecture for YouTube focuses on:

1. **Chunked Upload Pipeline**: S3 multipart uploads with resumable chunks handle large files reliably while tracking progress in Redis

2. **Async Transcoding**: Kafka/RabbitMQ job queue with FFmpeg workers generates HLS segments for adaptive streaming across multiple resolutions

3. **View Count Batching**: Redis buffers view increments with periodic flushes to PostgreSQL, preventing database bottleneck while maintaining eventual consistency

4. **Multi-Tier CDN**: Edge caching with HLS segment-level granularity, regional POPs, and origin shield reduce origin load to 5% of total bandwidth

5. **Hybrid Recommendations**: Collaborative filtering (similar users), content-based filtering (categories/tags), and trending algorithms combine for personalized feeds

6. **Denormalized Counters**: View, like, and subscriber counts are denormalized for read performance with trigger-based updates maintaining consistency

The system handles 500 hours of video per minute through horizontal scaling of stateless services, massive object storage capacity, and global CDN distribution.
