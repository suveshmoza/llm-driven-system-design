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

```sql
-- Content catalog
CREATE TABLE content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL,  -- seconds
    content_type VARCHAR(20),   -- movie, series, episode
    series_id UUID REFERENCES content(id),
    season_number INTEGER,
    episode_number INTEGER,
    master_resolution VARCHAR(20),
    hdr_format VARCHAR(20),
    status VARCHAR(20) DEFAULT 'processing',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Encoded variants
CREATE TABLE encoded_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES content(id),
    resolution INTEGER NOT NULL,
    codec VARCHAR(20) NOT NULL,
    hdr BOOLEAN DEFAULT FALSE,
    bitrate INTEGER NOT NULL,
    file_path VARCHAR(500),
    file_size BIGINT,
    encoding_time INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video segments (HLS)
CREATE TABLE video_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES content(id),
    variant_id UUID NOT NULL REFERENCES encoded_variants(id),
    segment_number INTEGER NOT NULL,
    duration DECIMAL NOT NULL,
    segment_url VARCHAR(500),
    byte_size INTEGER
);

-- Watch progress
CREATE TABLE watch_progress (
    profile_id UUID NOT NULL,
    content_id UUID NOT NULL REFERENCES content(id),
    position INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    client_timestamp BIGINT,
    completed BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (profile_id, content_id)
);

-- DRM license grants
CREATE TABLE license_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    content_id UUID NOT NULL REFERENCES content(id),
    device_id VARCHAR(100) NOT NULL,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_variants_content ON encoded_variants(content_id);
CREATE INDEX idx_segments_variant ON video_segments(content_id, variant_id);
CREATE INDEX idx_progress_profile ON watch_progress(profile_id, updated_at DESC);
CREATE INDEX idx_license_user ON license_grants(user_id, content_id);
```

### Ingestion Service

```typescript
class IngestionService {
    async ingestContent(contentId: string, masterFiles: MasterFiles) {
        const { videoFile, audioStems, subtitles, metadata } = masterFiles;

        // Step 1: Validate master file quality
        const videoInfo = await this.analyzeVideo(videoFile);
        if (videoInfo.resolution < 3840 || videoInfo.bitDepth < 10) {
            throw new Error('Master must be 4K HDR minimum');
        }

        // Step 2: Create content record
        await db.query(`
            INSERT INTO content
                (id, title, duration, master_resolution, hdr_format, status)
            VALUES ($1, $2, $3, $4, $5, 'ingesting')
        `, [
            contentId,
            metadata.title,
            videoInfo.duration,
            `${videoInfo.width}x${videoInfo.height}`,
            videoInfo.hdrFormat
        ]);

        // Step 3: Queue transcoding jobs
        const profiles = this.getEncodingProfiles(videoInfo);
        for (const profile of profiles) {
            await this.queue.publish('transcode', {
                contentId,
                profile,
                sourceFile: videoFile,
                priority: profile.resolution >= 2160 ? 'high' : 'normal'
            });
        }

        // Step 4: Process audio tracks
        for (const audio of audioStems) {
            await this.queue.publish('audio-encode', {
                contentId,
                sourceFile: audio.file,
                language: audio.language,
                formats: ['aac_stereo', 'aac_surround', 'atmos']
            });
        }

        return { contentId, variantCount: profiles.length };
    }

    getEncodingProfiles(videoInfo: VideoInfo): EncodingProfile[] {
        return [
            // 4K HDR (Apple TV 4K, high-end devices)
            { resolution: 2160, codec: 'hevc', hdr: true, bitrate: 25000 },
            { resolution: 2160, codec: 'hevc', hdr: true, bitrate: 15000 },
            // 4K SDR fallback
            { resolution: 2160, codec: 'hevc', hdr: false, bitrate: 12000 },
            // 1080p (most common)
            { resolution: 1080, codec: 'hevc', hdr: false, bitrate: 8000 },
            { resolution: 1080, codec: 'h264', hdr: false, bitrate: 6000 },
            { resolution: 1080, codec: 'h264', hdr: false, bitrate: 4500 },
            // 720p (mobile, limited bandwidth)
            { resolution: 720, codec: 'h264', hdr: false, bitrate: 3000 },
            { resolution: 720, codec: 'h264', hdr: false, bitrate: 1500 },
            // Low bandwidth
            { resolution: 480, codec: 'h264', hdr: false, bitrate: 800 },
            { resolution: 360, codec: 'h264', hdr: false, bitrate: 400 }
        ].filter(p => p.resolution <= videoInfo.height);
    }
}
```

### Transcoding Worker

```typescript
class TranscodingWorker {
    async processJob(job: TranscodeJob) {
        const { contentId, profile, sourceFile } = job;
        const outputPath = `/tmp/${contentId}/${profile.resolution}_${profile.bitrate}.mp4`;

        // Build FFmpeg command
        const ffmpegArgs = [
            '-i', sourceFile,
            '-c:v', profile.codec === 'hevc' ? 'libx265' : 'libx264',
            '-preset', 'slow',
            '-b:v', `${profile.bitrate}k`,
            '-maxrate', `${profile.bitrate * 1.5}k`,
            '-bufsize', `${profile.bitrate * 2}k`,
            '-vf', `scale=-2:${profile.resolution}`
        ];

        // Add HDR metadata
        if (profile.hdr) {
            ffmpegArgs.push(
                '-color_primaries', 'bt2020',
                '-color_trc', 'smpte2084',
                '-colorspace', 'bt2020nc'
            );
        }

        ffmpegArgs.push('-an', outputPath);
        await this.runFFmpeg(ffmpegArgs);

        // Create HLS segments
        await this.createHLSSegments(contentId, profile, outputPath);

        // Upload to origin storage (MinIO)
        await this.uploadToOrigin(contentId, profile);

        // Mark variant complete
        await db.query(`
            INSERT INTO encoded_variants
                (content_id, resolution, codec, hdr, bitrate, file_path)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [contentId, profile.resolution, profile.codec,
            profile.hdr, profile.bitrate, outputPath]);
    }

    async createHLSSegments(contentId: string, profile: EncodingProfile,
                            videoFile: string) {
        const segmentDir = `/tmp/${contentId}/segments/${profile.resolution}`;

        await this.runFFmpeg([
            '-i', videoFile,
            '-c', 'copy',
            '-hls_time', '6',  // 6-second segments
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', `${segmentDir}/segment_%04d.ts`,
            `${segmentDir}/playlist.m3u8`
        ]);
    }
}
```

## Deep Dive: HLS Manifest Generation

### Master Manifest Service

```typescript
class ManifestService {
    async generateMasterPlaylist(contentId: string): Promise<string> {
        const variants = await db.query(`
            SELECT * FROM encoded_variants
            WHERE content_id = $1
            ORDER BY resolution DESC, bitrate DESC
        `, [contentId]);

        const audioTracks = await db.query(`
            SELECT * FROM audio_tracks WHERE content_id = $1
        `, [contentId]);

        let manifest = '#EXTM3U\n#EXT-X-VERSION:6\n\n';

        // Audio groups
        for (const audio of audioTracks.rows) {
            manifest += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",`;
            manifest += `LANGUAGE="${audio.language}",NAME="${audio.name}",`;
            manifest += `URI="${this.getAudioUrl(contentId, audio)}"\n`;
        }

        manifest += '\n';

        // Video variants (adaptive streams)
        for (const variant of variants.rows) {
            const bandwidth = variant.bitrate * 1000;
            const resolution = `${this.getWidth(variant.resolution)}x${variant.resolution}`;
            const codecs = this.getCodecs(variant);

            manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},`;
            manifest += `RESOLUTION=${resolution},CODECS="${codecs}",`;
            manifest += `AUDIO="audio"\n`;
            manifest += `${this.getVariantUrl(contentId, variant)}\n`;
        }

        return manifest;
    }

    getCodecs(variant: Variant): string {
        if (variant.codec === 'hevc' && variant.hdr) {
            return 'hvc1.2.4.L150.B0,mp4a.40.2';
        } else if (variant.codec === 'hevc') {
            return 'hvc1.1.6.L150.90,mp4a.40.2';
        }
        return 'avc1.640029,mp4a.40.2';
    }
}
```

## Deep Dive: DRM License Service

### FairPlay Integration

```typescript
class DRMService {
    async getPlaybackLicense(request: LicenseRequest): Promise<LicenseResponse> {
        const { playbackToken, spcMessage, deviceId } = request;

        // Step 1: Verify playback token
        const tokenData = await this.verifyToken(playbackToken);
        if (!tokenData) {
            throw new UnauthorizedError('Invalid playback token');
        }

        // Step 2: Verify device authorization
        const authorized = await this.verifyDevice(tokenData.userId, deviceId);
        if (!authorized) {
            throw new UnauthorizedError('Device not authorized');
        }

        // Step 3: Process Server Playback Context
        const spcData = await this.decryptSPC(spcMessage);

        // Step 4: Get content key from HSM
        const contentKey = await this.getContentKey(tokenData.contentId);

        // Step 5: Generate Content Key Context
        const ckc = await this.generateCKC(spcData, contentKey, {
            offlineAllowed: tokenData.downloadPermission,
            hdcpRequired: true,
            expiresIn: 24 * 3600
        });

        // Step 6: Log for compliance
        await db.query(`
            INSERT INTO license_grants
                (user_id, content_id, device_id, granted_at, expires_at)
            VALUES ($1, $2, $3, NOW(), $4)
        `, [
            tokenData.userId,
            tokenData.contentId,
            deviceId,
            new Date(Date.now() + 24 * 3600 * 1000)
        ]);

        return { ckc };
    }
}
```

## Deep Dive: CDN and Edge Delivery

### Edge Selection Service

```typescript
class CDNService {
    async getPlaybackUrl(contentId: string, userId: string,
                         deviceInfo: DeviceInfo): Promise<PlaybackUrls> {
        // Check content availability in user's region
        const availability = await this.checkAvailability(contentId, userId);
        if (!availability.available) {
            throw new Error(`Not available in ${availability.region}`);
        }

        // Select optimal edge
        const edge = await this.selectEdge(userId, deviceInfo);

        // Generate signed playback token
        const playbackToken = await this.generatePlaybackToken({
            contentId,
            userId,
            deviceId: deviceInfo.deviceId,
            expiresAt: Date.now() + 24 * 3600 * 1000,
            maxBitrate: this.getMaxBitrate(deviceInfo)
        });

        return {
            manifestUrl: `${edge.baseUrl}/content/${contentId}/master.m3u8`,
            playbackToken,
            licenseUrl: `${edge.baseUrl}/drm/license`
        };
    }

    async selectEdge(userId: string, deviceInfo: DeviceInfo): Promise<Edge> {
        const location = await this.getLocation(userId);

        // Find edges with capacity in region
        const edges = await valkey.zrangebyscore(
            `edges:${location.region}`,
            0, 80  // Load < 80%
        );

        if (edges.length === 0) {
            return { baseUrl: this.originUrl };  // Fallback to origin
        }

        // Select by latency history
        return this.selectByLatency(edges, userId);
    }

    getMaxBitrate(deviceInfo: DeviceInfo): number {
        const limits: Record<string, number> = {
            'AppleTV4K': 25000,
            'iPad': 15000,
            'iPhone': 12000,
            'Mac': 25000,
            'Browser': 8000
        };
        return limits[deviceInfo.deviceType] || 6000;
    }
}
```

## Deep Dive: Watch Progress Sync

### Last-Write-Wins Implementation

```typescript
class WatchProgressService {
    async updateProgress(profileId: string, contentId: string,
                        position: number, clientTimestamp: number) {
        // Idempotency key from request header stored in Redis
        const idempotencyKey = `progress:${profileId}:${contentId}`;

        // Last-write-wins with client timestamp
        const result = await db.query(`
            INSERT INTO watch_progress
                (profile_id, content_id, position, duration,
                 client_timestamp, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (profile_id, content_id)
            DO UPDATE SET
                position = CASE
                    WHEN watch_progress.client_timestamp < $5 THEN $3
                    ELSE watch_progress.position
                END,
                client_timestamp = GREATEST(
                    watch_progress.client_timestamp, $5
                ),
                updated_at = NOW()
            RETURNING
                position,
                (watch_progress.client_timestamp < $5) AS was_updated
        `, [profileId, contentId, position, duration, clientTimestamp]);

        // Invalidate continue-watching cache
        await valkey.del(`continue:${profileId}`);

        return {
            position: result.rows[0].position,
            wasUpdated: result.rows[0].was_updated
        };
    }

    async getContinueWatching(profileId: string, limit = 10) {
        const cacheKey = `continue:${profileId}`;
        const cached = await valkey.get(cacheKey);
        if (cached) return JSON.parse(cached);

        const results = await db.query(`
            SELECT
                c.id, c.title, c.thumbnail_url, c.duration,
                wp.position,
                (wp.position::float / c.duration) AS progress_pct
            FROM watch_progress wp
            JOIN content c ON c.id = wp.content_id
            WHERE wp.profile_id = $1
              AND wp.position > 60
              AND (wp.position::float / c.duration) < 0.9
            ORDER BY wp.updated_at DESC
            LIMIT $2
        `, [profileId, limit]);

        await valkey.setex(cacheKey, 300, JSON.stringify(results.rows));
        return results.rows;
    }
}
```

## Deep Dive: Circuit Breaker Pattern

```typescript
class CircuitBreaker {
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    private failures = 0;
    private lastFailureTime = 0;
    private readonly threshold = 5;
    private readonly timeout = 30000;

    async execute<T>(
        operation: () => Promise<T>,
        fallback?: () => T
    ): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'half-open';
            } else {
                metrics.circuitBreakerRejection.inc();
                if (fallback) return fallback();
                throw new ServiceUnavailableError();
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            if (fallback) return fallback();
            throw error;
        }
    }

    private onSuccess() {
        this.failures = 0;
        this.state = 'closed';
    }

    private onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.threshold) {
            this.state = 'open';
        }
    }
}

// Separate circuit breakers per external service
const circuitBreakers = {
    cdn: new CircuitBreaker({ threshold: 5, timeout: 30000 }),
    transcoding: new CircuitBreaker({ threshold: 10, timeout: 120000 }),
    drm: new CircuitBreaker({ threshold: 3, timeout: 60000 })
};
```

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

```http
GET /api/stream/movie-123/master.m3u8
Authorization: Bearer <playback-token>

Response:
#EXTM3U
#EXT-X-VERSION:6

#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",URI="audio_en.m3u8"

#EXT-X-STREAM-INF:BANDWIDTH=25000000,RESOLUTION=3840x2160,CODECS="hvc1.2.4.L150.B0,mp4a.40.2",AUDIO="audio"
2160_25000.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS="avc1.640029,mp4a.40.2",AUDIO="audio"
1080_8000.m3u8
```

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

```typescript
const CACHE_KEYS = {
    // Continue watching list
    continueWatching: (profileId: string) => `continue:${profileId}`,

    // Recommendations
    recommendations: (profileId: string) => `recs:${profileId}`,

    // Content metadata
    content: (contentId: string) => `content:${contentId}`,

    // Edge server health
    edgeLoad: (edgeId: string) => `edge:load:${edgeId}`,

    // Idempotency
    idempotency: (key: string) => `idempotency:${key}`
};
```

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
