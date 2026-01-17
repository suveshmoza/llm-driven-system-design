# Design Apple Music - Architecture

## System Overview

Apple Music is a music streaming service with library management and recommendations. Core challenges involve audio delivery, library sync, and personalization.

**Learning Goals:**
- Build audio streaming infrastructure
- Design hybrid recommendation systems
- Implement library matching and sync
- Handle DRM and offline playback

---

## Requirements

### Functional Requirements

1. **Stream**: Play music with adaptive quality
2. **Library**: Manage personal music library
3. **Discover**: Get personalized recommendations
4. **Download**: Save music for offline
5. **Share**: Connect with friends

### Non-Functional Requirements

- **Latency**: < 200ms to start playback
- **Quality**: Up to 24-bit/192kHz lossless
- **Scale**: 100M+ subscribers
- **Catalog**: 100M+ songs

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│      iPhone │ Mac │ Apple Watch │ HomePod │ CarPlay │ Web       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         CDN                                     │
│           (Audio files, artwork, encrypted content)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│Catalog Service│    │Library Service│    │  Rec Service  │
│               │    │               │    │               │
│ - Search      │    │ - Sync        │    │ - For You     │
│ - Metadata    │    │ - Matching    │    │ - Radio       │
│ - Playback    │    │ - Uploads     │    │ - Similar     │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────┬───────────────────────────┤
│   PostgreSQL    │   Elasticsearch   │      Feature Store        │
│   - Catalog     │   - Search        │      - User embeddings    │
│   - Libraries   │   - Lyrics        │      - Song embeddings    │
└─────────────────┴───────────────────┴───────────────────────────┘
```

---

## Core Components

### 1. Audio Streaming

**Adaptive Bitrate Delivery:**
```javascript
class StreamingService {
  async getStreamUrl(trackId, userId, options = {}) {
    const { preferredQuality, networkType } = options

    // Check user subscription
    const user = await this.getUser(userId)
    const maxQuality = this.getMaxQuality(user.subscription)

    // Determine quality based on preference and network
    const quality = this.selectQuality(preferredQuality, networkType, maxQuality)

    // Get audio file info
    const audioFiles = await this.getAudioFiles(trackId)
    const selectedFile = audioFiles.find(f => f.quality === quality)

    // Generate signed URL with DRM
    const streamUrl = await this.generateSignedUrl(selectedFile, userId)

    // Generate license for FairPlay DRM
    const license = await this.generateLicense(trackId, userId)

    return {
      url: streamUrl,
      quality,
      format: selectedFile.format, // AAC, ALAC, etc.
      bitrate: selectedFile.bitrate,
      license,
      expiresAt: Date.now() + 3600000
    }
  }

  selectQuality(preferred, network, max) {
    const qualities = ['256_aac', '256_aac_plus', 'lossless', 'hi_res_lossless']
    const preferredIndex = qualities.indexOf(preferred)
    const maxIndex = qualities.indexOf(max)

    // Network constraints
    const networkMax = {
      'wifi': 'hi_res_lossless',
      'cellular_5g': 'lossless',
      'cellular_lte': '256_aac_plus',
      'cellular_3g': '256_aac'
    }[network] || '256_aac'

    const networkIndex = qualities.indexOf(networkMax)

    return qualities[Math.min(preferredIndex, maxIndex, networkIndex)]
  }

  // Gapless playback support
  async prefetchNextTrack(currentTrackId, queue, userId) {
    const nextTrack = this.getNextInQueue(currentTrackId, queue)
    if (!nextTrack) return

    // Pre-generate stream URL
    const streamInfo = await this.getStreamUrl(nextTrack.id, userId)

    // Pre-fetch first segments for gapless transition
    await this.prefetchSegments(streamInfo.url, 3)

    return streamInfo
  }
}
```

### 2. Library Matching

**Audio Fingerprinting:**
```javascript
class LibraryMatcher {
  async matchUpload(userId, uploadedFile) {
    // Generate audio fingerprint
    const fingerprint = await this.generateFingerprint(uploadedFile)

    // Search catalog for match
    const matches = await this.searchCatalog(fingerprint)

    if (matches.length > 0 && matches[0].confidence > 0.95) {
      // High confidence match - link to catalog
      const catalogTrack = matches[0]

      await db.query(`
        INSERT INTO library_tracks
          (user_id, track_id, source, matched_at, original_upload_id)
        VALUES ($1, $2, 'matched', NOW(), $3)
      `, [userId, catalogTrack.id, uploadedFile.id])

      return {
        status: 'matched',
        catalogTrack,
        confidence: matches[0].confidence
      }
    }

    // No match - store as uploaded track
    const uploadedTrack = await this.storeUpload(userId, uploadedFile)

    return {
      status: 'uploaded',
      uploadedTrack
    }
  }

  async generateFingerprint(audioFile) {
    // Extract audio features for matching
    // Use Chromaprint or similar acoustic fingerprinting
    const audioBuffer = await this.decodeAudio(audioFile)

    const fingerprint = {
      chromaprint: this.chromaprint(audioBuffer),
      duration: audioBuffer.duration,
      avgLoudness: this.calculateLoudness(audioBuffer),
      tempo: this.detectTempo(audioBuffer)
    }

    return fingerprint
  }

  async searchCatalog(fingerprint) {
    // Query fingerprint index
    const candidates = await this.fingerprintIndex.search(
      fingerprint.chromaprint,
      { topK: 10 }
    )

    // Verify candidates with additional features
    return candidates
      .map(c => ({
        ...c,
        confidence: this.verifyMatch(fingerprint, c)
      }))
      .filter(c => c.confidence > 0.5)
      .sort((a, b) => b.confidence - a.confidence)
  }
}
```

### 3. Library Sync

**Cross-Device Synchronization:**
```javascript
class LibrarySyncService {
  async syncLibrary(userId, deviceId, lastSyncToken) {
    // Get changes since last sync
    const changes = await db.query(`
      SELECT * FROM library_changes
      WHERE user_id = $1 AND sync_token > $2
      ORDER BY sync_token ASC
    `, [userId, lastSyncToken || 0])

    // Get current sync token
    const currentToken = await this.getCurrentSyncToken(userId)

    return {
      changes: changes.rows.map(c => ({
        type: c.change_type, // 'add', 'remove', 'update'
        itemType: c.item_type, // 'track', 'album', 'playlist'
        itemId: c.item_id,
        data: c.data,
        timestamp: c.created_at
      })),
      syncToken: currentToken
    }
  }

  async addToLibrary(userId, itemType, itemId) {
    await db.transaction(async (tx) => {
      // Add to library
      await tx.query(`
        INSERT INTO library_items (user_id, item_type, item_id, added_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT DO NOTHING
      `, [userId, itemType, itemId])

      // Record change for sync
      await tx.query(`
        INSERT INTO library_changes
          (user_id, change_type, item_type, item_id, sync_token)
        VALUES ($1, 'add', $2, $3, nextval('sync_token_seq'))
      `, [userId, itemType, itemId])
    })

    // Notify other devices
    await this.notifyDevices(userId, 'library_changed')
  }

  // Smart playlist sync
  async syncSmartPlaylist(userId, playlistId) {
    const playlist = await this.getPlaylist(playlistId)

    if (playlist.type !== 'smart') {
      throw new Error('Not a smart playlist')
    }

    // Evaluate rules against library
    const matchingTracks = await this.evaluateRules(
      userId,
      playlist.rules
    )

    // Update playlist contents
    await db.query(`
      DELETE FROM playlist_tracks WHERE playlist_id = $1
    `, [playlistId])

    for (const track of matchingTracks) {
      await db.query(`
        INSERT INTO playlist_tracks (playlist_id, track_id, position)
        VALUES ($1, $2, $3)
      `, [playlistId, track.id, track.position])
    }

    return matchingTracks
  }
}
```

### 4. Recommendations

**Personalized Discovery:**
```javascript
class RecommendationService {
  async getForYou(userId) {
    // Get user listening history
    const history = await this.getListeningHistory(userId, { days: 30 })

    // Get user embedding
    const userEmbedding = await this.getUserEmbedding(userId)

    // Generate recommendations
    const sections = []

    // Heavy rotation - recently played favorites
    sections.push({
      title: 'Heavy Rotation',
      type: 'albums',
      items: await this.getHeavyRotation(userId)
    })

    // New releases from followed artists
    sections.push({
      title: 'New Releases',
      type: 'albums',
      items: await this.getNewReleases(userId)
    })

    // Personalized mixes
    const genres = await this.getTopGenres(history)
    for (const genre of genres.slice(0, 3)) {
      sections.push({
        title: `${genre} Mix`,
        type: 'playlist',
        items: await this.generateMix(userEmbedding, genre)
      })
    }

    // Discovery - songs you haven't heard
    sections.push({
      title: 'Discovery',
      type: 'songs',
      items: await this.discoverNew(userEmbedding, history)
    })

    return sections
  }

  async generatePersonalStation(userId, seedTrackId) {
    // Get seed track features
    const seedTrack = await this.getTrack(seedTrackId)
    const seedEmbedding = await this.getTrackEmbedding(seedTrackId)

    // Get user preferences
    const userEmbedding = await this.getUserEmbedding(userId)

    // Combine seed and user preferences
    const targetEmbedding = this.blendEmbeddings(
      seedEmbedding,
      userEmbedding,
      0.7 // 70% seed, 30% user preferences
    )

    // Find similar tracks
    const candidates = await this.vectorDb.search({
      vector: targetEmbedding,
      topK: 100,
      filter: {
        // Same genre family
        genre: seedTrack.genre,
        // Exclude recently played
        id: { $nin: await this.getRecentlyPlayed(userId) }
      }
    })

    // Diversify results
    return this.diversify(candidates, {
      maxPerArtist: 3,
      totalCount: 25
    })
  }
}
```

---

## Database Schema

### Entity-Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    APPLE MUSIC DATABASE SCHEMA                                       │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘

                                         CATALOG DOMAIN
    ┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
    │     artists      │          │      albums      │          │      tracks      │
    ├──────────────────┤          ├──────────────────┤          ├──────────────────┤
    │ PK id            │◄─────────┤ FK artist_id     │◄─────────┤ FK artist_id     │
    │    name          │    1:N   │ PK id            │    1:N   │ FK album_id      │
    │    bio           │          │    title         │          │ PK id            │
    │    image_url     │          │    release_date  │          │    isrc (UNIQUE) │
    │    genres[]      │          │    album_type    │          │    title         │
    │    verified      │          │    genres[]      │          │    duration_ms   │
    │    created_at    │          │    artwork_url   │          │    track_number  │
    └──────────────────┘          │    total_tracks  │          │    disc_number   │
                                  │    duration_ms   │          │    explicit      │
                                  │    explicit      │          │    audio_features│
                                  │    created_at    │          │    fingerprint   │
                                  └──────────────────┘          │    play_count    │
                                                                │    created_at    │
                                                                └────────┬─────────┘
                                                                         │
                          ┌──────────────────────────────────────────────┼───────────────────┐
                          │                                              │                   │
                          ▼                                              ▼                   ▼
              ┌──────────────────┐                           ┌──────────────────┐  ┌──────────────────┐
              │   audio_files    │                           │   track_genres   │  │ radio_station_   │
              ├──────────────────┤                           ├──────────────────┤  │     tracks       │
              │ PK id            │                           │ PK,FK track_id   │  ├──────────────────┤
              │ FK track_id      │◄──── 1:N (one track,      │ PK genre         │  │ PK id            │
              │    quality       │      multiple qualities)  │    weight        │  │ FK station_id    │
              │    format        │                           └──────────────────┘  │ FK track_id      │
              │    bitrate       │                                                 │    position      │
              │    sample_rate   │                                                 └──────────────────┘
              │    bit_depth     │                                                          ▲
              │    file_size     │                                                          │
              │    minio_key     │                                              ┌───────────┴────────┐
              │    created_at    │                                              │   radio_stations   │
              └──────────────────┘                                              ├────────────────────┤
                                                                                │ PK id              │
                                         USER DOMAIN                            │    name            │
    ┌──────────────────┐                                                        │    description     │
    │      users       │                                                        │    artwork_url     │
    ├──────────────────┤                                                        │    type            │
    │ PK id            │◄───────────────────────────────────────────────────┐   │ FK seed_artist_id  │
    │    email(UNIQUE) │                                                    │   │    seed_genre      │
    │    username(UNQ) │                                                    │   │    is_active       │
    │    password_hash │                                                    │   │    created_at      │
    │    display_name  │                                                    │   └────────────────────┘
    │    avatar_url    │                                                    │
    │    subscription  │                                                    │
    │    role          │◄───────────────────────────────────────────────────┼────────────────────────┐
    │    preferred_    │                                                    │                        │
    │      quality     │                                                    │                        │
    │    created_at    │                                                    │                        │
    │    updated_at    │                                                    │                        │
    └────────┬─────────┘                                                    │                        │
             │                                                              │                        │
    ┌────────┴────────────────┬──────────────────────┬─────────────────────┼────────────────────┐   │
    │                         │                      │                     │                    │   │
    ▼                         ▼                      ▼                     ▼                    ▼   │
┌──────────────┐    ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌─────────┴────────┐
│library_items │    │ library_changes  │   │ listening_history│   │ uploaded_tracks  │   │    sessions      │
├──────────────┤    ├──────────────────┤   ├──────────────────┤   ├──────────────────┤   ├──────────────────┤
│PK,FK user_id │    │ PK id (BIGSERIAL)│   │ PK id (BIGSERIAL)│   │ PK id            │   │ PK id            │
│PK item_type  │    │ FK user_id       │   │ FK user_id       │   │ FK user_id       │   │ FK user_id       │
│PK item_id    │    │    change_type   │   │ FK track_id      │   │    orig_filename │   │    token (UNQ)   │
│   added_at   │    │    item_type     │   │    played_at     │   │    minio_key     │   │    device_info   │
└──────────────┘    │    item_id       │   │    duration_ms   │   │ FK matched_track │   │    expires_at    │
                    │    data (JSONB)  │   │    context_type  │   │    match_conf    │   │    created_at    │
                    │    sync_token    │   │    context_id    │   │    title         │   └──────────────────┘
                    │    created_at    │   │    completed     │   │    artist_name   │
                    └──────────────────┘   └──────────────────┘   │    album_name    │
                                                                  │    duration_ms   │
                                                                  │    uploaded_at   │
                                                                  └──────────────────┘
                                       PLAYLIST DOMAIN

    ┌──────────────────┐                      ┌──────────────────┐          ┌──────────────────┐
    │    playlists     │                      │  playlist_tracks │          │ user_genre_      │
    ├──────────────────┤                      ├──────────────────┤          │   preferences    │
    │ PK id            │◄─────────────────────┤ FK playlist_id   │          ├──────────────────┤
    │ FK user_id       │         1:N          │ FK track_id      │──────►   │ PK,FK user_id    │
    │    name          │                      │ FK added_by      │──────►   │ PK genre         │
    │    description   │                      │ PK id            │   users  │    score         │
    │    type          │                      │    position      │          │    updated_at    │
    │    rules(JSONB)  │                      │    added_at      │          └──────────────────┘
    │    is_public     │                      └──────────────────┘
    │    artwork_url   │
    │    total_tracks  │
    │    duration_ms   │
    │    created_at    │
    │    updated_at    │
    └──────────────────┘

                                       RELATIONSHIP LEGEND
    ─────────────────────────────────────────────────────────────────────────────────────────────────
    PK = Primary Key    FK = Foreign Key    1:N = One-to-Many    ──► = References (FK direction)
    UNQ/UNIQUE = Unique constraint         [] = PostgreSQL Array   JSONB = JSON Binary column
```

---

### Complete Table Definitions

#### Users Table

Stores user accounts with authentication, subscription, and preference data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique user identifier |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | User email for login |
| `username` | VARCHAR(100) | UNIQUE, NOT NULL | Public username |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt hashed password |
| `display_name` | VARCHAR(200) | | User's display name |
| `avatar_url` | VARCHAR(500) | | Profile image URL |
| `subscription_tier` | VARCHAR(50) | DEFAULT 'free' | 'free', 'individual', 'family', 'student' |
| `role` | VARCHAR(20) | DEFAULT 'user' | 'user', 'admin' for RBAC |
| `preferred_quality` | VARCHAR(50) | DEFAULT '256_aac' | '256_aac', 'lossless', 'hi_res_lossless' |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Account creation time |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Last profile update |

---

#### Artists Table

Stores artist/band information with metadata for catalog browsing and search.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique artist identifier |
| `name` | VARCHAR(500) | NOT NULL | Artist/band name |
| `bio` | TEXT | | Artist biography |
| `image_url` | VARCHAR(500) | | Profile/promo image URL |
| `genres` | TEXT[] | | PostgreSQL array of genre tags |
| `verified` | BOOLEAN | DEFAULT FALSE | Blue checkmark status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation time |

---

#### Albums Table

Stores album metadata with rollup statistics maintained by triggers.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique album identifier |
| `title` | VARCHAR(500) | NOT NULL | Album title |
| `artist_id` | UUID | REFERENCES artists(id) ON DELETE CASCADE | Primary artist |
| `release_date` | DATE | | Official release date |
| `album_type` | VARCHAR(50) | DEFAULT 'album' | 'album', 'single', 'ep', 'compilation' |
| `genres` | TEXT[] | | Genre tags array |
| `artwork_url` | VARCHAR(500) | | Album cover image URL |
| `total_tracks` | INTEGER | DEFAULT 0 | Track count (trigger-maintained) |
| `duration_ms` | INTEGER | DEFAULT 0 | Total duration (trigger-maintained) |
| `explicit` | BOOLEAN | DEFAULT FALSE | Contains explicit content |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation time |

---

#### Tracks Table

Core music catalog with audio fingerprints and analytics.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique track identifier |
| `isrc` | VARCHAR(20) | UNIQUE | International Standard Recording Code |
| `title` | VARCHAR(500) | NOT NULL | Track title |
| `artist_id` | UUID | REFERENCES artists(id) ON DELETE CASCADE | Primary artist |
| `album_id` | UUID | REFERENCES albums(id) ON DELETE CASCADE | Parent album |
| `duration_ms` | INTEGER | | Track length in milliseconds |
| `track_number` | INTEGER | | Position on album |
| `disc_number` | INTEGER | DEFAULT 1 | Disc number for multi-disc albums |
| `explicit` | BOOLEAN | DEFAULT FALSE | Explicit content flag |
| `audio_features` | JSONB | | Tempo, energy, danceability, etc. |
| `fingerprint_hash` | VARCHAR(64) | | Chromaprint hash for matching |
| `play_count` | BIGINT | DEFAULT 0 | Global play counter |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Record creation time |

---

#### Audio Files Table

Multiple quality versions per track for adaptive streaming.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique file identifier |
| `track_id` | UUID | REFERENCES tracks(id) ON DELETE CASCADE | Parent track |
| `quality` | VARCHAR(50) | NOT NULL | '256_aac', 'lossless', 'hi_res_lossless' |
| `format` | VARCHAR(20) | NOT NULL | 'aac', 'alac', 'flac', 'mp3' |
| `bitrate` | INTEGER | | Bits per second |
| `sample_rate` | INTEGER | | Hz (44100, 48000, 96000, 192000) |
| `bit_depth` | INTEGER | | Bits per sample (16, 24) |
| `file_size` | BIGINT | | File size in bytes |
| `minio_key` | VARCHAR(500) | | S3/MinIO object key |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Upload time |

---

#### Library Items Table

User's saved content (tracks, albums, artists, playlists).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PK, REFERENCES users(id) ON DELETE CASCADE | Owner |
| `item_type` | VARCHAR(20) | PK, NOT NULL | 'track', 'album', 'artist', 'playlist' |
| `item_id` | UUID | PK, NOT NULL | Referenced entity ID |
| `added_at` | TIMESTAMP | DEFAULT NOW() | When added to library |

**Composite Primary Key:** `(user_id, item_type, item_id)` - prevents duplicate library entries.

---

#### Library Changes Table

Change log for cross-device sync using sync tokens.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing change ID |
| `user_id` | UUID | REFERENCES users(id) ON DELETE CASCADE | User who made change |
| `change_type` | VARCHAR(20) | NOT NULL | 'add', 'remove', 'update' |
| `item_type` | VARCHAR(20) | NOT NULL | 'track', 'album', 'artist', 'playlist' |
| `item_id` | UUID | NOT NULL | Affected entity ID |
| `data` | JSONB | | Additional change metadata |
| `sync_token` | BIGINT | DEFAULT nextval('sync_token_seq') | Monotonic sync sequence |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Change timestamp |

**Index:** `idx_library_changes_sync(user_id, sync_token)` - optimizes delta sync queries.

---

#### Uploaded Tracks Table

User-uploaded music pending or matched to catalog.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Upload identifier |
| `user_id` | UUID | REFERENCES users(id) ON DELETE CASCADE | Uploader |
| `original_filename` | VARCHAR(500) | | Original file name |
| `minio_key` | VARCHAR(500) | | S3/MinIO storage key |
| `matched_track_id` | UUID | REFERENCES tracks(id) | Matched catalog track |
| `match_confidence` | DECIMAL | | 0.0-1.0 fingerprint match score |
| `title` | VARCHAR(500) | | Extracted/user-provided title |
| `artist_name` | VARCHAR(500) | | Extracted/user-provided artist |
| `album_name` | VARCHAR(500) | | Extracted/user-provided album |
| `duration_ms` | INTEGER | | Track duration |
| `uploaded_at` | TIMESTAMP | DEFAULT NOW() | Upload timestamp |

---

#### Listening History Table

Play events for recommendations and analytics.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Event identifier |
| `user_id` | UUID | REFERENCES users(id) ON DELETE CASCADE | Listener |
| `track_id` | UUID | REFERENCES tracks(id) ON DELETE CASCADE | Played track |
| `played_at` | TIMESTAMP | DEFAULT NOW() | Play start time |
| `duration_played_ms` | INTEGER | | Actual listen duration |
| `context_type` | VARCHAR(50) | | 'album', 'playlist', 'radio', 'library' |
| `context_id` | UUID | | ID of context (album, playlist, etc.) |
| `completed` | BOOLEAN | DEFAULT FALSE | True if played > 30 seconds |

**Indexes:**
- `idx_history_user(user_id, played_at DESC)` - user's recent plays
- `idx_history_track(track_id)` - track popularity queries

---

#### Playlists Table

User-created and smart playlists.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Playlist identifier |
| `user_id` | UUID | REFERENCES users(id) ON DELETE CASCADE | Creator/owner |
| `name` | VARCHAR(200) | NOT NULL | Playlist name |
| `description` | TEXT | | Playlist description |
| `type` | VARCHAR(20) | DEFAULT 'regular' | 'regular', 'smart', 'radio' |
| `rules` | JSONB | | Smart playlist filter rules |
| `is_public` | BOOLEAN | DEFAULT FALSE | Publicly discoverable |
| `artwork_url` | VARCHAR(500) | | Custom artwork URL |
| `total_tracks` | INTEGER | DEFAULT 0 | Track count (trigger-maintained) |
| `duration_ms` | INTEGER | DEFAULT 0 | Total duration (trigger-maintained) |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Creation time |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Last modification |

---

#### Playlist Tracks Table

Junction table for playlist contents with ordering.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Entry identifier |
| `playlist_id` | UUID | REFERENCES playlists(id) ON DELETE CASCADE | Parent playlist |
| `track_id` | UUID | REFERENCES tracks(id) ON DELETE CASCADE | Track in playlist |
| `position` | INTEGER | NOT NULL | Order within playlist |
| `added_at` | TIMESTAMP | DEFAULT NOW() | When track was added |
| `added_by` | UUID | REFERENCES users(id) | User who added (for collaborative) |

**Constraints:**
- `UNIQUE(playlist_id, position)` - enforces unique ordering
- **Index:** `idx_playlist_tracks(playlist_id, position)` - ordered retrieval

---

#### Radio Stations Table

Curated and algorithmic radio stations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Station identifier |
| `name` | VARCHAR(200) | NOT NULL | Station name |
| `description` | TEXT | | Station description |
| `artwork_url` | VARCHAR(500) | | Station artwork |
| `type` | VARCHAR(50) | DEFAULT 'curated' | 'curated', 'personal', 'artist', 'genre' |
| `seed_artist_id` | UUID | REFERENCES artists(id) | Artist seed for artist radio |
| `seed_genre` | VARCHAR(100) | | Genre seed for genre radio |
| `is_active` | BOOLEAN | DEFAULT TRUE | Active/visible status |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Creation time |

---

#### Radio Station Tracks Table

Pre-populated tracks for curated stations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Entry identifier |
| `station_id` | UUID | REFERENCES radio_stations(id) ON DELETE CASCADE | Parent station |
| `track_id` | UUID | REFERENCES tracks(id) ON DELETE CASCADE | Track in rotation |
| `position` | INTEGER | | Play order (nullable for shuffle) |

**Constraint:** `UNIQUE(station_id, track_id)` - no duplicate tracks per station.

---

#### Sessions Table

User authentication sessions stored in PostgreSQL (backed by Redis cache).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Session identifier |
| `user_id` | UUID | REFERENCES users(id) ON DELETE CASCADE | Session owner |
| `token` | VARCHAR(255) | UNIQUE, NOT NULL | Session token (hashed) |
| `device_info` | JSONB | | Device/browser metadata |
| `expires_at` | TIMESTAMP | NOT NULL | Expiration time |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Session creation time |

**Indexes:**
- `idx_sessions_token(token)` - fast token lookup
- `idx_sessions_user(user_id)` - list user's sessions

---

#### Track Genres Table

Many-to-many relationship between tracks and genres with weights.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `track_id` | UUID | PK, REFERENCES tracks(id) ON DELETE CASCADE | Track |
| `genre` | VARCHAR(100) | PK, NOT NULL | Genre tag |
| `weight` | DECIMAL | DEFAULT 1.0 | Genre relevance (0.0-1.0) |

---

#### User Genre Preferences Table

Computed user taste profile for recommendations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PK, REFERENCES users(id) ON DELETE CASCADE | User |
| `genre` | VARCHAR(100) | PK, NOT NULL | Genre tag |
| `score` | DECIMAL | DEFAULT 0 | Affinity score (computed) |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Last recalculation |

---

### Foreign Key Relationships

| Table | Column | References | ON DELETE | Rationale |
|-------|--------|------------|-----------|-----------|
| `albums` | `artist_id` | `artists(id)` | CASCADE | If artist is deleted, their albums should be removed |
| `tracks` | `artist_id` | `artists(id)` | CASCADE | Tracks belong to artists; orphan tracks have no value |
| `tracks` | `album_id` | `albums(id)` | CASCADE | Tracks belong to albums; album deletion removes tracks |
| `audio_files` | `track_id` | `tracks(id)` | CASCADE | Audio files are useless without parent track |
| `library_items` | `user_id` | `users(id)` | CASCADE | User deletion removes their library |
| `library_changes` | `user_id` | `users(id)` | CASCADE | Sync history irrelevant for deleted users |
| `uploaded_tracks` | `user_id` | `users(id)` | CASCADE | Uploads belong to users |
| `uploaded_tracks` | `matched_track_id` | `tracks(id)` | (none) | Matched track may be deleted; upload persists |
| `listening_history` | `user_id` | `users(id)` | CASCADE | History tied to user identity |
| `listening_history` | `track_id` | `tracks(id)` | CASCADE | History for deleted tracks is meaningless |
| `playlists` | `user_id` | `users(id)` | CASCADE | Playlists belong to creators |
| `playlist_tracks` | `playlist_id` | `playlists(id)` | CASCADE | Entries meaningless without playlist |
| `playlist_tracks` | `track_id` | `tracks(id)` | CASCADE | Removed tracks should be cleaned from playlists |
| `playlist_tracks` | `added_by` | `users(id)` | (none) | Attribution preserved even if user deleted |
| `radio_stations` | `seed_artist_id` | `artists(id)` | (none) | Station persists if seed artist removed |
| `radio_station_tracks` | `station_id` | `radio_stations(id)` | CASCADE | Tracks belong to station |
| `radio_station_tracks` | `track_id` | `tracks(id)` | CASCADE | Remove unavailable tracks from rotation |
| `sessions` | `user_id` | `users(id)` | CASCADE | Sessions invalidated on user deletion |
| `track_genres` | `track_id` | `tracks(id)` | CASCADE | Genre tags tied to track existence |
| `user_genre_preferences` | `user_id` | `users(id)` | CASCADE | Preferences tied to user |

**Why CASCADE is the default:**

Most relationships use `ON DELETE CASCADE` because:
1. **Data integrity**: Orphan records have no value (playlist tracks without a playlist)
2. **Storage efficiency**: Automatic cleanup prevents accumulation of useless data
3. **User expectations**: Deleting an artist should remove their music from the catalog

**Exceptions (no cascade):**
- `uploaded_tracks.matched_track_id`: User's upload should persist even if the matched catalog track is removed
- `playlist_tracks.added_by`: Attribution is historical; the user who added a track is recorded even if they leave
- `radio_stations.seed_artist_id`: Curated stations may outlive the artist they were seeded from

---

### Index Strategy

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_library_changes_sync` | `library_changes` | `(user_id, sync_token)` | Fast delta sync: get changes since last sync token |
| `idx_history_user` | `listening_history` | `(user_id, played_at DESC)` | Recent plays for user (For You, Recently Played) |
| `idx_history_track` | `listening_history` | `(track_id)` | Track popularity queries, trending calculations |
| `idx_playlist_tracks` | `playlist_tracks` | `(playlist_id, position)` | Ordered playlist retrieval |
| `idx_sessions_token` | `sessions` | `(token)` | Session validation on every authenticated request |
| `idx_sessions_user` | `sessions` | `(user_id)` | List/revoke user's sessions |

**Query patterns optimized:**

1. **Library sync** (`idx_library_changes_sync`):
   ```sql
   SELECT * FROM library_changes
   WHERE user_id = $1 AND sync_token > $2
   ORDER BY sync_token ASC;
   ```

2. **Recent plays** (`idx_history_user`):
   ```sql
   SELECT track_id, played_at FROM listening_history
   WHERE user_id = $1
   ORDER BY played_at DESC
   LIMIT 50;
   ```

3. **Playlist contents** (`idx_playlist_tracks`):
   ```sql
   SELECT t.* FROM playlist_tracks pt
   JOIN tracks t ON pt.track_id = t.id
   WHERE pt.playlist_id = $1
   ORDER BY pt.position;
   ```

---

### Why Tables Are Structured This Way

#### 1. Separation of Catalog and User Data

**Design:** `artists`, `albums`, `tracks` are distinct from `library_items`, `listening_history`

**Rationale:**
- **Read/write patterns differ**: Catalog is read-heavy, rarely updated; user data is write-heavy
- **Scaling independence**: Catalog can be read-replicated; user data may need sharding
- **Caching strategies**: Catalog entities are highly cacheable (static); user data is personalized

#### 2. Audio Files as Separate Table

**Design:** One track has multiple `audio_files` rows (different qualities)

**Rationale:**
- **Adaptive streaming**: Select quality based on subscription, network, preference
- **Storage optimization**: Store only qualities that are requested (lazy transcoding)
- **Future-proofing**: Add new formats (Dolby Atmos) without schema changes

#### 3. Library Items as Generic Entity

**Design:** `library_items(user_id, item_type, item_id)` instead of separate tables

**Rationale:**
- **Unified library API**: One endpoint for add/remove regardless of item type
- **Simple sync**: `library_changes` logs all types uniformly
- **Flexible UI**: Library page queries one table, groups by `item_type`

**Trade-off:** No foreign key enforcement on `item_id` (polymorphic reference). Application layer validates item existence.

#### 4. Sync Token Sequence

**Design:** Global `sync_token_seq` sequence for `library_changes`

**Rationale:**
- **Monotonic ordering**: Clients request "changes since token X"
- **No gaps**: PostgreSQL sequences guarantee uniqueness, order
- **Cross-device consistency**: All devices see same change order

#### 5. Denormalized Totals in Playlists/Albums

**Design:** `total_tracks` and `duration_ms` stored in `playlists` and `albums`

**Rationale:**
- **Read performance**: Display playlist/album info without JOIN + aggregation
- **Trigger-maintained**: Automatic updates on track insert/update/delete
- **Trade-off**: Slight write overhead, but reads vastly outnumber writes

#### 6. JSONB for Flexible Metadata

**Used in:** `tracks.audio_features`, `playlists.rules`, `sessions.device_info`

**Rationale:**
- **Schema flexibility**: Add new audio features without migrations
- **Smart playlists**: Complex rule trees stored as JSON (AND/OR conditions)
- **Device info**: Varies by client (iOS vs. web vs. CarPlay)

#### 7. Soft Delete Not Used

**Design:** Hard deletes with CASCADE throughout

**Rationale:**
- **GDPR compliance**: User deletion is complete removal
- **Storage efficiency**: Music catalog is reference data, not user-generated
- **Simplicity**: No `deleted_at` checks in every query

**Exception:** For production, `uploaded_tracks` might warrant soft delete for legal holds.

---

### Data Flow for Key Operations

#### 1. Add Track to Library

```sql
-- Transaction: Add to library + log change for sync
BEGIN;

INSERT INTO library_items (user_id, item_type, item_id, added_at)
VALUES ($1, 'track', $2, NOW())
ON CONFLICT DO NOTHING;  -- Idempotent

INSERT INTO library_changes (user_id, change_type, item_type, item_id, sync_token)
VALUES ($1, 'add', 'track', $2, nextval('sync_token_seq'));

COMMIT;
```

#### 2. Sync Library (Delta)

```sql
-- Get all changes since client's last sync token
SELECT
  change_type,
  item_type,
  item_id,
  data,
  sync_token,
  created_at
FROM library_changes
WHERE user_id = $1
  AND sync_token > $2  -- Client's last known token
ORDER BY sync_token ASC;
```

#### 3. Record Play Event

```sql
-- Insert with dedupe check (same track within 30s = single play)
INSERT INTO listening_history (user_id, track_id, played_at, duration_played_ms, context_type, context_id, completed)
SELECT $1, $2, $3, $4, $5, $6, $7
WHERE NOT EXISTS (
  SELECT 1 FROM listening_history
  WHERE user_id = $1
    AND track_id = $2
    AND played_at > $3 - INTERVAL '30 seconds'
    AND played_at < $3 + INTERVAL '30 seconds'
);

-- Update track play count
UPDATE tracks SET play_count = play_count + 1 WHERE id = $2;
```

#### 4. Get Playlist with Tracks

```sql
-- Fetch playlist metadata + ordered tracks in single query
SELECT
  p.id,
  p.name,
  p.description,
  p.total_tracks,
  p.duration_ms,
  json_agg(
    json_build_object(
      'track_id', t.id,
      'title', t.title,
      'artist_name', a.name,
      'album_title', al.title,
      'duration_ms', t.duration_ms,
      'position', pt.position
    ) ORDER BY pt.position
  ) AS tracks
FROM playlists p
LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
LEFT JOIN tracks t ON pt.track_id = t.id
LEFT JOIN artists a ON t.artist_id = a.id
LEFT JOIN albums al ON t.album_id = al.id
WHERE p.id = $1
GROUP BY p.id;
```

#### 5. Get Stream URL (Quality Selection)

```sql
-- Get best matching audio file for user's subscription and preference
SELECT
  af.id,
  af.quality,
  af.format,
  af.bitrate,
  af.minio_key
FROM audio_files af
JOIN tracks t ON af.track_id = t.id
JOIN users u ON u.id = $1
WHERE t.id = $2
  AND af.quality <= (
    CASE u.subscription_tier
      WHEN 'free' THEN '256_aac'
      WHEN 'individual' THEN u.preferred_quality
      WHEN 'family' THEN u.preferred_quality
      WHEN 'student' THEN u.preferred_quality
    END
  )
ORDER BY
  CASE af.quality
    WHEN 'hi_res_lossless' THEN 3
    WHEN 'lossless' THEN 2
    WHEN '256_aac' THEN 1
  END DESC
LIMIT 1;
```

#### 6. Personalized Recommendations (Heavy Rotation)

```sql
-- Albums most played in last 2 weeks
SELECT
  al.id,
  al.title,
  al.artwork_url,
  a.name AS artist_name,
  COUNT(*) AS play_count
FROM listening_history lh
JOIN tracks t ON lh.track_id = t.id
JOIN albums al ON t.album_id = al.id
JOIN artists a ON al.artist_id = a.id
WHERE lh.user_id = $1
  AND lh.played_at > NOW() - INTERVAL '14 days'
  AND lh.completed = true  -- Only count completed plays
GROUP BY al.id, al.title, al.artwork_url, a.name
ORDER BY play_count DESC
LIMIT 10;
```

#### 7. Update User Genre Preferences (Batch Job)

```sql
-- Recalculate genre scores from listening history (last 30 days)
INSERT INTO user_genre_preferences (user_id, genre, score, updated_at)
SELECT
  lh.user_id,
  tg.genre,
  SUM(tg.weight * CASE WHEN lh.completed THEN 1.0 ELSE 0.3 END) AS score,
  NOW()
FROM listening_history lh
JOIN track_genres tg ON lh.track_id = tg.track_id
WHERE lh.user_id = $1
  AND lh.played_at > NOW() - INTERVAL '30 days'
GROUP BY lh.user_id, tg.genre
ON CONFLICT (user_id, genre)
DO UPDATE SET
  score = EXCLUDED.score,
  updated_at = NOW();
```

---

### Database Triggers

Two triggers maintain denormalized counters:

#### Album Totals Trigger

```sql
CREATE OR REPLACE FUNCTION update_album_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE albums SET
    total_tracks = (SELECT COUNT(*) FROM tracks WHERE album_id = COALESCE(NEW.album_id, OLD.album_id)),
    duration_ms = (SELECT COALESCE(SUM(duration_ms), 0) FROM tracks WHERE album_id = COALESCE(NEW.album_id, OLD.album_id))
  WHERE id = COALESCE(NEW.album_id, OLD.album_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_album_totals
AFTER INSERT OR UPDATE OR DELETE ON tracks
FOR EACH ROW EXECUTE FUNCTION update_album_totals();
```

#### Playlist Totals Trigger

```sql
CREATE OR REPLACE FUNCTION update_playlist_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE playlists SET
    total_tracks = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = COALESCE(NEW.playlist_id, OLD.playlist_id)),
    duration_ms = (
      SELECT COALESCE(SUM(t.duration_ms), 0)
      FROM playlist_tracks pt
      JOIN tracks t ON pt.track_id = t.id
      WHERE pt.playlist_id = COALESCE(NEW.playlist_id, OLD.playlist_id)
    ),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.playlist_id, OLD.playlist_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_playlist_totals
AFTER INSERT OR UPDATE OR DELETE ON playlist_tracks
FOR EACH ROW EXECUTE FUNCTION update_playlist_totals();
```

---

## Key Design Decisions

### 1. Audio Fingerprinting for Matching

**Decision**: Use acoustic fingerprints to match uploads

**Rationale**:
- Works regardless of file format/quality
- Handles slight variations
- No metadata required

### 2. Sync Token Architecture

**Decision**: Use incrementing sync tokens for library sync

**Rationale**:
- Simple change tracking
- Efficient delta sync
- Handles offline changes

### 3. Hybrid Quality Streaming

**Decision**: Adaptive quality with lossless option

**Rationale**:
- Matches user preferences
- Considers network conditions
- Premium differentiator

---

## Consistency and Idempotency

### Write Semantics by Operation

| Operation | Consistency | Idempotency | Conflict Resolution |
|-----------|-------------|-------------|---------------------|
| Add to Library | Strong (PostgreSQL transaction) | Idempotent via `ON CONFLICT DO NOTHING` | Last-write-wins with sync tokens |
| Remove from Library | Strong | Idempotent (DELETE is no-op if missing) | Sync token ordering |
| Create Playlist | Strong | Client-generated UUID prevents duplicates | N/A (unique per user) |
| Update Playlist | Strong | Version column prevents lost updates | Reject stale writes, return current state |
| Record Play | Eventual (async via queue) | Dedupe by (user_id, track_id, timestamp window) | Accept all, dedupe later |
| Library Sync | Eventual (sync tokens) | Replay-safe via monotonic sync tokens | Token-based ordering resolves conflicts |

### Idempotency Key Implementation

For operations that create resources or trigger side effects, clients include an idempotency key:

```javascript
// Client sends: X-Idempotency-Key: <uuid>
app.post('/api/v1/library/tracks', async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];

  // Check if we've seen this request before
  const cached = await redis.get(`idempotency:${req.user.id}:${idempotencyKey}`);
  if (cached) {
    return res.json(JSON.parse(cached)); // Return cached response
  }

  // Process the request
  const result = await libraryService.addTrack(req.user.id, req.body.trackId);

  // Cache response for 24 hours
  await redis.setex(
    `idempotency:${req.user.id}:${idempotencyKey}`,
    86400,
    JSON.stringify(result)
  );

  res.json(result);
});
```

### Library Sync Conflict Resolution

When devices sync after being offline, conflicts are resolved using sync tokens:

```javascript
class ConflictResolver {
  async resolveLibraryConflicts(userId, clientChanges, serverSyncToken) {
    // Get all server changes since client's last sync
    const serverChanges = await this.getChangesSince(userId, clientChanges.lastSyncToken);

    const resolved = [];
    for (const clientChange of clientChanges.items) {
      const conflicting = serverChanges.find(
        s => s.itemType === clientChange.itemType && s.itemId === clientChange.itemId
      );

      if (!conflicting) {
        // No conflict - apply client change
        resolved.push({ action: 'apply', change: clientChange });
      } else if (clientChange.timestamp > conflicting.timestamp) {
        // Client wins - more recent
        resolved.push({ action: 'apply', change: clientChange });
      } else {
        // Server wins - client should accept server state
        resolved.push({ action: 'reject', serverState: conflicting });
      }
    }
    return resolved;
  }
}
```

### Replay Handling

Play history events are deduplicated to prevent inflated counts:

```sql
-- Dedupe window: same track played within 30 seconds = single play
INSERT INTO listening_history (user_id, track_id, played_at, duration_played_ms)
SELECT $1, $2, $3, $4
WHERE NOT EXISTS (
  SELECT 1 FROM listening_history
  WHERE user_id = $1
    AND track_id = $2
    AND played_at > $3 - INTERVAL '30 seconds'
    AND played_at < $3 + INTERVAL '30 seconds'
);
```

---

## Authentication, Authorization, and Rate Limiting

### Authentication Flow

```
┌─────────┐     ┌─────────────┐     ┌─────────┐     ┌─────────┐
│  Client │────▶│ API Gateway │────▶│  Auth   │────▶│  Redis  │
│         │◀────│             │◀────│ Service │◀────│ Session │
└─────────┘     └─────────────┘     └─────────┘     └─────────┘
```

**Session-Based Auth (Local Development)**:

```javascript
// Session configuration
const sessionConfig = {
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax'
  }
};

// Login endpoint
app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await userService.validateCredentials(email, password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Create session
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.subscription = user.subscriptionTier;

  res.json({ user: { id: user.id, email: user.email, role: user.role } });
});

// Session validation middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}
```

### Role-Based Access Control (RBAC)

| Role | Permissions |
|------|-------------|
| `user` | Read catalog, manage own library, stream (based on subscription), view own history |
| `premium_user` | All `user` permissions + lossless streaming, offline downloads |
| `curator` | All `user` permissions + create public playlists, feature content |
| `admin` | Full access: manage users, content moderation, view analytics, system config |

```javascript
// RBAC middleware
const rbac = {
  user: ['catalog:read', 'library:own', 'stream:basic', 'history:own'],
  premium_user: ['catalog:read', 'library:own', 'stream:lossless', 'stream:download', 'history:own'],
  curator: ['catalog:read', 'library:own', 'stream:basic', 'playlist:public', 'content:feature'],
  admin: ['*']
};

function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.session.role || 'user';
    const permissions = rbac[role] || [];

    if (permissions.includes('*') || permissions.includes(permission)) {
      return next();
    }

    res.status(403).json({ error: 'Insufficient permissions' });
  };
}

// Usage
app.delete('/api/v1/admin/tracks/:id', requireAuth, requirePermission('admin'), deleteTrack);
app.post('/api/v1/playlists/public', requireAuth, requirePermission('playlist:public'), createPublicPlaylist);
```

### API Endpoint Authorization Matrix

| Endpoint | user | premium_user | curator | admin |
|----------|------|--------------|---------|-------|
| `GET /api/v1/catalog/*` | Yes | Yes | Yes | Yes |
| `GET /api/v1/stream/:trackId` | 256 AAC | Lossless | 256 AAC | Lossless |
| `POST /api/v1/library/*` | Yes | Yes | Yes | Yes |
| `GET /api/v1/admin/*` | No | No | No | Yes |
| `POST /api/v1/playlists/public` | No | No | Yes | Yes |
| `DELETE /api/v1/tracks/:id` | No | No | No | Yes |

### Rate Limiting

Rate limits protect against abuse and ensure fair resource usage:

```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

// Global rate limit
const globalLimiter = rateLimit({
  store: new RedisStore({ client: redisClient }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

// Streaming-specific limits (more generous for playback)
const streamLimiter = rateLimit({
  store: new RedisStore({ client: redisClient, prefix: 'rl:stream:' }),
  windowMs: 60 * 1000,
  max: 300, // Higher limit for stream segments
  keyGenerator: (req) => req.session.userId
});

// Search rate limit (expensive operation)
const searchLimiter = rateLimit({
  store: new RedisStore({ client: redisClient, prefix: 'rl:search:' }),
  windowMs: 60 * 1000,
  max: 30, // 30 searches per minute
  keyGenerator: (req) => req.session.userId
});

// Admin endpoints - stricter limits
const adminLimiter = rateLimit({
  store: new RedisStore({ client: redisClient, prefix: 'rl:admin:' }),
  windowMs: 60 * 1000,
  max: 50
});

app.use('/api/v1', globalLimiter);
app.use('/api/v1/stream', streamLimiter);
app.use('/api/v1/search', searchLimiter);
app.use('/api/v1/admin', adminLimiter);
```

**Rate Limit Summary**:

| Endpoint Category | Limit | Window | Key |
|-------------------|-------|--------|-----|
| Global API | 100 req | 1 min | IP + User ID |
| Stream segments | 300 req | 1 min | User ID |
| Search | 30 req | 1 min | User ID |
| Admin | 50 req | 1 min | User ID |
| Login attempts | 5 req | 15 min | IP |

---

## Observability

### Metrics (Prometheus)

Key metrics exposed at `/metrics` endpoint:

```javascript
const promClient = require('prom-client');

// Enable default metrics (CPU, memory, event loop lag)
promClient.collectDefaultMetrics({ prefix: 'apple_music_' });

// Custom business metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'apple_music_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});

const streamStartLatency = new promClient.Histogram({
  name: 'apple_music_stream_start_latency_seconds',
  help: 'Time from stream request to first byte',
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2]
});

const activeStreams = new promClient.Gauge({
  name: 'apple_music_active_streams',
  help: 'Number of currently active audio streams'
});

const libraryOperations = new promClient.Counter({
  name: 'apple_music_library_operations_total',
  help: 'Library operations by type',
  labelNames: ['operation', 'item_type'] // add, remove, sync
});

const searchLatency = new promClient.Histogram({
  name: 'apple_music_search_latency_seconds',
  help: 'Search query latency',
  labelNames: ['search_type'], // catalog, library
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2]
});

const cacheHitRate = new promClient.Counter({
  name: 'apple_music_cache_hits_total',
  help: 'Cache hit/miss by cache type',
  labelNames: ['cache', 'result'] // redis/memory, hit/miss
});
```

### Structured Logging

JSON-formatted logs for aggregation in Grafana Loki or similar:

```javascript
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  base: {
    service: 'apple-music-api',
    version: process.env.APP_VERSION || '1.0.0'
  }
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();

  req.log = logger.child({ requestId, userId: req.session?.userId });

  res.on('finish', () => {
    req.log.info({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      userAgent: req.headers['user-agent']
    }, 'request completed');
  });

  next();
});

// Example: Streaming event log
logger.info({
  event: 'stream_started',
  userId: user.id,
  trackId: track.id,
  quality: selectedQuality,
  networkType: req.headers['x-network-type']
}, 'User started streaming');
```

### Distributed Tracing

OpenTelemetry integration for request tracing across services:

```javascript
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

const tracer = trace.getTracer('apple-music-api');

async function getStreamUrl(trackId, userId, options) {
  return tracer.startActiveSpan('getStreamUrl', async (span) => {
    try {
      span.setAttributes({
        'track.id': trackId,
        'user.id': userId,
        'stream.preferred_quality': options.preferredQuality
      });

      // Child span for subscription check
      const user = await tracer.startActiveSpan('checkSubscription', async (childSpan) => {
        const result = await userService.getUser(userId);
        childSpan.end();
        return result;
      });

      // Child span for URL generation
      const url = await tracer.startActiveSpan('generateSignedUrl', async (childSpan) => {
        const result = await this.generateSignedUrl(trackId, userId);
        childSpan.end();
        return result;
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return url;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### SLI/SLO Dashboard (Grafana)

**Service Level Indicators**:

| SLI | Target SLO | Alert Threshold |
|-----|------------|-----------------|
| Stream start latency (p95) | < 200ms | > 300ms for 5 min |
| API availability | 99.9% | < 99.5% for 10 min |
| Search latency (p95) | < 500ms | > 750ms for 5 min |
| Library sync success rate | 99.5% | < 99% for 15 min |
| Error rate (5xx) | < 0.1% | > 0.5% for 5 min |

**Grafana Dashboard Panels** (for local development):

```yaml
# docker-compose.yml addition for observability stack
services:
  prometheus:
    image: prom/prometheus:v2.47.0
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:10.1.0
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
```

**prometheus.yml**:
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'apple-music-api'
    static_configs:
      - targets: ['host.docker.internal:3000']
    metrics_path: /metrics
```

### Alert Rules (Prometheus Alertmanager)

```yaml
groups:
  - name: apple-music-alerts
    rules:
      - alert: HighStreamLatency
        expr: histogram_quantile(0.95, rate(apple_music_stream_start_latency_seconds_bucket[5m])) > 0.3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Stream start latency is high"
          description: "p95 stream latency is {{ $value }}s (threshold: 300ms)"

      - alert: HighErrorRate
        expr: sum(rate(apple_music_http_request_duration_seconds_count{status_code=~"5.."}[5m])) / sum(rate(apple_music_http_request_duration_seconds_count[5m])) > 0.005
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High 5xx error rate"
          description: "Error rate is {{ $value | humanizePercentage }}"

      - alert: CacheHitRateLow
        expr: sum(rate(apple_music_cache_hits_total{result="hit"}[10m])) / sum(rate(apple_music_cache_hits_total[10m])) < 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate below 80%"
```

### Audit Logging

Security-relevant events logged to a separate audit trail:

```javascript
const auditLogger = pino({
  level: 'info',
  base: { type: 'audit' }
}).child({ stream: 'audit' });

// Audit log middleware for sensitive operations
function auditLog(action) {
  return (req, res, next) => {
    const auditEntry = {
      action,
      userId: req.session?.userId,
      targetResource: req.params.id || req.body?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    };

    res.on('finish', () => {
      auditEntry.statusCode = res.statusCode;
      auditEntry.success = res.statusCode < 400;
      auditLogger.info(auditEntry, `Audit: ${action}`);
    });

    next();
  };
}

// Usage on sensitive endpoints
app.post('/api/v1/auth/login', auditLog('user.login'), loginHandler);
app.post('/api/v1/auth/logout', auditLog('user.logout'), logoutHandler);
app.delete('/api/v1/admin/users/:id', auditLog('admin.user.delete'), deleteUserHandler);
app.put('/api/v1/admin/tracks/:id', auditLog('admin.track.update'), updateTrackHandler);
```

**Audit Events Captured**:

| Event | Details Logged |
|-------|----------------|
| `user.login` | User ID, IP, success/failure, timestamp |
| `user.logout` | User ID, session duration |
| `admin.user.delete` | Admin ID, target user ID, reason |
| `admin.track.update` | Admin ID, track ID, fields changed |
| `library.export` | User ID, export format, item count |
| `subscription.change` | User ID, old tier, new tier |

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Audio matching | Fingerprinting | Metadata | Accuracy |
| Library sync | Sync tokens | Full sync | Efficiency |
| Streaming | Adaptive + lossless | Fixed bitrate | Quality, bandwidth |
| Recommendations | Hybrid CF + content | Pure CF | Cold start |
| Consistency | Strong for library, eventual for plays | All strong | Performance vs correctness tradeoff |
| Auth | Session + Redis | JWT | Easier revocation, simpler for local dev |
| Rate limiting | Redis-backed sliding window | In-memory | Distributed, persistent across restarts |

---

## Implementation Notes

This section documents the observability, security, and consistency improvements implemented in the backend codebase.

### 1. Structured Logging with Pino

**Location:** `backend/src/shared/logger.js`

**What was implemented:**
- JSON-formatted logging using pino
- Request correlation via `X-Request-ID` headers
- Separate audit logger for security events
- Stream-specific event logging

**Why this improves the system:**
- **Queryability**: JSON logs enable filtering in log aggregation tools (Loki, ELK, CloudWatch). Finding all errors for a specific user becomes a simple query: `userId="abc" AND level="error"`.
- **Correlation**: Request IDs allow tracing a single request across all log entries, essential for debugging distributed issues.
- **Compliance**: Audit logs create a separate, immutable record of security-relevant events (login attempts, admin actions, permission changes) required for SOC2/GDPR compliance.
- **Performance**: Pino is one of the fastest Node.js loggers, adding minimal overhead to request processing.

### 2. Prometheus Metrics

**Location:** `backend/src/shared/metrics.js`

**What was implemented:**
- HTTP request duration histogram (p50/p95/p99 latency)
- Stream start latency histogram (critical SLI)
- Active streams gauge (capacity planning)
- Library/playlist operation counters
- Cache hit rate counters
- Rate limit hit counters
- Idempotency cache usage counters

**Why this improves the system:**
- **SLI Tracking**: Histograms for stream latency directly map to SLOs (e.g., "95th percentile stream start < 200ms"). Dashboards can show real-time SLO compliance.
- **Capacity Planning**: Active streams gauge helps determine when to scale. If `activeStreams` approaches server capacity, auto-scaling can trigger.
- **Cache Effectiveness**: Cache hit counters reveal when Redis is providing value. A low hit rate suggests cache TTL issues or key invalidation bugs.
- **Alerting**: Metrics enable Prometheus alerting rules. Example: alert when error rate exceeds 0.5% for 5 minutes.

### 3. Rate Limiting

**Location:** `backend/src/shared/rateLimit.js`

**What was implemented:**
- Redis-backed sliding window rate limiting
- Tiered limits by endpoint category:
  - Global: 100 req/min
  - Streaming: 300 req/min (higher for segment fetching)
  - Search: 30 req/min (expensive operation)
  - Login: 5 attempts/15 min (brute force protection)
  - Admin: 50 req/min
  - Playlist creation: 10/hour (spam prevention)

**Why this improves the system:**
- **Distributed Consistency**: Redis-backed limiting ensures rate limits are enforced correctly across multiple server instances. In-memory limits would reset on restart and vary by instance.
- **Fair Resource Usage**: Different limits for different operations prevent abuse while allowing legitimate usage. Users can stream many songs but cannot spam search requests.
- **Security**: Login rate limiting prevents credential stuffing attacks. 5 attempts per 15 minutes makes brute force impractical.
- **Graceful Degradation**: Standard `429 Too Many Requests` response with `Retry-After` header tells clients exactly when to retry.

### 4. Idempotency for Playlist Operations

**Location:** `backend/src/shared/idempotency.js`, `backend/src/routes/playlists.js`

**What was implemented:**
- `X-Idempotency-Key` header support for POST operations
- 24-hour cached response storage in Redis
- Automatic response replay for duplicate requests
- Idempotency key validation (format checking)

**Why this improves the system:**
- **Network Resilience**: Mobile clients on spotty connections can safely retry requests. If a playlist creation request times out, the client can resend with the same idempotency key and either get the cached success response or trigger a new creation.
- **Duplicate Prevention**: Without idempotency, a network timeout after successful creation leads to duplicate playlists when the client retries.
- **Consistent User Experience**: Users never see unexpected duplicate content. The database stays clean.
- **24-Hour TTL**: Balances memory usage (keys are cleaned up) with a reasonable retry window (user could retry the next day).

### 5. Session-Based Authentication with RBAC

**Location:** `backend/src/middleware/auth.js`

**What was implemented:**
- Session validation with Redis caching
- Role-based permissions: `user`, `premium_user`, `curator`, `admin`
- Permission-based middleware (`requirePermission('playlist:public')`)
- Subscription tier checks
- Session invalidation for logout

**Why this improves the system:**
- **Instant Revocation**: Unlike JWTs, sessions can be invalidated immediately. If a user's subscription expires or they're banned, their access is revoked on the next request.
- **Redis Caching**: Sessions are validated from cache on most requests (avoiding database hits), with cache-aside pattern for cache misses.
- **Granular Permissions**: RBAC enables fine-grained access control. A curator can create public playlists but cannot access admin endpoints. Permissions can evolve independently of roles.
- **Subscription Enforcement**: Streaming quality is automatically limited based on subscription tier. Premium users get lossless; free users get 256 AAC.

### 6. Enhanced Health Checks

**Location:** `backend/src/shared/health.js`

**What was implemented:**
- `/health` - Simple liveness probe
- `/health/ready` - Detailed readiness check with component status
- PostgreSQL and Redis connectivity checks
- Latency measurement per component

**Why this improves the system:**
- **Load Balancer Integration**: Kubernetes and load balancers use these endpoints to route traffic only to healthy instances.
- **Component-Level Visibility**: When `/health/ready` fails, the response shows exactly which component (PostgreSQL or Redis) is unhealthy, speeding up incident diagnosis.
- **Zero-Downtime Deployments**: Readiness checks ensure new instances don't receive traffic until all dependencies are connected.

### 7. Streaming Metrics

**Location:** `backend/src/routes/streaming.js`

**What was implemented:**
- Stream start latency tracking (histogram)
- Active streams gauge by quality
- Total streams counter by quality and subscription tier
- Stream lifecycle events (started, prefetch, completed, ended)

**Why this improves the system:**
- **SLI Monitoring**: Stream start latency is a critical user experience metric. Tracking p95 latency ensures we meet the < 200ms target.
- **Quality Distribution**: Metrics show which quality tiers are most used. If 90% of streams are 256 AAC, it might indicate bandwidth issues or free tier dominance.
- **Capacity Signals**: Active streams gauge provides real-time load visibility. Correlating with CPU/memory metrics reveals per-stream resource cost.
- **User Journey Tracking**: Stream events (start, prefetch, complete, end) enable funnel analysis. High prefetch-to-start ratio indicates good UX; high start-to-end-early ratio might indicate content issues.

### Files Created/Modified

| File | Purpose |
|------|---------|
| `src/shared/logger.js` | Structured logging with pino |
| `src/shared/metrics.js` | Prometheus metrics collection |
| `src/shared/rateLimit.js` | Redis-backed rate limiting |
| `src/shared/idempotency.js` | Request idempotency handling |
| `src/shared/health.js` | Health check endpoints |
| `src/middleware/auth.js` | Enhanced auth with RBAC |
| `src/index.js` | Integration of all modules |
| `src/routes/playlists.js` | Idempotency for mutations |
| `src/routes/streaming.js` | Stream metrics and logging |

### Dependencies Added

```json
{
  "pino": "^8.x",
  "pino-http": "^9.x",
  "prom-client": "^15.x",
  "express-rate-limit": "^7.x",
  "rate-limit-redis": "^4.x"
}
```

### Endpoint Summary

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness probe |
| `GET /health/ready` | Readiness probe with component status |
| `GET /metrics` | Prometheus metrics export |
