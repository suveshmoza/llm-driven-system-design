# Gallery - CLAUDE.md

## Project Context

A frontend-only image gallery demonstrating three common layout paradigms (slideshow, masonry, tiles) using placeholder images from picsum.photos. This is a UI/UX focused project with no backend.

## Key Learning Goals

- **CSS Layout Techniques**: Mastering CSS columns (masonry), CSS Grid (tiles), and flexbox (slideshow)
- **Image Optimization**: Lazy loading, appropriate sizing, placeholder services
- **Keyboard Accessibility**: Full keyboard navigation for galleries
- **State Management**: Simple global state with Zustand for UI state

## Key Decisions

### 1. Frontend-Only Architecture

**Decision**: No backend, using picsum.photos directly

**Rationale**:
- Focus on layout and UI patterns
- No image storage complexity
- picsum.photos provides reliable placeholder images
- Easy to replace with real API later

### 2. CSS Columns for Masonry

**Decision**: Use CSS `columns` property instead of JavaScript masonry

**Rationale**:
- Native browser support, no layout calculations
- Simpler implementation than react-masonry-css
- Good browser support (IE10+)
- Limitation: Column-first ordering (acceptable for this use case)

### 3. Single Page with Tabs

**Decision**: All views on one page with tab switching

**Rationale**:
- Instant view switching
- Shared lightbox component
- Simpler state management
- Natural mobile pattern

### 4. Pre-selected Image IDs

**Decision**: Hardcoded list of 50 image IDs (10-59)

**Rationale**:
- Picsum.photos has some missing/broken IDs
- Consistent experience across sessions
- Predictable heights for masonry layout
- Easy to customize

## Iteration History

### v1 - Initial Implementation

- Created all three view components
- Implemented Zustand store for state
- Added lightbox with keyboard navigation
- Slideshow with auto-play and thumbnails

## Architecture Decisions

| Area | Choice | Alternative Considered |
|------|--------|----------------------|
| Layout Engine | CSS native | react-masonry-css, packery |
| State | Zustand | React Context, Redux |
| Images | picsum.photos | Unsplash API, Lorem Picsum |
| Routing | TanStack Router | React Router, wouter |

## File Structure Rationale

```
components/gallery/   # All gallery-specific components grouped
stores/              # Zustand stores (single file for this project)
utils/               # Helper functions for image URLs
```

## Tips for Future Development

1. **Adding Real Images**: Replace `imageIds` array with API response
2. **Infinite Scroll**: Add intersection observer to load more images
3. **Server Rendering**: Would need image dimensions from API
4. **Mobile Gestures**: Consider swipe for slideshow, pinch for zoom
