# Apple TV+ - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a premium video streaming service that:
- Ingests and transcodes master video files to multiple quality variants
- Delivers adaptive bitrate streaming via HLS
- Provides global content delivery with < 2s playback start
- Manages DRM licensing and content protection

## Requirements Clarification

### Functional Requirements
1. **Video Ingestion**: Accept 4K HDR master files and transcode to 10+ variants
2. **Manifest Generation**: Create HLS master and variant playlists
3. **DRM Licensing**: Issue FairPlay licenses for authorized devices
4. **Watch Progress**: Sync playback position across devices
5. **Content Catalog**: Serve metadata, recommendations, and search

### Non-Functional Requirements
1. **Latency**: < 2s from play request to first frame
2. **Quality**: Support 4K HDR with Dolby Vision and Atmos
3. **Availability**: 99.99% for streaming, 99.9% for catalog
4. **Scale**: Millions of concurrent streams globally

### Scale Estimates
- Thousands of movies and shows
- Millions of subscribers
- Each title: 10+ encoded variants (4K HDR to 360p)
- Petabytes of video content

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Load Balancer (nginx)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ API Server  │ │ API Server  │ │ API Server  │
            │   (Node)    │ │   (Node)    │ │   (Node)    │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   └───────────────┼───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │    Valkey    │      │  PostgreSQL  │      │     CDN      │
    │   (Cache +   │      │   (Primary)  │      │    Edges     │
    │   Sessions)  │      │              │      │              │
    └──────────────┘      └──────────────┘      └──────────────┘
                                   │
                          ┌────────┴────────┐
                          ▼                 ▼
                  ┌──────────────┐  ┌──────────────┐
                  │   RabbitMQ   │  │    MinIO     │
                  │  (Job Queue) │  │  (Segments)  │
                  └──────────────┘  └──────────────┘
```

## Deep Dive: Transcoding Pipeline

### Database Schema

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **content** | id (UUID PK), title, description, duration (seconds), content_type (movie/series/episode), series_id (self-ref FK), season_number, episode_number, master_resolution, hdr_format, status (default 'processing') | — | Content catalog with hierarchical series/episode support |
| **encoded_variants** | id (UUID PK), content_id (FK), resolution, codec, hdr (boolean), bitrate, file_path, file_size, encoding_time | idx_variants_content (content_id) | One row per encoded quality variant |
| **video_segments** | id (UUID PK), content_id (FK), variant_id (FK), segment_number, duration, segment_url, byte_size | idx_segments_variant (content_id, variant_id) | HLS segments for each variant |
| **watch_progress** | profile_id + content_id (composite PK), position, duration, client_timestamp, completed (boolean) | idx_progress_profile (profile_id, updated_at DESC) | Tracks playback position per profile per content |
| **license_grants** | id (UUID PK), user_id, content_id (FK), device_id, granted_at, expires_at | idx_license_user (user_id, content_id) | DRM license grants with expiration |

### Ingestion Service

The ingestion service processes master files through a multi-step pipeline:

1. **Validate master file quality** - Analyze the video file to confirm it meets the 4K HDR minimum requirement (resolution >= 3840, bit depth >= 10). Reject files that do not meet the quality bar.

2. **Create content record** - Insert a new row into the content table with status "ingesting", recording the title, duration, resolution, and HDR format from the master file metadata.

3. **Queue transcoding jobs** - Determine the encoding profiles based on the master resolution (see encoding ladder below), then publish a job to the "transcode" queue for each profile. Higher resolutions (2160p+) receive "high" priority; lower ones receive "normal" priority.

4. **Process audio tracks** - For each audio stem (language), publish a job to the "audio-encode" queue requesting AAC stereo, AAC surround, and Dolby Atmos variants.

**Encoding Ladder:**

| Resolution | Codec | HDR | Bitrate (kbps) | Target Device |
|------------|-------|-----|----------------|---------------|
| 2160p | HEVC | Yes | 25,000 | Apple TV 4K, high-end |
| 2160p | HEVC | Yes | 15,000 | Apple TV 4K |
| 2160p | HEVC | No | 12,000 | 4K SDR fallback |
| 1080p | HEVC | No | 8,000 | Most common |
| 1080p | H.264 | No | 6,000 | Broad compatibility |
| 1080p | H.264 | No | 4,500 | Moderate bandwidth |
| 720p | H.264 | No | 3,000 | Mobile, limited bandwidth |
| 720p | H.264 | No | 1,500 | Low bandwidth |
| 480p | H.264 | No | 800 | Very low bandwidth |
| 360p | H.264 | No | 400 | Minimum quality |

Only profiles at or below the master resolution are generated.

### Transcoding Worker

Each transcoding worker consumes jobs from the queue and processes them through these steps:

1. **Build FFmpeg encode** - Construct the FFmpeg command with the appropriate codec (libx265 for HEVC, libx264 for H.264), target bitrate, max rate at 1.5x target, buffer size at 2x target, and resolution scaling. For HDR profiles, include BT.2020 color primaries, SMPTE 2084 transfer characteristics, and BT.2020 non-constant luminance colorspace metadata.

2. **Run the encode** - Execute FFmpeg against the source file to produce the encoded output. Audio is stripped (encoded separately).

3. **Create HLS segments** - Re-mux the encoded video into 6-second HLS segments using FFmpeg with VOD playlist type. Each segment is named sequentially (segment_0000.ts, segment_0001.ts, etc.) and a variant playlist (playlist.m3u8) is generated.

4. **Upload to origin storage** - Push all segments and the variant playlist to MinIO (S3-compatible object storage).

5. **Record completion** - Insert a row into the encoded_variants table with the content ID, resolution, codec, HDR flag, bitrate, and file path.

## Deep Dive: HLS Manifest Generation

### Master Manifest Service

The manifest service generates an HLS master playlist (M3U8) for a given content ID:

1. **Query all encoded variants** for the content, ordered by resolution descending and bitrate descending.
2. **Query all audio tracks** for the content.
3. **Build the manifest header** with the M3U8 version tag.
4. **Add audio group entries** - For each audio track, add an EXT-X-MEDIA line specifying the language, name, and URI.
5. **Add video variant entries** - For each encoded variant, add an EXT-X-STREAM-INF line with bandwidth (bitrate * 1000), resolution, codec string, and audio group reference, followed by the variant playlist URL.

**Codec string mapping:**
- HEVC + HDR: `hvc1.2.4.L150.B0,mp4a.40.2`
- HEVC (SDR): `hvc1.1.6.L150.90,mp4a.40.2`
- H.264: `avc1.640029,mp4a.40.2`

## Deep Dive: DRM License Service

### FairPlay Integration

The DRM license service handles FairPlay Streaming requests through a six-step process:

1. **Verify playback token** - Validate the token from the playback request. Reject with 401 if invalid.
2. **Verify device authorization** - Confirm the requesting device is registered and authorized for this user account. Reject if the device is not recognized.
3. **Process Server Playback Context (SPC)** - Decrypt the SPC message sent by the client's FairPlay module to extract the content key request.
4. **Retrieve content key from HSM** - Fetch the content encryption key from the Hardware Security Module for the requested content ID.
5. **Generate Content Key Context (CKC)** - Combine the SPC data with the content key to produce the CKC response, setting policies such as offline playback permission, HDCP requirement, and 24-hour expiration.
6. **Log for compliance** - Insert a record into the license_grants table with the user ID, content ID, device ID, grant time, and expiration time (24 hours from now).

The service returns the CKC to the client, which uses it to decrypt and play the protected content.

## Deep Dive: CDN and Edge Delivery

### Edge Selection Service

The CDN service determines the optimal playback URLs for a given user and device:

1. **Check regional availability** - Verify the content is licensed for distribution in the user's region. Return an error if not available.
2. **Select optimal edge** - Find CDN edge servers in the user's region with load below 80% (tracked in Valkey sorted sets). If no healthy edges are available, fall back to the origin server. Among available edges, select the one with the lowest historical latency for this user.
3. **Generate signed playback token** - Create a time-limited token (24-hour expiry) containing the content ID, user ID, device ID, and maximum bitrate allowed for the device type.
4. **Return playback URLs** - Provide the manifest URL, playback token, and license URL, all routed through the selected edge server.

**Device bitrate limits:**

| Device Type | Max Bitrate (kbps) |
|-------------|-------------------|
| Apple TV 4K | 25,000 |
| Mac | 25,000 |
| iPad | 15,000 |
| iPhone | 12,000 |
| Browser | 8,000 |
| Default | 6,000 |

## Deep Dive: Watch Progress Sync

### Last-Write-Wins Implementation

**Updating progress:** The service uses an UPSERT with a client timestamp comparison. On conflict (same profile + content), the position is only updated if the incoming client timestamp is newer than the stored one, using a GREATEST function to always keep the latest timestamp. After updating, the continue-watching cache for that profile is invalidated.

**Continue watching list:** The service first checks Valkey for a cached result (5-minute TTL). On cache miss, it queries PostgreSQL for the profile's watch progress, joining with the content table to get titles and thumbnails. It filters to items where the user watched at least 60 seconds but less than 90% of the content, ordered by most recently updated, limited to 10 items. The result includes a progress percentage (position / duration). The query result is cached in Valkey for 300 seconds.

## Deep Dive: Circuit Breaker Pattern

The circuit breaker protects against cascading failures by wrapping external service calls in a state machine with three states:

- **Closed** (normal): Requests pass through. Failures are counted. After 5 consecutive failures, the breaker transitions to Open.
- **Open** (blocking): All requests are immediately rejected (or routed to a fallback) without calling the downstream service. After a 30-second timeout, transitions to Half-Open.
- **Half-Open** (probing): The next request is allowed through as a test. If it succeeds, the breaker resets to Closed. If it fails, it returns to Open.

On success, the failure counter resets and state returns to Closed. On failure, the counter increments and the last failure timestamp is recorded.

Each external service gets its own circuit breaker instance with tuned thresholds:

| Service | Failure Threshold | Timeout |
|---------|------------------|---------|
| CDN | 5 failures | 30 seconds |
| Transcoding | 10 failures | 120 seconds |
| DRM | 3 failures | 60 seconds |

## API Design

### RESTful Endpoints

```
Content Ingestion:
POST   /api/admin/content                   Ingest new content
GET    /api/admin/content/:id/status        Check transcoding status
POST   /api/admin/content/:id/publish       Publish content

Streaming:
GET    /api/stream/:contentId/master.m3u8   Get master manifest
GET    /api/stream/:contentId/:variant      Get variant playlist
POST   /api/drm/license                     Request FairPlay license

Watch Progress:
POST   /api/watch/progress                  Update watch position
GET    /api/watch/continue                  Get continue watching list
POST   /api/watch/progress/batch            Batch sync (offline)

Catalog:
GET    /api/content                         List content
GET    /api/content/:id                     Get content details
GET    /api/recommendations                 Get personalized recommendations
```

### Request/Response Examples

**Get Master Manifest**:

A GET request to `/api/stream/movie-123/master.m3u8` with a Bearer playback-token returns an HLS master playlist. The response contains audio media entries (e.g., English audio track) and stream variant entries listing bandwidth, resolution, codecs, and audio group. For example, a 4K HDR variant at 25 Mbps with HEVC codec and a 1080p variant at 8 Mbps with H.264 codec, each pointing to their respective variant playlist files.

## Caching Strategy

### Cache Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Request Flow                            │
│                                                              │
│  Manifest ──► CDN Edge (1h) ──► Origin Shield ──► API       │
│  Segments ──► CDN Edge (24h) ──► Origin ──► MinIO           │
│  Continue ──► Valkey (5min) ──► PostgreSQL                  │
│  Sessions ──► Valkey (7 days)                               │
└─────────────────────────────────────────────────────────────┘
```

### Cache Key Design

| Cache Key Pattern | Purpose | TTL |
|-------------------|---------|-----|
| `continue:{profileId}` | Continue watching list | 5 min |
| `recs:{profileId}` | Personalized recommendations | varies |
| `content:{contentId}` | Content metadata | varies |
| `edge:load:{edgeId}` | Edge server health/load | real-time |
| `idempotency:{key}` | Request idempotency | 24h |

## Scalability Considerations

### Read Scaling

1. **CDN Multi-tier**: Edge POPs -> Regional Shields -> Origin
2. **Read Replicas**: Route catalog queries to PostgreSQL replicas
3. **Connection Pooling**: PgBouncer for API server connections

### Write Scaling

1. **Distributed Transcoding**: Multiple workers per profile
2. **Partitioned Tables**: Shard watch_progress by profile_id hash
3. **Async Processing**: Queue non-critical operations

### Estimated Capacity

| Component | Single Node | Scaled (16x) |
|-----------|-------------|--------------|
| PostgreSQL writes | 5K/sec | 80K/sec (sharded) |
| PostgreSQL reads | 20K/sec | 320K/sec (replicas) |
| Valkey cache | 200K/sec | 200K/sec |
| CDN throughput | N/A | 100+ Tbps |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| HLS over DASH | Native Apple support, FairPlay | Less efficient than DASH |
| HEVC + H.264 | Universal decode support | HEVC licensing costs |
| Per-segment encryption | Secure seeking, offline | Key management overhead |
| 6-second segments | Good quality switching | Slightly higher latency |
| PostgreSQL for catalog | ACID, complex queries | Write scaling limits |
| Last-write-wins progress | Low latency, simple | Potential stale reads |
| Circuit breakers per service | Isolated failures | Configuration complexity |

## Future Backend Enhancements

1. **Event Sourcing**: Store playback events for analytics replay
2. **Multi-Region Active-Active**: Global availability with regional affinity
3. **Real-time Analytics**: ClickHouse for playback quality monitoring
4. **AV1 Codec**: Better compression when hardware support improves
5. **Predictive Pre-positioning**: ML-based content caching
6. **Webhook Notifications**: Real-time transcoding status updates
