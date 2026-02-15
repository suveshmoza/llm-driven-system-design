# Pinterest - Image Pinning Platform - Architecture

## System Overview

Pinterest is a visual discovery platform where users save images (Pins) to organized collections (Boards). The core interaction model is save-based rather than like-based: users curate content into themed boards, creating a network of visual inspiration.

**Key learning goals:**
- Masonry layout algorithm with variable-height virtualization
- Image processing pipeline (dimensions, aspect ratio, dominant color extraction)
- Save-based engagement model (boards) vs. like-based engagement
- Visual content feed generation and ranking

## Requirements

### Functional Requirements
1. Users can upload images as Pins with title, description, and destination link
2. Users organize Pins into Boards (curated collections)
3. Users can save any Pin to their own Boards
4. Users follow other users to see their Pins in a personalized feed
5. Masonry grid layout adapts to variable-height images without layout shift
6. Full-text search across pins, users, and boards
7. Pin detail view with comments

### Non-Functional Requirements (Production Scale)
- Support 450M monthly active users
- Handle 5B+ Pins stored
- Image processing latency < 30s from upload to published
- Feed generation p99 < 200ms
- 99.95% uptime
- Support images up to 20MB upload size

## Capacity Estimation

### Production Scale
- **Users**: 450M MAU, 100M DAU
- **Pins**: 5B total, 2M new pins/day (~23 pins/sec)
- **Saves**: 10x pins created = 20M saves/day
- **Image storage**: Average 2MB per image * 5B = ~10 PB
- **Feed reads**: 100M DAU * 10 feed views/day = 1B feed requests/day (~11,500 QPS)

### Local Development Scale
- 2-5 concurrent users, ~10 pins, 3-6 boards per user
- Single PostgreSQL instance, single RabbitMQ queue
- MinIO for S3-compatible object storage

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Clients                                    │
│                    (Web / Mobile / Progressive Web App)                  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                     ┌─────────▼─────────┐
                     │    CDN (Images)    │
                     │  CloudFront / BOS  │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │   API Gateway /    │
                     │   Load Balancer    │
                     └─────────┬─────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
┌─────────▼────────┐ ┌────────▼────────┐ ┌────────▼────────┐
│  Pin Service     │ │  Board Service  │ │  Feed Service   │
│  (Upload, CRUD)  │ │  (Collections)  │ │  (Ranking)      │
└─────────┬────────┘ └────────┬────────┘ └────────┬────────┘
          │                    │                    │
          │         ┌──────────┴──────────┐         │
          │         │                     │         │
┌─────────▼─────────▼───┐  ┌─────────────▼─────────▼───┐
│     PostgreSQL         │  │        Redis/Valkey        │
│  (Users, Pins, Boards, │  │  (Sessions, Feed Cache,   │
│   Follows, Saves)      │  │   Rate Limiting)          │
└────────────────────────┘  └───────────────────────────┘
          │
┌─────────▼─────────┐     ┌──────────────────────┐
│   Message Queue   │────▶│  Image Worker(s)     │
│   (RabbitMQ)      │     │  - Extract dimensions │
└───────────────────┘     │  - Aspect ratio       │
                          │  - Dominant color      │
                          │  - Thumbnail gen       │
                          └──────────┬─────────────┘
                                     │
                          ┌──────────▼─────────────┐
                          │   Object Storage       │
                          │   (S3 / MinIO)         │
                          │   - Originals          │
                          │   - Thumbnails         │
                          └────────────────────────┘
```

## Data Model

### Database Schema

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    bio TEXT,
    follower_count INT DEFAULT 0,
    following_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pins table (the core entity)
CREATE TABLE pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255),
    description TEXT,
    image_url TEXT NOT NULL,
    image_width INT,           -- Extracted by worker
    image_height INT,          -- Extracted by worker
    aspect_ratio FLOAT,        -- height/width, critical for masonry
    dominant_color VARCHAR(7), -- Hex color for placeholder
    link_url TEXT,             -- Destination URL
    status VARCHAR(20) DEFAULT 'processing',
    save_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Boards (curated collections)
CREATE TABLE boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    cover_pin_id UUID REFERENCES pins(id),
    is_private BOOLEAN DEFAULT false,
    pin_count INT DEFAULT 0,
    UNIQUE(user_id, name)
);

-- Many-to-many: boards contain pins
CREATE TABLE board_pins (
    board_id UUID NOT NULL REFERENCES boards(id),
    pin_id UUID NOT NULL REFERENCES pins(id),
    position INT DEFAULT 0,
    UNIQUE(board_id, pin_id)
);

-- Save action: user saves pin to board
CREATE TABLE pin_saves (
    pin_id UUID NOT NULL REFERENCES pins(id),
    user_id UUID NOT NULL REFERENCES users(id),
    board_id UUID NOT NULL REFERENCES boards(id),
    UNIQUE(pin_id, user_id, board_id)
);

-- Social graph
CREATE TABLE follows (
    follower_id UUID REFERENCES users(id),
    following_id UUID REFERENCES users(id),
    UNIQUE(follower_id, following_id),
    CHECK(follower_id != following_id)
);

-- Comments on pins
CREATE TABLE pin_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id UUID REFERENCES pins(id),
    user_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    parent_comment_id UUID REFERENCES pin_comments(id)
);
```

### Key Index Strategy

| Table | Index | Purpose |
|-------|-------|---------|
| `pins` | `(user_id, created_at DESC)` | User's pins feed |
| `pins` | `(status, created_at DESC)` | Published pins listing |
| `pins` | `(save_count DESC)` | Popular pins ranking |
| `board_pins` | `(board_id, position)` | Board pin ordering |
| `follows` | `(follower_id)`, `(following_id)` | Social graph lookups |
| `pin_saves` | `(pin_id)`, `(user_id)` | Save checks |

## API Design

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login with credentials |
| POST | `/api/v1/auth/logout` | Destroy session |
| GET | `/api/v1/auth/me` | Get current user |

### Pins
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/pins` | Create pin (multipart upload) |
| GET | `/api/v1/pins/:pinId` | Get pin details with comments |
| DELETE | `/api/v1/pins/:pinId` | Delete own pin |
| POST | `/api/v1/pins/:pinId/save` | Save pin to board |
| DELETE | `/api/v1/pins/:pinId/save` | Unsave pin from board |
| GET | `/api/v1/pins/:pinId/comments` | Get pin comments |
| POST | `/api/v1/pins/:pinId/comments` | Add comment |

### Boards
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/boards` | Create board |
| GET | `/api/v1/boards/:boardId` | Get board details |
| PUT | `/api/v1/boards/:boardId` | Update board |
| DELETE | `/api/v1/boards/:boardId` | Delete board |
| GET | `/api/v1/boards/:boardId/pins` | Get board's pins |

### Feed
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/feed` | Personalized feed (auth required) |
| GET | `/api/v1/feed/discover` | Discover/explore feed (public) |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/:username` | Get user profile |
| GET | `/api/v1/users/:username/pins` | Get user's pins |
| GET | `/api/v1/users/:username/boards` | Get user's boards |
| POST | `/api/v1/users/:userId/follow` | Follow user |
| DELETE | `/api/v1/users/:userId/follow` | Unfollow user |

### Search
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/search/pins?q=` | Search pins |
| GET | `/api/v1/search/users?q=` | Search users |
| GET | `/api/v1/search/boards?q=` | Search boards |

## Image Processing Pipeline

```
┌──────────┐     ┌───────────┐     ┌──────────┐     ┌──────────────┐
│  Client   │────▶│  API      │────▶│  MinIO   │────▶│  RabbitMQ    │
│  Upload   │     │  Server   │     │ Original │     │  Job Queue   │
└──────────┘     └───────────┘     └──────────┘     └──────┬───────┘
                                                           │
                                                    ┌──────▼───────┐
                                                    │ Image Worker  │
                                                    │              │
                                                    │ 1. Download  │
                                                    │ 2. Metadata  │
                                                    │ 3. Aspect    │
                                                    │ 4. Color     │
                                                    │ 5. Thumbnail │
                                                    │ 6. Upload    │
                                                    │ 7. Update DB │
                                                    └──────────────┘
```

### Worker Processing Steps

1. **Download original** from MinIO
2. **Extract metadata** via `sharp.metadata()`: width, height, format
3. **Calculate aspect_ratio** = `height / width`
4. **Extract dominant color** via `sharp.stats()` → RGB → hex string
5. **Generate thumbnail** at 300px width, WebP format, 80% quality
6. **Upload thumbnail** to MinIO under `thumbnails/{pinId}/`
7. **Update pin record**: set `image_width`, `image_height`, `aspect_ratio`, `dominant_color`, `status='published'`

### Why aspect_ratio Matters

The masonry layout must know each image's height before it loads. Without `aspect_ratio`:
- Layout jumps as images load (poor UX)
- Cannot pre-calculate column assignments
- Virtualization breaks (wrong row heights)

With `aspect_ratio = height / width`:
- Pin height = `columnWidth * aspectRatio` (one multiplication)
- Layout is stable from first render
- Dominant color placeholder fills the exact space

## Masonry Layout Algorithm

### Column Assignment (useMasonryLayout hook)

```
Input: pins[] with aspect_ratio, columnCount, columnWidth
Output: items[] with {pin, column, top, height}

columnHeights = [0, 0, 0, 0, ...]  // Track height of each column

for each pin:
    shortestColumn = findMin(columnHeights)
    imageHeight = columnWidth * pin.aspect_ratio
    totalHeight = imageHeight + PIN_PADDING

    item = {
        pin,
        column: shortestColumn,
        top: columnHeights[shortestColumn],
        height: totalHeight
    }

    columnHeights[shortestColumn] += totalHeight + GAP
```

### Responsive Column Count

| Viewport | Columns | Column Width |
|----------|---------|--------------|
| < 500px | 2 | ~230px |
| 500-768px | 3 | ~230px |
| 768-1024px | 4 | ~236px |
| 1024-1280px | 5 | ~236px |
| > 1280px | 6 | ~236px |

### Virtualization Strategy

The masonry grid uses absolute positioning (not CSS columns) to enable virtualization. Each item knows its exact `top` and `left` position. A `ResizeObserver` watches container width to dynamically recalculate column count.

## Key Design Decisions

### 1. Save-Based vs. Like-Based Engagement

Pinterest's core mechanic is saving, not liking. This creates fundamentally different behavior:

| Aspect | Save-Based (Pinterest) | Like-Based (Instagram) |
|--------|----------------------|----------------------|
| **User intent** | Collect for future reference | Express approval |
| **Content lifecycle** | Long-lived, revisited | Ephemeral, scroll past |
| **Data model** | pin_saves with board reference | Simple likes table |
| **Ranking signal** | save_count (high intent) | like_count (low friction) |
| **Organization** | User-created boards | No organization |

### 2. Pull Model for Feed Generation

**Chosen**: Pull model (fetch on read) with cache
**Alternative**: Push model (fanout on write)

At Pinterest's scale, most users follow a moderate number of accounts (median ~100). Pull model works well because:
- Simple UNION query: followed users' pins + popular pins
- 60-second cache TTL avoids repeated expensive queries
- No write amplification when popular accounts post
- Cache invalidation on follow/unfollow

Push model would be necessary if we optimized for instant delivery of new pins, but Pinterest's use case tolerates 60-second latency.

### 3. Storing Dominant Color in Database

**Chosen**: Extract and store hex color during image processing
**Alternative**: Compute client-side with canvas

Server-side extraction ensures:
- Consistent results across all clients
- No additional client-side computation
- Available immediately when pin data loads (before image)
- Only 7 bytes per pin (#RRGGBB)

### 4. WebP Thumbnails

**Chosen**: WebP at 80% quality for all thumbnails
**Alternative**: JPEG at 85% quality

WebP provides 25-35% better compression at equivalent visual quality. Since thumbnails are the most-loaded assets (grid view), this directly reduces bandwidth and loading time.

## Security / Auth

- **Session-based auth** with Valkey-backed sessions (cookie: `connect.sid`)
- **bcrypt** password hashing with 12 rounds
- **Rate limiting**: per-endpoint limits (10 pins/min, 5 login attempts/min, 30 follows/min)
- **CORS**: restricted to frontend origin
- **File upload validation**: whitelist MIME types (JPEG, PNG, WebP, GIF), 20MB max
- **Input sanitization**: parameterized SQL queries prevent injection
- **CSRF protection**: SameSite=Lax cookies

## Monitoring and Observability

### Prometheus Metrics
- `http_request_duration_seconds` - Request latency histogram
- `http_requests_total` - Request count by method/route/status
- `pins_created_total` - Pin creation counter
- `pin_saves_total` - Save action counter
- `image_processing_duration_seconds` - Worker processing time
- `image_processing_errors_total` - Worker error count
- `feed_generation_duration_seconds` - Feed query time
- `feed_cache_hits_total` / `feed_cache_misses_total` - Cache effectiveness

### Health Checks
- `GET /api/health` - Overall health with timestamp
- `GET /api/health/live` - Liveness probe
- `GET /metrics` - Prometheus scrape endpoint

### Structured Logging
Pino logger with JSON output, including service name and environment context.

## Failure Handling

- **Circuit breaker** (Opossum) wraps external service calls with configurable thresholds
- **Dead letter queue** for failed image processing jobs (retry manually or alert)
- **Graceful degradation**: if Redis is down, session creation fails but existing cached data still serves
- **Idempotent saves**: `ON CONFLICT DO NOTHING` prevents duplicate board_pins entries
- **Image processing retry**: failed images get status='failed', can be reprocessed

## Scalability Considerations

### Horizontal Scaling Path

1. **API servers**: Stateless (sessions in Redis), scale behind load balancer
2. **Image workers**: Independent consumers, scale by adding more worker instances
3. **Database reads**: Add read replicas for feed queries and search
4. **Feed optimization**: Introduce hybrid push/pull model for accounts with >10K followers
5. **Image serving**: CDN in front of MinIO/S3 for global distribution
6. **Search**: Move from PostgreSQL ILIKE to Elasticsearch for full-text search
7. **Caching**: Distributed Redis Cluster for session and feed caching

### Sharding Strategy (Future)

- **Pins table**: Shard by `user_id` hash (user's pins are co-located)
- **Board_pins**: Shard by `board_id` (board contents are co-located)
- **Follows**: Shard by `follower_id` (outgoing follows are co-located for feed generation)

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Engagement model | Save-based | Like-based | Matches Pinterest's curation UX |
| Feed strategy | Pull + cache | Push (fanout) | Simpler, sufficient for moderate follow counts |
| Image metadata | Server-side extraction | Client-side canvas | Consistent, available before image loads |
| Thumbnail format | WebP | JPEG | 25-35% smaller at equivalent quality |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler state management |
| Masonry layout | Absolute positioning | CSS columns | Enables virtualization and precise height calculation |
| Search | PostgreSQL ILIKE | Elasticsearch | Simpler for learning; would migrate for production |
| Queue | RabbitMQ | Kafka | Simpler setup, job semantics fit image processing |

## Implementation Notes

### Production-Grade Patterns Implemented

1. **Async image processing**: Upload returns immediately with `status: 'processing'`. Worker handles heavy image operations asynchronously via RabbitMQ, updating the pin when complete. This prevents upload timeouts and enables scaling workers independently.

2. **Circuit breaker** (Opossum): Wraps external service calls (MinIO, RabbitMQ). Opens after 50% error rate, resets after 30 seconds. Prevents cascade failures when infrastructure services are degraded.

3. **Prometheus metrics** (prom-client): Histogram for request duration, counters for business events (pins created, saves, cache hits/misses). Enables alerting on degraded image processing or feed latency.

4. **Structured logging** (Pino): JSON logs with request context, query timing, and error details. Enables log aggregation and debugging in production.

5. **Rate limiting**: Per-endpoint limits prevent abuse of expensive operations (pin creation, follows, search).

6. **Health checks**: Kubernetes-compatible liveness and readiness endpoints.

### What Was Simplified

- **MinIO** substitutes for S3 (same API, local storage)
- **Single PostgreSQL** instead of sharded cluster with read replicas
- **ILIKE search** instead of Elasticsearch
- **Session auth** instead of OAuth/JWT
- **picsum.photos** URLs in seed data instead of real uploaded images

### What Was Omitted

- CDN for image distribution
- Multi-region deployment
- Kubernetes orchestration
- ML-based pin recommendations
- Visual similarity search (image embeddings)
- Pin categorization/tagging
- Notification system
- A/B testing framework
