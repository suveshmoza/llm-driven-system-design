# Pinterest - Backend System Design Interview Answer

## 🎯 Problem Statement

> "Design the backend for Pinterest, an image pinning platform where users save images to organized collections called boards."

"Pinterest is fundamentally different from Instagram or Twitter because the core engagement mechanic is saving, not liking. Users collect pins into themed boards for future reference -- this means content has a much longer lifecycle and save-count is the primary quality signal. I will focus on the image processing pipeline, the data model for save-based engagement, feed generation, and the masonry layout data requirements."

---

## 📋 Requirements Clarification

"Before diving in, let me clarify scope."

**Functional:**
- Users upload images as Pins (with title, description, destination link)
- Users organize Pins into Boards (curated collections)
- Users save any Pin to their own Boards
- Follow-based personalized feed
- Search across pins, users, and boards
- Comments on pins

**Non-Functional:**
- 450M MAU, 100M DAU
- 5B+ pins stored
- Image processing < 30 seconds end-to-end
- Feed generation p99 < 200ms
- 99.95% uptime

---

## 📊 Capacity Estimation

"Let me estimate the scale we are designing for."

| Metric | Value |
|--------|-------|
| DAU | 100M |
| New pins/day | 2M (~23/sec) |
| Saves/day | 20M (~230/sec) |
| Feed reads/day | 1B (~11,500 QPS) |
| Avg image size | 2MB |
| Total image storage | ~10 PB |
| Pin metadata per record | ~500 bytes |

> "The read-heavy nature (1B feed reads vs 2M writes) tells me I need aggressive caching for feeds and efficient image serving via CDN."

---

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Clients    │────▶│   CDN        │────▶│   S3 / Obj   │
│  Web/Mobile  │     │  (Images)    │     │   Storage    │
└──────┬───────┘     └──────────────┘     └──────────────┘
       │                                         ▲
┌──────▼───────┐                                 │
│  API Gateway │                          ┌──────┴───────┐
│  / LB        │                          │ Image Worker │
└──────┬───────┘                          │ (Sharp)      │
       │                                  └──────▲───────┘
┌──────┼─────────────────┐                       │
│      │                 │                ┌──────┴───────┐
│ ┌────▼────┐  ┌────────┐│                │  Message     │
│ │Pin Svc  │  │Feed Svc││                │  Queue       │
│ └────┬────┘  └───┬────┘│                └──────────────┘
│      │           │      │
│ ┌────▼───────────▼────┐ │
│ │    PostgreSQL       │ │
│ │  (Primary + Reads)  │ │
│ └─────────────────────┘ │
│                         │
│ ┌─────────────────────┐ │
│ │    Redis/Valkey     │ │
│ │  Sessions + Cache   │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

"I split the system into three primary concerns: the Pin service handles uploads and CRUD, the Feed service handles personalized feeds, and Image Workers handle async processing. Let me walk through each."

---

## 💾 Data Model

### Core Tables

**users** -- id (UUID), username, email, password_hash, display_name, avatar_url, bio, follower_count, following_count, timestamps

**pins** -- id (UUID), user_id (FK), title, description, image_url, image_width, image_height, aspect_ratio (FLOAT, height/width), dominant_color (VARCHAR 7, hex), link_url, status (processing/published/failed), save_count, comment_count, timestamps

**boards** -- id (UUID), user_id (FK), name, description, cover_pin_id, is_private, pin_count. UNIQUE(user_id, name)

**board_pins** -- board_id (FK), pin_id (FK), position (INT). UNIQUE(board_id, pin_id)

**pin_saves** -- pin_id (FK), user_id (FK), board_id (FK). UNIQUE(pin_id, user_id, board_id)

**follows** -- follower_id (FK), following_id (FK). CHECK(follower_id != following_id)

**pin_comments** -- id (UUID), pin_id (FK), user_id (FK), content, parent_comment_id (self-ref FK)

> "Two fields on the pins table deserve special attention: `aspect_ratio` and `dominant_color`. These are extracted during async image processing and are critical for the frontend masonry layout -- the client needs to know each image's proportions before it loads to prevent layout shifts."

### Index Strategy

| Index | Purpose |
|-------|---------|
| pins(user_id, created_at DESC) | User's pins for profile page |
| pins(status, save_count DESC) | Popular published pins for discover feed |
| board_pins(board_id, position) | Ordered board contents |
| follows(follower_id) | Outgoing follows for feed generation |
| follows(following_id) | Incoming follows for follower lists |
| pin_saves(pin_id) | Check if a pin has been saved |
| pin_saves(user_id) | List all saves by a user |

> "The index on `pins(status, save_count DESC)` is particularly important for the discover feed. It allows me to query published pins ordered by popularity without a full table scan. At 5B pins, an unindexed sort on save_count would be catastrophic."

---

## 🔧 Deep Dive 1: Image Processing Pipeline

"The image processing pipeline is the most critical backend component. Users upload raw images of varying sizes, and we need to extract metadata, generate thumbnails, and make them available for the masonry grid."

### Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client   │────▶│  API     │────▶│  Object  │────▶│  Queue   │
│  Upload   │     │  Server  │     │  Storage │     │  (AMQP)  │
└──────────┘     └──────────┘     └──────────┘     └────┬─────┘
                  │ Returns                              │
                  │ pin_id +                       ┌─────▼─────┐
                  │ status=                        │  Worker   │
                  │ processing                     │           │
                  ▼                                │ 1. Download│
                                                   │ 2. Width/H │
                                                   │ 3. Ratio   │
                                                   │ 4. Color   │
                                                   │ 5. Thumb   │
                                                   │ 6. Upload  │
                                                   │ 7. DB Upd  │
                                                   └───────────┘
```

### Processing Steps

1. **Client uploads** image via multipart form POST
2. **API server** stores original in object storage, creates pin with `status='processing'`, publishes job to message queue, returns pin ID immediately
3. **Worker** consumes job, downloads original, runs Sharp:
   - Extract width/height from EXIF metadata
   - Calculate `aspect_ratio = height / width`
   - Extract dominant color via `sharp.stats()` (dominant RGB -> hex)
   - Generate 300px-wide thumbnail in WebP format
   - Upload thumbnail to object storage
4. **Worker updates** pin record: set dimensions, aspect ratio, dominant color, `status='published'`

### Trade-off: Sync vs Async Processing

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Async (queue + worker) | Non-blocking uploads, scalable workers, retry via DLQ | Complexity, brief "processing" state |
| ❌ Sync (process in request) | Simpler, immediate result | Blocks request, timeout risk, cannot scale processing independently |

> "I chose async processing because image operations (resize, color extraction, format conversion) take 1-5 seconds depending on image size. A 20MB upload processed synchronously would timeout on most load balancers set to 30 seconds. The async model lets the API server respond in milliseconds while workers process at their own pace. If processing volume spikes, I add more worker instances without touching the API layer."

### Why aspect_ratio and dominant_color Matter

> "These two fields solve a frontend problem from the backend: layout stability. Without aspect_ratio, the masonry grid cannot calculate pin heights before images load, causing layout jumps as each image arrives. Without dominant_color, placeholders are grey rectangles -- showing the actual dominant color creates a seamless loading experience. The cost is 12 bytes per pin (4 bytes float + 7 bytes varchar + 1 byte overhead), negligible against the UX benefit."

---

## 🔧 Deep Dive 2: Feed Generation

### Pull Model with Caching

> "For feed generation, I chose a pull model: when a user requests their feed, I query pins from followed users and mix in popular pins, then cache the result."

```
Feed Request ──▶ Cache Check ──▶ Cache Hit ──▶ Return
                     │
                     ▼
                Cache Miss
                     │
                     ▼
         ┌───────────────────────┐
         │  UNION Query:         │
         │  1. Followed users'   │
         │     recent pins       │
         │  2. Popular pins      │
         │     (by save_count)   │
         └───────────┬───────────┘
                     │
                     ▼
              Cache result (60s)
                     │
                     ▼
                  Return
```

### Trade-off: Pull vs Push for Feeds

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Pull (fetch on read) | Simple, no write amplification, consistent | Higher read latency, more DB load per read |
| ❌ Push (fanout on write) | Instant delivery, pre-materialized | Massive write amplification for popular users, wasted writes for inactive followers |

> "I chose pull because Pinterest's content consumption pattern tolerates latency. Unlike Twitter where users expect tweets within seconds, Pinterest users browse a visual feed where 60-second staleness is imperceptible. The median Pinterest user follows ~100 accounts, making the follow-join query manageable. A push model would require writing to potentially millions of fan-out lists when a popular account pins something -- at 2M pins/day with average 1000 followers, that is 2B writes/day just for fanout. The pull model with a 60-second cache reduces feed reads from 11,500 QPS to roughly 3,800 unique cache-miss queries per second."

> "If I needed to optimize further, I would use a hybrid approach: pull for users following < 10,000 accounts, push for celebrity-tier accounts with a pre-materialized follower inbox."

### Cursor-Based Pagination

"Feeds use cursor-based pagination with `created_at` timestamps as cursors. This avoids the offset-skip problem where page 100 requires scanning and discarding 2000 rows."

---

## 🔧 Deep Dive 3: Save-Based Engagement Model

### How Saves Differ from Likes

> "The save model is architecturally more complex than likes because each save has a destination -- a board. This creates a three-way relationship (user, pin, board) instead of a two-way relationship (user, post)."

```
┌──────┐      ┌──────────┐      ┌──────┐
│ User │──────│ pin_saves │──────│ Pin  │
└──────┘      │          │      └──────┘
              │ board_id │
              └────┬─────┘
                   │
              ┌────▼─────┐
              │  Board   │
              └──────────┘
```

### Board Selection UX Flow

1. User taps "Save" on a pin
2. Frontend shows board picker modal (fetches user's boards)
3. User selects board (or creates new one)
4. Backend inserts into `pin_saves` AND `board_pins`
5. Increments `save_count` on pin and `pin_count` on board

### Idempotency

"The UNIQUE constraint on `(pin_id, user_id, board_id)` ensures a pin can only be saved once per board per user. The INSERT uses `ON CONFLICT DO NOTHING` to make saves idempotent -- if a user double-taps save, the second request succeeds silently without duplicating."

### Why save_count is a Better Signal

> "Save count is a higher-quality signal than like count because saving requires deliberate action and indicates future intent. A user who saves a recipe pin is likely to cook it; a user who likes a photo might never look at it again. This makes save_count more reliable for content ranking in the discover feed."

---

## 🔍 Search Architecture

"For the local implementation, I use PostgreSQL ILIKE queries with pattern matching. At production scale, this would migrate to Elasticsearch."

| Scale | Approach | Latency |
|-------|----------|---------|
| Local | PostgreSQL ILIKE | 10-50ms |
| Production | Elasticsearch with BM25 scoring | 5-20ms |

> "The migration path is clean: search queries go through a Search Service that abstracts the backend. Switch from PostgreSQL to Elasticsearch by changing the service implementation without touching the API contract."

### Search Ranking Considerations

> "Pinterest search is unique because visual content does not have the same textual density as web pages. A pin might have a 10-word title and a 30-word description -- not much for text-based relevance scoring. At production scale, I would combine text relevance (BM25 on title and description) with engagement signals (save_count, recency) and visual similarity (image embeddings from a CNN). The weighted score would look like: 0.3 * text_relevance + 0.4 * engagement_score + 0.3 * visual_similarity."

Search results must also respect privacy -- private boards and their pins should never appear in search results for other users. This filtering happens at query time using a visibility field indexed on the pins table, ensuring that the search index only contains publicly visible content.

### Search Index Updates

> "When a pin is created or updated, I publish a search index update event to a dedicated queue. A search indexer worker consumes these events and updates the Elasticsearch index. This decouples the write path from the search path -- a slow Elasticsearch cluster does not block pin creation. The trade-off is that newly created pins may not appear in search results for 5-10 seconds until the indexer processes the event. For Pinterest's use case, this delay is imperceptible."

---

## 🔒 Security

- Session-based auth with Redis-backed sessions
- bcrypt password hashing (12 rounds)
- Per-endpoint rate limiting (10 pins/min, 5 login attempts/min)
- Parameterized SQL queries (prevent injection)
- MIME type whitelist for uploads (JPEG, PNG, WebP, GIF)
- File size limit (20MB)
- SameSite=Lax cookies for CSRF protection

---

## 📈 Scalability Path

| Phase | Action | Impact |
|-------|--------|--------|
| 1 | Redis cache for feeds | 3x reduction in DB reads |
| 2 | Read replicas | Scale feed/search reads horizontally |
| 3 | CDN for images | Global image latency < 50ms |
| 4 | Elasticsearch for search | Full-text search with relevance scoring |
| 5 | Hybrid push/pull feed | Instant delivery for celebrity follows |
| 6 | Shard by user_id | Horizontal write scaling |

### Caching Strategy in Detail

> "Caching is layered. The first layer is the feed cache in Redis -- each user's personalized feed is serialized and stored with a 60-second TTL. This converts 11,500 QPS of database UNION queries into roughly 3,800 cache-miss queries. The second layer is per-pin metadata caching. When a pin appears in multiple feeds, its metadata (title, aspect_ratio, dominant_color, save_count) is fetched once from PostgreSQL and cached individually for 5 minutes. This reduces redundant row reads because popular pins appear in thousands of feeds simultaneously."

Board pin lists are also cached because users frequently revisit their own boards. The cache key includes the board ID and a version counter that increments on every add or remove operation. This avoids time-based staleness -- the board cache is always consistent with the database because any mutation explicitly invalidates it.

For image URLs, the CDN acts as a third cache layer. Thumbnail URLs include a content hash so they are cacheable indefinitely. When a user re-processes a pin (changing the thumbnail), the new thumbnail gets a new hash and a new URL, sidestepping cache invalidation entirely.

### Database Read Replica Topology

> "At production scale, I would deploy read replicas in each geographic region. Feed queries, search queries, and profile page reads hit the nearest replica. Only writes (pin creation, saves, follows, comments) go to the primary. Replication lag of 1-2 seconds is acceptable for feeds because users tolerate 60-second cache staleness anyway. The risk is a user creating a pin and not seeing it immediately on their own profile. To handle this, I apply a 'read-your-own-writes' guarantee by routing authenticated profile page requests to the primary for 5 seconds after any write operation."

---

## 🔍 Failure Handling and Resilience

> "Pinterest's backend must handle several failure modes gracefully. The image processing pipeline is the most failure-prone component because it depends on three external services: object storage, the message queue, and the database."

**Image worker failures**: If a worker crashes mid-processing, the RabbitMQ message is not acknowledged and redelivers to another worker. Each processing step is idempotent -- uploading a thumbnail to the same MinIO key overwrites cleanly, and the database UPDATE sets absolute values rather than increments. After three delivery attempts, the message moves to a dead letter queue, the pin status is set to 'failed', and an alert fires.

**Object storage outages**: The circuit breaker around MinIO opens after three consecutive failures within 30 seconds. While open, upload requests fail fast with a 503 instead of hanging. The pin is created with `status='processing'` and the upload job is queued. If MinIO recovers before the queue message expires, the worker picks it up and completes processing normally.

**Redis outages**: If Redis goes down, session creation fails (new logins are blocked), but existing sessions that have been validated within the last request still work because the application caches session data in memory for the duration of a request. Feed requests fall back to direct database queries without caching, increasing PostgreSQL load but maintaining availability. Rate limiting also degrades gracefully -- without Redis, rate limits are not enforced, which is acceptable for short outages but requires monitoring to prevent abuse.

**Database connection exhaustion**: The connection pool is configured with a maximum of 20 connections per API server instance. If all connections are in use, new requests queue for up to 5 seconds before returning a 503. This prevents cascade failures where one slow query starves all other requests.

---

## 📊 Observability

> "Observability for Pinterest's backend centers on three signals: latency distributions, error rates, and business metrics."

**Request latency**: Every API endpoint records a histogram of response times. The critical SLO is feed generation p99 under 200ms. If the p99 breaches 200ms, I investigate whether the cause is cache miss rate increase, database query plan regression, or network latency to Redis.

**Image processing metrics**: The worker records processing duration per step (download, metadata extraction, thumbnail generation, upload, database update). This breakdown identifies which step is slow. A spike in download duration points to MinIO issues; a spike in thumbnail generation points to a batch of unusually large images.

**Business metrics**: Counters for pins created, saves performed, follows established, and comments posted. These are not just for dashboards -- a sudden drop in pin creation rate could indicate an upload bug, not a traffic change. Correlating business metrics with error rates enables faster root-cause analysis.

**Structured logging**: All log entries are JSON with request ID, user ID, endpoint, duration, and status code. The request ID propagates from the API server through RabbitMQ messages to the worker, enabling end-to-end tracing of a pin from upload through processing to publication.

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Image processing | Async queue + workers | Sync in request handler | Non-blocking, scalable, retry-friendly |
| Feed generation | Pull + 60s cache | Fanout on write | No write amplification, acceptable latency |
| Engagement model | Save (with boards) | Like (simple toggle) | Higher-intent signal, matches Pinterest UX |
| Session storage | Redis + cookie | JWT | Immediate revocation, server-side state |
| Thumbnail format | WebP | JPEG | 25-35% smaller at equivalent quality |
| Search backend | PostgreSQL ILIKE | Elasticsearch | Simpler initial, clear migration path |
| Queue technology | RabbitMQ | Kafka | Job semantics fit, simpler operations |
