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
- Multi-select and group operations (move, delete, copy)
- Undo/redo for local operations
- Export to PNG and SVG

**Non-Functional:**
- 60fps canvas rendering with 1000+ elements
- Sub-50ms perceived latency for drawing operations
- Smooth pan/zoom experience
- Support retina/HiDPI displays
- Accessible tool selection and keyboard navigation
- Responsive layout across desktop screen sizes

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

> "Canvas 2D is the right choice for a whiteboard with typically 100-1000 elements. SVG would give us free DOM events and CSS styling, but performance degrades sharply above 1000 elements because each shape is a DOM node. WebGL (via PixiJS or Three.js) would handle 100K+ elements but adds significant complexity for a whiteboard where we don't need GPU-accelerated rendering. Canvas 2D lets us render 1000+ shapes at 60fps with straightforward drawing calls."

### Retina Display Support

Canvas uses 2x pixel density for sharp rendering on HiDPI displays:

```
canvas.width = containerWidth * 2    (double pixel buffer)
canvas.height = containerHeight * 2
canvas.style.width = containerWidth  (CSS size stays normal)
ctx.setTransform(2, 0, 0, 2, 0, 0)  (scale context)
```

The device pixel ratio is detected at initialization and used as the scaling factor. On non-retina displays, the ratio is 1 and no scaling occurs. This approach doubles memory usage for the canvas buffer on retina displays but produces crisp lines and text that match the display's native resolution.

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

Each shape type has a dedicated renderer function that receives the canvas context and element data. The renderer dispatches by `element.type` to the appropriate function (rectangle, ellipse, diamond, arrow, line, freehand, text). The grid is drawn in screen space before the viewport transform is applied, so grid dots maintain consistent spacing regardless of zoom level. Elements are drawn in world space after the transform, so they pan and zoom naturally.

### Performance Optimizations for Large Canvases

For drawings with 1000+ elements, several optimizations maintain 60fps:

**Viewport culling:** Before rendering each element, check whether its bounding box intersects the visible viewport rectangle. Elements entirely outside the viewport are skipped. This is a simple AABB (axis-aligned bounding box) intersection test that reduces the number of draw calls proportionally to the viewport-to-canvas ratio. For a canvas with 5000 elements where the user is zoomed in, typically only 50-200 elements are visible and need rendering.

**Dirty rectangle tracking:** When a single element changes (move, resize, style change), instead of re-rendering all elements, mark a rectangle around the changed element as dirty. Clear only that rectangle and re-render elements that intersect it. This optimization is most effective during drag operations where a single element moves while thousands of others remain static.

**requestAnimationFrame batching:** All rendering is driven by requestAnimationFrame rather than direct state change handlers. Multiple state changes within a single frame (for example, receiving several WebSocket shape updates) are batched into one render pass. The render function reads the current state snapshot and draws everything in a single frame.

**Off-screen canvas for static layers:** For very large canvases, the grid and static (non-selected) elements can be rendered to an off-screen canvas that is only re-drawn when the viewport changes. The main canvas composites the off-screen layer with the actively changing elements. This trades memory for CPU time.

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

**Select tool:** Click performs hit testing against all elements (reverse z-order). If hit, enter drag mode. Drag updates element position. Double-click on a text element opens edit mode.

**Shape tools (rect, ellipse, diamond):** Mousedown sets start point. Mousemove calculates width/height from cursor delta and renders a preview. Mouseup finalizes and adds element to store. Holding Shift constrains to a square or circle.

**Arrow and line tools:** Mousedown sets the start endpoint. Mousemove shows a preview line to the cursor. Mouseup sets the end endpoint and finalizes. Arrows detect proximity to existing shapes for snapping.

**Freehand tool:** Mousedown starts collecting points. Mousemove appends points at ~60fps. Mouseup runs Ramer-Douglas-Peucker simplification to reduce point count, then adds element.

**Text tool:** Click opens a prompt for text input. The element is created with width approximated from character count and font metrics. In a production implementation, an invisible textarea overlay would be positioned over the text element for inline editing.

### Tool System Architecture

The tool system is organized as a registry where each tool defines its mouse event handlers (onMouseDown, onMouseMove, onMouseUp), its cursor style, and its keyboard shortcut. The active tool is stored in the Zustand canvas store. Switching tools is as simple as updating the activeTool property, which causes the canvas component to bind the new tool's event handlers.

Each tool is responsible for creating its own preview rendering during the drawing state. The select tool renders resize handles and a selection outline. Shape tools render a semi-transparent preview of the shape being drawn. The freehand tool renders the collected points as a path in real time.

### Hit Testing

> "Hit testing is crucial for the select tool -- we need to determine which element the user clicked. I iterate elements in reverse z-order (topmost first) and test each shape type differently: rectangles use point-in-rect, ellipses use the ellipse equation, diamonds use Manhattan distance, and freehand/line shapes check distance to each line segment. This runs on every click at O(n) where n is the number of visible elements. For 1000+ elements, I'd add spatial indexing (quadtree or R-tree) to reduce to O(log n), but for typical whiteboard sizes, linear scan is fine."

### Multi-Select and Group Operations

Multi-select is triggered by Shift+click (toggle individual elements into/out of the selection set) or by drawing a selection rectangle (rubber band). The selection rectangle is rendered as a dashed outline during drag. On mouseup, all elements whose bounding boxes intersect the selection rectangle are added to the selection set.

Once multiple elements are selected, group operations apply uniformly: drag moves all selected elements by the same delta, Delete removes all selected elements, and style changes (color, stroke width) apply to every element in the selection. The selection state is stored as a Set of element IDs in the canvas store. Group resize is more complex -- a bounding box around all selected elements defines the resize handles, and each element's position and size scales proportionally relative to the group bounding box origin.

### Keyboard Shortcut Handling

Keyboard shortcuts are registered at the document level using a keydown event listener. The handler checks the active element to avoid intercepting input field keystrokes. The shortcut map includes:

- V for select tool, R for rectangle, E for ellipse, D for diamond, A for arrow, L for line, P for pen (freehand), T for text
- Delete/Backspace to remove selected element
- Ctrl+Z / Cmd+Z for undo, Ctrl+Shift+Z / Cmd+Shift+Z for redo
- Ctrl+A / Cmd+A for select all
- Ctrl+C / Cmd+C and Ctrl+V / Cmd+V for copy and paste
- Plus/Minus or Ctrl+scroll for zoom in/out
- Escape to deselect or cancel current drawing operation

The shortcut system respects modifier keys and distinguishes between single-key shortcuts (tool selection) and modified shortcuts (Ctrl+Z for undo). When a text element is being edited, single-key shortcuts are suppressed to allow typing.

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

Raw line segments create jagged freehand paths. Using quadraticCurveTo with the midpoint between consecutive points as the control point creates smooth Bezier curves:

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
2. addElement(rect)          ──▶ updates Zustand store immediately
3. wsClient.sendShapeAdd(rect) ──▶ sends to server
4. Server broadcasts to other clients
5. Other clients: addElement(rect) from WebSocket message
```

> "The user never waits for a server round-trip. Their shape appears instantly. If the server rejects the operation or the connection drops, the shape is already visible. On reconnection, the client receives the authoritative state from the server and reconciles."

### Collaborator Cursors

Other users' cursors are rendered as colored SVG arrows with username labels, positioned using CSS transforms. They update at ~10fps (throttled from 60fps to reduce network traffic). The cursors are absolutely positioned in the DOM layer above the canvas, not drawn on the canvas itself -- this avoids redrawing the entire canvas on every cursor move.

## 🔄 Undo/Redo

### Operation Stack Approach

The undo/redo system maintains two stacks: an undo stack and a redo stack. Each entry is an operation record containing the operation type (add, update, delete, move), the element ID, the previous state of the element (for undo), and the new state (for redo).

When the user performs an action, the operation is pushed onto the undo stack and the redo stack is cleared. Pressing Ctrl+Z pops the top operation from the undo stack, applies the inverse (restore previous state, re-add a deleted element, or remove an added element), and pushes the operation onto the redo stack. Ctrl+Shift+Z reverses this process.

> "The tricky part in a collaborative environment is that another user might have modified the same element between your action and your undo. I handle this by checking whether the element's current version matches what the undo operation expects. If the versions diverge, the undo is applied as a new operation rather than a revert, which may conflict with the collaborator's changes but follows the LWW resolution path."

## 📤 Export Functionality

Export to PNG creates an off-screen canvas, renders all non-deleted elements without the grid or selection handles, and converts the result to a downloadable blob. The export canvas dimensions are computed from the bounding box of all elements plus a configurable padding margin. The off-screen canvas uses the same renderer functions as the main canvas, ensuring visual fidelity between what the user sees and what they export.

Export to SVG generates an SVG document by translating each element into its SVG equivalent (rect, ellipse, polygon, path, text elements), preserving stroke and fill properties. SVG export produces a resolution-independent output that can be scaled to any size without pixelation, making it preferred for embedding in documents or printing.

### Trade-off: Client-side Export vs Server-side Export

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Client-side (off-screen canvas) | Instant, no server load, works offline | Limited to browser canvas capabilities |
| ❌ Server-side (node-canvas/Puppeteer) | Consistent rendering, larger canvases | Added latency, server resource consumption |

> "Client-side export is the right default because it gives instant feedback and does not require a server round-trip. The limitation is that very large canvases (10K+ elements) may hit browser memory limits. For production, I'd add a server-side fallback using node-canvas or Puppeteer for high-resolution exports and PDF generation."

## 📦 State Management

### Zustand Store Structure

```
canvasStore:
  elements[]          -- All drawing elements
  selectedElementId   -- Currently selected element
  selectedElementIds  -- Set of selected elements (multi-select)
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
  undoStack[]         -- Operation history for undo
  redoStack[]         -- Operation history for redo

authStore:
  user                -- Current user
  isAuthenticated     -- Auth state
  login/logout/register actions
```

> "I chose Zustand over React Context for two reasons: first, it doesn't cause re-renders of the entire component tree when a single value changes (Zustand uses selector-based subscriptions). Second, the canvas needs to read state at 60fps for rendering, and Zustand's direct store access via `getState()` is faster than Context's component re-render cycle."

## 🛡️ Error Handling and Resilience

**WebSocket disconnection:** When the WebSocket connection drops, the client displays a subtle "Reconnecting..." indicator in the toolbar without blocking the drawing interface. The user can continue drawing locally while the reconnection loop runs with exponential backoff (500ms initial, 30s cap). All local operations are queued in memory. On reconnection, the client re-joins the room and reconciles its local state with the server's authoritative copy using the same CRDT merge function. This ensures no local work is lost during the outage.

**Failed API requests:** Drawing list loads, collaborator updates, and metadata saves use a retry-with-backoff strategy. On persistent failure, the UI shows inline error messages with a retry button rather than crashing the application. Authentication failures (401 responses) redirect to the login page and clear the local auth state.

**Canvas rendering errors:** If a malformed element causes a rendering exception (for example, a freehand path with an empty points array), the renderer catches the error per-element and skips the broken element rather than crashing the entire canvas. A warning indicator shows the user that one element failed to render.

**State corruption recovery:** If the local Zustand state becomes inconsistent (for example, a selectedElementId pointing to a nonexistent element), the canvas component detects the inconsistency during the render loop and resets the selection state. For more severe corruption, the user can force-reload from the server by refreshing the page, which fetches the last persisted state from PostgreSQL.

## 📊 Scaling the Frontend

For canvases approaching 5000+ elements, additional frontend optimizations become necessary beyond basic viewport culling:

**Spatial indexing with quadtree:** Replace the linear hit-testing scan with a quadtree that partitions elements by their bounding boxes. This reduces hit-test time from O(n) to O(log n) and also accelerates viewport culling by allowing the renderer to quickly find all elements within the visible rectangle.

**Web Worker for CRDT merge:** Move the CRDT merge computation off the main thread into a Web Worker. When a large elements-sync message arrives from the server (potentially thousands of elements), the merge runs in the background without blocking the rendering loop. The worker posts the merged result back to the main thread, which updates the Zustand store.

**Canvas layer separation:** Split the single canvas into three layers stacked via CSS: a background layer (grid, static elements that haven't changed recently), an active layer (elements being dragged or drawn), and a selection layer (handles, rubber band). Only the active layer re-renders during drag operations, dramatically reducing draw calls.

**Memory management:** Soft-deleted elements accumulate in the elements array over time. The client periodically compacts the array by removing elements marked as deleted more than 24 hours ago, reducing memory footprint and rendering loop iteration count.

## ♿ Accessibility Considerations

Drawing tools are inherently visual, but several aspects can be made accessible. The toolbar uses proper ARIA roles (toolbar, radio group for tool selection) and supports keyboard navigation with arrow keys between tool buttons. Each tool button has an aria-label describing its function and keyboard shortcut. The zoom level is announced to screen readers when it changes. The collaborator list (showing who is in the room) uses a live region that announces when users join or leave.

For keyboard-only users, the select tool supports Tab to cycle through elements and arrow keys to nudge the selected element by 1 pixel (or 10 pixels with Shift held). Delete and style changes work on the keyboard-selected element. Full freehand drawing is not accessible via keyboard, which is an inherent limitation of the drawing paradigm.

## 📱 Responsive Design

The canvas occupies the full viewport width and height minus the toolbar. The toolbar adapts to narrower screens by collapsing less-used tools into an overflow menu. The properties panel (colors, stroke width) slides in from the side on desktop and from the bottom on narrow screens.

Touch events are mapped to mouse events for basic tablet support: one-finger drag for drawing, two-finger pinch for zoom, two-finger pan for scrolling. Pointer events (pointerdown, pointermove, pointerup) are preferred over mouse events because they unify mouse, touch, and stylus input into a single event model, reducing code duplication.

The canvas element resizes dynamically when the browser window resizes. A ResizeObserver watches the canvas container and updates the canvas dimensions and pixel buffer accordingly. The viewport transform is preserved across resizes so the user does not lose their current pan/zoom position.

The minimum supported width is 768px -- below that, the drawing experience degrades significantly and a mobile-specific UI would be needed. A dedicated mobile layout would replace the toolbar with a bottom drawer, use larger touch targets, and implement gesture-based tool switching.

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Rendering engine | Canvas 2D | WebGL / SVG | Simple API, sufficient for 1K elements |
| State management | Zustand | React Context | Selector subscriptions, no re-render cascade |
| Hit testing | Linear scan | Quadtree | Sufficient for typical element counts |
| Path simplification | Ramer-Douglas-Peucker | Visvalingam | Better preserves sharp corners |
| Text input | Prompt | Inline textarea | Simpler, avoids overlay complexity |
| Cursor rendering | DOM overlay | Canvas-drawn | Avoids full canvas redraw on cursor move |
| Undo/redo | Operation stack | State snapshots | Lower memory, granular control |
| Export | Off-screen canvas | Server-side render | No server dependency, instant |
| Large canvas perf | Viewport culling | Web Workers | Simpler, effective for 5K elements |
| Multi-select | Bounding box resize | Per-element handles | Intuitive group behavior |
