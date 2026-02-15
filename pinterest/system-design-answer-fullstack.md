# Pinterest - Full-Stack System Design Interview Answer

## 🎯 Problem Statement

> "Design Pinterest, an image pinning platform where users save images to organized collections called boards, displayed in a masonry grid layout."

"Pinterest combines two interesting technical challenges: a backend image processing pipeline that extracts metadata critical for layout, and a frontend masonry grid that uses that metadata to render variable-height items without layout shifts. The two halves are tightly coupled -- the backend's `aspect_ratio` and `dominant_color` extraction directly enables the frontend's zero-shift masonry layout. I will walk through both sides and show how they connect."

---

## 📋 Requirements

**Functional:**
- Upload images as Pins with title, description, destination link
- Organize Pins into Boards (curated collections)
- Save any Pin to own Boards
- Masonry grid layout with variable-height images
- Personalized feed from followed users + popular pins
- Search across pins, users, and boards
- Pin detail view with comments

**Non-Functional:**
- 450M MAU, 100M DAU
- Image processing < 30 seconds
- Feed p99 < 200ms
- Zero layout shift in masonry grid
- 60fps scrolling through hundreds of pins

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│  React + TanStack Router + Zustand              │
│                                                 │
│  ┌─────────────┐  ┌──────────┐  ┌───────────┐  │
│  │ MasonryGrid │  │ PinCard  │  │ SaveBoard │  │
│  │ (virtual)   │  │ (aspect  │  │ (modal)   │  │
│  │             │  │  ratio)  │  │           │  │
│  └──────┬──────┘  └──────────┘  └───────────┘  │
│         │ uses aspect_ratio, dominant_color      │
└─────────┼───────────────────────────────────────┘
          │
          │ HTTP/JSON
          │
┌─────────▼───────────────────────────────────────┐
│                   Backend                        │
│  Node.js + Express                              │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Pin API  │  │ Feed API │  │ Board API    │  │
│  └────┬─────┘  └────┬─────┘  └──────────────┘  │
│       │              │                          │
│  ┌────▼──────────────▼────┐  ┌──────────────┐  │
│  │    PostgreSQL          │  │ Redis/Valkey  │  │
│  └────────────────────────┘  └──────────────┘  │
│       │                                         │
│  ┌────▼─────────┐     ┌───────────────────┐    │
│  │  RabbitMQ    │────▶│  Image Worker     │    │
│  └──────────────┘     │  (Sharp)          │    │
│                       │  -> aspect_ratio   │    │
│                       │  -> dominant_color  │    │
│                       │  -> thumbnail      │    │
│                       └────────┬──────────┘    │
│                                │               │
│                       ┌────────▼──────────┐    │
│                       │  MinIO (S3)       │    │
│                       └───────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## 💾 Data Model

### Core Tables

**pins** -- The central entity. Key fields beyond standard CRUD:
- `aspect_ratio FLOAT` -- height/width ratio, extracted by worker
- `dominant_color VARCHAR(7)` -- hex color placeholder, extracted by worker
- `status VARCHAR(20)` -- 'processing' -> 'published' -> 'failed'
- `save_count INT` -- primary engagement metric (not likes)
- `image_width INT`, `image_height INT` -- pixel dimensions

**boards** -- User-created collections with UNIQUE(user_id, name)

**board_pins** -- Many-to-many with position ordering

**pin_saves** -- Three-way relationship: UNIQUE(pin_id, user_id, board_id)

**follows** -- Social graph with CHECK(follower_id != following_id)

> "The `aspect_ratio` field is the bridge between backend and frontend. The backend worker extracts it during image processing. The frontend reads it to calculate exact pixel heights before images load. This eliminates layout shift -- the single most important UX characteristic of Pinterest's grid."

---

## 🔧 Deep Dive 1: End-to-End Image Pipeline (Backend + Frontend)

"Let me trace an image from upload through to rendering in the masonry grid."

### Backend: Upload and Processing

```
1. Client POST /api/v1/pins (multipart)
   └── API stores original in MinIO
   └── Creates pin record: status='processing'
   └── Publishes job to RabbitMQ
   └── Returns pin_id immediately

2. Image Worker consumes job
   └── Downloads original from MinIO
   └── sharp.metadata() -> width=800, height=1200
   └── aspect_ratio = 1200/800 = 1.5
   └── sharp.stats() -> dominant RGB -> "#a8b8c8"
   └── sharp.resize(300) -> WebP thumbnail
   └── Uploads thumbnail to MinIO
   └── UPDATE pins SET aspect_ratio=1.5, dominant_color='#a8b8c8', status='published'
```

### Frontend: Rendering in Masonry Grid

```
3. Feed API returns pins with aspect_ratio, dominant_color

4. useMasonryLayout hook:
   └── columnWidth = 236px (from container / column count)
   └── For pin with aspect_ratio=1.5:
       pinHeight = 236 * 1.5 = 354px
   └── Place at shortest column position

5. PinCard renders:
   └── Container: padding-bottom: 150%, background: #a8b8c8
   └── Image: opacity: 0, loading="lazy"
   └── onLoad: transition opacity to 1 (300ms)
```

### The Connection

> "This is why the full-stack perspective matters. A backend-only engineer might store image dimensions without understanding why `aspect_ratio` specifically matters. A frontend-only engineer would struggle with layout shift without realizing the backend must precompute this during processing. The aspect ratio extracted by the Sharp worker flows through the database, through the API response, into the masonry layout hook, and finally controls the CSS padding-bottom that reserves exact space before any image loads."

### Trade-off: Where to Compute Aspect Ratio

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Backend (worker) | Consistent, one-time cost, available before image loads | Requires async processing pipeline |
| ❌ Frontend (onLoad) | Simpler backend | Layout shift, reflow on every image load, cannot virtualize |

> "Computing aspect ratio on the frontend means the grid cannot know heights until images fully load. With 30 images in a grid, this causes 30 sequential layout reflows -- the grid visually 'jumps' as each image arrives. Precomputing in the backend eliminates this entirely. The operational cost is one Sharp metadata call per image (< 50ms), which happens during thumbnail generation anyway."

---

## 🔧 Deep Dive 2: Masonry Layout with Virtualization

### The Algorithm

```
┌─ Column 0 ─┐ ┌─ Column 1 ─┐ ┌─ Column 2 ─┐ ┌─ Column 3 ─┐
│ Pin A       │ │ Pin B       │ │ Pin C       │ │ Pin D       │
│ (ratio 1.5) │ │ (ratio 0.75)│ │ (ratio 1.0) │ │ (ratio 1.25)│
│ 354px       │ │ 177px       │ │ 236px       │ │ 295px       │
├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤
│             │ │ Pin F       │ │ Pin G       │ │             │
│ Pin E       │ │ (ratio 1.0) │ │ (ratio 0.6) │ │ Pin H       │
│ (ratio 0.8) │ │ 236px       │ │ 142px       │ │ (ratio 1.3) │
│ 189px       │ │             │ │             │ │ 307px       │
│             │ │             │ │ ← shortest  │ │             │
│ heights:    │ │ heights:    │ │ Pin I next  │ │ heights:    │
│ 559px       │ │ 429px       │ │ here        │ │ 618px       │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

"Each new pin goes to the shortest column. The columnHeights array tracks the bottom edge of each column. Items are absolutely positioned based on their column index and accumulated height."

### Why Not CSS Columns

> "CSS `column-count` is the natural CSS solution for masonry, but it has a fatal flaw for Pinterest: items flow top-to-bottom within each column, not left-to-right across columns. This means items are ordered column-first (A, E, I in column 0, then B, F in column 1), not row-first (A, B, C, D across the top). More critically, CSS columns render ALL DOM nodes -- with 500 pins, that is 500 image elements, 500 intersection observers, 500 potential network requests. Absolute positioning lets me calculate which items are visible and render only those, reducing DOM nodes from 500 to ~30 (visible viewport + overscan)."

### ResizeObserver for Responsiveness

"I attach a `ResizeObserver` to the grid container rather than listening to `window.resize`. This correctly handles cases where the container width changes without the viewport changing (sidebar collapse, layout mode switch). The observer fires, I recalculate column count and width, and the masonry hook recomputes all positions."

---

## 🔧 Deep Dive 3: Save-Based Engagement (Full Stack)

### Why Saves Instead of Likes

> "Pinterest's engagement model is fundamentally different from Instagram's likes. A save is a high-intent action -- the user is collecting content for future reference. This affects both the backend data model and the frontend interaction design."

### Backend: Three-Way Relationship

```
pin_saves table:
  UNIQUE(pin_id, user_id, board_id)

  ┌──────┐     ┌───────────┐     ┌──────┐
  │ User │─────│ pin_saves │─────│ Pin  │
  └──────┘     └─────┬─────┘     └──────┘
                     │
                ┌────▼────┐
                │  Board  │
                └─────────┘
```

"Unlike a binary likes table (user + post), saves require a board destination. This creates a three-column unique constraint and means the frontend must present a board selection UI."

### Frontend: Board Picker Modal

```
Hover Pin ──▶ Show Overlay ──▶ Click "Save" ──▶ Open Modal
                                                     │
                                              ┌──────▼──────┐
                                              │ Fetch user's│
                                              │ boards      │
                                              │ (lazy load) │
                                              └──────┬──────┘
                                                     │
                                              ┌──────▼──────┐
                                              │ Board List  │
                                              │ + "Create"  │
                                              └──────┬──────┘
                                                     │
                                              Select / Create
                                                     │
                                              ┌──────▼──────┐
                                              │ POST save   │
                                              │ Optimistic  │
                                              └─────────────┘
```

### Full-Stack Coordination

1. **Backend** increments `pin.save_count` and `board.pin_count` atomically
2. **Backend** uses `ON CONFLICT DO NOTHING` for idempotent saves
3. **Frontend** optimistically updates UI before API response
4. **Frontend** lazily loads board list only when modal opens
5. **Frontend** allows inline board creation from the modal

> "The idempotency on the backend (unique constraint + ON CONFLICT) lets the frontend be aggressive with optimistic updates. Even if a double-tap sends two save requests, the backend handles it gracefully -- no duplicate entries, no count over-increment."

---

## 🔄 Feed Generation (Full Stack)

### Backend: Pull Model

"I use a pull model: when the feed is requested, I query pins from followed users UNION popular pins, sorted by recency, and cache the result for 60 seconds."

### Frontend: Infinite Scroll

"The frontend maintains feed state in Zustand (pins array + cursor). On scroll within 500px of bottom, I request the next page. The cursor is a `created_at` timestamp, avoiding offset-based pagination issues."

### Trade-off: Pull vs Push

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Pull + cache | Simple, no write amplification | Read latency, stale for up to 60s |
| ❌ Push (fanout) | Instant delivery | 2B+ fanout writes/day, wasted for inactive users |

> "Pinterest's use case tolerates 60-second staleness. Users browse a visual inspiration feed, not a real-time news feed. The pull model with caching reduces read QPS by 60-70% while keeping implementation simple. At production scale, I would add a hybrid model: push for users following < 10K accounts, pull with longer cache for others."

---

## 📱 Responsive Design

| Viewport | Columns | Column Width | UX Adaptation |
|----------|---------|--------------|---------------|
| < 500px | 2 | ~230px | Stack header, hide text |
| 500-768px | 3 | ~230px | Compact header |
| 768-1024px | 4 | ~236px | Full header |
| 1024-1280px | 5 | ~236px | Full layout |
| > 1280px | 6 | ~236px | Maximum density |

---

## 🔒 Security (Full Stack)

| Layer | Measure |
|-------|---------|
| Auth | Session-based with Redis, bcrypt password hashing |
| API | Rate limiting per endpoint (10 pins/min, 5 logins/min) |
| Upload | MIME type whitelist, 20MB file size limit |
| XSS | React's default escaping, no dangerouslySetInnerHTML |
| CSRF | SameSite=Lax cookies |
| SQL | Parameterized queries |

---

## ⚡ Performance Budget

| Metric | Target | How |
|--------|--------|-----|
| FCP | < 1.5s | Vite code splitting, small JS bundles |
| LCP | < 2.5s | Dominant color placeholders, lazy images |
| CLS | 0 | Pre-calculated aspect ratios |
| FID | < 100ms | Virtualized grid, minimal JS on scroll |
| Scroll FPS | 60fps | Only ~30 DOM nodes rendered at a time |

---

## 📈 Scalability Path

| Phase | Backend | Frontend |
|-------|---------|----------|
| 1 | Redis feed cache | Virtualized masonry grid |
| 2 | Read replicas | Service worker for image caching |
| 3 | CDN for images | WebP/AVIF format negotiation |
| 4 | Elasticsearch | Autocomplete with debounced search |
| 5 | Shard by user_id | Micro-frontend for pin detail |

### Scaling the Image Pipeline

> "The image processing pipeline is the first bottleneck at scale. At 2M pins/day (23 pins/sec), a single worker processing each image in 3 seconds can handle about 0.33 pins/sec. I need roughly 70 worker instances to keep up. The beauty of the queue-based architecture is that adding workers requires zero changes to the API layer -- I simply deploy more consumer instances. RabbitMQ distributes jobs round-robin across connected consumers."

If processing volume becomes bursty (marketing campaigns, viral content waves), I use autoscaling based on queue depth. When the RabbitMQ queue exceeds 1,000 pending messages, I scale up workers. When it drops below 100, I scale down. This keeps costs proportional to actual load rather than peak capacity.

### Frontend Performance at Scale

> "As the pin catalog grows, the frontend faces different scaling challenges. The masonry grid itself scales well because virtualization keeps DOM node count constant regardless of total pins. The real challenge is state management for infinite scroll -- after loading 500 pins, the Zustand store holds significant data in memory. I mitigate this by evicting pins that are far from the current scroll position, keeping only the visible window plus 200 pins in each direction. Evicted pins are refetched on scroll-back, but this is rare because users typically scroll forward."

Image loading at scale requires a content-aware strategy. Not all images in the viewport need to load simultaneously. I prioritize images in columns that are currently visible and defer images in columns that are partially off-screen. Combined with the CDN serving images from the nearest edge location, this keeps the perceived load time under 500ms for most pins.

---

## 🔄 Failure Handling (Full Stack)

### Backend Failures

> "The most common failure mode is the image worker failing mid-processing. Since each step is idempotent (uploading to the same MinIO key overwrites cleanly, database UPDATEs set absolute values), retries are safe. After three failed attempts, the message routes to a dead letter queue, the pin status becomes 'failed', and the user sees a failed upload notification in the UI."

Circuit breakers wrap external service calls (MinIO, RabbitMQ, Redis). When the error rate exceeds 50% over 10 requests, the circuit opens and requests fail fast for 30 seconds before testing again. This prevents cascade failures where one degraded service causes all API requests to time out.

### Frontend Error Recovery

When the backend returns an error during a save operation, the frontend rolls back the optimistic update -- the save count decrements and the saved state reverts. For image uploads, the frontend shows a retry button if the initial upload fails, preserving the user's selected image and form data so they do not need to start over. Network disconnections during feed loading show a non-intrusive banner with a "Retry" action rather than clearing the existing feed content.

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Aspect ratio source | Backend (worker) | Frontend (onLoad) | Zero layout shift, enables virtualization |
| Masonry approach | Absolute positioning | CSS columns | Virtualizable, row-first ordering |
| Placeholder strategy | Dominant color (7 bytes) | Blur-up LQIP (2-3KB) | 99.7% less data, sufficient quality |
| Image processing | Async (queue + worker) | Sync (in request) | Non-blocking, independently scalable |
| Feed model | Pull + 60s cache | Push (fanout) | Simple, acceptable latency for visual browsing |
| Engagement model | Save (with boards) | Like (binary toggle) | Higher-intent signal, curated collections |
| State management | Zustand (2 stores) | Redux | Minimal API surface for small state needs |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler auth flow |
