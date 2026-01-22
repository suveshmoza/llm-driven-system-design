# Apple TV+ - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Problem Statement

Design a complete premium video streaming platform that:
- Ingests master files and transcodes to multiple quality variants
- Delivers adaptive bitrate streaming with < 2s playback start
- Provides a cinematic browsing and viewing experience
- Synchronizes watch progress across devices

## Requirements Clarification

### Functional Requirements
1. **Ingest**: Accept 4K HDR masters and encode to 10+ variants
2. **Browse**: Discover content through hero banners, rows, and search
3. **Watch**: Stream with adaptive quality and DRM protection
4. **Sync**: Resume playback position across all devices
5. **Profiles**: Family sharing with individual profiles

### Non-Functional Requirements
1. **Latency**: < 2s time to first frame
2. **Quality**: Support 4K HDR with Dolby Vision
3. **Availability**: 99.99% for streaming
4. **Scale**: Millions of concurrent streams

### Scale Estimates
- Thousands of movies and shows
- Millions of subscribers worldwide
- Each title: 10+ encoded variants
- Petabytes of video content

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Client Applications                              │
│     React + HLS.js (Web) │ Swift/AVPlayer (iOS/tvOS) │ Kotlin (Android) │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              CDN Edge                                    │
│          Video Segments │ Manifests │ Images │ DRM Licenses             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Load Balancer                                  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
            │ API Server  │  │ API Server  │  │ API Server  │
            │   (Node)    │  │   (Node)    │  │   (Node)    │
            └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
                   │                │                │
        ┌──────────┴────────────────┴────────────────┴──────────┐
        │                                                        │
        ▼                ▼                ▼                     ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  PostgreSQL  │ │    Valkey    │ │   RabbitMQ   │ │    MinIO     │
│   (Primary)  │ │   (Cache)    │ │   (Queue)    │ │  (Storage)   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

## Deep Dive: Type Definitions

### Content Types

**Content Entity**:
- id, title, description, duration (seconds), releaseYear, rating
- genres (array), contentType: 'movie' | 'series' | 'episode'
- seriesId, seasonNumber, episodeNumber (for episodes)
- masterResolution, hdrFormat: 'dolby_vision' | 'hdr10' | 'hdr10plus' | null
- hasAtmos, posterUrl, thumbnailUrl, heroImageUrl, logoUrl
- status: 'processing' | 'ready' | 'error'

**EncodedVariant**:
- id, contentId, resolution (height in px)
- codec: 'hevc' | 'h264', hdr (boolean)
- bitrate (kbps), filePath, fileSize (bytes)

**WatchProgress**:
- profileId, contentId, position (seconds), duration
- completed (boolean), clientTimestamp, updatedAt

### API Types

**PlaybackSession**:
- manifestUrl, playbackToken, licenseUrl
- qualities: array of { height, bitrate, codec, hdr }
- resumePosition (seconds)

**ProgressUpdateRequest/Response**:
- Request: contentId, position, duration, clientTimestamp
- Response: success, wasUpdated, serverTimestamp

**RecommendationsResponse**:
- sections: array of { title, type, items }
- types: 'continue_watching' | 'trending' | 'personalized' | 'new'

## Deep Dive: API Layer Integration

### API Client Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ApiClient                                 │
├─────────────────────────────────────────────────────────────────┤
│  Private:                                                        │
│  - token: string | null                                          │
│  - request<T>(method, path, body?, options?): Promise<T>         │
│                                                                  │
│  Request Features:                                               │
│  - Auto-adds Authorization header when token set                 │
│  - Adds Idempotency-Key for POST/PUT/PATCH                      │
│  - Includes credentials for cookies                              │
│  - Parses JSON responses, throws ApiError on failure            │
├─────────────────────────────────────────────────────────────────┤
│  Auth Methods:                                                   │
│  - login(username, password) -> { user, profiles }              │
│  - logout()                                                      │
│                                                                  │
│  Profile Methods:                                                │
│  - getProfiles() -> Profile[]                                    │
│  - selectProfile(profileId) -> { token }                        │
│                                                                  │
│  Content Methods:                                                │
│  - getContent(id) -> Content                                     │
│  - getContentList(params) -> ContentListResponse                 │
│  - getRecommendations(profileId) -> RecommendationsResponse      │
│                                                                  │
│  Playback Methods:                                               │
│  - getPlaybackSession(contentId) -> PlaybackSession              │
│  - updateProgress(data) -> ProgressUpdateResponse                │
│  - getContinueWatching(profileId) -> Content[]                   │
└─────────────────────────────────────────────────────────────────┘
```

### Streaming Route Flow

**POST /:contentId/session** - Create playback session:

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  Client  │────>│  API Server  │────>│  PostgreSQL  │
└──────────┘     └──────────────┘     └──────────────┘
     │                  │                    │
     │  Request session │  Check content     │
     │                  │  exists & ready    │
     │                  │<───────────────────│
     │                  │                    │
     │                  │  Get variants      │
     │                  │<───────────────────│
     │                  │                    │
     │                  │  Get saved         │
     │                  │  progress          │
     │                  │<───────────────────│
     │                  │                    │
     │                  │  Generate signed   │
     │                  │  playback token    │
     │<─────────────────│                    │
     │  PlaybackSession │                    │
```

**GET /:contentId/master.m3u8** - HLS master manifest:

```
┌──────────────────────────────────────────────────────────────┐
│                   HLS Master Manifest                         │
├──────────────────────────────────────────────────────────────┤
│  #EXTM3U                                                      │
│  #EXT-X-VERSION:6                                             │
│                                                               │
│  # Audio groups                                               │
│  #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",                   │
│    LANGUAGE="en",NAME="English",URI="audio/en.m3u8"          │
│                                                               │
│  # Video variants (sorted by resolution desc)                 │
│  #EXT-X-STREAM-INF:BANDWIDTH=15000000,                       │
│    RESOLUTION=3840x2160,CODECS="hvc1.2.4...",AUDIO="audio"   │
│  2160_15000.m3u8                                              │
│                                                               │
│  #EXT-X-STREAM-INF:BANDWIDTH=8000000,                        │
│    RESOLUTION=1920x1080,CODECS="hvc1.1.6...",AUDIO="audio"   │
│  1080_8000.m3u8                                               │
└──────────────────────────────────────────────────────────────┘
```

**Codec Strings**:
- HEVC + HDR: `hvc1.2.4.L150.B0,mp4a.40.2`
- HEVC SDR: `hvc1.1.6.L150.90,mp4a.40.2`
- H.264: `avc1.640029,mp4a.40.2`

## Deep Dive: Watch Progress Synchronization

### Frontend Store Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                      PlayerStore (Zustand)                       │
├─────────────────────────────────────────────────────────────────┤
│  State:                                                          │
│  - contentId: string | null                                      │
│  - currentTime: number                                           │
│  - duration: number                                              │
│  - isPlaying: boolean                                            │
│  - lastSyncedTime: number                                        │
├─────────────────────────────────────────────────────────────────┤
│  Actions:                                                        │
│  - updateTime(time): Updates currentTime, triggers sync if      │
│    30+ seconds since lastSyncedTime                             │
│  - syncProgress(): POSTs to /api/watch/progress                 │
│    with clientTimestamp for conflict resolution                 │
└─────────────────────────────────────────────────────────────────┘
```

### Backend Progress Handler

**POST /progress** - Update watch progress with last-write-wins:

```
┌─────────────────────────────────────────────────────────────────┐
│               Last-Write-Wins Conflict Resolution                │
├─────────────────────────────────────────────────────────────────┤
│  INSERT INTO watch_progress (...)                                │
│  ON CONFLICT (profile_id, content_id) DO UPDATE SET             │
│    position = CASE                                               │
│      WHEN watch_progress.client_timestamp < EXCLUDED.client_ts  │
│      THEN EXCLUDED.position                                      │
│      ELSE watch_progress.position  -- Keep older, ignore stale  │
│    END,                                                          │
│    completed = CASE                                              │
│      WHEN position/duration > 0.9 THEN true                      │
│      ELSE completed                                              │
│    END                                                           │
└─────────────────────────────────────────────────────────────────┘
```

**GET /continue** - Continue watching list:
- Filters: position > 60s, not completed, progress < 90%
- Orders by updated_at DESC, limits to 20
- Cached in Valkey for 5 minutes
- Includes remainingMinutes calculation

**POST /progress/batch** - Batch sync for offline-to-online:
- Accepts up to 50 updates per request
- Processes each with same last-write-wins logic
- Returns per-item success/failure results

## Deep Dive: HLS Player Integration

### Video Player Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      VideoPlayer Component                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Initialization Flow:                                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. Fetch playback session from API                       │   │
│  │ 2. Create HLS.js instance (or native for Safari)         │   │
│  │ 3. Configure XHR to add auth token to segment requests   │   │
│  │ 4. Load source from manifestUrl                          │   │
│  │ 5. On MANIFEST_PARSED: set available qualities           │   │
│  │ 6. Seek to resumePosition, start playback               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  HLS.js Configuration:                                           │
│  - enableWorker: true (offload parsing)                         │
│  - lowLatencyMode: false (VOD content)                          │
│  - backBufferLength: 90s (memory management)                    │
│  - maxBufferLength: 30s (start playback fast)                   │
│  - maxMaxBufferLength: 600s (allow large buffers)               │
│                                                                  │
│  Error Recovery:                                                 │
│  - NETWORK_ERROR: Call hls.startLoad() to retry                 │
│  - MEDIA_ERROR: Call hls.recoverMediaError()                    │
│  - Other fatal: Log and show error UI                           │
│                                                                  │
│  Quality Selection:                                              │
│  - 'auto': hls.currentLevel = -1                                │
│  - Specific: Find level index by height, set currentLevel       │
│                                                                  │
│  Cleanup:                                                        │
│  - syncProgress() on unmount                                     │
│  - hls.destroy() to free resources                              │
└─────────────────────────────────────────────────────────────────┘
```

## Deep Dive: Profile Management

### Frontend Profile Selector

```
┌─────────────────────────────────────────────────────────────────┐
│                       Who's Watching?                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐         │
│    │        │    │        │    │        │    │   +    │         │
│    │  Dad   │    │  Mom   │    │  Kids  │    │  Add   │         │
│    │        │    │        │    │ [Kids] │    │Profile │         │
│    └────────┘    └────────┘    └────────┘    └────────┘         │
│       Dad          Mom          Tommy                            │
│                                (Kids)                            │
│                                                                  │
│  Behaviors:                                                      │
│  - Animated entrance with staggered delays                       │
│  - Hover border highlight                                        │
│  - Kids profiles show green ring + badge                        │
│  - Max 6 profiles (Add button hidden when at limit)             │
│  - On select: calls API, navigates to home                      │
└─────────────────────────────────────────────────────────────────┘
```

### Backend Profile Routes

**GET /profiles** - List user's profiles (ordered by created_at)

**POST /profiles** - Create new profile:
- Validates: name (1-50 chars), avatarUrl (optional URL), isKids (boolean)
- Enforces 6-profile limit per user
- Returns created profile with generated ID

**POST /profiles/:id/select** - Select profile for session:
- Verifies profile belongs to authenticated user
- Updates session with profileId and isKidsProfile flag
- Returns selected profile info

**GET /profiles/:id/recommendations** - Personalized sections:

```
┌─────────────────────────────────────────────────────────────────┐
│              Recommendation Sections Pipeline                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Verify profile ownership                                     │
│  2. Check isKids flag for content filtering                     │
│                                                                  │
│  Section Building:                                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Continue Watching  - In-progress content for profile      │  │
│  │                      (only if items exist)                │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ Trending Now       - Popular content (filtered by isKids) │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ New Releases       - Recent content (filtered by isKids)  │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ Because You        - Based on watch history               │  │
│  │ Watched...          (only if history exists)              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## API Design Summary

### Endpoints

```
Authentication:
POST   /api/auth/login              Login with credentials
POST   /api/auth/logout             Logout and clear session

Profiles:
GET    /api/profiles                List user's profiles
POST   /api/profiles                Create new profile
POST   /api/profiles/:id/select     Select profile for session
GET    /api/profiles/:id/recommendations  Get personalized recommendations

Content:
GET    /api/content                 List content (with pagination)
GET    /api/content/:id             Get content details

Streaming:
POST   /api/stream/:contentId/session     Create playback session
GET    /api/stream/:contentId/master.m3u8 Get HLS master manifest
GET    /api/stream/:contentId/:variant.m3u8  Get variant playlist
POST   /api/drm/license             Request DRM license

Watch Progress:
POST   /api/watch/progress          Update watch progress
GET    /api/watch/continue          Get continue watching list
POST   /api/watch/progress/batch    Batch sync progress

Admin:
POST   /api/admin/content           Upload new content
GET    /api/admin/content/:id/status   Check transcoding status
POST   /api/admin/content/:id/publish  Publish content
```

## Caching Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cache Layers                                │
├─────────────────────────────────────────────────────────────────┤
│  CDN Edge (24h)                                                  │
│  - Video segments (.ts files)                                    │
│  - Images (posters, thumbnails)                                  │
├─────────────────────────────────────────────────────────────────┤
│  CDN Edge (1h)                                                   │
│  - HLS manifests (.m3u8)                                         │
├─────────────────────────────────────────────────────────────────┤
│  Valkey (5min)                                                   │
│  - Continue watching lists                                       │
│  - Recommendations                                               │
│  - Content metadata                                              │
├─────────────────────────────────────────────────────────────────┤
│  Valkey (7 days)                                                 │
│  - User sessions                                                 │
│  - Idempotency keys (24h)                                        │
└─────────────────────────────────────────────────────────────────┘
```

## Error Handling Pattern

### Backend Error Handler

```
┌─────────────────────────────────────────────────────────────────┐
│                    Error Handler Middleware                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Log error with context:                                      │
│     - error message and stack                                    │
│     - requestId for tracing                                      │
│     - userId if authenticated                                    │
│     - request path                                               │
│                                                                  │
│  2. Track metrics:                                               │
│     - Increment httpErrors counter                               │
│     - Label by path and status code                             │
│                                                                  │
│  3. Send response:                                               │
│     - ApiError: Return statusCode and message                   │
│     - Other: Return 500 with requestId (no internal details)    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend Error Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│                  Something went wrong                            │
│                                                                  │
│                     [!] Icon                                     │
│                                                                  │
│              {error.message displayed}                           │
│                                                                  │
│                  [ Try Again ]                                   │
│                                                                  │
│  Behaviors:                                                      │
│  - Catches React render errors                                   │
│  - Full-screen dark background matching app theme               │
│  - resetErrorBoundary clears error state                        │
└─────────────────────────────────────────────────────────────────┘
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Session-based auth | Simple, secure cookies | Server-side state |
| PostgreSQL for all data | ACID, joins, familiar | Write scaling limits |
| HLS over DASH | Native Apple support | Less efficient |
| Last-write-wins sync | Low latency, simple | Potential stale data |
| Zod validation | Runtime type safety | Extra bundle size |
| Zustand over Redux | Less boilerplate | Smaller ecosystem |
| Separate profile sessions | Better isolation | More API calls |

## Future Fullstack Enhancements

1. **GraphQL API**: Better data fetching flexibility
2. **WebSocket Progress**: Real-time cross-device sync
3. **Offline Mode**: Service worker with IndexedDB
4. **SSR/Streaming**: React Server Components
5. **Multi-Region**: Global deployment with data locality
6. **Feature Flags**: Gradual rollout of new features
