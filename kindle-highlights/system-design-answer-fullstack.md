# Kindle Community Highlights - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Opening Statement (1 minute)

"I'll design a Kindle Community Highlights system - a social reading platform that enables users to highlight passages in books, sync highlights across devices in real-time, and discover popular highlights from the community.

As a fullstack engineer, I'll focus on the end-to-end data flow from user interactions through WebSocket sync to aggregation pipelines, emphasizing the integration points between frontend components and backend services, shared type contracts, and the complete lifecycle of a highlight from creation to community discovery."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Highlight Management** - Create, edit, delete highlights with notes and colors
- **Cross-device Sync** - Real-time synchronization across Kindle, iOS, Android, Web
- **Community Discovery** - View popular/trending highlights in any book
- **Social Features** - Follow readers, share highlights, friends-only sharing
- **Export** - Export personal highlights to Markdown, CSV, or PDF

### Non-Functional Requirements
- **Sync Latency** - < 2 seconds cross-device propagation
- **Scale** - 10M users, 1B highlights, 100K highlight views/second
- **Availability** - 99.9% uptime
- **Privacy** - Community highlights are anonymized, opt-out available

---

## High-Level Architecture (4 minutes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Web Application                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                │
│  │   Library    │   │    Book      │   │   Export     │                │
│  │    Page      │   │   Detail     │   │    Page      │                │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘                │
│         │                  │                  │                         │
│  ┌──────┴──────────────────┴──────────────────┴───────┐                │
│  │                   Zustand Store                     │                │
│  │        (user, library, highlights, syncQueue)       │                │
│  └─────────────────────────┬───────────────────────────┘                │
│                            │                                            │
│  ┌─────────────────────────┴───────────────────────────┐                │
│  │           API Client / WebSocket Manager             │                │
│  └─────────────────────────┬───────────────────────────┘                │
└────────────────────────────┼────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Gateway                                      │
│                 (Authentication, Rate Limiting)                          │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  Sync Service  │  │   Highlight    │  │  Aggregation   │
│  (WebSocket)   │  │    Service     │  │    Service     │
└────────────────┘  └────────────────┘  └────────────────┘
            │                │                │
            └────────────────┼────────────────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│   PostgreSQL   │  │     Redis      │  │ Elasticsearch  │
└────────────────┘  └────────────────┘  └────────────────┘
```

---

## Deep Dive: Shared Type Contracts (5 minutes)

### Core Domain Types

**User** - id, email, username, avatarUrl, createdAt

**Book** - id, title, author, isbn, coverUrl, totalLocations, highlightCount

**Highlight** - id, userId, bookId, locationStart, locationEnd, text, note, color (yellow/orange/blue/green/pink), visibility (private/friends/public), fingerprint, createdAt, updatedAt

**PopularHighlight** - fingerprint, text, count, location {start, end}

### WebSocket Message Types

```
┌──────────────────────────────────────────────────────────────────┐
│                    Sync Message Protocol                          │
├──────────────────┬───────────────────────────────────────────────┤
│ sync_request     │ Client requests changes since lastSyncTime    │
├──────────────────┼───────────────────────────────────────────────┤
│ sync_response    │ Server returns highlights[], deleted[], time  │
├──────────────────┼───────────────────────────────────────────────┤
│ highlight_create │ Client creates new highlight + idempotencyKey │
├──────────────────┼───────────────────────────────────────────────┤
│ highlight_update │ Client updates existing highlight             │
├──────────────────┼───────────────────────────────────────────────┤
│ highlight_delete │ Client deletes highlight by ID                │
├──────────────────┼───────────────────────────────────────────────┤
│ highlight_sync   │ Server broadcasts change to other devices     │
└──────────────────┴───────────────────────────────────────────────┘
```

---

## Deep Dive: Highlight Creation Flow (10 minutes)

### End-to-End Lifecycle

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         Highlight Creation Flow                            │
└───────────────────────────────────────────────────────────────────────────┘

User selects text
       │
       ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Generate   │───▶│  Optimistic  │───▶│  WebSocket   │
│   Temp ID    │    │   Update     │    │    Send      │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                               │
       ┌───────────────────────────────────────┘
       ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Backend    │───▶│   Database   │───▶│  Aggregation │
│  Validation  │    │   Insert     │    │   Update     │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                               │
       ┌───────────────────────────────────────┘
       ▼
┌──────────────┐    ┌──────────────┐
│  Broadcast   │───▶│   Confirm    │
│  to Devices  │    │   to Client  │
└──────────────┘    └──────────────┘
```

### Frontend: Text Selection and Highlight Creation

1. **Text Selection Handler** - Listens for mouseup events, validates selection length (min 3 chars)
2. **Position Popup** - Shows color picker at selection coordinates
3. **Generate IDs** - Creates temp ID and idempotency key with crypto.randomUUID()
4. **Calculate Location** - Converts DOM Range to Kindle location values
5. **Optimistic Update** - Immediately adds highlight to Zustand store
6. **Send via WebSocket** - If connected, sends highlight_create message
7. **Queue if Offline** - If disconnected, adds to sync queue for later

### Backend: Highlight Service

1. **Check Idempotency** - Query Redis for existing idempotency key
2. **Generate Fingerprint** - SHA256 hash of normalized text for aggregation grouping
3. **Insert to PostgreSQL** - Create highlight with gen_random_uuid()
4. **Cache Idempotency** - Store result in Redis with 24-hour TTL
5. **Update Aggregation** - Increment counter if user opts in
6. **Broadcast to Devices** - Push to all user's connected WebSocket clients

### WebSocket Sync Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Sync Service                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │   Connection Registry: Map<userId, Map<deviceId, ws>>   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│           ┌───────────────┼───────────────┐                     │
│           ▼               ▼               ▼                     │
│    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│    │   Device 1  │ │   Device 2  │ │   Device 3  │             │
│    │  (Kindle)   │ │   (Web)     │ │   (iOS)     │             │
│    └─────────────┘ └─────────────┘ └─────────────┘             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │   Redis Presence: HSET sync:{userId} {deviceId} {info}  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │   Offline Queue: RPUSH sync:queue:{userId}:{deviceId}   │    │
│  │   TTL: 30 days                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Operations:**
- handleConnection: Register device, update Redis presence, drain offline queue
- handleMessage: Route by type (sync_request, highlight_create/update/delete)
- handleSyncRequest: Query highlights since lastSyncTimestamp, return delta
- pushHighlight: Send to all connected devices, queue for offline ones
- handleDisconnect: Remove from registry, clean up Redis presence

---

## Deep Dive: Popular Highlights Integration (8 minutes)

### Aggregation Service

```
┌─────────────────────────────────────────────────────────────────┐
│                    Aggregation Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Write Path:                                                     │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │  Highlight   │───▶│  Redis Sorted Set                    │   │
│  │   Created    │    │  ZINCRBY book:{bookId}:popular 1 fp  │   │
│  └──────────────┘    └──────────────────────────────────────┘   │
│                                                                  │
│  Read Path:                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Check       │───▶│  ZREVRANGE   │───▶│  Fetch Text  │      │
│  │  Cache       │    │  Top N       │    │  from PG     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                              │                                   │
│                              ▼                                   │
│                     ┌──────────────┐                            │
│                     │ Cache Result │                            │
│                     │ TTL: 5 min   │                            │
│                     └──────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Methods:**
- incrementHighlightCount(bookId, fingerprint) - ZINCRBY to sorted set
- decrementHighlightCount(bookId, fingerprint) - ZINCRBY with -1
- getPopularHighlights(bookId, limit) - Check cache, get top from sorted set, fetch text from PG, cache result

**Threshold:** Only return highlights with count >= 5 for privacy

### Trending Highlights API

1. Query books with most recent activity (last 7 days)
2. For each active book, get top 3 popular highlights
3. Return combined list with book metadata

### Frontend: Trending Page

- Fetches trending data on mount
- Groups highlights by book
- Shows book cover, title, author
- Renders PopularPassage components with rank indicator

---

## Deep Dive: Export Flow (5 minutes)

### Export Format Options

| Format   | Use Case                           | Output                    |
|----------|-----------------------------------|---------------------------|
| Markdown | Personal knowledge base           | Grouped by book, blockquotes |
| CSV      | Spreadsheet analysis              | Flat table with columns   |
| JSON     | Developer integration             | Structured data array     |

### Export Pipeline

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Frontend   │───▶│   Backend    │───▶│   Download   │
│   Options    │    │   Generate   │    │   File       │
└──────────────┘    └──────────────┘    └──────────────┘

Options:                 Processing:
- Format selection       - Query user's highlights
- Include notes toggle   - Join with book metadata
- Include dates toggle   - Group by book (Markdown)
- Book filter            - Format according to type
- Preview mode           - Return content string
```

**Markdown Format:**
- H1: "My Highlights"
- H2: Book title with author italic
- Blockquotes for highlight text
- Bold "Note:" prefix for notes
- Italic date if included
- Horizontal rules between entries

---

## Deep Dive: Privacy Settings Integration (5 minutes)

### Privacy Settings Structure

| Setting                     | Default   | Description                           |
|-----------------------------|-----------|---------------------------------------|
| highlightVisibility         | private   | Default visibility for new highlights |
| contributeToAggregation     | true      | Include in popular highlights         |
| allowFollowers              | true      | Let others follow this user           |
| showHighlightsToFollowers   | false     | Let followers see highlights          |

### Privacy-Aware Query Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              Privacy-Aware Highlight Access                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Request: GET /api/users/{targetUserId}/highlights               │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Check      │───▶│   Get User   │───▶│  Determine   │      │
│  │   Follower   │    │   Privacy    │    │   Visible    │      │
│  │   Status     │    │   Settings   │    │   Levels     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                  │               │
│                                                  ▼               │
│                      ┌───────────────────────────────────────┐  │
│                      │ Visibility Matrix:                    │  │
│                      │ - Self: private, friends, public      │  │
│                      │ - Follower: friends, public           │  │
│                      │ - Other: public only                  │  │
│                      └───────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema (2 minutes)

### Core Tables

```
┌─────────────────────────────────────────────────────────────────┐
│                        highlights                                │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID PRIMARY KEY                              │
│ user_id         │ UUID NOT NULL REFERENCES users(id)            │
│ book_id         │ UUID NOT NULL REFERENCES books(id)            │
│ location_start  │ INTEGER NOT NULL                              │
│ location_end    │ INTEGER NOT NULL                              │
│ highlighted_text│ TEXT NOT NULL                                 │
│ fingerprint     │ VARCHAR(16) - for aggregation grouping        │
│ note            │ TEXT                                          │
│ color           │ VARCHAR(20) DEFAULT 'yellow'                  │
│ visibility      │ VARCHAR(20) DEFAULT 'private'                 │
│ idempotency_key │ VARCHAR(64) UNIQUE                            │
│ created_at      │ TIMESTAMP DEFAULT NOW()                       │
│ updated_at      │ TIMESTAMP DEFAULT NOW()                       │
├─────────────────────────────────────────────────────────────────┤
│ INDEXES:                                                         │
│ - idx_highlights_user (user_id, created_at DESC)                │
│ - idx_highlights_book (book_id)                                 │
│ - idx_highlights_fingerprint (book_id, fingerprint)             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    user_privacy_settings                         │
├─────────────────────────────────────────────────────────────────┤
│ user_id                      │ UUID PRIMARY KEY                 │
│ highlight_visibility         │ VARCHAR(20) DEFAULT 'private'    │
│ contribute_to_aggregation    │ BOOLEAN DEFAULT true             │
│ allow_followers              │ BOOLEAN DEFAULT true             │
│ show_highlights_to_followers │ BOOLEAN DEFAULT false            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                          follows                                 │
├─────────────────────────────────────────────────────────────────┤
│ follower_id │ UUID REFERENCES users(id)                         │
│ followee_id │ UUID REFERENCES users(id)                         │
│ created_at  │ TIMESTAMP DEFAULT NOW()                           │
│ PRIMARY KEY (follower_id, followee_id)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Trade-offs and Alternatives (2 minutes)

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Sync Protocol | WebSocket | Server-Sent Events | Bidirectional needed for conflict resolution |
| Conflict Resolution | Last-Write-Wins | CRDTs | Simpler, works for highlight data |
| Aggregation Storage | Redis + PostgreSQL | Kafka + ClickHouse | Simpler for this scale |
| Offline Queue | Zustand persist | IndexedDB | Sufficient for highlight operations |
| Fingerprinting | SHA256 prefix | MinHash | Exact matching preferred |

---

## Closing Summary (1 minute)

"The Kindle Community Highlights system is built with a fullstack perspective emphasizing:

1. **Shared type contracts** between frontend and backend ensuring type-safe data flow across the WebSocket and REST APIs
2. **End-to-end highlight lifecycle** from text selection through optimistic updates, WebSocket sync, aggregation updates, and cross-device broadcast
3. **Privacy-integrated data access** with visibility checks at both the API and query levels

Key integration points include the WebSocket sync service bridging frontend state with backend persistence, the aggregation service consuming highlight events while respecting privacy settings, and the export service transforming stored data into user-friendly formats. The architecture enables real-time collaboration while preserving individual control over data sharing."
