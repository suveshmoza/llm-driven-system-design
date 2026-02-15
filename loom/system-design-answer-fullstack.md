# Loom - System Design Answer (Full-Stack Focus)

## 1. Clarifying Questions (2 minutes)

> "We're building a Loom-like platform for asynchronous video communication. Users record their screen or camera in the browser, upload recordings, share via link, and track engagement. I'll cover both the frontend recording/playback experience and the backend upload pipeline, storage, commenting, and analytics. Should I include team workspaces and permissions, or focus on individual use?"

Assuming individual use with sharing. Teams and RBAC would be follow-up features.

> "And should I design for transcoding and adaptive bitrate streaming, or raw browser-native video delivery?"

Assuming raw WebM delivery locally, with notes on where HLS/DASH transcoding fits at production scale.

## 2. Functional Requirements

- Browser-based screen and camera recording with MediaRecorder API
- Direct-to-storage video upload with progress tracking
- Video library management with folders and search
- Video playback with time-anchored comments
- Share links with password protection, expiration, and download control
- View analytics: total views, unique viewers, watch duration, completion rate

## 3. Non-Functional Requirements

- Recording works in Chrome and Firefox (MediaRecorder support required)
- Presigned URL generation under 100ms at p99
- Upload progress updates at least every 500ms
- Share link validation under 50ms at p99
- Analytics freshness within 5 seconds
- System supports recordings up to 2GB
- Graceful degradation: analytics can be down without affecting playback/sharing

## 4. High-Level Architecture

```
┌──────────────────────┐
│      Browser         │
│ ┌──────────────────┐ │      ┌──────────────┐     ┌──────────────┐
│ │  React + Zustand │ │─────▶│   CDN/Edge   │────▶│  API Gateway │
│ │  MediaRecorder   │ │      │  (Delivery)  │     │  (Auth/Rate) │
│ └──────────────────┘ │      └──────────────┘     └──────┬───────┘
│          │           │                                  │
│          │ PUT       │                          ┌───────┴───────┐
│          │ (presigned)                          │               │
│          ▼           │                  ┌───────┴──────┐ ┌──────┴───────┐
│  ┌───────────────┐   │                  │  Video API   │ │  Analytics   │
│  │ XHR Upload    │───┼─────────────────▶│  Service     │ │  Service     │
│  │ (progress)    │   │                  └──────┬───────┘ └──────┬───────┘
│  └───────────────┘   │                         │                │
└──────────────────────┘                  ┌──────┴───────┐ ┌──────┴───────┐
                                          │  PostgreSQL  │ │  Redis       │
       ┌───────────────┐                  │  (metadata)  │ │  (sessions,  │
       │  S3 / MinIO   │◀── presigned ────│              │ │   cache)     │
       │  (video files)│     URLs         └──────────────┘ └──────────────┘
       └───────────────┘
```

> "The critical architectural decision is that video bytes never pass through the API server. The browser uploads directly to object storage via presigned URLs. The API server handles only metadata operations -- kilobytes, not gigabytes."

## 5. Data Model

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash, display_name, role | username, email | Session-based auth via Redis |
| videos | id (UUID PK), user_id (FK), title, description, duration_seconds, status, storage_path, thumbnail_path, file_size_bytes, view_count | (user_id, created_at DESC), status | Status transitions: processing, ready, failed. view_count denormalized |
| comments | id (UUID PK), video_id (FK CASCADE), user_id (FK), content, timestamp_seconds (nullable float), parent_id (self-ref FK) | (video_id, created_at), parent_id | Null timestamp = general comment, non-null = time-anchored |
| shares | id (UUID PK), video_id (FK CASCADE), token (unique, 64 chars), password_hash (nullable), expires_at (nullable), allow_download | token, video_id | 256-bit crypto-random tokens, bcrypt passwords |
| view_events | id (UUID PK), video_id (FK CASCADE), viewer_id (FK nullable), session_id, watch_duration_seconds, completed, ip_address | (video_id, created_at DESC) | Insert-only append log, aggregated on read |
| folders | id (UUID PK), user_id (FK), name, parent_id (self-ref FK) | user_id | Hierarchical with adjacency list |
| video_folders | video_id (FK), folder_id (FK), PK(video_id, folder_id) | -- | Many-to-many junction table |

> "The view_count on videos is intentionally denormalized. The video library grid needs view counts for every card -- running COUNT(*) on view_events per video would be prohibitively slow. We atomically increment view_count on each view event."

## 6. API Design

```
POST /api/auth/register          Create account
POST /api/auth/login             Start session
POST /api/auth/logout            End session
GET  /api/auth/me                Current user

GET    /api/videos               List videos (paginated, searchable, folder-filterable)
GET    /api/videos/:id           Get video + author info
POST   /api/videos               Create metadata (title, desc) -- returns ID for upload
PUT    /api/videos/:id           Update title/description
DELETE /api/videos/:id           Delete video + cascade storage

POST /api/upload/presigned       Get presigned PUT URL for MinIO/S3
POST /api/upload/complete        Mark video ready after upload
GET  /api/upload/download/:id    Get presigned GET URL for playback

GET  /api/videos/:id/comments    List comments (chronological)
POST /api/videos/:id/comments    Create comment (optional timestamp_seconds, parentId)
DELETE /api/videos/:id/comments/:commentId  Delete own comment

POST   /api/share/:id/share      Create share link with options
GET    /api/share/:token         Validate share, get video + presigned URL (unauthenticated)
GET    /api/share/:id/shares     List shares for a video (owner only)
DELETE /api/share/:id/shares/:shareId  Revoke share

POST /api/analytics/view         Record view event (works unauthenticated)
GET  /api/analytics/:id/analytics  Get aggregate stats (owner only)

GET    /api/folders              List folders
POST   /api/folders              Create folder
PUT    /api/folders/:id          Rename folder
DELETE /api/folders/:id          Delete folder
POST   /api/folders/:id/videos   Add video to folder
```

> "The share validation endpoint (GET /api/share/:token) is intentionally unauthenticated. Anyone with the token can access the video, subject to password and expiration checks. This is the same access model as Google Docs share links."

## 7. Frontend Architecture

### Route Structure

```
/                     Library page -- video grid with folder sidebar
/login                Authentication
/register             Account creation
/record               Recording interface (authenticated)
/videos/:videoId      Player + comments + analytics sidebar
/share/:token         Public share page (no auth required)
```

### State Management

**Global state (Zustand):**
- **authStore** -- user, loading, login/register/logout/checkAuth actions. The `loading` flag starts `true` to prevent flash-of-login-page when a session cookie exists
- **videoStore** -- video list, current video, upload state (progress, uploading flag), recording state (blob, isRecording). The `createAndUpload` action manages the 4-step upload flow

**Local state (React useState):**
- Comment input text, search query, modal visibility, recording mode selection, active tab (comments vs. analytics), share form fields

> "The boundary: if state must survive route changes or be consumed by sibling components, it's global. Everything else stays local."

### Key Component Responsibilities

- **RecordingInterface** -- manages MediaRecorder lifecycle, screen/camera mode, pause/resume, timer display, stream cleanup on unmount
- **RecordingPreview** -- renders the recorded Blob in a `<video>` element via `URL.createObjectURL()` for review before upload
- **UploadProgress** -- circular SVG progress ring + linear progress bar, 5-stage labels ("Creating video...", "Uploading...", etc.)
- **VideoPlayer** -- wraps native `<video>` element, exposes `onTimeUpdate` callback for comment anchoring
- **CommentSection** -- loads comments, provides input with optional time anchor checkbox, single-level threading
- **CommentItem** -- renders comment with author initial avatar, timestamp badge (clickable), delete button
- **ShareModal** -- form for password, expiry, download permission; shows copyable share URL after creation
- **AnalyticsPanel** -- stat cards (total views, unique viewers, avg duration, completion rate) + ViewsChart bar chart
- **FolderTree** -- sidebar folder list with create/delete, folder selection filters the video grid
- **VideoGrid/VideoCard** -- responsive CSS Grid of video thumbnails with duration badges and view counts

## 8. Deep Dives

### Deep Dive 1: Video Storage and Delivery (Full-Stack)

> "The upload flow is the most architecturally interesting full-stack interaction. It requires tight coordination between the React frontend, Express API, and MinIO object storage."

**Frontend upload orchestration (videoStore):**

The `createAndUpload` action in the Zustand store manages a four-step flow with progress tracking at each stage:

Step 1 -- Create metadata (0-10%): POST to `/api/videos` with title and description. Returns a video ID with status "processing". The video exists in the database but has no file yet.

Step 2 -- Get presigned URL (10-20%): POST to `/api/upload/presigned` with the video ID. The backend verifies ownership, generates a time-limited (1-hour) PUT URL from the MinIO SDK, and stores the object path on the video record. The path follows `{userId}/{videoId}/{uuid}.webm` -- grouping a user's files for efficient bulk operations.

Step 3 -- Upload blob (20-85%): XHR PUT to the presigned URL with the recorded Blob. This is the only step where we use XMLHttpRequest instead of fetch -- XHR supports `upload.onprogress` events with `loaded`/`total` bytes. We map upload progress to the 20-85% range: `progress = 20 + (loaded / total) * 65`. The API server is completely bypassed during this step.

Step 4 -- Complete (85-100%): POST to `/api/upload/complete`. The backend queries MinIO for the file size via `statObject`, updates the video status to "ready", and stores `file_size_bytes` and `duration_seconds`.

**Backend presigned URL generation (storageService):**

The MinIO client's `presignedPutObject` generates a URL containing a cryptographic signature that encodes the bucket, object key, expiration time, and allowed HTTP method. The client can PUT to this URL without any authentication headers -- the signature IS the authentication. This means the API server never sees the video bytes.

**Why not proxy the upload through the API?** Three reasons: memory (Express buffers request bodies -- a 500MB upload consumes 500MB of Node.js heap), bandwidth (API egress costs 3-5x more than S3 ingress), and availability (API restart during upload = total upload loss; with presigned URLs, S3 handles the upload independently).

**Playback delivery:** When a user or share viewer requests a video, the frontend calls GET `/api/upload/download/:videoId`. The backend generates a presigned GET URL (1-hour expiry) and returns it. The frontend sets this as the `<video>` element's `src`. The browser fetches directly from MinIO/S3.

**The trade-off:** Presigned URLs expire. If a user leaves a video page open for over an hour, playback fails. We would handle this by catching video load errors and transparently requesting a fresh presigned URL. The alternative -- proxying through the API -- never expires but creates a massive bandwidth bottleneck. At production scale, a CDN would cache popular videos and handle expiry transparently.

### Deep Dive 2: Comment System with Time Anchoring (Full-Stack)

> "Time-anchored comments create a tight coupling between the video player and the comment UI. Let me walk through how data flows between them across the full stack."

**Data flow architecture:**

The VideoPage component holds `playerTime` in local state. VideoPlayer fires `onTimeUpdate` from the HTML5 video element (~4 times/second), updating `playerTime`. CommentSection receives `playerTime` and uses it for the "Anchor at X:XX" label on the comment input checkbox.

When the user checks "Anchor at 2:34" and submits, the comment is created with `timestampSeconds: 134` (floored to integer). The backend stores this as a nullable FLOAT in the comments table. When fetched, comments with non-null timestamps render a clickable badge in the CommentItem component.

**Backend schema decision:**

> "I chose a nullable float over polymorphic comment types because the ONLY difference between a general comment and a time-anchored comment is the presence of a timestamp value. Creating two tables or a discriminated union for a single nullable field is overengineering. One table, one query, one API endpoint."

The float type (vs. integer) preserves sub-second precision for future features like frame-accurate annotations. In the UI, we floor to integer seconds because "2:34.7" looks awkward.

**Comment threading:** Comments support single-level nesting via `parent_id`. The backend returns all comments in chronological order. The frontend groups them: top-level comments render first, with replies indented below their parent.

> "I chose single-level nesting over unlimited depth. Two levels (comment + reply) covers 95% of asynchronous discussion patterns on video. Unlimited nesting creates recursive rendering complexity, confusing indentation in a narrow ~300px sidebar, and makes chronological ordering ambiguous. Loom's actual product uses single-level replies."

**Comment loading strategy:** Comments load in a separate API call from video metadata. The video starts playing immediately while comments load asynchronously. This separation is critical -- a video with 500 comments should not delay playback by a second while the comment query completes.

**Why not timeline-synced comments?** Some platforms auto-scroll comments to match video position. This fails because: (1) comments are posted chronologically, not in video-time order, causing random jumping; (2) general comments have no timeline position; (3) auto-scroll fights user scrolling intent. We show all comments chronologically with optional timestamp badges. Simple and predictable.

**The trade-off:** Time-anchored comments on the same second all show identical badges. We don't collapse or cluster them. At Loom's typical density (5-20 comments per video), this is not a problem. At higher density, we might group comments by time range.

### Deep Dive 3: Analytics and Engagement Tracking (Full-Stack)

> "Analytics seems simple -- count views -- but the full stack involves careful event design, deduplication, and efficient aggregation."

**Frontend view tracking:**

The share page generates a random session ID on mount: `anon-{timestamp}-{random}`. This identifies the viewing session without requiring authentication. The page calls POST `/api/analytics/view` with the video ID and session ID.

For authenticated users on the video page, the session includes the viewer's user ID, enabling richer analytics (which team members watched).

Watch duration tracking would fire periodic updates (every 30 seconds) with cumulative watch time, plus a final event on video end or navigation away. The `completed` flag is set when the video reaches 90% of its duration.

**Backend event recording:**

The analytics endpoint inserts a row into `view_events` with the video ID, viewer ID (nullable for anonymous), session ID, watch duration, completion flag, IP address, and user agent. It also atomically increments `view_count` on the videos table with `UPDATE videos SET view_count = view_count + 1`.

> "I separate the view_events table from the video view_count for a reason. view_count is a denormalized counter for fast display in the video grid. view_events is the source of truth for detailed analytics. They may temporarily diverge, but view_events is always authoritative."

**Aggregation query design:**

The analytics endpoint runs a single PostgreSQL query computing:
- Total views: COUNT(*)
- Unique viewers: COUNT(DISTINCT COALESCE(viewer_id::text, session_id))
- Average watch duration: AVG(watch_duration_seconds)
- Completion rate: COUNT(*) FILTER (WHERE completed) * 100.0 / COUNT(*)
- Views by day: GROUP BY DATE(created_at)

The COALESCE handles anonymous viewers who have session_id but no viewer_id.

**Frontend analytics display:**

The AnalyticsPanel shows four stat cards in a 2x2 grid (total views, unique viewers, avg watch time, completion rate) and a ViewsChart component below. ViewsChart renders a bar chart using div elements with calculated heights -- no charting library needed for a basic daily histogram. Each bar has a hover tooltip showing the exact count.

**Production scaling path:**

At 10M daily view events, the view_events table grows by 300M rows/month. The aggregation query becomes slow past ~100M rows. Three evolutionary stages:

1. Direct PostgreSQL (now): works to ~100M rows, query time 50-200ms
2. Materialized views: pre-compute daily aggregates, refreshed every 5 minutes. Trade fresh data for fast reads
3. ClickHouse: columnar OLAP database handles billion-row aggregations in sub-second. Events flow through Kafka. PostgreSQL retains only metadata

At scale, Redis HyperLogLog provides approximate unique viewer counts (< 0.81% error) in O(1) time and 12KB constant memory per video, replacing expensive COUNT DISTINCT queries.

**The trade-off:** We compute analytics on-demand from raw events rather than pre-aggregating. This gives always-fresh data but slower queries as data grows. At local scale, queries take < 100ms. At production scale, pre-aggregation is mandatory, introducing up to 5 minutes of staleness. This is acceptable -- video creators don't need real-time analytics precision.

## 9. End-to-End Flows

### Recording and Upload Flow

```
User                    Frontend                   Backend                  MinIO
 │                        │                          │                       │
 │  Click "Record"        │                          │                       │
 │───────────────────────▶│                          │                       │
 │                        │  getDisplayMedia()       │                       │
 │  Select screen         │  MediaRecorder.start()   │                       │
 │◀──────────────────────▶│                          │                       │
 │                        │                          │                       │
 │  Click "Stop"          │                          │                       │
 │───────────────────────▶│  Assemble Blob           │                       │
 │                        │  Show Preview            │                       │
 │  Enter title           │                          │                       │
 │  Click "Upload"        │                          │                       │
 │───────────────────────▶│  POST /api/videos        │                       │
 │                        │─────────────────────────▶│                       │
 │                        │  { video.id }            │                       │
 │                        │◀─────────────────────────│                       │
 │                        │  POST /api/upload/presigned                      │
 │                        │─────────────────────────▶│  presignedPutObject   │
 │                        │  { uploadUrl }           │──────────────────────▶│
 │                        │◀─────────────────────────│◀──────────────────────│
 │                        │  XHR PUT uploadUrl       │                       │
 │                        │──────────────────────────┼──────────────────────▶│
 │  [progress updates]    │                          │                       │
 │◀───────────────────────│                          │                       │
 │                        │  POST /api/upload/complete                       │
 │                        │─────────────────────────▶│  statObject           │
 │                        │  { status: ready }       │──────────────────────▶│
 │  Navigate to video     │◀─────────────────────────│◀──────────────────────│
 │◀───────────────────────│                          │                       │
```

### Share Access Flow

```
Owner                   Frontend                   Backend
 │                        │                          │
 │  Click "Share"         │                          │
 │───────────────────────▶│  POST /api/share/:id/share
 │                        │─────────────────────────▶│  crypto.randomBytes(32)
 │                        │  { token }               │  bcrypt password if set
 │  Copy link             │◀─────────────────────────│
 │◀───────────────────────│                          │

Viewer                  Frontend                   Backend
 │                        │                          │
 │  Open share URL        │                          │
 │───────────────────────▶│  GET /api/share/:token   │
 │                        │─────────────────────────▶│  Lookup token
 │                        │                          │  Check expires_at
 │                        │                          │  Check password_hash
 │                        │  { video, downloadUrl }  │  presignedGetObject
 │  Watch video           │◀─────────────────────────│
 │◀───────────────────────│                          │
```

## 10. Failure Handling

> "Let me briefly cover how failures are handled across the stack."

**Upload failure:** Video stays in "processing" status. Client can retry with a new presigned URL. Background job cleans up orphaned videos after 24 hours.

**Storage unavailability:** Circuit breaker (Opossum) wraps MinIO operations. After 50% failure rate, circuit opens for 30 seconds. Upload and playback degrade gracefully -- user sees "Video not available" instead of a crash.

**Database failure:** Connection pool fails fast (5-second timeout). Health check endpoint (`GET /api/health`) enables load balancer to route away from unhealthy instances.

**Redis failure:** Sessions cannot be validated -- authenticated endpoints return 401. Share validation still works (PostgreSQL-only path). Users must re-login when Redis recovers.

## 11. Scalability Discussion

**10K DAU:** Single PostgreSQL, single API server, local MinIO. No caching needed.

**100K DAU:** Read replicas for video listing. Redis caches hot metadata. Rate limiting moves to Redis-backed.

**1M DAU:** CDN for video delivery (mandatory at this scale -- raw serving is cost-prohibitive). ClickHouse for analytics. Elasticsearch for search.

**10M DAU:** Shard PostgreSQL by user_id. Partition view_events by month. HLS/DASH transcoding pipeline. Edge processing for transcoding.

## 12. Trade-offs Summary

| Approach | Pros | Cons |
|----------|------|------|
| Presigned URL upload | API stays stateless, scales independently | Multi-step client logic, URL expiry handling |
| ❌ Proxy upload | Simpler client, single endpoint | API becomes memory/bandwidth bottleneck |
| MediaRecorder (WebM) | No server processing, instant capture | Safari limited, no adaptive bitrate |
| ❌ Server recording | Universal format, quality control | Streaming infra, latency, cost |
| XHR for upload progress | Accurate byte-level progress events | Older API, more verbose than fetch |
| ❌ Fetch API | Modern, cleaner code | No upload progress support |
| Nullable float for timestamps | Simple schema, single table and query | No compile-time type distinction |
| ❌ Polymorphic comments | Explicit types, cleaner domain model | Over-engineering for one nullable field |
| Token-based shares | Revocable, password-protected, expirable | Database lookup per access (~1ms) |
| ❌ Signed URLs (HMAC) | No database lookup | Cannot revoke individual links |
| On-demand analytics aggregation | Always fresh data, simple implementation | Slower queries as data grows past 100M rows |
| ❌ Pre-aggregated materialized views | Fast reads at any scale | Up to 5 minutes of data staleness |
| Denormalized view_count on videos | O(1) read for grid display | Can diverge from authoritative count |
| ❌ COUNT(*) per video on read | Always accurate | O(n) query per video in grid listing |
| Session auth (Redis) | Immediate revocation, simple | Server-side state, Redis dependency |
| ❌ JWT tokens | Stateless, horizontally scalable | No revocation without blocklist |
