# Loom - Video Recording & Sharing Platform

## System Overview

Loom is an asynchronous video communication platform that enables users to record their screen, camera, or both, and share recordings instantly via link. The platform combines browser-based recording with a video management library, time-anchored commenting, link-based sharing with access controls, and engagement analytics. At production scale, it serves millions of daily recordings with sub-second share link generation and real-time view tracking.

**Learning goals:** Browser-based media capture (MediaRecorder API), presigned URL upload patterns, video storage and delivery at scale, time-anchored commenting, share token security, and view analytics aggregation.

## Requirements

### Functional Requirements
- **Recording:** Browser-based screen, camera, or screen+camera capture with pause/resume
- **Upload:** Direct-to-storage upload via presigned URLs with progress tracking
- **Library:** Video management with folders, search, and grid/list views
- **Playback:** HTML5 video player with custom controls
- **Comments:** Time-anchored and general comments with threading
- **Sharing:** Token-based share links with optional password protection and expiration
- **Analytics:** View tracking with completion rates, unique viewers, and daily view charts

### Non-Functional Requirements
- **Upload latency:** Presigned URL generation < 100ms (p99)
- **Share link resolution:** < 50ms (p99) for token validation
- **Availability:** 99.95% uptime for playback and sharing
- **Storage:** Support videos up to 2GB per recording
- **Concurrent viewers:** Handle 10K+ simultaneous viewers per popular video
- **Analytics freshness:** View counts updated within 5 seconds

## High-Level Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Browser    │────▶│   CDN/Edge   │────▶│   API Gateway    │
│  (React +    │     │  (CloudFront)│     │  (Rate Limiting) │
│  MediaRecorder)    └──────────────┘     └────────┬─────────┘
└──────┬───────┘                                   │
       │                                  ┌────────┴─────────┐
       │  Presigned PUT                   │                  │
       │                          ┌───────┴──────┐  ┌───────┴──────┐
       ▼                          │  Video API   │  │  Analytics   │
┌──────────────┐                  │  Service     │  │  Service     │
│  Object      │◀─── presigned ───│              │  │              │
│  Storage     │     URLs         └──────┬───────┘  └───────┬──────┘
│  (S3/MinIO)  │                         │                  │
└──────────────┘                  ┌──────┴───────┐  ┌───────┴──────┐
                                  │  PostgreSQL  │  │  ClickHouse  │
                                  │  (metadata)  │  │  (analytics) │
                                  └──────────────┘  └──────────────┘
                                         │
                                  ┌──────┴───────┐
                                  │  Redis/Valkey│
                                  │  (sessions,  │
                                  │   cache)     │
                                  └──────────────┘
```

## Core Components

### Recording Flow
1. User selects recording mode (screen, camera, or both)
2. Browser calls `getDisplayMedia()` / `getUserMedia()` to acquire media streams
3. `MediaRecorder` captures the combined stream as WebM chunks
4. On stop, chunks are assembled into a single Blob
5. Client creates video metadata via POST `/api/videos`
6. Client requests a presigned PUT URL via POST `/api/upload/presigned`
7. Client uploads the Blob directly to object storage using XMLHttpRequest (for progress tracking)
8. Client marks upload complete via POST `/api/upload/complete`

### Upload Pipeline (Presigned URL Pattern)

The presigned URL pattern keeps large video files off the API server entirely:

1. API server generates a time-limited presigned PUT URL for MinIO/S3
2. Client uploads directly to object storage -- no proxy needed
3. After upload, the client notifies the API to mark the video as ready
4. The API queries MinIO for the file size and updates metadata

This eliminates the API server as a bottleneck for large uploads. At production scale, uploads go directly to S3 across edge locations.

### Share Token System

Share links use cryptographically random 64-character hex tokens:

1. Owner creates a share via POST `/api/videos/:id/share` with optional password, expiry, and download permission
2. Server generates a `crypto.randomBytes(32).toString('hex')` token
3. If password-protected, the password is bcrypt-hashed and stored alongside the token
4. Viewers access `/share/:token` -- the token is looked up, expiry is checked, and if password-protected, the viewer must authenticate
5. On valid access, the server generates a presigned GET URL for the video file

### Analytics Pipeline

View events are recorded with viewer identity (authenticated or session-based), watch duration, and completion status:

1. Client sends view events via POST `/api/analytics/view` with session ID and watch duration
2. Events are inserted into the `view_events` table with IP, user agent, and timestamp
3. Video `view_count` is incremented atomically
4. Analytics queries aggregate by day, computing unique viewers, average watch time, and completion rates

At production scale, view events would flow through Kafka to ClickHouse for real-time OLAP queries, with Redis HyperLogLog for approximate unique viewer counts.

## Database Schema

```sql
-- Users: standard auth table
users (id UUID PK, username UNIQUE, email UNIQUE, password_hash, display_name, avatar_url, role, timestamps)

-- Videos: core content table
videos (id UUID PK, user_id FK, title, description, duration_seconds, status [processing/ready/failed],
        storage_path, thumbnail_path, file_size_bytes, view_count, timestamps)
  Indexes: (user_id, created_at DESC), (status)

-- Comments: time-anchored commenting
comments (id UUID PK, video_id FK CASCADE, user_id FK, content, timestamp_seconds FLOAT nullable,
          parent_id FK self-ref, created_at)
  Indexes: (video_id, created_at), (parent_id)

-- Shares: token-based access control
shares (id UUID PK, video_id FK CASCADE, token VARCHAR(64) UNIQUE, password_hash nullable,
        expires_at nullable, allow_download, created_at)
  Indexes: (token), (video_id)

-- View Events: analytics data
view_events (id UUID PK, video_id FK CASCADE, viewer_id FK nullable, session_id,
             watch_duration_seconds, completed, ip_address, user_agent, created_at)
  Indexes: (video_id, created_at DESC), (viewer_id)

-- Folders: organization hierarchy
folders (id UUID PK, user_id FK, name, parent_id FK self-ref, created_at)
video_folders (video_id FK CASCADE, folder_id FK CASCADE, PK(video_id, folder_id))
  Indexes: (user_id), (parent_id)
```

## API Design

### Authentication
```
POST /api/auth/register     → Create account
POST /api/auth/login        → Session login
POST /api/auth/logout       → Destroy session
GET  /api/auth/me           → Current user info
```

### Videos
```
GET    /api/videos           → List user's videos (paginated, filterable by folder/search)
GET    /api/videos/:id       → Get video with author info
POST   /api/videos           → Create video metadata (title, description)
PUT    /api/videos/:id       → Update title/description
DELETE /api/videos/:id       → Delete video and storage objects
```

### Upload
```
POST /api/upload/presigned          → Generate presigned PUT URL for MinIO
POST /api/upload/complete           → Mark video ready after upload
GET  /api/upload/download/:videoId  → Generate presigned GET URL for playback
```

### Comments
```
GET    /api/videos/:videoId/comments       → List comments for a video
POST   /api/videos/:videoId/comments       → Create comment (with optional timestamp_seconds)
DELETE /api/videos/:videoId/comments/:id   → Delete comment
```

### Shares
```
POST   /api/share/:videoId/share        → Create share link with options
GET    /api/share/:token                → Validate share and get video
GET    /api/share/:videoId/shares       → List shares for a video
DELETE /api/share/:videoId/shares/:id   → Revoke share link
```

### Analytics
```
POST /api/analytics/view               → Record view event
GET  /api/analytics/:videoId/analytics  → Get aggregated analytics
```

### Folders
```
GET    /api/folders              → List user's folders
POST   /api/folders              → Create folder
PUT    /api/folders/:id          → Rename folder
DELETE /api/folders/:id          → Delete folder
POST   /api/folders/:id/videos   → Add video to folder
DELETE /api/folders/:id/videos/:videoId → Remove video from folder
```

## Key Design Decisions

### Presigned URLs vs. Proxy Upload

**Chosen: Presigned URLs.** Video files range from megabytes to gigabytes. Proxying through the API server would consume massive bandwidth and memory, creating a bottleneck. Presigned URLs let the client upload directly to object storage. The API server only handles metadata (kilobytes) and URL generation (< 100ms).

**Trade-off:** The client needs more upload logic (XHR with progress, retry on failure). We accept this complexity to keep the API server stateless and horizontally scalable.

### Time-Anchored Comments as Nullable Float

**Chosen: Single `timestamp_seconds FLOAT` column (nullable).** A null value means a general comment; a non-null value anchors it to a video timestamp. This keeps the schema simple -- no separate tables for anchored vs. unanchored comments.

**Alternative: Polymorphic comment types** with a `comment_type` enum and separate metadata tables. This would be overengineered for a feature where the only difference is the presence of a timestamp.

### Share Tokens vs. Video IDs for Public Access

**Chosen: Random 64-character tokens.** UUIDs for video IDs are predictable-ish (v4 UUIDs have patterns). Share tokens are `crypto.randomBytes(32)` -- 256 bits of entropy. Even if someone knows a video exists, they cannot access it without the exact token.

**Alternative: Signed URLs with HMAC.** This would avoid database lookups but makes revocation impossible without a blocklist. Token-based shares allow instant revocation by deleting the share row.

## Consistency and Idempotency

- **Upload completion** is idempotent: calling `/api/upload/complete` multiple times sets status to 'ready' and updates file size -- no duplicate side effects
- **View events** use insert-only semantics: duplicate view inserts create separate rows, but analytics aggregation handles this correctly via COUNT DISTINCT on viewer/session
- **Share token generation** always creates a new token -- no deduplication needed since each share is intentionally distinct

## Security

- **Session auth** via Redis-backed `express-session` with `httpOnly`, `sameSite: lax` cookies
- **Password-protected shares** use bcrypt with 10 salt rounds
- **Share expiration** checked server-side on every access -- expired tokens return 404
- **Rate limiting** on auth endpoints (50/15min), upload endpoints (10/min), and API generally (1000/15min)
- **Presigned URL expiry** set to 1 hour -- unused URLs become invalid automatically
- **Ownership validation** on all mutating endpoints -- users can only modify their own videos/folders/comments

## Observability

- **Prometheus metrics:** HTTP request duration/count histograms, video upload duration, active viewers gauge
- **Structured logging:** Pino with JSON output, request correlation via pino-http
- **Health check:** `GET /api/health` tests database connectivity
- **Metrics endpoint:** `GET /metrics` exposes Prometheus-format metrics

## Failure Handling

- **Circuit breaker** (Opossum) wraps external service calls (MinIO operations) with 50% error threshold, 30s reset timeout
- **Database pool** configured with 20 max connections, 5s connection timeout, automatic reconnection
- **Redis retry** with exponential backoff (50ms * attempts, max 2s)
- **Upload failure recovery:** Video remains in 'processing' status; client can retry upload and call complete again
- **Storage deletion failures** logged as warnings but don't block video metadata deletion (eventual cleanup)

## Scalability Considerations

### What breaks first: Video storage bandwidth
At 1M daily recordings averaging 50MB each, that is 50TB/day of new storage. S3 handles this natively. CDN caching of popular videos reduces origin bandwidth by 80-90%.

### Horizontal scaling path
1. **API servers:** Stateless, scale horizontally behind a load balancer
2. **Database:** Read replicas for video listing and analytics queries; write master for uploads and comments
3. **Analytics:** Move from PostgreSQL aggregation to ClickHouse for sub-second OLAP queries at billions of events
4. **Search:** Elasticsearch for full-text video title/description search
5. **Caching:** Redis for hot video metadata, share token validation, and session storage

### Sharding strategy
- Videos sharded by `user_id` hash -- keeps user's library on one shard
- View events partitioned by `created_at` month -- time-series access pattern
- Comments co-located with their video via `video_id` sharding

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Upload pattern | Presigned URLs | Proxy upload | API stays stateless, no bandwidth bottleneck |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler session management |
| Comment anchoring | Nullable float column | Polymorphic types | Simpler schema, single query for all comments |
| Share access | Random tokens | Signed URLs (HMAC) | Supports revocation, password protection, expiry |
| Analytics storage | PostgreSQL (local) | ClickHouse | Sufficient for local scale, ClickHouse for production |
| Video format | WebM (browser native) | MP4 (transcoded) | No server-side transcoding needed, browser-native |
| Object storage | MinIO (local S3) | Filesystem | S3-compatible API, mirrors production deployment |

## Implementation Notes

### Production-grade patterns implemented

**Presigned URL upload** (`src/services/storageService.ts`): MinIO client generates time-limited PUT/GET URLs, keeping video binary data off the API server entirely. The client uploads directly with XHR progress tracking.

**Circuit breaker** (`src/services/circuitBreaker.ts`): Opossum wraps MinIO operations. If object storage becomes unavailable, the circuit opens after 50% failure rate, failing fast for 30 seconds rather than hanging on timeouts.

**Prometheus metrics** (`src/services/metrics.ts`): Custom histograms for HTTP request duration, video upload duration, and a gauge for active viewers. Default metrics (CPU, memory, event loop) collected automatically.

**Structured logging** (`src/services/logger.ts`): Pino with JSON output in production, human-readable in development. Request-level correlation via pino-http middleware.

**Rate limiting** (`src/services/rateLimiter.ts`): Three tiers -- general API (1000/15min), auth (50/15min), uploads (10/min). Uses express-rate-limit with in-memory store locally.

**Session auth** (`src/middleware/auth.ts`): Redis-backed sessions via connect-redis. Session data includes userId, username, and role. Middleware guards protect authenticated routes.

### What was simplified or substituted

- **MinIO** substitutes for S3 -- same API, runs locally in Docker
- **PostgreSQL** serves both metadata and analytics -- production would separate these into PostgreSQL + ClickHouse
- **WebM format only** -- no server-side transcoding; production would use a media pipeline (FFmpeg) for HLS/DASH adaptive streaming
- **Session auth** instead of OAuth2 + JWT -- simpler for local development
- **In-memory rate limiting** instead of Redis-backed rate limiting with `rate-limit-redis`
- **No thumbnail generation** -- production would extract thumbnails from video frames server-side

### What was omitted

- **CDN** for video delivery (CloudFront, Cloudflare)
- **Adaptive bitrate streaming** (HLS/DASH) -- serving raw WebM files instead
- **Server-side video transcoding** pipeline (FFmpeg, AWS MediaConvert)
- **Real-time notifications** (WebSocket for new comments, processing completion)
- **Multi-region replication** for storage and database
- **Kubernetes orchestration** and auto-scaling
- **Content moderation** and abuse detection
- **Team workspaces** and permission model (RBAC beyond simple ownership)
