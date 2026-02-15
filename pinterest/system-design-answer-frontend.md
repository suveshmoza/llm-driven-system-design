# Pinterest - Frontend System Design Interview Answer

## 🎯 Problem Statement

> "Design the frontend for Pinterest, an image pinning platform with a masonry grid layout."

"Pinterest's frontend is distinctive because of its masonry grid -- variable-height images arranged in columns where each new item fills the shortest column. This is the core technical challenge. I need to handle variable-height virtualization, image loading with colored placeholders, and responsive column counts. I will focus on the masonry layout algorithm, image loading strategy, and the save-to-board interaction pattern."

---

## 📋 Requirements

**Functional:**
- Masonry grid of pins with variable heights
- Responsive column count (2 on mobile, 6 on desktop)
- Infinite scroll with lazy loading
- Pin detail view with comments
- Create pin with image upload and preview
- Save pin to board (modal with board picker)
- User profiles with Created/Saved tabs
- Search with results in masonry layout

**Non-Functional:**
- First meaningful paint < 1.5 seconds
- Smooth 60fps scrolling through hundreds of pins
- No layout shift when images load
- Works across screen sizes (320px to 2560px)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    React App                         │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  TanStack   │  │   Zustand   │  │  Services  │  │
│  │  Router     │  │   Stores    │  │  (API)     │  │
│  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘  │
│         │                │               │          │
│  ┌──────▼──────────────────────────────────────┐    │
│  │              Route Components               │    │
│  │  / (Home + Masonry)  /pin/:id  /profile/:u  │    │
│  └──────┬──────────────────────────────────────┘    │
│         │                                           │
│  ┌──────▼──────────────────────────────────────┐    │
│  │           Shared Components                  │    │
│  │  MasonryGrid  PinCard  Header  SaveToBoard  │    │
│  └──────┬──────────────────────────────────────┘    │
│         │                                           │
│  ┌──────▼──────────────────────────────────────┐    │
│  │              Hooks + Utils                   │    │
│  │  useMasonryLayout  formatNumber  formatTime │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Technology Choices

| Technology | Purpose |
|-----------|---------|
| React 19 + TypeScript | UI framework with type safety |
| TanStack Router | File-based routing with type-safe params |
| @tanstack/react-virtual | Scroll-based virtualization |
| Zustand | Lightweight global state (auth, feed) |
| Tailwind CSS | Utility-first styling |
| Vite | Fast dev server and build tool |

---

## 🔧 Deep Dive 1: Masonry Layout Algorithm

"This is the heart of Pinterest's frontend. The masonry layout places variable-height items into columns, always filling the shortest column first."

### The Algorithm (useMasonryLayout hook)

```
Input:
  - pins: array with aspect_ratio (height/width)
  - columnCount: number (responsive, based on viewport)
  - columnWidth: number (calculated from container width)

Process:
  columnHeights = [0, 0, 0, ...]  // one per column

  for each pin:
    shortestCol = index of min(columnHeights)
    imageHeight = columnWidth * pin.aspect_ratio
    totalHeight = imageHeight + PADDING (title, avatar below)

    position = {
      column: shortestCol,
      top: columnHeights[shortestCol],
      left: shortestCol * (columnWidth + GAP)
    }

    columnHeights[shortestCol] += totalHeight + GAP

Output:
  - items: array of { pin, column, top, height }
  - totalHeight: max(columnHeights)
```

### Why Absolute Positioning (Not CSS Columns)

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Absolute positioning | Precise height control, virtualizable, predictable | Must calculate positions manually |
| ❌ CSS columns | Simple CSS, browser handles layout | Cannot virtualize, no control over item order, items flow top-to-bottom not left-to-right |
| ❌ CSS Grid with auto-rows | Good for uniform items | Cannot handle truly variable heights without JS |

> "I chose absolute positioning because it is the only approach that enables virtualization. CSS columns render all DOM nodes regardless of visibility -- with 500 pins, that is 500 img elements loaded simultaneously. Absolute positioning lets me know the exact pixel position of every item, so I can render only what is visible plus a small overscan buffer. The trade-off is complexity: I must manage positions myself rather than letting the browser's layout engine handle it. But for a masonry grid with potentially thousands of items, this complexity is justified by the 10-50x reduction in DOM nodes."

### Responsive Column Count

```
Container Width ──▶ ResizeObserver ──▶ Column Count
                                           │
                                    ┌──────▼──────┐
                                    │ Recalculate  │
                                    │ Layout       │
                                    └─────────────┘
```

| Viewport Width | Columns |
|---------------|---------|
| < 500px | 2 |
| 500-768px | 3 |
| 768-1024px | 4 |
| 1024-1280px | 5 |
| > 1280px | 6 |

"I use a `ResizeObserver` on the container element rather than media queries. This lets the masonry grid adapt to any container width, not just viewport breakpoints -- useful if the grid is inside a sidebar layout."

---

## 🔧 Deep Dive 2: Image Loading Strategy

### The Problem

"Images of varying sizes arrive from the network at different times. Without a strategy, the grid would show grey rectangles that pop into colorful images, causing jarring visual shifts."

### The Solution: Dominant Color Placeholders

```
┌─────────────────────────────────┐
│  Phase 1: Placeholder          │
│  ┌─────────────┐               │
│  │             │  Background:  │
│  │  #a8b8c8    │  dominant_color│
│  │  (colored   │  from backend │
│  │  rectangle) │               │
│  │             │  Height:      │
│  │             │  aspect_ratio │
│  └─────────────┘  * colWidth   │
└─────────────────────────────────┘
         │
         ▼ (image loads)
┌─────────────────────────────────┐
│  Phase 2: Image Visible        │
│  ┌─────────────┐               │
│  │             │  opacity: 0   │
│  │  [actual    │  ──▶ 1       │
│  │   image]    │  (300ms fade) │
│  │             │               │
│  └─────────────┘               │
└─────────────────────────────────┘
```

### PinCard Implementation Strategy

1. **Container div** has `padding-bottom: ${aspectRatio * 100}%` and `background-color: ${dominantColor}`
2. **Image** is absolutely positioned inside, starts with `opacity: 0`
3. **onLoad event** transitions opacity to 1 with a 300ms CSS transition
4. **Result**: smooth fade from colored placeholder to actual image, with zero layout shift

### Trade-off: Placeholder Strategies

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Dominant color + aspect ratio | Zero layout shift, smooth loading, low data cost (7 bytes) | Requires backend preprocessing |
| ❌ Blur-up (LQIP) | Beautiful progressive load | Requires generating and serving base64 thumbnails (~2KB each) |
| ❌ Grey skeleton | Simple | Generic, no visual connection to content |

> "I chose dominant color because it provides 90% of the visual benefit of blur-up (LQIP) at 0.3% of the data cost. A hex color is 7 bytes; a base64 blur-up thumbnail is 2-3KB. With a grid showing 20-40 pins, that is 140 bytes vs 60KB of placeholder data. The dominant color extracted by the backend's Sharp worker is consistent and zero-cost to the client."

---

## 🔧 Deep Dive 3: Save-to-Board Interaction

"Unlike Instagram's one-tap like, Pinterest's save requires a board selection. This creates a more complex interaction flow."

### Interaction Flow

```
User hovers pin ──▶ Save button appears ──▶ Click Save
                                                 │
                                          ┌──────▼──────┐
                                          │ Board Picker │
                                          │ Modal        │
                                          │              │
                                          │ ○ Board A    │
                                          │ ○ Board B    │
                                          │ + Create new │
                                          └──────┬──────┘
                                                 │
                                          Select board
                                                 │
                                          ┌──────▼──────┐
                                          │ API: POST   │
                                          │ /pins/:id/  │
                                          │ save        │
                                          └─────────────┘
```

### Key UX Decisions

1. **Lazy board loading**: Board list is fetched only when the save modal opens, not on every pin render
2. **Create board inline**: Users can create a new board directly from the modal without navigating away
3. **Auto-save to new board**: After creating a board, the pin is automatically saved to it
4. **Hover-only save button**: The save button appears only on hover to keep the grid clean

### Optimistic Updates

> "When a user saves a pin, I optimistically update the pin's `isSaved` state and `saveCount` before the API responds. If the save fails, I revert. This makes the interaction feel instant even on slow networks. The trade-off is temporary UI inconsistency if the save fails, but save failures are rare (< 0.1% in normal operation) and the UX benefit of instant feedback justifies the complexity of rollback logic."

---

## 📁 Component Architecture

### Route Structure

```
routes/
├── __root.tsx            # Layout with Header
├── index.tsx             # Home feed (masonry grid)
├── login.tsx             # Login form
├── register.tsx          # Registration form
├── create.tsx            # Pin creation with upload
├── pin.$pinId.tsx        # Pin detail with comments
├── profile.$username.tsx # User profile (Created/Saved tabs)
└── board.$boardId.tsx    # Board view with pins
```

### Component Hierarchy

```
App
├── Header (fixed, search bar, nav)
├── MasonryGrid
│   └── PinCard (per pin)
│       ├── Placeholder (dominant color)
│       ├── Image (lazy loaded)
│       └── Overlay (hover: save button, title)
├── SaveToBoard (modal)
│   ├── BoardList
│   └── CreateBoardInline
├── CreatePin
│   ├── DropZone / FileInput
│   ├── ImagePreview
│   └── PinDetails form
└── PinDetail
    ├── FullImage
    ├── PinInfo (title, description, author)
    └── Comments
```

### State Management

| Store | State | Purpose |
|-------|-------|---------|
| authStore | user, isLoading | Authentication state |
| pinStore | feedPins, feedCursor, feedLoading | Feed pagination |

"I use Zustand for two global stores: auth (persists across routes) and pin feed (preserves scroll position when navigating away and back). Component-local state handles everything else -- pin detail data, board lists, search results. This keeps the global state surface small and predictable."

---

## 🔄 Data Flow

### Feed Loading

```
Mount ──▶ Check auth ──▶ Load feed (API call)
                              │
                        ┌─────▼─────┐
                        │  Zustand  │
                        │  pinStore │
                        │  feedPins │
                        └─────┬─────┘
                              │
                        ┌─────▼─────┐
                        │  Masonry  │
                        │  Layout   │
                        │  Hook     │
                        └─────┬─────┘
                              │
                        ┌─────▼─────┐
                        │  Render   │
                        │  Grid     │
                        └───────────┘
```

### Infinite Scroll

"I detect when the user scrolls within 500px of the bottom using a scroll event listener on the container. When triggered and `feedCursor` exists, I load the next page of pins and append to the Zustand store. The masonry layout hook automatically recalculates positions with the new items."

---

## 📱 Responsive Design

"Pinterest's responsive behavior is entirely column-count-based. The grid adapts fluidly because:"

1. Container width drives column count (via ResizeObserver)
2. Column width = (containerWidth - gaps) / columnCount
3. Pin height = columnWidth * aspectRatio

"No media queries needed for the grid itself. Tailwind handles component-level responsive changes (header layout, pin detail view flexbox direction)."

---

## ⚡ Performance Optimizations

| Optimization | Impact |
|-------------|--------|
| Dominant color placeholders | Zero layout shift, smooth loading |
| Absolute positioning | Enables virtualization of masonry grid |
| Lazy image loading | Only load images near viewport |
| Cursor-based pagination | Efficient server-side queries |
| Feed state in Zustand | Preserve scroll position on navigation |
| ResizeObserver (not resize event) | Efficient container width tracking |

### Image Decode Optimization

> "Beyond lazy loading, I use the browser's `decode()` API on Image objects before inserting them into the DOM. This moves JPEG/WebP decoding off the main thread, preventing frame drops during scroll. Without this, a burst of 6-8 images decoding simultaneously can cause a 50-100ms jank spike, dropping scroll FPS from 60 to below 30. With async decode, the image is ready to paint immediately when its opacity transitions to 1."

### Memory Management for Long Sessions

Pinterest users often browse for extended periods, scrolling through hundreds of pins. Without memory management, the Zustand store accumulates pin data indefinitely, and off-screen image elements retain decoded bitmap data. I address this by setting a maximum pin retention window -- only pins within 200 items of the current scroll position are kept in state. Pins outside this window are evicted from the store and their corresponding DOM nodes are removed by the virtualizer. If the user scrolls back, the evicted pins are re-fetched from the API using cursor-based pagination. This caps memory usage at approximately 15-20MB regardless of session length.

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Masonry approach | Absolute positioning | CSS columns | Enables virtualization, precise control |
| Placeholder | Dominant color | Blur-up (LQIP) | 99.7% less data, sufficient visual quality |
| State management | Zustand (2 stores) | Redux / Context | Minimal boilerplate, good for small state surface |
| Routing | TanStack Router | React Router | File-based, type-safe params |
| Column responsiveness | ResizeObserver | Media queries | Adapts to container, not just viewport |
| Save interaction | Modal board picker | Inline dropdown | Matches Pinterest UX, room for board creation |
