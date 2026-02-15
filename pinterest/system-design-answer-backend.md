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
