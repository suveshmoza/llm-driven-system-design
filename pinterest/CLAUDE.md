# Pinterest - Image Pinning Platform - Development with Claude

## Project Context

Building an image pinning platform to understand masonry layout with variable-height virtualization, image processing pipelines, save-based engagement models (boards), and feed generation for visual content discovery.

**Key Learning Goals:**
- Design masonry grid with variable-height items and virtualization
- Implement image processing pipeline (dimensions, aspect ratio, dominant color extraction)
- Build save-based engagement model (boards) vs like-based engagement
- Understand visual content feed ranking
- Handle async image processing with message queues

---

## Key Challenges Explored

### 1. Masonry Layout with Virtualization

**Problem**: Pinterest's signature masonry grid places items of varying heights into columns, finding the shortest column for each new item. With hundreds of pins, rendering all DOM nodes kills performance.

**Solution: Column-height tracking + absolute positioning**
- `useMasonryLayout` hook tracks column heights, assigns each pin to the shortest column
- Each pin's height is pre-calculated from `aspect_ratio` stored in the database
- Items are absolutely positioned within a relative container
- `@tanstack/react-virtual` provides scroll-based rendering optimization

**Why aspect_ratio matters**: Without knowing image dimensions before render, the layout jumps as images load. By storing `height/width` ratio during image processing, we can calculate exact pixel heights before any image downloads.

### 2. Image Processing Pipeline

**Challenge**: Users upload raw images of varying sizes and formats. We need dimensions, aspect ratio, dominant color (for placeholder), and a thumbnail.

**Solution: RabbitMQ + Sharp worker**
```
Upload -> MinIO (original) -> RabbitMQ job -> Worker -> {
  1. Extract width/height from metadata
  2. Calculate aspect_ratio = height / width
  3. Extract dominant color via sharp.stats()
  4. Generate 300px-wide thumbnail
  5. Upload thumbnail to MinIO
  6. Update pin record: status='published'
}
```

### 3. Save-Based Engagement Model

**Decision**: Pinterest's engagement is save-based, not like-based. Users save pins to boards, creating curated collections. This fundamentally changes the data model compared to Instagram/Twitter.

**Implications:**
- No `likes` table; instead `pin_saves` with board reference
- `save_count` on pins indicates popularity, not `like_count`
- Boards are organizational units with many-to-many relationship to pins
- The same pin can appear in multiple boards

### 4. Dominant Color Extraction

**Why**: When images load slowly, showing a colored placeholder (instead of grey) creates a much smoother experience. Pinterest shows the dominant color as background while the image loads.

**How**: `sharp.stats()` returns channel statistics including dominant RGB values. We convert to hex and store as `dominant_color` on the pin record.

---

## Development Phases

### Phase 1: Infrastructure (Complete)
- [x] PostgreSQL schema (users, pins, boards, board_pins, follows, comments, saves)
- [x] MinIO for image storage
- [x] RabbitMQ for async processing
- [x] Valkey for session and cache

### Phase 2: Image Pipeline (Complete)
- [x] Multer multipart upload
- [x] Image worker with Sharp
- [x] Dimension extraction and aspect ratio calculation
- [x] Dominant color extraction
- [x] Thumbnail generation (300px wide, WebP)

### Phase 3: Core API (Complete)
- [x] Auth (register, login, logout, me)
- [x] Pin CRUD with image upload
- [x] Board CRUD
- [x] Save/unsave pins to boards
- [x] Follow/unfollow users
- [x] Pin comments
- [x] Feed (personalized + discover)
- [x] Search (pins, users, boards)

### Phase 4: Frontend (Complete)
- [x] Masonry grid with useMasonryLayout hook
- [x] PinCard with dominant color placeholder
- [x] Pin detail view with comments
- [x] Profile page with Created/Saved tabs
- [x] Board view
- [x] Create pin with image upload
- [x] Search
- [x] Auth (login/register)

---

## Design Decisions Log

### Decision 1: aspect_ratio = height / width
**Context**: Need to calculate pin height before image loads
**Decision**: Store as height/width (not width/height)
**Rationale**: `columnWidth * aspectRatio` gives pixel height directly. No division at render time.

### Decision 2: Pull model for feed
**Context**: Need to show pins from followed users + popular pins
**Decision**: Simple pull model with UNION query
**Trade-off**: Higher read latency but much simpler than fanout-on-write
**Mitigation**: 60-second cache TTL in Valkey

### Decision 3: Session-based auth (not JWT)
**Context**: Need simple auth for learning project
**Decision**: Express sessions in Valkey
**Rationale**: Immediate revocation, simpler than JWT for web-only app

### Decision 4: WebP thumbnails
**Context**: Need efficient thumbnail format
**Decision**: Convert all thumbnails to WebP at 80% quality
**Rationale**: 25-35% smaller than JPEG at equivalent quality

### Decision 5: picsum.photos for seed data
**Context**: Need realistic-looking images in seed data without storing actual files
**Decision**: Use `https://picsum.photos/id/{N}/800/{height}` URLs
**Rationale**: Pre-set dimensions and aspect ratios simulate already-processed images
