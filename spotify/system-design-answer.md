# Design Spotify - System Design Interview Answer

## Introduction (2 minutes)

"Thank you. Today I'll design Spotify, a music streaming platform. Spotify is a great system design problem because it combines several interesting challenges:

1. Audio streaming with adaptive quality based on network conditions
2. Recommendation systems that blend collaborative and content-based filtering
3. Offline synchronization with DRM protection
4. Playback analytics at scale for royalty attribution

Let me start by clarifying the requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our core product:

1. **Streaming**: Play music with adaptive bitrate based on network quality
2. **Library**: Browse artists, albums, songs with search
3. **Playlists**: Create, manage, and share playlists
4. **Discovery**: Personalized recommendations - Discover Weekly, Daily Mixes
5. **Offline**: Download music for offline listening

The streaming and recommendation systems are the most technically interesting, so I'll focus there."

### Non-Functional Requirements

"For scale and performance:

- **Playback Start Latency**: Under 200ms from tap to audio playing
- **Availability**: 99.99% for the streaming service
- **Scale**: 500 million users, 100 million songs in the catalog
- **Audio Quality**: Up to 320 kbps for premium users

The low latency requirement is critical - users expect instant playback when they tap a song."

---

## High-Level Design (10 minutes)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│       Mobile │ Desktop │ Web │ Car │ Smart Speaker              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         CDN                                     │
│              (Audio files, album art, assets)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│Catalog Service│    │Playback Service│    │  Rec Service  │
│               │    │               │    │               │
│ - Artists     │    │ - Stream URLs │    │ - Discovery   │
│ - Albums      │    │ - Play state  │    │ - Radio       │
│ - Tracks      │    │ - Analytics   │    │ - Similar     │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────────────────────────────────┤
│   PostgreSQL    │           Feature Store + ML                  │
│   - Catalog     │           - User embeddings                   │
│   - Playlists   │           - Track embeddings                  │
│   - Users       │           - Listening history                 │
└─────────────────┴───────────────────────────────────────────────┘
```

### Key Components

"Three main services:

**Catalog Service**: Manages the music library - artists, albums, tracks, and their metadata. This is read-heavy with relatively infrequent updates.

**Playback Service**: Handles streaming requests. Generates signed URLs for CDN, tracks play state across devices, and collects analytics for royalties.

**Recommendation Service**: Powers Discover Weekly, Radio, and similar artist features. Uses ML models with a feature store.

The CDN is critical - all audio files are served from edge locations, not our origin servers."

---

## Deep Dive: Audio Streaming (10 minutes)

### Adaptive Bitrate Approach

"Audio files are encoded at multiple quality levels:

```
Track 123:
├── track_123_96kbps.ogg    (Low quality, mobile data)
├── track_123_160kbps.ogg   (Normal quality)
├── track_123_320kbps.ogg   (High quality, premium only)
```

The client chooses quality based on:
1. User subscription (premium gets 320kbps)
2. Network conditions (detected bandwidth)
3. User preference (data saver mode)

Unlike video ABR which switches mid-stream, audio typically picks quality at start and sticks with it - songs are short enough that mid-stream switching isn't worth the complexity."

### Streaming Flow

"When a user taps play:

```javascript
async function getStreamUrl(trackId, userId) {
  // Check subscription level
  const user = await getUser(userId)
  const maxQuality = user.isPremium ? 320 : 160

  // Determine quality based on network
  const quality = determineQuality(user.connectionType, maxQuality)

  // Generate signed URL with expiry
  const url = await cdn.signedUrl(`tracks/${trackId}_${quality}kbps.ogg`, {
    expiresIn: 3600,
    userId  // For analytics attribution
  })

  return { url, quality, expiresAt: Date.now() + 3600000 }
}
```

Key points:
- URLs are signed so they can't be shared or reused
- URLs expire after an hour
- User ID is embedded for royalty tracking"

### CDN Strategy

"We use a global CDN with points of presence worldwide. Audio files are cached at the edge because:
- Same song is requested millions of times
- Cache hit rate is extremely high for popular tracks
- Reduces origin load and improves latency

For popular tracks, they're likely already cached at your nearest edge server, giving sub-100ms response times."

---

## Deep Dive: Recommendation Engine (12 minutes)

### The Cold Start Problem

"When a new user signs up, we have no listening history. How do we recommend music?

Three approaches:
1. **Onboarding**: 'Select artists you like' during signup
2. **Demographics**: Age and location can inform initial recommendations
3. **Popularity**: Start with trending/popular content

After even a few hours of listening, our models have enough signal to personalize."

### Hybrid Recommendation Approach

"We combine two recommendation strategies:

**Collaborative Filtering**: 'Users like you also listened to X'
- Find users with similar listening patterns
- Recommend what they listen to that you haven't

**Content-Based Filtering**: 'Because this sounds like what you like'
- Analyze audio features: tempo, energy, acousticness
- Recommend tracks with similar characteristics

```javascript
async function getDiscoverWeekly(userId) {
  // 1. Get user's listening history
  const history = await getListeningHistory(userId, { days: 28 })

  // 2. Collaborative: Find similar users, get their tracks
  const userEmbedding = await getUserEmbedding(userId)
  const similarUsers = await findSimilarUsers(userEmbedding, 100)
  const collaborativeTracks = await getTopTracks(similarUsers, {
    excludeListened: history.trackIds
  })

  // 3. Content-based: Find similar-sounding tracks
  const likedTracks = history.filter(h => h.rating > 0.7)
  const contentBasedTracks = await findSimilarTracks(likedTracks, {
    excludeListened: history.trackIds
  })

  // 4. Blend results (60% collaborative, 40% content)
  const blended = blendResults(collaborativeTracks, contentBasedTracks, 0.6)

  // 5. Diversify (avoid too many from same artist)
  return diversify(blended, { maxPerArtist: 2, totalCount: 30 })
}
```"

### Track Embeddings

"Each track has a 128-dimensional embedding vector:

```typescript
interface TrackEmbedding {
  trackId: string
  embedding: number[]  // 128 dimensions
  // Derived from:
  // - Audio features (tempo, energy, danceability)
  // - Genre tags
  // - User interaction patterns
  // - Co-occurrence in playlists
}
```

Finding similar tracks is an approximate nearest neighbor search:

```javascript
function findSimilarTracks(tracks, options) {
  const avgEmbedding = averageEmbeddings(tracks.map(t => t.embedding))

  return vectorDb.query({
    vector: avgEmbedding,
    topK: 100,
    filter: { trackId: { $nin: options.excludeListened } }
  })
}
```

We use a vector database (like Pinecone or Milvus) for fast ANN search across 100 million tracks."

### Why Hybrid?

"Collaborative filtering catches hidden preferences - you might love jazz even though you've never explicitly searched for it, because users with similar taste to you love jazz.

Content-based helps with the long tail - for niche genres with few listeners, collaborative filtering fails but audio similarity still works.

The blend gives us the best of both worlds."

---

## Deep Dive: Offline Mode (5 minutes)

### Download Flow

"Premium users can download for offline listening:

```javascript
class OfflineManager {
  async downloadTrack(trackId) {
    // Check if already downloaded
    if (await localDb.has('tracks', trackId)) return

    // Get download URL with DRM license
    const { url, license } = await api.getOfflineDownload(trackId)

    // Download encrypted audio
    const audioData = await fetch(url).then(r => r.arrayBuffer())

    // Store locally with license
    await localDb.put('tracks', trackId, {
      audio: audioData,
      license,
      downloadedAt: Date.now()
    })
  }

  async playOffline(trackId) {
    const { audio, license } = await localDb.get('tracks', trackId)

    // Verify license is still valid
    if (!this.verifyLicense(license)) {
      throw new Error('License expired')
    }

    // Decrypt and play
    return this.decryptAndPlay(audio, license)
  }
}
```"

### DRM Considerations

"Downloaded tracks are encrypted. The license:
- Is tied to the user's account
- Has an expiration (typically 30 days)
- Must be refreshed by connecting online periodically

This protects artist rights while allowing offline listening. If a user cancels their subscription, licenses expire and downloaded content becomes unplayable."

---

## Deep Dive: Playback Analytics (5 minutes)

### Stream Counting

"Accurate play counts are critical for royalty payments. Here's the challenge: what counts as a 'stream'?

Industry standard: 30 seconds of playback OR 50% of track duration (whichever is less).

```javascript
// Client reports playback events
async function reportPlayback(userId, trackId, event) {
  await kafka.send('playback_events', {
    userId,
    trackId,
    event,  // 'start', 'progress', 'complete', 'skip'
    timestamp: Date.now(),
    position: event.position,  // Seconds into track
    deviceType: event.device
  })
}

// Server processes events
async function processPlaybackEvent(event) {
  if (event.event === 'progress' && event.position >= 30) {
    await incrementStreamCount(event.trackId)
    await attributeRoyalty(event.trackId, event.userId)
  }
}
```"

### Why Kafka?

"We process billions of playback events daily. Kafka gives us:
- High throughput for event ingestion
- Durability - events aren't lost if a consumer is down
- Multiple consumers - analytics, royalties, recommendations all read from the same stream

The actual royalty calculation happens in batch jobs that aggregate stream counts per track, per territory, per subscription type."

---

## Database Schema (2 minutes)

"Core tables:

```sql
CREATE TABLE tracks (
  id UUID PRIMARY KEY,
  album_id UUID REFERENCES albums(id),
  title VARCHAR(200) NOT NULL,
  duration_ms INTEGER,
  track_number INTEGER,
  explicit BOOLEAN DEFAULT FALSE,
  stream_count BIGINT DEFAULT 0,
  audio_features JSONB,  -- tempo, energy, danceability, etc.
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE playlists (
  id UUID PRIMARY KEY,
  owner_id UUID REFERENCES users(id),
  name VARCHAR(200) NOT NULL,
  is_public BOOLEAN DEFAULT TRUE,
  is_collaborative BOOLEAN DEFAULT FALSE,
  follower_count INTEGER DEFAULT 0
);

CREATE TABLE playlist_tracks (
  playlist_id UUID REFERENCES playlists(id),
  track_id UUID REFERENCES tracks(id),
  position INTEGER NOT NULL,
  added_by UUID REFERENCES users(id),
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (playlist_id, track_id)
);
```

Audio features stored as JSONB allow flexible schema for ML features."

---

## Trade-offs and Alternatives (2 minutes)

"Key decisions:

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Audio Delivery | CDN + signed URLs | Direct streaming | Global scale, edge caching |
| Recommendations | Hybrid CF + CB | Pure collaborative | Handles cold start, long tail |
| Offline DRM | License + encryption | No DRM | Rights holder requirements |
| Analytics | Event streaming (Kafka) | Batch collection | Real-time, durability |

Things I'd explore with more time:
- Collaborative playlist conflict resolution
- Cross-device playback handoff (Spotify Connect)
- Social features (friend activity, listening parties)
- Audio fingerprinting for content matching"

---

## Summary

"To summarize, I've designed Spotify with:

1. **CDN-based streaming** with signed URLs and multi-quality encoding
2. **Hybrid recommendation engine** combining collaborative and content-based filtering
3. **Vector embeddings** for track similarity search at scale
4. **DRM-protected offline mode** with license management
5. **Event streaming** for playback analytics and royalty attribution

The architecture prioritizes low-latency playback and personalized discovery while respecting content rights.

What aspects would you like to explore further?"
