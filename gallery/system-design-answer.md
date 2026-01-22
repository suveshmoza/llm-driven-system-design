# System Design Answer: Image Gallery

## Problem Statement

Design an image gallery system that supports multiple viewing modes (slideshow, masonry grid, uniform tiles) with smooth navigation and good performance.

---

## 1. Requirements Clarification (2 min)

### Functional Requirements
- Display images in three layouts: slideshow, masonry, tiles
- Navigation between images (arrows, thumbnails)
- Full-screen lightbox view
- Responsive design for mobile/desktop

### Non-Functional Requirements
- Fast initial load (< 3 seconds)
- Smooth transitions between images
- Keyboard accessible
- Works offline (after initial load)

### Scale Assumptions
- Hundreds to thousands of images per gallery
- Mostly read traffic
- No upload functionality (display only)

---

## 2. High-Level Design (5 min)

### Frontend Architecture

```
┌─────────────────────────────────────────┐
│            Gallery Application           │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐    │
│  │         Tab Navigation          │    │
│  │  [Slideshow][Masonry][Tiles]    │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │        Active View              │    │
│  │  (Slideshow/Masonry/Tiles)     │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │     Lightbox Overlay            │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### State Management

```
GalleryState {
  activeTab: 'Slideshow' | 'Masonry' | 'Tiles'
  lightboxImage: ImageId | null
  slideshowIndex: number
  images: Image[]
}
```

---

## 3. Deep Dive: Layout Implementations (10 min)

### A. Slideshow Layout

**Structure**:
- Main image container (16:9 aspect ratio)
- Navigation arrows (left/right)
- Thumbnail strip below
- Play/pause controls

**Key Implementation Details**:
```css
.slideshow {
  position: relative;
  aspect-ratio: 16/9;
}
.nav-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}
.thumbnails {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
}
```

**Features**:
- Preload adjacent images
- Keyboard navigation (arrows, space)
- Auto-play with configurable interval

### B. Masonry Layout

**Structure**:
- CSS columns-based layout
- Variable height images
- Click to open lightbox

**Implementation**:
```css
.masonry-grid {
  columns: 4 250px;
  column-gap: 1rem;
}
.masonry-item {
  break-inside: avoid;
  margin-bottom: 1rem;
}
```

**Trade-offs**:
- ✅ No JavaScript layout calculations
- ✅ Native browser performance
- ❌ Column-first ordering (not row-first)
- Alternative: react-masonry-css for row-first

### C. Tiles Grid Layout

**Structure**:
- CSS Grid with fixed aspect ratio
- Uniform squares
- Hover effects

**Implementation**:
```css
.tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}
.tile {
  aspect-ratio: 1;
  overflow: hidden;
}
.tile img {
  object-fit: cover;
  transition: transform 0.3s;
}
.tile:hover img {
  transform: scale(1.05);
}
```

---

## 4. Image Loading Strategy (8 min)

### Responsive Images

```html
<img
  srcset="
    image-400.jpg 400w,
    image-800.jpg 800w,
    image-1200.jpg 1200w
  "
  sizes="(max-width: 600px) 400px,
         (max-width: 1200px) 800px,
         1200px"
  loading="lazy"
/>
```

### Loading Priorities

| View | Priority | Size |
|------|----------|------|
| Slideshow current | Eager | 1200px |
| Slideshow ±1 | Preload | 1200px |
| Thumbnails | Lazy | 80px |
| Grid visible | Lazy | 300-400px |
| Lightbox | On-demand | 1920px |

### Image CDN Pattern

```
https://cdn.example.com/{id}?w={width}&h={height}&fit=crop
```

---

## 5. Performance Optimizations (5 min)

### Lazy Loading
- Native `loading="lazy"` attribute
- Intersection Observer for custom loading

### Virtualization (for large galleries)
```javascript
// Only render visible items
const visibleItems = images.slice(
  scrollOffset,
  scrollOffset + viewportItems
);
```

### Preloading
```javascript
// Preload adjacent slideshow images
const preloadImage = (src) => {
  const img = new Image();
  img.src = src;
};
```

### Caching
- Service worker for offline support
- Browser cache with appropriate headers

---

## 6. Accessibility (3 min)

### Keyboard Navigation
| Key | Action |
|-----|--------|
| ← → | Navigate slideshow/lightbox |
| Space | Play/pause slideshow |
| Escape | Close lightbox |
| Enter | Open lightbox |

### Screen Reader Support
- Alt text on all images
- ARIA labels on buttons
- Focus management in lightbox

---

## 7. API Design (for full implementation) (5 min)

### Endpoints

```
GET /api/galleries/{id}
Response: {
  id, name, imageCount,
  images: [{ id, url, width, height, alt }]
}

GET /api/galleries/{id}/images?page=1&limit=50
Response: {
  images: [...],
  pagination: { page, limit, total }
}
```

### Image URL Pattern
```
/api/images/{id}?
  w=400&       # width
  h=300&       # height (optional)
  fit=cover&   # cover, contain, fill
  q=80         # quality
```

---

## 8. Summary

### Key Design Decisions

1. **CSS-native layouts** over JavaScript calculations for performance
2. **Tab-based navigation** for instant view switching
3. **Lazy loading** with appropriate priorities
4. **Zustand** for simple state management
5. **Keyboard-first** accessibility

### Trade-offs

| Decision | Pro | Con |
|----------|-----|-----|
| CSS columns masonry | Simple, performant | Column-first order |
| Frontend-only | Simple deployment | No server-side optimization |
| Fixed image IDs | Predictable | Limited flexibility |

### Scaling Considerations

For production:
- CDN for images
- Image processing service (Sharp, Cloudinary)
- Server-side pagination
- Virtualized lists for 1000+ images
