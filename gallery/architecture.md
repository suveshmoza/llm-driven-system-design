# Gallery Architecture

## System Overview

A frontend-only image gallery application showcasing different layout paradigms for displaying image collections. This project focuses on UI/UX patterns and CSS layout techniques.

## Design Goals

1. **Multiple Layout Modes**: Demonstrate three common gallery layouts (slideshow, masonry, tiles)
2. **Performant Image Loading**: Lazy loading and optimized image URLs
3. **Keyboard Accessibility**: Full keyboard navigation support
4. **Responsive Design**: Works across desktop, tablet, and mobile

## Component Architecture

```
┌─────────────────────────────────────────────────┐
│                   App Layout                     │
│  ┌───────────────────────────────────────────┐  │
│  │              Header / Title                │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │           GalleryTabs Component            │  │
│  │   [Slideshow] [Masonry] [Tiles]           │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │         Active View Component              │  │
│  │   ┌────────────────────────────────────┐  │  │
│  │   │   Slideshow / Masonry / Tiles     │  │  │
│  │   └────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │         Lightbox Overlay (Modal)          │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Layout Implementations

### 1. Slideshow View

**Goal**: Full-screen single image display with navigation

**Implementation**:
- Main image display with 16:9 aspect ratio
- Navigation arrows (left/right)
- Thumbnail strip for quick navigation
- Auto-play with configurable interval
- Keyboard support (arrows, space for play/pause)

**CSS Pattern**: Flexbox with absolute positioning for overlays

### 2. Masonry Grid View

**Goal**: Pinterest-style variable-height grid

**Implementation**:
- CSS `columns` property for true masonry layout
- `break-inside-avoid` to prevent image splitting
- Variable image heights based on image ID
- Lazy loading for off-screen images

**CSS Pattern**: Multi-column layout
```css
.masonry {
  columns: 4 300px;
  column-gap: 1rem;
}
.masonry-item {
  break-inside: avoid;
  margin-bottom: 1rem;
}
```

### 3. Tiles Grid View

**Goal**: Uniform square grid with hover effects

**Implementation**:
- CSS Grid with responsive column count
- Fixed aspect ratio (1:1 square)
- Hover effect with scale transform
- Images cropped via `object-fit: cover`

**CSS Pattern**: CSS Grid with aspect-ratio
```css
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}
.tile {
  aspect-ratio: 1;
  overflow: hidden;
}
```

## State Management

Using Zustand for simple global state:

```typescript
interface GalleryState {
  // Tab navigation
  activeTab: 'Slideshow' | 'Masonry' | 'Tiles'
  setActiveTab: (tab) => void

  // Lightbox
  lightboxImage: number | null
  openLightbox: (id) => void
  closeLightbox: () => void

  // Slideshow
  slideshowIndex: number
  nextSlide: () => void
  prevSlide: () => void
}
```

## Image Loading Strategy

### Picsum.photos Integration

```typescript
// URL pattern for specific image with dimensions
`https://picsum.photos/id/${imageId}/${width}/${height}`

// Examples:
// Thumbnail: https://picsum.photos/id/10/80/60
// Grid tile: https://picsum.photos/id/10/300/300
// Full size: https://picsum.photos/id/10/1920/1080
```

### Lazy Loading

- Native `loading="lazy"` attribute on images
- Only visible images are loaded initially
- Thumbnails use smaller dimensions for faster loading

### Image ID Selection

Pre-selected stable IDs (10-59) to avoid broken images. Picsum.photos occasionally has missing IDs.

## Performance Considerations

1. **Appropriate Image Sizes**
   - Thumbnails: 80×60 px
   - Grid tiles: 300×300 px (tiles), 400×variable (masonry)
   - Full view: 1200×675 px (slideshow), 1920×1080 (lightbox)

2. **Lazy Loading**
   - Off-screen images load on scroll
   - Reduces initial page load time

3. **CSS-Only Layouts**
   - No JavaScript layout calculations
   - Browser-native column and grid layouts

## Accessibility

- **Keyboard Navigation**: Arrow keys, Escape, Space
- **Focus Management**: Visible focus rings on interactive elements
- **ARIA Labels**: Descriptive labels on buttons
- **Screen Reader Support**: Alt text on all images

## Future Enhancements

1. **Image Metadata**: Show author, description from Picsum API
2. **Infinite Scroll**: Load more images on scroll
3. **Zoom**: Pinch-to-zoom in lightbox
4. **Favorites**: Save favorite images (localStorage)
5. **Upload**: Support user image uploads
6. **Transitions**: Animate between layout modes
