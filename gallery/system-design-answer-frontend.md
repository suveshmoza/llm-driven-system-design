# Image Gallery - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

---

## 🎯 Requirements Clarification (2 min)

### Functional Requirements

- Display images in three layout modes: slideshow, masonry grid, and tiles grid
- Tab-based switching between layout modes with instant transitions
- Full-screen lightbox view with keyboard navigation and backdrop overlay
- Responsive design that adapts across desktop, tablet, and mobile viewports
- Slideshow auto-play with play/pause toggle and thumbnail strip

### Non-Functional Requirements

- First Contentful Paint under 3 seconds on broadband connections
- Smooth 60fps animations for hover effects, layout transitions, and lightbox open/close
- Full keyboard accessibility across all views including focus trapping in modals
- Cross-browser compatibility with all modern browsers (Chrome, Firefox, Safari, Edge)

### UI/UX Requirements

- Visual feedback on hover (scale, shadow) and focus (outline ring) states
- Intuitive navigation matching established gallery patterns (arrows, thumbnails, click-to-open)
- Mobile-friendly touch targets with minimum 44x44px hit areas

---

## 🏗️ High-Level Architecture (3 min)

### Component Hierarchy

                ┌─────────────────────────────────────────────────────────┐
                │                          App                            │
                │                                                         │
                │  ┌─────────────────────────────────────────────────┐   │
                │  │                     Header                      │   │
                │  └─────────────────────────────────────────────────┘   │
                │                                                         │
                │  ┌─────────────────────────────────────────────────┐   │
                │  │  GalleryTabs                                    │   │
                │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐     │   │
                │  │  │ Slideshow │ │  Masonry  │ │   Tiles   │     │   │
                │  │  └───────────┘ └───────────┘ └───────────┘     │   │
                │  └─────────────────────────────────────────────────┘   │
                │                                                         │
                │  ┌─────────────────────────────────────────────────┐   │
                │  │  GalleryContent (renders active view)           │   │
                │  │  ┌─────────────────────────────────────────┐   │   │
                │  │  │  SlideshowView                          │   │   │
                │  │  │  ├── MainImage (16:9 aspect ratio)      │   │   │
                │  │  │  ├── NavigationArrows (prev / next)     │   │   │
                │  │  │  ├── PlayPauseControl                   │   │   │
                │  │  │  └── ThumbnailStrip (horizontal scroll) │   │   │
                │  │  └─────────────────────────────────────────┘   │   │
                │  │  ┌─────────────────────────────────────────┐   │   │
                │  │  │  MasonryView                            │   │   │
                │  │  │  └── MasonryItem x N (variable heights) │   │   │
                │  │  └─────────────────────────────────────────┘   │   │
                │  │  ┌─────────────────────────────────────────┐   │   │
                │  │  │  TilesView                              │   │   │
                │  │  │  └── TileItem x N (uniform squares)     │   │   │
                │  │  └─────────────────────────────────────────┘   │   │
                │  └─────────────────────────────────────────────────┘   │
                │                                                         │
                │  ┌─────────────────────────────────────────────────┐   │
                │  │  Lightbox (Portal to document.body)             │   │
                │  │  ├── LightboxImage                             │   │
                │  │  ├── NavigationArrows                          │   │
                │  │  └── CloseButton                               │   │
                │  └─────────────────────────────────────────────────┘   │
                └─────────────────────────────────────────────────────────┘

### State Flow

                ┌──────────────────────────────────────────┐
                │              Zustand Store                │
                ├──────────────────────────────────────────┤
                │  activeTab: Slideshow | Masonry | Tiles  │
                │  slideshowIndex: number                  │
                │  isPlaying: boolean                      │
                │  lightboxImage: number or null           │
                │  images: ImageData[]                     │
                └──────┬─────────────┬──────────────┬──────┘
                       │             │              │
                       ▼             ▼              ▼
                 ┌──────────┐ ┌──────────┐  ┌───────────┐
                 │   Tabs   │ │ Gallery  │  │ Lightbox  │
                 │Component │ │  Views   │  │   Modal   │
                 └──────────┘ └──────────┘  └───────────┘

---

## 🎨 Deep Dive: CSS Layout Techniques (10 min)

### A. Slideshow Layout (Flexbox + Absolute Positioning)

> "The slideshow uses a flex column layout with a relative-positioned main image container. Navigation arrows and the play/pause control sit absolutely positioned within the container, letting them float over the image without affecting document flow."

                ┌──────────────────────────────────────────────────────┐
                │                   SlideshowView                      │
                │                                                      │
                │  ┌──────────────────────────────────────────────┐   │
                │  │  main container (relative, aspect-ratio 16/9)│   │
                │  │                                              │   │
                │  │  ┌────┐                            ┌────┐   │   │
                │  │  │ <- │                            │ -> │   │   │
                │  │  │prev│      [ Main Image ]        │next│   │   │
                │  │  │    │    (object-fit: contain)    │    │   │   │
                │  │  └────┘                            └────┘   │   │
                │  │                                              │   │
                │  │                             ┌────────────┐  │   │
                │  │                             │ Play/Pause │  │   │
                │  │                             └────────────┘  │   │
                │  └──────────────────────────────────────────────┘   │
                │                                                      │
                │  ┌──────────────────────────────────────────────┐   │
                │  │  ThumbnailStrip (horizontal scroll, gap 8px) │   │
                │  │  [img] [img] [img] [img] [img] [img] ...    │   │
                │  └──────────────────────────────────────────────┘   │
                │                                                      │
                │  Keyboard Controls:                                  │
                │  ├── ArrowLeft ──▶ prevSlide()                      │
                │  ├── ArrowRight ──▶ nextSlide()                     │
                │  └── Space ──▶ toggle isPlaying                     │
                │                                                      │
                │  Auto-play: 3-second interval when isPlaying=true   │
                └──────────────────────────────────────────────────────┘

The slideshow container uses flex-direction column with a 1rem gap. The main image wrapper enforces a 16:9 aspect ratio and overflow hidden. Navigation arrows are absolutely positioned at top 50% with translateY(-50%) and semi-transparent backgrounds. The play/pause button sits at bottom-right. The thumbnail strip uses overflow-x auto with flex-shrink 0 on each thumbnail for horizontal scrolling.

### B. Masonry Grid (CSS Columns)

> "I chose CSS columns over JavaScript-based masonry libraries because it eliminates layout thrashing entirely. The browser handles all positioning natively. Items flow top-to-bottom within each column, then left-to-right across columns. The trade-off is column-first ordering rather than row-first, but for a gallery of unrelated images this is perfectly acceptable."

                ┌──────────────────────────────────────────────────────┐
                │                    MasonryView                       │
                │                                                      │
                │  Layout: columns 4 300px, column-gap 1rem            │
                │                                                      │
                │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐    │
                │  │  img1  │  │  img2  │  │  img3  │  │  img4  │    │
                │  │ 280px  │  │ 350px  │  │ 200px  │  │ 320px  │    │
                │  └────────┘  └────────┘  └────────┘  └────────┘    │
                │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐    │
                │  │  img5  │  │  img6  │  │  img7  │  │  img8  │    │
                │  │ 320px  │  │ 240px  │  │ 380px  │  │ 260px  │    │
                │  └────────┘  └────────┘  └────────┘  └────────┘    │
                │                                                      │
                │  Each item uses break-inside avoid to prevent        │
                │  splitting across column boundaries.                 │
                │  Heights are pseudo-random based on image ID:        │
                │  height = 200 + ((id * 7) mod 200), range 200-400px │
                │                                                      │
                │  Hover: translateY(-4px) + elevated box-shadow       │
                │  Focus: 3px solid blue outline for accessibility     │
                │                                                      │
                │  Responsive breakpoints:                             │
                │  ├── > 1200px ──▶ 4 columns                         │
                │  ├── > 768px  ──▶ 3 columns                         │
                │  ├── > 480px  ──▶ 2 columns                         │
                │  └── mobile   ──▶ 1 column                          │
                └──────────────────────────────────────────────────────┘

### C. Tiles Grid (CSS Grid)

> "The tiles layout uses CSS Grid with auto-fill and minmax to create a responsive grid of equal-sized square tiles. The browser automatically determines column count based on available width, so no media queries are needed for the column calculation itself."

                ┌──────────────────────────────────────────────────────┐
                │                     TilesView                        │
                │                                                      │
                │  Layout: grid, repeat(auto-fill, minmax(200px, 1fr))│
                │          gap 1rem                                    │
                │                                                      │
                │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
                │  │  1:1    │ │  1:1    │ │  1:1    │ │  1:1    │  │
                │  │ square  │ │ square  │ │ square  │ │ square  │  │
                │  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
                │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
                │  │  1:1    │ │  1:1    │ │  1:1    │ │  1:1    │  │
                │  │ square  │ │ square  │ │ square  │ │ square  │  │
                │  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
                │                                                      │
                │  Each tile: aspect-ratio 1, overflow hidden          │
                │  Image: width 100%, height 100%, object-fit cover    │
                │  Hover: image scales to 1.05 inside overflow hidden  │
                │                                                      │
                │  Tablet adjustment: minmax(150px, 1fr)               │
                └──────────────────────────────────────────────────────┘

---

## 🔧 Deep Dive: Lightbox Component (8 min)

### Portal-Based Modal Architecture

> "The lightbox uses React's createPortal to render directly into document.body, avoiding z-index stacking context issues that arise when a modal is nested deep inside a component tree. This guarantees the lightbox always appears above all other content regardless of parent positioning contexts."

                ┌──────────────────────────────────────────────────────┐
                │                      Lightbox                        │
                │                                                      │
                │  Renders via createPortal into document.body         │
                │                                                      │
                │  ┌──────────────────────────────────────────────┐   │
                │  │  Backdrop (fixed, inset 0, z-index 1000)     │   │
                │  │  Background: rgba(0,0,0,0.9)                 │   │
                │  │  Animation: fadeIn 0.2s ease-out              │   │
                │  │                                              │   │
                │  │  ┌──────────────────────────────────────┐   │   │
                │  │  │  Content (relative, max 90vw x 90vh) │   │   │
                │  │  │  Animation: scaleIn 0.2s ease-out     │   │   │
                │  │  │                                       │   │   │
                │  │  │         ┌────────────────┐   [X]     │   │   │
                │  │  │  [←]   │  Main Image    │  Close    │   │   │
                │  │  │  prev  │  object-fit:   │  Button   │   │   │
                │  │  │        │  contain       │           │   │   │
                │  │  │        └────────────────┘   [→]     │   │   │
                │  │  │                              next    │   │   │
                │  │  └──────────────────────────────────────┘   │   │
                │  └──────────────────────────────────────────────┘   │
                │                                                      │
                │  Click Handling:                                      │
                │  ├── Backdrop click ──▶ closeLightbox()              │
                │  └── Content click ──▶ stopPropagation (no close)   │
                │                                                      │
                │  ARIA Attributes:                                     │
                │  ├── role="dialog"                                   │
                │  ├── aria-modal="true"                               │
                │  └── aria-label="Image lightbox"                     │
                └──────────────────────────────────────────────────────┘

### Animations

The backdrop uses a fadeIn keyframe animation from opacity 0 to 1. The content panel uses a scaleIn animation from scale 0.95 with opacity 0 to scale 1 with full opacity. Both run over 200ms with ease-out timing. Navigation buttons are positioned outside the image at negative 4rem offsets with circular shapes and semi-transparent hover backgrounds.

### Focus Management

When the lightbox opens, the previously focused element is stored. All focusable elements within the lightbox container are identified (buttons, links, inputs). Focus is set to the close button. A Tab key handler cycles focus: Shift+Tab on the first element wraps to the last, and Tab on the last element wraps to the first. On close, focus returns to the previously stored element.

---

## 🖼️ Deep Dive: Image Loading and Optimization (8 min)

### Responsive Image Strategy

> "The ResponsiveImage component generates a srcSet for multiple resolutions, allowing the browser to choose the most appropriate size based on the viewport and display density. This means a mobile user on a 375px-wide screen downloads a 300px image instead of the full 1200px version."

| Context | Image Dimensions | Purpose |
|---------|-----------------|---------|
| Thumbnails | 80 x 60 px | Slideshow strip, quick previews |
| Grid tiles | 300 x 300 px (tiles), 400 x variable (masonry) | Grid browsing |
| Slideshow main | 1200 x 675 px | Primary slideshow display |
| Lightbox full | 1920 x 1080 px | Full-screen detailed view |

The component accepts an imageId, alt text, size configuration, and loading strategy (lazy or eager). It generates srcSet entries for thumbnail, medium, and large breakpoints using the picsum.photos URL pattern with specific dimensions. The sizes attribute tells the browser which image to select based on viewport width.

### Lazy Loading with Intersection Observer

                ┌──────────────────────────────────────────────────────┐
                │               useLazyLoad Hook                       │
                │                                                      │
                │  Configuration:                                      │
                │  ├── threshold: 0.1 (trigger at 10% visibility)     │
                │  └── rootMargin: 100px (preload 100px before view)  │
                │                                                      │
                │  Returns:                                            │
                │  ├── ref ──▶ attach to target element                │
                │  └── isVisible ──▶ boolean (one-way latch)          │
                │                                                      │
                │  Lifecycle:                                          │
                │  1. Create IntersectionObserver                      │
                │  2. Observe the referenced element                   │
                │  3. On intersection ──▶ set isVisible true           │
                │  4. Disconnect observer (never revert to hidden)    │
                │  5. On unmount ──▶ disconnect for cleanup            │
                └──────────────────────────────────────────────────────┘

### Slideshow Image Preloading

> "For the slideshow, I preload the next and previous images in the background. When the user clicks an arrow, the adjacent image is already cached in the browser, making navigation feel instantaneous."

When the active tab is Slideshow, the preloader hook calculates the next and previous indices using circular arithmetic. It creates new Image objects and sets their src to the full-size picsum URL, triggering a background fetch. The browser caches these images so that when the user navigates, the image renders immediately without a loading flash. On cleanup, the src is cleared to free memory.

### Loading States

Each image tracks two states: loaded and error. While loading, a spinner placeholder is shown. On error, a "Failed to load" message appears. On successful load, the image fades in with an opacity transition using a "loaded" CSS class. This provides smooth visual feedback rather than abrupt image appearance.

---

## ⚖️ Deep Trade-off: CSS Columns vs JavaScript Masonry

**Decision**: Use CSS columns property for masonry layout instead of JavaScript-based libraries like react-masonry-css or Packery.

**Why CSS columns works for this problem**: The gallery displays a collection of unrelated images where visual variety matters more than strict ordering. CSS columns is a zero-JavaScript solution that eliminates all layout calculation overhead. The browser handles column balancing natively, and the layout automatically reflows on window resize without any JavaScript resize observers or debounced recalculations. For a gallery of 50 images, this means no layout thrashing during scroll and no JavaScript bundle cost for a masonry library.

**Why JavaScript masonry fails here**: JavaScript-based masonry calculates absolute positions for every item, creating a layout dependency chain. When any image loads and changes its natural height, the library must recalculate positions for every subsequent item. With 50 lazy-loaded images, this creates cascading layout shifts as images load in unpredictable order. The user sees items jumping around as the layout recalculates, which is exactly the jittery experience we want to avoid. Additionally, libraries like Packery add 30-40KB to the bundle for functionality we can achieve with two CSS properties.

**What we give up**: CSS columns flows items top-to-bottom within each column, then left-to-right across columns. This means item ordering is column-first rather than row-first. A user reading left-to-right would see items 1, 4, 7, 10 across the first row rather than 1, 2, 3, 4. For a photo gallery with no inherent sequence, this is acceptable. If the gallery needed chronological row-order (like a social media feed), we would need JavaScript masonry or CSS Grid masonry (still experimental in most browsers).

| Approach | Pros | Cons |
|----------|------|------|
| ✅ CSS columns | Zero JS, no layout thrashing, auto reflow on resize | Column-first ordering, no row-level alignment control |
| ❌ react-masonry-css | Row-first ordering, precise positioning | 30-40KB bundle, layout recalculation on load, resize observers |
| ❌ CSS Grid masonry | Best of both worlds, native | Experimental, limited browser support as of 2025 |

---

## ⚖️ Deep Trade-off: Portal-Based Lightbox vs CSS z-index Stacking

**Decision**: Render the lightbox via React createPortal into document.body rather than placing it inline within the component tree and relying on z-index.

**Why portals work for this problem**: A gallery application has deeply nested components (App, GalleryContent, MasonryView, MasonryItem) where each level might establish a new stacking context through transforms, opacity, or filters. The masonry items use translateY on hover and the tiles use scale transforms, both of which create new stacking contexts. A lightbox rendered inside this tree would be trapped in the stacking context of its parent, unable to visually appear above sibling stacking contexts regardless of z-index value. By portaling to document.body, the lightbox escapes all parent stacking contexts entirely.

**Why inline z-index fails here**: The hover effects on masonry items use transform: translateY(-4px), which creates a new stacking context per CSS specification. If the lightbox were rendered inside MasonryView, it would compete with sibling MasonryItems for z-index priority within the same stacking context. Setting z-index: 9999 on the lightbox would not help because its parent stacking context might still sit below other stacking contexts in the document. This is a well-known CSS layering trap that leads to developers playing "z-index whack-a-mole."

**What we give up**: The lightbox exists in a separate DOM subtree from the gallery components. This means CSS inheritance (custom properties, font settings) does not automatically cascade from the gallery to the lightbox. We must explicitly set any inherited styles on the lightbox container. Additionally, React context boundaries require careful attention; the lightbox must be wrapped in any necessary context providers if it needs access to gallery state. In practice, since we use Zustand (which operates outside the React tree), this is not an issue.

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Portal to body | Escapes all stacking contexts, guaranteed top layer | Separate DOM subtree, no CSS inheritance from parent |
| ❌ Inline with z-index | Simpler React tree, natural CSS inheritance | Trapped in parent stacking context, z-index battles |

---

## ⚖️ Deep Trade-off: Zustand vs React Context for Gallery State

**Decision**: Use Zustand for global gallery state rather than React Context with useReducer.

**Why Zustand works for this problem**: The gallery has five pieces of interrelated state (activeTab, slideshowIndex, isPlaying, lightboxImage, images) accessed by components at different levels of the tree. Zustand provides selector-based subscriptions, meaning the Lightbox component re-renders only when lightboxImage changes, not when slideshowIndex updates. For a gallery where the slideshow index changes every 3 seconds during auto-play, this prevents unnecessary re-renders of the masonry grid and tiles view. Zustand also supports the subscribeWithSelector middleware, enabling side-effect subscriptions (like adding keyboard listeners when the lightbox opens) without wrapping components in useEffect chains.

**Why React Context fails here**: Context triggers re-renders for every consumer when any part of the context value changes. During slideshow auto-play, the index updates every 3 seconds. With Context, this would re-render the MasonryView and TilesView (which subscribe to the same context for lightbox state) even though they only care about lightboxImage. Splitting into multiple contexts (SlideshowContext, LightboxContext, TabContext) adds boilerplate and makes cross-cutting actions (like "switch tab and pause slideshow") require coordinating dispatches across three separate contexts.

**What we give up**: Zustand is an external dependency (approximately 1KB gzipped), whereas React Context is built in. For a small gallery application, the dependency might seem unnecessary. However, the developer experience improvement (less boilerplate, selector subscriptions, middleware support) justifies the tiny bundle cost.

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Zustand | Selector subscriptions, minimal re-renders, middleware | External dependency (1KB) |
| ❌ React Context | Built-in, no extra dependency | Re-renders all consumers on any change, verbose with multiple contexts |

---

## ♿ Accessibility Implementation (3 min)

### Keyboard Navigation Map

| Key | Context | Action |
|-----|---------|--------|
| ArrowLeft / ArrowRight | Slideshow | Previous / Next image |
| Space | Slideshow | Toggle play / pause |
| ArrowLeft / ArrowRight | Lightbox | Navigate between images |
| Escape | Lightbox | Close lightbox |
| Enter | Grid item (focused) | Open lightbox for that image |
| Tab | Global | Navigate focusable elements in order |

### Focus Trap in Lightbox

When the lightbox opens, focus is programmatically set to the close button. A keydown handler intercepts Tab and Shift+Tab to cycle focus among the lightbox's focusable elements (close button, previous arrow, next arrow). When the lightbox closes, focus returns to the element that was focused before the lightbox opened. The body scroll is locked by setting overflow hidden while the lightbox is active.

---

## ⚡ Performance Optimizations (3 min)

| Technique | How It Works | Benefit |
|-----------|-------------|---------|
| Native lazy loading | loading="lazy" attribute on grid images | Reduces initial payload to visible images only |
| Responsive srcSet | Multiple resolutions per image | Browser downloads appropriate size for viewport |
| CSS-only layouts | columns and grid properties | No JavaScript layout calculations or thrashing |
| Component memoization | React.memo on MasonryItem and TileItem | Prevents re-render when parent updates but item props unchanged |
| Adjacent preloading | Prefetch next/prev slideshow images | Navigation feels instantaneous |
| One-way visibility latch | IntersectionObserver disconnects after first intersection | No ongoing observation cost for visible images |

---

## 📋 Summary

### Key Frontend Decisions

1. CSS-native layouts (columns for masonry, grid for tiles, flexbox for slideshow) eliminate JavaScript layout computation entirely
2. Zustand store with selector subscriptions prevents cascade re-renders during slideshow auto-play
3. Portal-based lightbox escapes stacking context traps from hover transforms on grid items
4. Keyboard-first navigation with focus trapping ensures the gallery is fully accessible
5. Lazy loading combined with slideshow preloading balances initial load speed with navigation responsiveness

### Architecture Patterns

                ┌──────────────────────────────────────────────────────┐
                │  Key Patterns                                        │
                │                                                      │
                │  Layout:                                             │
                │  ├── Slideshow ──▶ Flexbox + absolute positioning   │
                │  ├── Masonry ──▶ CSS columns (column-first flow)    │
                │  └── Tiles ──▶ CSS Grid auto-fill (responsive)      │
                │                                                      │
                │  State:                                              │
                │  ├── Zustand with subscribeWithSelector middleware   │
                │  └── Side effects via store subscriptions            │
                │                                                      │
                │  Optimization:                                       │
                │  ├── Native lazy loading on grid images              │
                │  ├── Responsive srcSet for multiple resolutions      │
                │  ├── React.memo on grid items                        │
                │  └── Image preloading for slideshow adjacents        │
                │                                                      │
                │  Accessibility:                                      │
                │  ├── Full keyboard navigation across all views       │
                │  ├── Focus trap in lightbox modal                    │
                │  ├── ARIA roles and labels on dialog                 │
                │  └── Focus restoration on lightbox close             │
                └──────────────────────────────────────────────────────┘

### Future Enhancements

- Virtualized grids using TanStack Virtual for galleries with 1000+ images
- Touch gestures (swipe for slideshow, pinch-to-zoom in lightbox)
- Blurhash placeholders during image loading for smoother UX
- Image metadata fetched from picsum API (author, description)
- Animated transitions between layout modes using View Transitions API
