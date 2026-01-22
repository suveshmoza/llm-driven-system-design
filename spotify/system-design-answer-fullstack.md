# Spotify - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Introduction (2 minutes)

"Thank you. Today I'll design Spotify, a music streaming platform. As a full-stack engineer, I'll focus on how the frontend and backend work together to deliver seamless audio playback, real-time queue synchronization, and personalized recommendations.

The key full-stack challenges are:
1. End-to-end audio streaming with CDN integration and playback analytics
2. Player state synchronization across frontend and backend
3. Real-time updates for collaborative playlists
4. Recommendation pipeline from listening history to UI

Let me start by clarifying the requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our core product:

1. **Streaming**: Play music with adaptive quality based on network
2. **Library**: Browse and save tracks, albums, playlists
3. **Playlists**: Create, edit, collaborate with real-time updates
4. **Discovery**: Personalized recommendations (Discover Weekly, Daily Mixes)
5. **Queue**: Manage upcoming tracks with shuffle and repeat

From a full-stack perspective, the streaming pipeline and real-time playlist updates are the most interesting challenges."

### Non-Functional Requirements

"For scale and experience:

- **Playback Start**: Under 200ms from tap to audio
- **Availability**: 99.99% for streaming
- **Scale**: 500M users, 100M songs
- **Sync**: Play state consistent across devices"

---

## High-Level Design (8 minutes)

### Full-Stack Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                              │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐│
│  │   PlayerStore   │ │  LibraryStore   │ │     API Client          ││
│  │   (Zustand)     │ │  (Zustand)      │ │  (fetch + React Query)  ││
│  └────────┬────────┘ └────────┬────────┘ └───────────┬─────────────┘│
└───────────│────────────────────│─────────────────────│──────────────┘
            │                    │                     │
            ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         CDN (Audio/Images)                           │
│                        └── Signed URLs ──┘                           │
└─────────────────────────────────────────────────────────────────────┘
            │                    │                     │
            ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       API Gateway (Express)                          │
│                  Rate Limiting │ Auth │ Routing                      │
└─────────────────────────────────────────────────────────────────────┘
            │                    │                     │
            ▼                    ▼                     ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  Playback Service │ │  Catalog Service  │ │    Rec Service    │
│                   │ │                   │ │                   │
│ - Stream URLs     │ │ - Artists/Albums  │ │ - Discover Weekly │
│ - Analytics       │ │ - Playlists       │ │ - Similar tracks  │
│ - Queue sync      │ │ - Library CRUD    │ │ - Radio           │
└─────────┬─────────┘ └─────────┬─────────┘ └─────────┬─────────┘
          │                     │                     │
          ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Data Layer                                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐│
│  │   PostgreSQL    │ │     Valkey      │ │   Feature Store (ML)    ││
│  │  Catalog/Users  │ │ Sessions/Cache  │ │   Embeddings/History    ││
│  └─────────────────┘ └─────────────────┘ └─────────────────────────┘│
│                               │                                      │
│                               ▼                                      │
│                    ┌─────────────────────┐                          │
│                    │       Kafka         │                          │
│                    │  (Playback Events)  │                          │
│                    └─────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Deep Dive: End-to-End Streaming Flow (12 minutes)

### Shared Type Definitions

Both frontend and backend share TypeScript interfaces for type safety:

**Track**: id, title, duration_ms, explicit, album (id, title, cover_url), artist (id, name), audio_features (tempo, energy, danceability, acousticness, valence)

**StreamResponse**: url, quality (96 | 160 | 320), expiresAt

**PlaybackEvent**: trackId, eventType (start | progress | complete | skip | seek), position (ms), timestamp

### Stream URL Generation Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │     │   Backend   │     │    Redis    │     │     CDN     │
│  (Player)   │     │  (Express)  │     │   (Cache)   │     │  (Storage)  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ GET /stream/:id   │                   │                   │
       ├──────────────────►│                   │                   │
       │                   │ Check cache       │                   │
       │                   ├──────────────────►│                   │
       │                   │◄──────────────────┤                   │
       │                   │                   │                   │
       │                   │ Determine quality │                   │
       │                   │ (premium + network)                   │
       │                   │                   │                   │
       │                   │ Generate signed URL                   │
       │                   ├───────────────────────────────────────►
       │                   │                   │                   │
       │◄──────────────────┤ { url, quality, expiresAt }           │
       │                   │                   │                   │
       │ Stream audio directly from CDN        │                   │
       ├───────────────────────────────────────────────────────────►
```

**Quality Determination Logic:**
- Premium users: up to 320kbps
- Free users: max 160kbps
- Network adaptation: 4G/WiFi = max, 3G = 160, 2G = 96

### Audio Controller Integration

The frontend AudioController component:
- Fetches signed URL when track changes
- Reports playback events (start, 30-second progress, complete)
- Tracks 30-second mark for royalty attribution (industry standard)
- Updates PlayerStore with current time for progress bar

### Playback Event Processing

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │     │   Backend   │     │    Redis    │     │    Kafka    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       │ POST /events      │                   │                   │
       │ (progress @ 30s)  │                   │                   │
       ├──────────────────►│                   │                   │
       │                   │ Check idempotency │                   │
       │                   ├──────────────────►│                   │
       │                   │◄──────────────────┤                   │
       │                   │                   │                   │
       │                   │ Queue for async   │                   │
       │                   ├───────────────────────────────────────►
       │                   │                   │                   │
       │◄──────────────────┤ { success: true } │                   │
```

**Kafka Consumer** (separate process):
- Increments track stream_count for 30+ second plays
- Records playback_events for royalty attribution with idempotency key
- Updates listening_history for recommendations

---

## Deep Dive: Playlist Management (10 minutes)

### Playlist API Design

**GET /playlists/:id** - Returns playlist with tracks, owner, metadata (cached 5 min)

**POST /playlists/:id/tracks** - Adds track with idempotency key header
- Uses ON CONFLICT to prevent duplicates
- Auto-assigns next position
- Invalidates cache after write

**PUT /playlists/:id/tracks/reorder** - Reorders within transaction
- Shifts positions up or down based on direction
- Uses PostgreSQL transaction for atomicity

### Playlist Component with Optimistic Updates

```
┌───────────────────────────────────────────────────────────────────┐
│                     Playlist Page Component                        │
├───────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Header: Cover, Title, Owner, Track Count                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Controls: Play Button                                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ DndContext (drag-and-drop reordering)                       │  │
│  │  ┌─────────────────────────────────────────────────────────┐│  │
│  │  │ SortableTrackRow 1                                      ││  │
│  │  ├─────────────────────────────────────────────────────────┤│  │
│  │  │ SortableTrackRow 2                                      ││  │
│  │  ├─────────────────────────────────────────────────────────┤│  │
│  │  │ SortableTrackRow N                                      ││  │
│  │  └─────────────────────────────────────────────────────────┘│  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

**Optimistic Update Pattern (React Query):**
1. **onMutate**: Cancel queries, snapshot previous state, apply optimistic update
2. **onError**: Rollback to snapshot
3. **onSettled**: Invalidate to ensure consistency

---

## Deep Dive: Recommendations Pipeline (8 minutes)

### Discover Weekly Generation

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Recommendation Pipeline                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. LISTENING HISTORY (28 days)                                     │
│     ┌───────────────────────────────────────────────────────────┐   │
│     │ track_id │ play_count │ engagement (0.5 skip, 1.0 complete)│   │
│     └───────────────────────────────────────────────────────────┘   │
│                              │                                       │
│              ┌───────────────┴───────────────┐                      │
│              ▼                               ▼                       │
│  2. COLLABORATIVE FILTERING          3. CONTENT-BASED              │
│     ┌─────────────────────┐          ┌─────────────────────┐        │
│     │ User Embedding      │          │ Track Embeddings    │        │
│     │      ↓              │          │      ↓              │        │
│     │ Similar Users (100) │          │ Average Vector      │        │
│     │      ↓              │          │      ↓              │        │
│     │ Their Top Tracks    │          │ Similar Tracks (50) │        │
│     │ (exclude listened)  │          │ (exclude listened)  │        │
│     └─────────┬───────────┘          └─────────┬───────────┘        │
│               │                                │                     │
│               └───────────────┬────────────────┘                    │
│                               ▼                                      │
│  4. BLEND (60% collaborative, 40% content)                          │
│                               │                                      │
│                               ▼                                      │
│  5. DIVERSIFY (max 2 per artist, total 30)                          │
│                               │                                      │
│                               ▼                                      │
│  6. CACHE (7 days)                                                  │
│     ┌─────────────────────────────────────────────────────────────┐ │
│     │ discover_weekly:{userId} → { tracks, generatedAt, algorithm }│ │
│     └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Algorithm Details

**Collaborative Filtering**: Find users with similar embeddings, get their popular tracks from last 7 days

**Content-Based**: Average embeddings of high-engagement tracks, find similar by vector similarity

**Blending**: Normalize scores, weight 60/40, sort by combined score

**Diversification**: Cap at 2 tracks per artist to prevent artist domination

### Frontend Display

Discover Weekly page displays:
- Gradient header with generation date range
- Play button triggers playQueue with all tracks
- TrackList component with context for analytics

---

## API Layer Design

### API Client Methods

| Category | Method | Endpoint |
|----------|--------|----------|
| Auth | login, logout, getMe | /auth/* |
| Playback | getStreamUrl, reportPlaybackEvent | /playback/* |
| Library | getLibrary, saveToLibrary, removeFromLibrary | /library/* |
| Playlists | getPlaylist, createPlaylist, addTrack, reorderTrack | /playlists/* |
| Recommendations | getDiscoverWeekly, getDailyMix | /recommendations/* |
| Search | search | /search |
| Catalog | getArtist, getAlbum, getTrack | /artists/*, /albums/*, /tracks/* |

### Session Management

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Session Flow                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Login → createSession(userId)                                   │
│     ├── Query user from PostgreSQL                                  │
│     ├── Generate sessionId (crypto.randomUUID)                      │
│     ├── Store in Redis: session:{id} → { userId, email, isPremium } │
│     └── Set TTL: 4 hours (sliding expiration)                       │
│                                                                      │
│  2. Request → requireAuth middleware                                │
│     ├── Extract sessionId from cookie                               │
│     ├── Lookup in Redis                                             │
│     ├── Refresh TTL (sliding expiration)                            │
│     └── Attach session to req                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State Management | Zustand (frontend) | Redux Toolkit | Simpler API, built-in persistence |
| Audio Delivery | CDN + signed URLs | Direct streaming | Global scale, 90%+ cache hit rate |
| Playlist Sync | Optimistic updates + refetch | WebSocket real-time | Simpler, works for most cases |
| Recommendations | Pre-computed weekly | Real-time | Balance freshness vs compute cost |
| Drag-and-Drop | @dnd-kit | react-beautiful-dnd | Better maintained, more flexible |
| Event Processing | Kafka | Direct DB writes | Throughput, multi-consumer |

---

## Future Enhancements (Full-Stack Focus)

1. **Spotify Connect**: WebSocket-based cross-device playback control
2. **Collaborative Playlist Real-time**: WebSocket updates for simultaneous editing
3. **Offline Mode**: IndexedDB + Service Worker with sync queue
4. **Social Features**: Friend activity feed, listening together
5. **A/B Testing**: Feature flags with analytics to compare recommendation algorithms
6. **Lyrics Sync**: Time-synced lyrics from backend, rendered in frontend

---

## Summary

"To summarize the full-stack architecture:

1. **Streaming pipeline**: Frontend Audio controller fetches signed URLs from backend, reports 30-second marks for royalty attribution via Kafka
2. **Shared types**: TypeScript interfaces used by both frontend and backend for type safety
3. **Playlist management**: Backend handles idempotent writes with cache invalidation, frontend uses optimistic updates with React Query
4. **Recommendations**: Backend generates weekly using collaborative + content-based filtering, cached for 7 days, displayed in frontend with play integration
5. **Session auth**: Redis-based sessions with sliding expiration, shared across services

The architecture prioritizes seamless playback experience while maintaining accurate analytics for royalty payments.

What aspects would you like to explore further?"
