# YouTube - Video Platform - Architecture Design

## System Overview

A video hosting and streaming platform that supports video upload, transcoding, adaptive streaming, recommendations, and social features (comments, subscriptions, reactions). Designed for local development learning with patterns that scale to production.

## Requirements

### Functional Requirements

- **Video Upload**: Chunked uploads for large files (up to 5GB), progress tracking, resumable uploads
- **Transcoding**: Convert uploaded videos to multiple resolutions (1080p, 720p, 480p, 360p) with HLS packaging
- **Streaming**: Adaptive bitrate streaming via HLS, quality selection, seek support
- **Channels**: User-owned channels with customization (banner, description, playlists)
- **Subscriptions**: Subscribe to channels, subscription feed
- **Comments**: Threaded comments on videos, replies, reactions
- **Recommendations**: Personalized video suggestions based on watch history and subscriptions
- **Search**: Full-text search across video titles, descriptions, and channel names

### Non-Functional Requirements

- **Scalability**: Handle 1,000 concurrent users locally; design patterns support horizontal scaling
- **Availability**: 99.9% uptime target for streaming; graceful degradation for non-critical features
- **Latency**: Video start time < 2 seconds; API responses < 200ms p95; search < 500ms p95
- **Consistency**: Strong consistency for user actions (comments, subscriptions); eventual consistency for view counts and recommendations

## Capacity Estimation

### Local Development Scale

For learning and testing, target these baseline metrics:

| Metric | Value | Sizing Implication |
|--------|-------|-------------------|
| Daily Active Users (DAU) | 100 | Single PostgreSQL instance sufficient |
| Concurrent Viewers | 50 | 2-3 API server instances behind load balancer |
| Video Uploads/Day | 20 | Single transcoding worker handles queue |
| Average Video Size | 500 MB (raw) | ~10 GB/day raw storage growth |
| Videos in Library | 1,000 | ~50 GB processed video storage |
| Comments/Day | 500 | ~50 KB/day metadata growth |

### Derived Capacity Targets

| Component | Calculation | Target |
|-----------|-------------|--------|
| API RPS (peak) | 50 users x 2 req/sec | 100 RPS |
| Upload Bandwidth | 20 uploads x 500 MB / 86400 sec | ~120 KB/s average |
| Streaming Bandwidth | 50 viewers x 5 Mbps (720p) | ~31 MB/s peak |
| PostgreSQL Storage | 1,000 videos x 5 KB metadata + comments | ~50 MB/year |
| Redis Memory | Session + cache for 100 users | ~100 MB |
| MinIO Storage | 1,000 videos x 50 MB (processed avg) | ~50 GB |

### SLO Targets

| Service | Metric | Target | Alerting Threshold |
|---------|--------|--------|-------------------|
| API Gateway | Availability | 99.9% | < 99.5% over 5 min |
| Video Streaming | Time to first byte | < 500ms p95 | > 1s p95 |
| Video Playback | Start time | < 2s p95 | > 3s p95 |
| Metadata API | Response latency | < 200ms p95 | > 500ms p95 |
| Search | Query latency | < 500ms p95 | > 1s p95 |
| Upload Processing | Queue time | < 5 min p95 | > 15 min |
| Transcoding | Completion time | < 30 min/video | > 1 hour |

## High-Level Architecture

```
                                    +------------------+
                                    |   CDN / Nginx    |
                                    |  (Static + HLS)  |
                                    +--------+---------+
                                             |
                    +------------------------+------------------------+
                    |                        |                        |
           +--------v--------+      +--------v--------+      +--------v--------+
           |  Upload Service |      |   API Gateway   |      | Streaming Svc   |
           |   (Port 3002)   |      |   (Port 3000)   |      |   (Port 3003)   |
           +--------+--------+      +--------+--------+      +--------+--------+
                    |                        |                        |
                    |                +-------+-------+                |
                    |                |               |                |
           +--------v--------+  +----v----+  +------v------+         |
           |   RabbitMQ      |  |  Redis  |  | PostgreSQL  |         |
           | (Transcode Q)   |  | (Cache) |  | (Metadata)  |         |
           +--------+--------+  +---------+  +-------------+         |
                    |                                                 |
           +--------v--------+                               +--------v--------+
           | Transcode Worker|                               |     MinIO       |
           | (Background)    +------------------------------>|  (Video Store)  |
           +-----------------+                               +-----------------+
```

### Core Components

| Component | Responsibility | Technology | Port |
|-----------|---------------|------------|------|
| API Gateway | Route requests, auth, rate limiting | Express.js | 3000 |
| Upload Service | Chunked uploads, validation | Express.js | 3002 |
| Streaming Service | HLS manifest, segment delivery | Express.js | 3003 |
| Transcode Worker | Video processing, thumbnail generation | Node.js + FFmpeg | - |
| PostgreSQL | User/video/comment metadata | PostgreSQL 16 | 5432 |
| Redis/Valkey | Session store, caching, rate limiting | Valkey 7 | 6379 |
| RabbitMQ | Transcode job queue | RabbitMQ 3.12 | 5672 |
| MinIO | Video and thumbnail storage | MinIO | 9000 |

## Request Flows

### Video Upload Flow

```
1. Client initiates upload
   POST /api/v1/uploads/init
   Body: { filename, fileSize, mimeType }
   Response: { uploadId, chunkSize, totalChunks }

2. Client uploads chunks (parallel, up to 3 concurrent)
   PUT /api/v1/uploads/:uploadId/chunks/:chunkNumber
   Body: binary chunk data
   Response: { received: true, etag }

3. Client completes upload
   POST /api/v1/uploads/:uploadId/complete
   Body: { title, description, channelId, tags }

4. Server actions:
   a. Validate all chunks received
   b. Assemble chunks into raw video file
   c. Store raw video in MinIO (raw-videos bucket)
   d. Create video record in PostgreSQL (status: 'processing')
   e. Publish transcode job to RabbitMQ
   Response: { videoId, status: 'processing' }

5. Transcode worker picks up job
   a. Download raw video from MinIO
   b. Generate thumbnail at 10% mark
   c. Transcode to multiple resolutions (1080p, 720p, 480p, 360p)
   d. Package as HLS (10-second segments)
   e. Upload processed files to MinIO (videos bucket)
   f. Update video record (status: 'ready', duration, resolutions)
   g. Acknowledge job completion
```

### Video Playback Flow

```
1. Client requests video page
   GET /api/v1/videos/:videoId
   Response: { video metadata, hlsManifestUrl, thumbnailUrl }

2. Client loads HLS manifest
   GET /videos/:videoId/master.m3u8 (via CDN/Nginx)
   Response: HLS master playlist with quality variants

3. Player selects quality based on bandwidth
   GET /videos/:videoId/720p/playlist.m3u8
   Response: Quality-specific playlist

4. Player fetches segments
   GET /videos/:videoId/720p/segment-001.ts
   (Served directly from MinIO or CDN cache)

5. Client reports watch progress (every 30 seconds)
   POST /api/v1/videos/:videoId/progress
   Body: { watchedSeconds, completed }
```

### Comment Flow

```
1. Fetch comments (paginated, sorted by time or popularity)
   GET /api/v1/videos/:videoId/comments?page=1&sort=newest
   Response: { comments: [...], total, hasMore }

2. Post comment
   POST /api/v1/videos/:videoId/comments
   Body: { content, parentId? }
   Response: { commentId, createdAt }

3. React to comment
   POST /api/v1/comments/:commentId/reactions
   Body: { type: 'like' | 'dislike' }
```

## Data Model

### Entity-Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│    ┌──────────────┐         ┌──────────────────┐         ┌──────────────────┐          │
│    │    users     │         │  subscriptions   │         │     videos       │          │
│    ├──────────────┤         ├──────────────────┤         ├──────────────────┤          │
│    │ id (PK)      │◄───┐    │ subscriber_id(PK)│────────►│ id (PK)          │          │
│    │ username     │    │    │ channel_id (PK)  │────┐    │ channel_id (FK)  │──────┐   │
│    │ email        │    │    │ notifications    │    │    │ title            │      │   │
│    │ password_hash│    │    │ created_at       │    │    │ description      │      │   │
│    │ channel_name │    │    └──────────────────┘    │    │ status           │      │   │
│    │ channel_desc │    │                            │    │ visibility       │      │   │
│    │ avatar_url   │    │         ┌──────────────────┘    │ view_count       │      │   │
│    │ subscriber_  │◄───┼─────────┘                       │ like_count       │      │   │
│    │   count      │    │                                 │ published_at     │      │   │
│    │ role         │    │                                 └─────────┬────────┘      │   │
│    │ created_at   │    │                                           │               │   │
│    │ updated_at   │    │    ┌──────────────────────────────────────┘               │   │
│    └───────┬──────┘    │    │                                                      │   │
│            │           │    │    ┌──────────────────┐    ┌──────────────────┐      │   │
│            │           │    │    │ video_resolutions│    │ video_reactions  │      │   │
│            │           │    │    ├──────────────────┤    ├──────────────────┤      │   │
│            │           │    └───►│ video_id (PK,FK) │    │ user_id (PK,FK)  │◄─────┤   │
│            │           │         │ resolution (PK)  │    │ video_id (PK,FK) │◄─────┼───┘
│            │           │         │ manifest_url     │    │ reaction_type    │      │
│            │           │         │ bitrate          │    │ created_at       │      │
│            │           │         │ width/height     │    └──────────────────┘      │
│            │           │         └──────────────────┘                              │
│            │           │                                                            │
│    ┌───────┼───────────┼────────────────────────────────────────────────────────┐  │
│    │       │           │                                                        │  │
│    │       ▼           │    ┌──────────────────┐    ┌──────────────────┐       │  │
│    │  ┌────────────┐   │    │    comments      │    │  comment_likes   │       │  │
│    │  │  watch_    │   │    ├──────────────────┤    ├──────────────────┤       │  │
│    │  │  history   │   │    │ id (PK)          │◄───┤ comment_id(PK,FK)│       │  │
│    │  ├────────────┤   │    │ video_id (FK)    │────┤ user_id (PK,FK)  │◄──┐   │  │
│    │  │ id (PK)    │   │    │ user_id (FK)     │────┤ created_at       │   │   │  │
│    │  │ user_id(FK)│◄──┘    │ parent_id (FK)   │◄──┐└──────────────────┘   │   │  │
│    │  │ video_id   │───────►│ text             │   │                       │   │  │
│    │  │   (FK)     │        │ like_count       │   │ (self-reference       │   │  │
│    │  │ watch_dur  │        │ is_edited        │   │  for replies)         │   │  │
│    │  │ watch_pct  │        │ created_at       │───┘                       │   │  │
│    │  │ position   │        └──────────────────┘                           │   │  │
│    │  │ watched_at │                                                       │   │  │
│    │  └────────────┘                                                       │   │  │
│    │                                                                        │   │  │
│    └────────────────────────────────────────────────────────────────────────┼───┘  │
│                                                                              │      │
│    ┌──────────────────┐                                                     │      │
│    │ upload_sessions  │                                                     │      │
│    ├──────────────────┤                                                     │      │
│    │ id (PK)          │                                                     │      │
│    │ user_id (FK)     │◄────────────────────────────────────────────────────┘      │
│    │ filename         │                                                            │
│    │ file_size        │                                                            │
│    │ total_chunks     │                                                            │
│    │ uploaded_chunks  │                                                            │
│    │ status           │                                                            │
│    │ minio_upload_id  │                                                            │
│    │ expires_at       │                                                            │
│    └──────────────────┘                                                            │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Table Relationships Summary

| Parent Table | Child Table | Relationship | FK Column | Cascade Behavior |
|--------------|-------------|--------------|-----------|------------------|
| users | videos | 1:N | channel_id | ON DELETE CASCADE |
| users | comments | 1:N | user_id | ON DELETE CASCADE |
| users | subscriptions | N:M (subscriber) | subscriber_id | ON DELETE CASCADE |
| users | subscriptions | N:M (channel) | channel_id | ON DELETE CASCADE |
| users | video_reactions | 1:N | user_id | ON DELETE CASCADE |
| users | comment_likes | 1:N | user_id | ON DELETE CASCADE |
| users | watch_history | 1:N | user_id | ON DELETE CASCADE |
| users | upload_sessions | 1:N | user_id | ON DELETE CASCADE |
| videos | video_resolutions | 1:N | video_id | ON DELETE CASCADE |
| videos | comments | 1:N | video_id | ON DELETE CASCADE |
| videos | video_reactions | 1:N | video_id | ON DELETE CASCADE |
| videos | watch_history | 1:N | video_id | ON DELETE CASCADE |
| comments | comments | 1:N (self-ref) | parent_id | ON DELETE CASCADE |
| comments | comment_likes | 1:N | comment_id | ON DELETE CASCADE |

### Complete Database Schema

The following schema is implemented in `/backend/db/init.sql`:

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- USERS TABLE
-- =============================================================================
-- Users serve as both viewers and channel owners. Each user has an optional
-- channel (channel_name, channel_description) that becomes active when they
-- upload videos.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,           -- Login identifier
    email VARCHAR(255) UNIQUE NOT NULL,             -- Contact and recovery
    password_hash VARCHAR(255) NOT NULL,            -- bcrypt hash
    channel_name VARCHAR(100),                      -- Display name for channel
    channel_description TEXT,                       -- Channel about section
    avatar_url TEXT,                                -- Profile image URL
    subscriber_count BIGINT DEFAULT 0,              -- Denormalized for fast display
    role VARCHAR(20) DEFAULT 'user',                -- 'user', 'creator', 'admin'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- =============================================================================
-- VIDEOS TABLE
-- =============================================================================
-- Core content entity using YouTube-style 11-char IDs for shareable URLs.
-- Status workflow: uploading -> processing -> ready/failed -> blocked
CREATE TABLE videos (
    id VARCHAR(11) PRIMARY KEY,                     -- YouTube-style short ID
    channel_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    duration_seconds INTEGER,
    status VARCHAR(20) DEFAULT 'processing',        -- workflow state
    visibility VARCHAR(20) DEFAULT 'public',        -- public/unlisted/private
    view_count BIGINT DEFAULT 0,
    like_count BIGINT DEFAULT 0,
    dislike_count BIGINT DEFAULT 0,
    comment_count BIGINT DEFAULT 0,
    categories TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    thumbnail_url TEXT,
    raw_video_key TEXT,                             -- MinIO key for original
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_videos_channel ON videos(channel_id, published_at DESC);
CREATE INDEX idx_videos_published ON videos(published_at DESC) WHERE status = 'ready';
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_visibility ON videos(visibility) WHERE visibility = 'public';
CREATE INDEX idx_videos_tags ON videos USING GIN(tags);
CREATE INDEX idx_videos_categories ON videos USING GIN(categories);

-- =============================================================================
-- VIDEO RESOLUTIONS TABLE
-- =============================================================================
-- Transcoded variants for adaptive bitrate streaming
CREATE TABLE video_resolutions (
    video_id VARCHAR(11) REFERENCES videos(id) ON DELETE CASCADE,
    resolution VARCHAR(10) NOT NULL,                -- '1080p', '720p', etc.
    manifest_url TEXT,
    video_url TEXT,
    bitrate INTEGER,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (video_id, resolution)
);

-- =============================================================================
-- COMMENTS TABLE
-- =============================================================================
-- Threaded comments with self-referential parent_id for replies
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id VARCHAR(11) REFERENCES videos(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    like_count INTEGER DEFAULT 0,
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_comments_video ON comments(video_id, created_at DESC);
CREATE INDEX idx_comments_parent ON comments(parent_id);
CREATE INDEX idx_comments_user ON comments(user_id, created_at DESC);

-- =============================================================================
-- SUBSCRIPTIONS TABLE
-- =============================================================================
-- Many-to-many: users subscribe to channels (other users)
CREATE TABLE subscriptions (
    subscriber_id UUID REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES users(id) ON DELETE CASCADE,
    notifications_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (subscriber_id, channel_id)
);

CREATE INDEX idx_subscriptions_channel ON subscriptions(channel_id);
CREATE INDEX idx_subscriptions_subscriber ON subscriptions(subscriber_id);

-- =============================================================================
-- VIDEO REACTIONS TABLE
-- =============================================================================
-- Likes/dislikes on videos (one per user per video)
CREATE TABLE video_reactions (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id VARCHAR(11) REFERENCES videos(id) ON DELETE CASCADE,
    reaction_type VARCHAR(10) NOT NULL,             -- 'like' or 'dislike'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_video_reactions_video ON video_reactions(video_id, reaction_type);

-- =============================================================================
-- COMMENT LIKES TABLE
-- =============================================================================
-- Only likes on comments (no dislikes per YouTube model)
CREATE TABLE comment_likes (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, comment_id)
);

CREATE INDEX idx_comment_likes_comment ON comment_likes(comment_id);

-- =============================================================================
-- WATCH HISTORY TABLE
-- =============================================================================
-- Tracks viewing for recommendations and resume playback
CREATE TABLE watch_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id VARCHAR(11) REFERENCES videos(id) ON DELETE CASCADE,
    watch_duration_seconds INTEGER DEFAULT 0,
    watch_percentage DECIMAL(5,2) DEFAULT 0,
    last_position_seconds INTEGER DEFAULT 0,
    watched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_watch_history_user ON watch_history(user_id, watched_at DESC);
CREATE INDEX idx_watch_history_video ON watch_history(video_id);
CREATE INDEX idx_watch_history_user_video ON watch_history(user_id, video_id);

-- =============================================================================
-- UPLOAD SESSIONS TABLE
-- =============================================================================
-- Chunked upload state for large files with 24-hour expiry
CREATE TABLE upload_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    content_type VARCHAR(100),
    total_chunks INTEGER NOT NULL,
    uploaded_chunks INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    minio_upload_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_upload_sessions_user ON upload_sessions(user_id, status);
CREATE INDEX idx_upload_sessions_expires ON upload_sessions(expires_at) WHERE status = 'active';
```

### Foreign Key Relationships and Cascade Rationale

All foreign keys use `ON DELETE CASCADE` for the following reasons:

| Relationship | Cascade Rationale |
|--------------|-------------------|
| **users -> videos** | When a user/channel is deleted, their videos should be removed. Orphaned videos without an owner cannot be managed or moderated. |
| **users -> comments** | User deletion should remove their comments. Preserving anonymous comments creates moderation challenges. |
| **users -> subscriptions** | Both sides cascade: subscriber deletion removes their subscriptions; channel deletion removes all subscriptions to it. |
| **users -> video_reactions** | Reactions are meaningless without the user who made them. Deletion ensures accurate counts. |
| **users -> comment_likes** | Same reasoning as video_reactions. |
| **users -> watch_history** | Watch history is personal data that should be deleted with the user account (GDPR compliance). |
| **users -> upload_sessions** | Abandoned uploads from deleted users should be cleaned up. |
| **videos -> video_resolutions** | Transcoded files are derived from the source; deleting video should remove all versions. |
| **videos -> comments** | Comments on deleted videos have no context and should be removed. |
| **videos -> video_reactions** | Reactions to deleted videos are meaningless. |
| **videos -> watch_history** | Historical viewing of deleted content has limited value for recommendations. |
| **comments -> comments** | Replies to deleted comments lose context and should be removed (cascade through parent_id). |
| **comments -> comment_likes** | Likes on deleted comments should be removed. |

**Why not use ON DELETE SET NULL?**

SET NULL would be appropriate if we wanted to preserve orphaned data (e.g., keeping comments but showing "[deleted user]"). However, for this learning project:
1. CASCADE simplifies cleanup and prevents orphaned data
2. GDPR-style "right to be forgotten" is easier to implement
3. Referential integrity is strictly maintained
4. No need for complex null-handling in application code

### Index Strategy

| Index | Type | Purpose | Query Pattern |
|-------|------|---------|---------------|
| `idx_videos_channel` | B-tree composite | Channel page videos | `WHERE channel_id = ? ORDER BY published_at DESC` |
| `idx_videos_published` | Partial B-tree | Home feed | `WHERE status = 'ready' ORDER BY published_at DESC` |
| `idx_videos_status` | B-tree | Admin moderation | `WHERE status = 'processing'` |
| `idx_videos_visibility` | Partial B-tree | Public listings | `WHERE visibility = 'public'` |
| `idx_videos_tags` | GIN | Tag search | `WHERE tags @> ARRAY['gaming']` |
| `idx_comments_video` | B-tree composite | Video comments | `WHERE video_id = ? ORDER BY created_at DESC` |
| `idx_comments_parent` | B-tree | Reply threads | `WHERE parent_id = ?` |
| `idx_subscriptions_channel` | B-tree | Subscriber count | `WHERE channel_id = ?` |
| `idx_watch_history_user` | B-tree composite | Continue watching | `WHERE user_id = ? ORDER BY watched_at DESC` |

### Why Tables Are Structured This Way

#### 1. Users with Embedded Channel Data
Instead of a separate `channels` table, channel data is embedded in `users`. This simplifies queries and works well when:
- Every channel has exactly one owner (1:1 relationship)
- Channel-specific data is small (name, description, avatar)
- Local development scale doesn't require separate scaling

For production with millions of channels, a separate `channels` table with its own sharding strategy would be preferable.

#### 2. YouTube-Style Short Video IDs
Videos use `VARCHAR(11)` primary keys instead of UUIDs because:
- Short, memorable URLs (youtube.com/watch?v=dQw4w9WgXcQ)
- URL-safe characters only (alphanumeric + underscore + hyphen)
- Still provides ~73 trillion unique IDs (62^11)
- Trade-off: Slightly more storage than integer, but much better UX

#### 3. Separate Reaction Tables
Video reactions and comment likes are in separate tables because:
- Different cardinality (many more video reactions than comment likes)
- Different query patterns (video reactions need type filtering, comments only have likes)
- Simpler indexes without polymorphic type columns

#### 4. Non-Unique Watch History
Unlike some schemas where watch history is unique per (user, video), this schema allows multiple entries because:
- Tracks separate viewing sessions for analytics
- Enables "watch again" pattern detection
- More accurate engagement metrics

#### 5. Denormalized Counters
`subscriber_count`, `view_count`, `like_count`, etc. are denormalized because:
- These are read millions of times (every page view)
- Computing via COUNT(*) would be expensive
- Trigger-based updates maintain accuracy
- Acceptable eventual consistency for display purposes

### Data Flow for Key Operations

#### Video Upload Flow

```
1. Client initiates upload
   └─> INSERT INTO upload_sessions (user_id, filename, file_size, total_chunks)
       Returns: upload_session_id

2. Client uploads chunks (parallel)
   └─> UPDATE upload_sessions SET uploaded_chunks = uploaded_chunks + 1
       WHERE id = ? AND uploaded_chunks < total_chunks

3. Client completes upload
   └─> Transaction:
       a. UPDATE upload_sessions SET status = 'completed'
       b. INSERT INTO videos (id, channel_id, title, status='processing')
       c. Publish job to RabbitMQ

4. Transcode worker processes
   └─> Transaction:
       a. INSERT INTO video_resolutions (video_id, resolution, ...)
          FOR EACH quality level (1080p, 720p, 480p, 360p)
       b. UPDATE videos SET status = 'ready', duration_seconds = ?, published_at = NOW()
```

#### Subscription Feed Query

```sql
-- Get videos from subscribed channels, sorted by recency
SELECT v.*
FROM videos v
INNER JOIN subscriptions s ON s.channel_id = v.channel_id
WHERE s.subscriber_id = :user_id
  AND v.status = 'ready'
  AND v.visibility = 'public'
ORDER BY v.published_at DESC
LIMIT 20 OFFSET :offset;

-- Uses: idx_subscriptions_subscriber, idx_videos_channel
```

#### Comment Thread Loading

```sql
-- Get top-level comments
SELECT c.*, u.username, u.avatar_url
FROM comments c
JOIN users u ON u.id = c.user_id
WHERE c.video_id = :video_id
  AND c.parent_id IS NULL
ORDER BY c.like_count DESC, c.created_at DESC
LIMIT 20;

-- Get replies for expanded comment
SELECT c.*, u.username, u.avatar_url
FROM comments c
JOIN users u ON u.id = c.user_id
WHERE c.parent_id = :parent_comment_id
ORDER BY c.created_at ASC;

-- Uses: idx_comments_video, idx_comments_parent
```

#### Like/Dislike Toggle

```sql
-- Upsert reaction with counter update
WITH old_reaction AS (
    SELECT reaction_type FROM video_reactions
    WHERE user_id = :user_id AND video_id = :video_id
),
new_reaction AS (
    INSERT INTO video_reactions (user_id, video_id, reaction_type)
    VALUES (:user_id, :video_id, :reaction_type)
    ON CONFLICT (user_id, video_id)
    DO UPDATE SET reaction_type = :reaction_type
    RETURNING reaction_type
)
UPDATE videos
SET like_count = like_count
    + CASE WHEN :reaction_type = 'like' THEN 1 ELSE 0 END
    - CASE WHEN (SELECT reaction_type FROM old_reaction) = 'like' THEN 1 ELSE 0 END,
    dislike_count = dislike_count
    + CASE WHEN :reaction_type = 'dislike' THEN 1 ELSE 0 END
    - CASE WHEN (SELECT reaction_type FROM old_reaction) = 'dislike' THEN 1 ELSE 0 END
WHERE id = :video_id;
```

#### Watch History for Recommendations

```sql
-- Get user's watch patterns for recommendation engine
SELECT
    v.categories,
    v.tags,
    v.channel_id,
    AVG(wh.watch_percentage) as avg_completion,
    COUNT(*) as watch_count
FROM watch_history wh
JOIN videos v ON v.id = wh.video_id
WHERE wh.user_id = :user_id
  AND wh.watched_at > NOW() - INTERVAL '30 days'
GROUP BY v.categories, v.tags, v.channel_id
ORDER BY watch_count DESC, avg_completion DESC
LIMIT 50;

-- Uses: idx_watch_history_user, then aggregates
```

### Storage Strategy

#### MinIO Buckets

| Bucket | Purpose | Access | Lifecycle |
|--------|---------|--------|-----------|
| `raw-videos` | Original uploaded files | Private | Delete after transcode + 7 days |
| `videos` | Processed HLS segments | Public read | Permanent |
| `thumbnails` | Video thumbnails | Public read | Permanent |
| `avatars` | User/channel images | Public read | Permanent |
| `temp-chunks` | Upload chunks | Private | Delete after 24 hours |

#### Storage Layout

```
raw-videos/
  ├── {uploadId}/raw.{ext}

videos/
  ├── {videoId}/
  │   ├── master.m3u8
  │   ├── 1080p/
  │   │   ├── playlist.m3u8
  │   │   └── segment-{n}.ts
  │   ├── 720p/
  │   ├── 480p/
  │   └── 360p/

thumbnails/
  ├── {videoId}/
  │   ├── default.jpg
  │   ├── t-0.jpg (0%)
  │   ├── t-25.jpg (25%)
  │   ├── t-50.jpg (50%)
  │   └── t-75.jpg (75%)
```

### Caching Strategy

#### Redis/Valkey Key Patterns

| Pattern | TTL | Purpose |
|---------|-----|---------|
| `session:{sessionId}` | 24h | User session data |
| `user:{userId}` | 1h | User profile cache |
| `video:{videoId}` | 5m | Video metadata cache |
| `channel:{channelId}` | 5m | Channel metadata cache |
| `feed:{userId}` | 5m | Subscription feed cache |
| `trending` | 1m | Trending videos list |
| `rate:{ip}:{endpoint}` | 1m | Rate limit counters |
| `upload:{uploadId}` | 24h | Upload progress/chunk tracking |

#### Cache Invalidation Rules

| Event | Invalidate |
|-------|-----------|
| Video published | `video:{id}`, `channel:{channelId}`, `trending`, `feed:*` (subscribed users) |
| Video updated | `video:{id}` |
| User subscribes | `feed:{userId}`, `channel:{channelId}` |
| Comment added | `video:{id}` (comment count) |
| Profile updated | `user:{userId}`, `channel:{channelId}` |

## Message Queue Design

### RabbitMQ Exchanges and Queues

```
Exchange: youtube.transcode (direct)
  └── Queue: transcode.jobs
      └── Routing key: transcode.new
      └── Dead letter: transcode.dlq

Exchange: youtube.events (topic)
  └── Queue: notifications
      └── Routing key: video.published, comment.new
  └── Queue: analytics
      └── Routing key: video.*, user.*
```

### Transcode Job Message Format

```json
{
  "jobId": "uuid",
  "videoId": "uuid",
  "rawFileKey": "raw-videos/{uploadId}/raw.mp4",
  "resolutions": [1080, 720, 480, 360],
  "priority": "normal",
  "retryCount": 0,
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Queue Configuration

| Queue | Prefetch | Retry | DLQ TTL |
|-------|----------|-------|---------|
| transcode.jobs | 1 | 3 attempts, exponential backoff (1m, 5m, 15m) | 7 days |
| notifications | 10 | 5 attempts, 30s delay | 24 hours |
| analytics | 100 | No retry (at-most-once) | - |

## API Design

### Core Endpoints

#### Authentication
```
POST   /api/v1/auth/register     Register new user
POST   /api/v1/auth/login        Login, create session
POST   /api/v1/auth/logout       Destroy session
GET    /api/v1/auth/me           Get current user
```

#### Videos
```
GET    /api/v1/videos            List videos (paginated, filterable)
GET    /api/v1/videos/:id        Get video details
POST   /api/v1/videos            Create video metadata (after upload)
PATCH  /api/v1/videos/:id        Update video metadata
DELETE /api/v1/videos/:id        Delete video

GET    /api/v1/videos/:id/comments    Get comments
POST   /api/v1/videos/:id/comments    Add comment
POST   /api/v1/videos/:id/reactions   Add reaction
POST   /api/v1/videos/:id/progress    Update watch progress
```

#### Uploads
```
POST   /api/v1/uploads/init           Initialize chunked upload
PUT    /api/v1/uploads/:id/chunks/:n  Upload chunk
POST   /api/v1/uploads/:id/complete   Complete upload
DELETE /api/v1/uploads/:id            Cancel upload
```

#### Channels
```
GET    /api/v1/channels/:handle       Get channel by handle
GET    /api/v1/channels/:id/videos    Get channel videos
POST   /api/v1/channels/:id/subscribe Subscribe to channel
DELETE /api/v1/channels/:id/subscribe Unsubscribe
```

#### Feed & Discovery
```
GET    /api/v1/feed                   Subscription feed
GET    /api/v1/trending               Trending videos
GET    /api/v1/search?q=              Search videos
GET    /api/v1/recommendations        Personalized recommendations
```

#### Admin (RBAC: admin role required)
```
GET    /api/v1/admin/videos           List all videos (including private)
PATCH  /api/v1/admin/videos/:id       Moderate video (takedown, restore)
GET    /api/v1/admin/users            List users
PATCH  /api/v1/admin/users/:id        Update user role, ban/unban
GET    /api/v1/admin/transcode-jobs   View job queue status
POST   /api/v1/admin/transcode-jobs/:id/retry  Retry failed job
```

### Response Format

```json
{
  "data": { ... },
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 150,
    "hasMore": true
  },
  "error": null
}
```

### Error Response Format

```json
{
  "data": null,
  "meta": null,
  "error": {
    "code": "VIDEO_NOT_FOUND",
    "message": "Video with id 'abc' not found",
    "details": { "videoId": "abc" }
  }
}
```

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React 19 + Vite + TypeScript | Fast builds, modern React features |
| | Tanstack Router | Type-safe routing |
| | Zustand | Lightweight state management |
| | Tailwind CSS | Rapid UI development |
| | hls.js | HLS playback in browsers without native support |
| **API Layer** | Express.js + TypeScript | Simple, well-understood, sufficient for learning |
| | express-session | Session management |
| | multer | File upload handling |
| **Data Layer** | PostgreSQL 16 | ACID, full-text search, JSONB |
| | Valkey 7 (Redis-compatible) | Sessions, caching, rate limiting |
| | MinIO | S3-compatible object storage |
| **Queue** | RabbitMQ 3.12 | Reliable message delivery, DLQ support |
| **Processing** | FFmpeg | Video transcoding (or simulated for learning) |
| **Reverse Proxy** | Nginx | Static files, HLS caching, load balancing |

## Frontend Brand Identity

This section documents the visual design system implemented in the frontend, matching YouTube's brand identity as closely as possible.

### Why Brand Authenticity Matters for System Design Learning

Matching the original platform's brand identity serves several important purposes in a system design learning project:

1. **Realistic User Experience Testing**: When the UI looks and feels like the real product, testers and learners interact with it more naturally. This reveals actual UX challenges (information density, visual hierarchy, accessibility) that wouldn't surface with a generic Bootstrap interface.

2. **Design System Understanding**: Implementing a specific brand forces you to understand how large-scale design systems work---color tokens, typography scales, component states, and dark mode theming. These patterns are essential for production frontends.

3. **Attention to Detail**: System design isn't just about databases and APIs. Production systems include pixel-perfect UIs. Learning to implement brand guidelines develops the precision needed for professional work.

4. **Portfolio Presentation**: A project that looks like YouTube demonstrates both backend architecture skills AND frontend polish. Generic-looking projects don't showcase the same range of abilities.

5. **Component State Complexity**: YouTube's UI has nuanced states (subscribed vs. not, liked vs. neutral vs. disliked, live vs. premiere vs. regular video). Implementing these correctly reveals the data requirements that flow back to the API and database design.

### YouTube Brand Colors

The following color palette matches YouTube's official brand guidelines:

| Color Purpose | Light Mode | Dark Mode | CSS Variable |
|---------------|------------|-----------|--------------|
| **Primary Red** | `#FF0000` | `#FF0000` | `--yt-red` |
| **Subscribe Button** | `#CC0000` | `#CC0000` | `--yt-subscribe` |
| **Background Primary** | `#FFFFFF` | `#0F0F0F` | `--yt-bg-primary` |
| **Background Secondary** | `#F9F9F9` | `#212121` | `--yt-bg-secondary` |
| **Text Primary** | `#0F0F0F` | `#FFFFFF` | `--yt-text-primary` |
| **Text Secondary** | `#606060` | `#AAAAAA` | `--yt-text-secondary` |
| **Like Active (Blue)** | `#065FD4` | `#3EA6FF` | `--yt-like-active` |
| **Subscribed (Gray)** | `#909090` | `#909090` | `--yt-subscribed` |
| **Border/Divider** | `#E5E5E5` | `#3F3F3F` | `--yt-border` |
| **Hover State** | `#F2F2F2` | `#3F3F3F` | `--yt-hover` |

**Color Usage Guidelines:**
- Primary red (`#FF0000`) is used sparingly: the logo, progress bar in video player, and unsubscribed subscribe button
- Subscribe button transitions from red (`#CC0000`) to gray (`#909090`) when subscribed
- Like button turns blue (`#065FD4`) when active, following YouTube's interaction pattern
- Dark mode uses pure black (`#0F0F0F`) as the primary background, not a dark gray

### Typography

YouTube uses the Roboto font family throughout its interface:

```css
font-family: 'Roboto', Arial, sans-serif;
```

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| Video Title (card) | 14px | 500 (medium) | 1.4 |
| Video Title (watch page) | 18-20px | 600 (semi-bold) | 1.3 |
| Channel Name | 12-13px | 500 (medium) | 1.3 |
| Metadata (views, date) | 12px | 400 (regular) | 1.3 |
| Comment Text | 14px | 400 (regular) | 1.4 |
| Button Text | 14px | 500 (medium) | 1.0 |
| Section Headers | 16px | 500 (medium) | 1.3 |

**Typography Guidelines:**
- Roboto is loaded from Google Fonts for consistency
- Text truncation with ellipsis is used for long video titles (2-line max on cards)
- Channel names are single-line truncated
- Metadata text uses secondary color for visual hierarchy

### Key UI Components

#### Video Thumbnail Grid
- Aspect ratio: 16:9 for thumbnails
- Rounded corners: 12px on thumbnails
- Grid gap: 16px horizontal, 24px vertical
- Hover state: No thumbnail transform, shows duration badge

#### Video Player
- Red progress bar (`#FF0000`) on the seek bar
- Gray buffered progress indicator
- Circular red scrubber handle
- Black letterboxing for non-16:9 content

#### Subscribe Button
- **Unsubscribed state**: Red background (`#CC0000`), white text, "Subscribe"
- **Subscribed state**: Gray background (`#909090`), white text, "Subscribed"
- **Hover on subscribed**: Shows "Unsubscribe" text
- Pill-shaped (fully rounded corners)
- Height: 36px, padding: 0 16px

#### Like/Dislike Buttons
- Pill-shaped container with border
- Icons use outlined style when inactive
- Like icon fills blue (`#065FD4`) when active
- Dislike icon fills with text color when active
- Vertical divider between like and dislike
- Count displays next to like icon only

#### Channel Avatar
- Circular avatar image
- Size varies by context: 24px (comment), 36px (video card), 48px (channel header), 80px (channel page)
- Fallback: First letter of channel name on colored background

#### Navigation Sidebar
- Fixed width: 240px (expanded), 72px (collapsed)
- Active item: Light gray background with bold text
- Icons: YouTube's custom icon set (replicated with similar styling)

### Dark Mode Implementation

The frontend supports both light and dark themes, matching YouTube's theme options:

```css
/* Light mode (default) */
:root {
  --yt-bg-primary: #FFFFFF;
  --yt-bg-secondary: #F9F9F9;
  --yt-text-primary: #0F0F0F;
  --yt-text-secondary: #606060;
}

/* Dark mode */
[data-theme="dark"] {
  --yt-bg-primary: #0F0F0F;
  --yt-bg-secondary: #212121;
  --yt-text-primary: #FFFFFF;
  --yt-text-secondary: #AAAAAA;
}
```

**Dark Mode Considerations:**
- Theme preference is stored in localStorage and respects `prefers-color-scheme` media query
- Red elements (`#FF0000`) remain unchanged between themes
- Blue like button lightens in dark mode (`#3EA6FF`) for better visibility
- Video thumbnails have no border in either mode
- Modal overlays use semi-transparent black backdrop

### Responsive Breakpoints

| Breakpoint | Grid Columns | Sidebar State |
|------------|--------------|---------------|
| < 500px | 1 column | Hidden |
| 500-900px | 2 columns | Collapsed (icons only) |
| 900-1200px | 3 columns | Collapsed |
| 1200-1600px | 4 columns | Expanded |
| > 1600px | 5-6 columns | Expanded |

## Security

### Authentication and Authorization

#### Session-Based Auth
- HTTP-only, secure cookies (secure=true in production)
- Session stored in Redis with 24-hour TTL
- CSRF protection via same-site cookies and origin checking

#### Role-Based Access Control (RBAC)

| Role | Permissions |
|------|------------|
| `guest` | View public videos, search |
| `user` | + Comment, react, subscribe, watch history |
| `creator` | + Upload videos, manage own channel |
| `admin` | + Moderate content, manage users, view system metrics |

#### Middleware Authorization Pattern
```typescript
// Route protection
router.post('/videos', requireAuth, requireRole(['creator', 'admin']), createVideo);
router.patch('/admin/videos/:id', requireAuth, requireRole(['admin']), moderateVideo);

// Resource ownership check
router.patch('/videos/:id', requireAuth, requireOwnership('video'), updateVideo);
```

### Rate Limiting

| Endpoint Pattern | Limit | Window |
|-----------------|-------|--------|
| `/api/v1/auth/*` | 10 | 1 minute |
| `/api/v1/uploads/*` | 5 | 1 minute |
| `/api/v1/comments` POST | 20 | 1 minute |
| `/api/v1/*` (default) | 100 | 1 minute |

### Input Validation

- All inputs validated with zod schemas
- File uploads: type checking (video/mp4, video/webm, etc.), size limits
- SQL injection: parameterized queries via pg library
- XSS: React escaping + Content-Security-Policy headers

## Observability

### Metrics (Prometheus)

```
# Request metrics
http_requests_total{method, endpoint, status}
http_request_duration_seconds{method, endpoint, quantile}

# Business metrics
videos_uploaded_total
videos_transcoded_total{status}
video_views_total
comments_created_total
subscriptions_total

# System metrics
transcode_queue_depth
transcode_job_duration_seconds{resolution}
cache_hit_ratio{cache}
db_connection_pool_size
db_query_duration_seconds{query_type}
```

### Logging Strategy

```typescript
// Structured logging with pino
logger.info({
  event: 'video_uploaded',
  videoId: video.id,
  userId: user.id,
  fileSize: file.size,
  duration: processingTime
});

// Log levels
// ERROR: Failures requiring attention (transcode failures, DB errors)
// WARN: Degraded state (cache miss, rate limit hit)
// INFO: Business events (upload, publish, subscribe)
// DEBUG: Request/response details (development only)
```

### Tracing

For local development, use simple request-id propagation:
```
X-Request-ID: {uuid}
```

Each log entry includes the request ID for correlation:
```json
{"level":"info","requestId":"abc-123","event":"video_fetched","videoId":"xyz"}
```

### Health Checks

```
GET /health           Quick liveness check
GET /health/ready     Deep readiness check (DB, Redis, MinIO, RabbitMQ)
```

### Alerting Thresholds (Local Simulation)

| Metric | Warning | Critical |
|--------|---------|----------|
| API error rate | > 1% | > 5% |
| p95 latency | > 500ms | > 2s |
| Transcode queue depth | > 10 | > 50 |
| Cache hit ratio | < 80% | < 50% |
| Disk usage | > 80% | > 95% |

## Failure Handling

### Retry Policies

| Operation | Retries | Backoff | Idempotency |
|-----------|---------|---------|-------------|
| Transcode job | 3 | Exponential (1m, 5m, 15m) | Job ID prevents duplicates |
| DB write | 3 | Immediate | Transaction rollback |
| Cache write | 1 | None | Overwrite is safe |
| MinIO upload | 3 | Linear (1s) | ETag verification |

### Circuit Breaker Pattern

For external dependencies (simulated locally):
```typescript
const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 30000,      // Try again after 30s
  successThreshold: 2       // Close after 2 successes
});

// Usage
const result = await circuitBreaker.execute(() => minioClient.putObject(...));
```

### Graceful Degradation

| Failure | Degraded Behavior |
|---------|------------------|
| Redis down | Fall back to DB for sessions; disable caching |
| RabbitMQ down | Return upload as 'queued', poll for recovery |
| MinIO down | Serve cached HLS from Nginx; uploads fail gracefully |
| PostgreSQL down | Full service unavailable (critical dependency) |

### Idempotency Keys

For upload completion and video publishing:
```
POST /api/v1/uploads/:id/complete
X-Idempotency-Key: {client-generated-uuid}
```

Server stores key in Redis (24h TTL) and returns cached response for duplicates.

### Backup and Recovery (Local Dev)

```bash
# PostgreSQL backup
pg_dump -U youtube youtube_db > backup.sql

# PostgreSQL restore
psql -U youtube youtube_db < backup.sql

# MinIO: mc mirror for bucket replication
mc mirror minio/videos backup/videos
```

## Cost Tradeoffs

### Storage vs Compute

| Decision | Tradeoff |
|----------|----------|
| Pre-transcode all resolutions | Higher storage (4x), lower compute during playback |
| Transcode on-demand | Lower storage, higher latency, more compute |
| **Chosen**: Pre-transcode | Better user experience; storage is cheap |

### Cache Sizing

| Cache | Size | Cost | Benefit |
|-------|------|------|---------|
| Video metadata | 100 MB | Low | 90%+ hit rate on popular videos |
| Session store | 50 MB | Low | Avoid DB for every request |
| Full video cache (Nginx) | 1 GB | Medium | Reduce MinIO load |

### Queue Retention

| Queue | Retention | Rationale |
|-------|-----------|-----------|
| Transcode jobs | 7 days in DLQ | Debug failed jobs |
| Event notifications | 24 hours | Non-critical, at-most-once OK |
| Analytics | No retention | Fire-and-forget |

### Local Development Resource Budget

| Component | Memory | Disk | Justification |
|-----------|--------|------|---------------|
| PostgreSQL | 512 MB | 1 GB | Small dataset, simple queries |
| Valkey | 128 MB | - | Sessions + cache for 100 users |
| RabbitMQ | 256 MB | 100 MB | Low message volume |
| MinIO | 256 MB | 50 GB | Video storage (main cost) |
| API Services (x3) | 512 MB each | - | Node.js baseline |
| Nginx | 64 MB | 1 GB | Static cache |
| **Total** | ~2.5 GB | ~52 GB | Runs on 8GB laptop |

## Scalability Considerations

### Horizontal Scaling Path

| Component | Scaling Strategy |
|-----------|-----------------|
| API Gateway | Add instances behind Nginx load balancer |
| Upload Service | Add instances; MinIO handles concurrent writes |
| Transcode Workers | Add workers; RabbitMQ distributes jobs |
| PostgreSQL | Read replicas for queries; write to primary |
| Redis | Redis Cluster for sharding |
| MinIO | Add nodes for capacity |

### Local Multi-Instance Testing

```bash
# Run 3 API instances
npm run dev:server1  # Port 3001
npm run dev:server2  # Port 3002
npm run dev:server3  # Port 3003

# Nginx load balancer config
upstream api {
    server localhost:3001;
    server localhost:3002;
    server localhost:3003;
}
```

## Implementation Notes

This section documents the key infrastructure patterns implemented in the backend and explains their purpose.

### Prometheus Metrics (`/metrics` endpoint)

**WHY metrics enable content recommendation optimization:**

Metrics provide quantitative insights into user behavior and system performance that directly feed into recommendation algorithms:

1. **View patterns**: `video_views_total` and `video_watch_duration_seconds` track which videos are being watched and for how long. Videos with high completion rates (watch duration / total duration) are likely higher quality content worth promoting.

2. **Popular content identification**: Real-time metrics on view counts, likes, and engagement allow the trending algorithm to surface content that's gaining traction. The `transcode_queue_depth` metric helps prioritize processing of videos from channels with historically high engagement.

3. **User engagement signals**: Metrics on comments, reactions, and subscriptions provide implicit feedback signals. A video generating many comments quickly likely deserves recommendation boost.

4. **Capacity planning**: Metrics like `http_request_duration_seconds` and `db_query_duration_seconds` help identify bottlenecks before they impact recommendations (slow API = users abandon before engagement data is captured).

**Implemented metrics:**
- `video_views_total{video_id, channel_id}` - Total views per video
- `video_watch_duration_seconds` - Watch time histogram
- `video_uploads_total{status}` - Upload success/failure counts
- `transcode_queue_depth` - Current transcoding backlog
- `transcode_job_duration_seconds{resolution, status}` - Processing time per resolution
- `http_requests_total{method, endpoint, status_code}` - Request counts
- `http_request_duration_seconds` - API latency histogram

### Rate Limiting

**WHY rate limiting prevents abuse and protects transcoding resources:**

Transcoding is the most expensive operation in a video platform. A single video upload can consume CPU for 10-60 minutes depending on length and quality. Rate limiting serves multiple purposes:

1. **Resource protection**: Without limits, a malicious actor could queue hundreds of transcode jobs, blocking legitimate uploads for hours. The upload rate limit (5/minute) ensures the queue stays manageable.

2. **Fair access**: Rate limiting ensures one heavy user can't monopolize shared resources. If the transcode queue has capacity for 100 jobs/hour, limiting uploads prevents one creator from consuming the entire quota.

3. **Cost control**: Cloud transcoding costs scale with usage. Rate limits provide a predictable ceiling on infrastructure costs.

4. **Abuse prevention**: Limits on auth endpoints (10/minute) prevent brute-force attacks. Limits on comments (20/minute) prevent spam.

5. **Quality of service**: By rejecting excess requests with 429 status, rate limiting prevents system overload that would degrade performance for everyone.

**Implemented rate limits:**
- Auth endpoints: 10 requests/minute (prevents brute force)
- Upload endpoints: 5 uploads/minute (protects transcoding)
- Write operations: 20 requests/minute (prevents spam)
- Read operations: 100 requests/minute (generous for UX)

### Circuit Breakers

**WHY circuit breakers prevent cascade failures:**

In a distributed system, one failing service can bring down the entire platform through cascading failures. Circuit breakers act as automatic safety switches:

1. **Failure isolation**: When MinIO (storage) becomes unresponsive, the circuit opens. Instead of every request waiting 30 seconds before timing out (blocking threads, exhausting connection pools), requests fail immediately with a meaningful error.

2. **Fast recovery**: The half-open state periodically tests if the service recovered. When MinIO comes back, the circuit closes and normal operation resumes automatically---no manual intervention needed.

3. **Graceful degradation**: With circuit breakers, the API can return cached video metadata even when storage is down. Users can browse (degraded mode) rather than seeing complete failure.

4. **Resource conservation**: Without circuit breakers, a slow storage service causes thread pool exhaustion, database connection timeouts, and memory pressure from queued requests. Breaking the circuit early prevents this domino effect.

5. **Visibility**: Circuit breaker state changes are logged and exposed via metrics (`circuit_breaker_state`), enabling alerting when services are struggling.

**Implemented circuit breakers:**
- Storage operations (MinIO): Opens after 5 failures within threshold
- 30-second reset timeout before retrying
- Metrics track circuit state and failure counts

### Structured Logging with Pino

**WHY structured logging enables debugging distributed systems:**

Plain text logs (`console.log`) become unusable in distributed systems. Structured JSON logging solves critical debugging challenges:

1. **Request correlation**: Every request gets a `requestId` that's included in all log entries and returned in the `X-Request-ID` header. When a user reports "upload failed," you can search logs for that specific request ID and trace the entire flow across services.

2. **Machine parsing**: JSON logs can be ingested by log aggregation tools (ELK stack, Grafana Loki) for searching, filtering, and alerting. Finding all transcode failures in the last hour becomes a simple query rather than grep gymnastics.

3. **Context preservation**: Structured logs include contextual fields (userId, videoId, duration, error code) that would be lost in text logs. When debugging, you see the full picture without reconstructing context from surrounding lines.

4. **Performance analysis**: Logs include timing information. Aggregating the `duration` field from request logs reveals slow endpoints. Finding patterns like "all slow requests have userId=X" becomes trivial.

5. **Error categorization**: Structured error logs include error codes and types, enabling automatic categorization (operational vs. programmer errors) and smart alerting (alert on new error types, not volume).

**Log structure example:**
```json
{
  "level": "info",
  "time": "2024-01-15T10:30:00.000Z",
  "requestId": "abc-123",
  "userId": "user-456",
  "event": "video_uploaded",
  "videoId": "vid-789",
  "fileSize": 52428800,
  "duration": 1523
}
```

### RBAC (Role-Based Access Control)

**Implemented roles:**
- `viewer`: Default role. Can watch videos, comment, subscribe.
- `creator`: Can upload videos, manage own channel and content.
- `admin`: Full access including content moderation and user management.

**Permission enforcement:**
- Role checks via `requireRole()` middleware
- Ownership checks via `requireOwnership()` for resource-specific access
- Role hierarchy: admin permissions supersede creator, which supersede viewer

### Retry with Exponential Backoff

**Implementation details:**
- Base delay: 1 second, doubles each attempt (1s, 2s, 4s, 8s...)
- Max delay cap: 30 seconds (prevents unreasonably long waits)
- Jitter: 20% randomization prevents thundering herd after outages
- Configurable presets for different operation types (cache, database, storage)

### Health Checks

**Endpoints:**
- `GET /health` - Liveness check (is the process running?)
- `GET /health/ready` - Readiness check (are dependencies healthy?)
- `GET /health/detailed` - Full status including circuit breaker states, queue depths, memory usage

**Dependency checks:**
- PostgreSQL: Simple query test
- Redis: Ping command
- MinIO: Head object request

## Future Optimizations

1. **Real FFmpeg Integration**: Replace simulated transcoding with actual video processing
2. **Live Streaming**: Add RTMP ingest and live HLS generation
3. **CDN Simulation**: Implement edge caching layer with geographic routing simulation
4. **ML Recommendations**: Replace rule-based recommendations with collaborative filtering
5. **Elasticsearch**: Add dedicated search cluster for better full-text search
6. **WebSocket**: Real-time notifications for transcode completion, new comments
