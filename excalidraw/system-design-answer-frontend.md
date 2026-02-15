# Excalidraw - Collaborative Whiteboard (Frontend Focus)

## 🎯 Problem Statement

Design the frontend for a collaborative whiteboard where multiple users draw shapes on an infinite canvas, see each other's cursors in real time, and can pan/zoom freely. The core challenge is performant canvas rendering with viewport transforms, responsive drawing interactions, and real-time state synchronization.

## 📋 Requirements Clarification

**Functional:**
- Drawing tools: select, rectangle, ellipse, diamond, arrow, line, freehand, text
- Shape properties: stroke color, fill color, stroke width, opacity
- Infinite canvas with pan and zoom
- Live cursor presence of collaborators
- Selection with resize handles
- Keyboard shortcuts for all tools

**Non-Functional:**
- 60fps canvas rendering with 1000+ elements
- Sub-50ms perceived latency for drawing operations
- Smooth pan/zoom experience
- Support retina/HiDPI displays

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    React Application                      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │ TanStack │  │  Zustand  │  │    Services Layer     │  │
│  │  Router  │  │  Stores   │  │  ┌─────┐  ┌────────┐ │  │
│  │          │  │           │  │  │ API │  │   WS   │ │  │
│  │ /        │  │ authStore │  │  │Client│  │ Client │ │  │
│  │ /login   │  │canvasStore│  │  └─────┘  └────────┘ │  │
│  │ /draw/$id│  │           │  └───────────────────────┘  │
│  └──────────┘  └─────┬─────┘                             │
│                      │                                    │
│  ┌───────────────────▼────────────────────────────────┐  │
│  │              Canvas Layer                           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │ Renderer │  │  Hit     │  │  Path             │ │  │
│  │  │ (shapes, │  │  Testing │  │  Simplification   │ │  │
│  │  │  grid)   │  │  Engine  │  │  (RDP algorithm)  │ │  │
│  │  └──────────┘  └──────────┘  └──────────────────┘ │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## 🎨 Deep Dive 1: Canvas Rendering Architecture

### Viewport Transform

The infinite canvas uses a 2D affine transform applied before rendering:

```
ctx.setTransform(zoom, 0, 0, zoom, scrollX, scrollY)
```

All element coordinates are stored in "world space." The viewport transform converts world space to screen space during rendering. This means:
- **Pan:** Update `scrollX/scrollY` offsets
- **Zoom:** Scale factor centered on cursor position
- **Hit testing:** Convert screen coordinates back to world space: `worldX = (screenX - scrollX) / zoom`

### Trade-off: Canvas 2D vs WebGL vs SVG

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Canvas 2D | Simple API, good for 1K elements | CPU-bound, no built-in events |
| ❌ WebGL (PixiJS) | GPU-accelerated, handles 100K+ | Complex shader code, harder debugging |
| ❌ SVG | DOM events, CSS styling | Slow above 1K elements (DOM bloat) |

> "Canvas 2D is the right choice for a whiteboard with typically 100-1000 elements. SVG would give us free DOM events and CSS styling, but performance degrades sharply above 1000 elements because each shape is a DOM node. WebGL (via PixiJS or Three.js) would handle 100K+ elements but adds significant complexity for a whiteboard where we don't need GPU-accelerated rendering. Canvas 2D lets us render 1000+ shapes at 60fps with straightforward `ctx.rect()`, `ctx.ellipse()`, and `ctx.bezierCurveTo()` calls."

### Retina Display Support

Canvas uses 2x pixel density for sharp rendering on HiDPI displays:

```
canvas.width = containerWidth * 2    // Double pixel buffer
canvas.height = containerHeight * 2
canvas.style.width = containerWidth  // CSS size stays normal
ctx.setTransform(2, 0, 0, 2, 0, 0)  // Scale context
```

### Rendering Pipeline

```
┌─────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
│  Clear   │───▶│ Draw Grid │───▶│ Apply      │───▶│ Render   │
│  Canvas  │    │ (dots)    │    │ Transform  │    │ Elements │
└─────────┘    └──────────┘    └────────────┘    └────┬─────┘
                                                      │
                                         ┌────────────▼──────────┐
                                         │ Draw Selection Handles │
                                         │ (if element selected)  │
                                         └────────────────────────┘
```

Each shape type has a dedicated renderer function that receives the canvas context and element data. The renderer dispatches by `element.type` to the appropriate function (rectangle, ellipse, diamond, arrow, line, freehand, text).

## 🔧 Deep Dive 2: Drawing Interaction Model

### State Machine for Drawing

```
                    mousedown
    IDLE ──────────────────────▶ DRAWING
     ▲                              │
     │          mouseup             │ mousemove
     └──────────────────────────────┘
         (finalize shape)       (update preview)
```

**Select tool:** Click performs hit testing against all elements (reverse z-order). If hit, enter drag mode. Drag updates element position.

**Shape tools (rect, ellipse, diamond):** Mousedown sets start point. Mousemove calculates width/height from cursor delta. Mouseup finalizes and adds element to store.

**Freehand tool:** Mousedown starts collecting points. Mousemove appends points at ~60fps. Mouseup runs Ramer-Douglas-Peucker simplification to reduce point count, then adds element.

**Text tool:** Click opens a prompt for text input. The element is created with width approximated from character count.

### Hit Testing

> "Hit testing is crucial for the select tool -- we need to determine which element the user clicked. I iterate elements in reverse z-order (topmost first) and test each shape type differently: rectangles use point-in-rect, ellipses use the ellipse equation, diamonds use Manhattan distance, and freehand/line shapes check distance to each line segment. This runs on every click at O(n) where n is the number of visible elements. For 1000+ elements, I'd add spatial indexing (quadtree or R-tree) to reduce to O(log n), but for typical whiteboard sizes, linear scan is fine."

### Trade-off: Prompt-based Text vs Inline Editing

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Prompt-based | Simple, no overlay management | Interrupts flow, no preview |
| ❌ Inline text editing | WYSIWYG, natural feel | Complex: textarea overlay, cursor sync |

> "I chose the simpler prompt approach for the learning project. Production Excalidraw uses an invisible textarea overlay positioned over the text element, which provides true inline editing. The complexity comes from synchronizing the textarea position with canvas pan/zoom transforms and handling multi-line text wrapping."

## 🔧 Deep Dive 3: Freehand Drawing and Path Simplification

### The Problem

During freehand drawing, mousemove fires at ~60Hz, generating hundreds of points per second. Storing all points wastes memory and creates noisy paths with unnecessary detail.

### Ramer-Douglas-Peucker Algorithm

```
simplify(points, epsilon):
  Find point with max perpendicular distance from start-end line
  If maxDistance > epsilon:
    Recursively simplify left half and right half
    Concatenate results
  Else:
    Return [start, end] only
```

With `epsilon = 2` pixels, a 200-point freehand stroke typically reduces to 30-50 points while preserving visual fidelity. This is a 4-6x reduction in storage and rendering cost.

### Smooth Rendering with Quadratic Curves

Raw line segments create jagged freehand paths. Using `quadraticCurveTo()` with the midpoint between consecutive points as the control point creates smooth Bezier curves:

```
for each point (except first and last):
  midX = (point[i].x + point[i+1].x) / 2
  midY = (point[i].y + point[i+1].y) / 2
  ctx.quadraticCurveTo(point[i].x, point[i].y, midX, midY)
```

## 🔌 Real-Time Synchronization

### WebSocket Client

The WebSocket client is a singleton class that manages connection, reconnection, and message routing:

```
wsClient.connect()
wsClient.joinRoom(drawingId, userId, username)
wsClient.on('shape-add', handler)
wsClient.sendShapeAdd(element)
wsClient.sendCursorMove(x, y)
```

### Optimistic Updates

Shape operations are applied locally first, then sent over WebSocket:

```
1. User draws rectangle
2. addElement(rect) ← updates Zustand store immediately
3. wsClient.sendShapeAdd(rect) ← sends to server
4. Server broadcasts to other clients
5. Other clients: addElement(rect) ← from WebSocket message
```

> "The user never waits for a server round-trip. Their shape appears instantly. If the server rejects the operation or the connection drops, the shape is already visible. On reconnection, the client receives the authoritative state from the server and reconciles."

### Collaborator Cursors

Other users' cursors are rendered as colored SVG arrows with username labels, positioned using CSS transforms. They update at ~10fps (throttled from 60fps to reduce network traffic). The cursors are absolutely positioned in the DOM layer above the canvas, not drawn on the canvas itself -- this avoids redrawing the entire canvas on every cursor move.

## 📦 State Management

### Zustand Store Structure

```
canvasStore:
  elements[]          -- All drawing elements
  selectedElementId   -- Currently selected element
  activeTool          -- Current tool
  viewState           -- { scrollX, scrollY, zoom }
  isDrawing           -- Whether mouse is currently drawing
  drawingStartPoint   -- Where mousedown occurred
  currentPoints[]     -- Points being collected (freehand)
  cursors[]           -- Other users' cursor positions
  strokeColor         -- Current stroke color
  fillColor           -- Current fill color
  strokeWidth         -- Current stroke width
  opacity             -- Current opacity

authStore:
  user                -- Current user
  isAuthenticated     -- Auth state
  login/logout/register actions
```

> "I chose Zustand over React Context for two reasons: first, it doesn't cause re-renders of the entire component tree when a single value changes (Zustand uses selector-based subscriptions). Second, the canvas needs to read state at 60fps for rendering, and Zustand's direct store access via `getState()` is faster than Context's component re-render cycle."

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Rendering engine | Canvas 2D | WebGL / SVG | Simple API, sufficient for 1K elements |
| State management | Zustand | React Context | Selector subscriptions, no re-render cascade |
| Hit testing | Linear scan | Quadtree | Sufficient for typical element counts |
| Path simplification | Ramer-Douglas-Peucker | Visvalingam | Better preserves sharp corners |
| Text input | Prompt | Inline textarea | Simpler, avoids overlay complexity |
| Cursor rendering | DOM overlay | Canvas-drawn | Avoids full canvas redraw on cursor move |
