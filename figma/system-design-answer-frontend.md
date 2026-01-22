# Figma - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

## Opening Statement

"Today I'll design Figma, a real-time collaborative design platform, focusing on the frontend architecture. The core challenges are building a high-performance WebGL canvas renderer, managing complex editor state with Zustand, implementing real-time collaboration with cursor presence, and creating an intuitive design tool interface with panels for layers and properties."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **WebGL Canvas Editor** - Hardware-accelerated vector graphics with pan/zoom
2. **Shape Tools** - Create rectangles, ellipses, text, frames, groups
3. **Selection System** - Click, shift-click, marquee selection with resize handles
4. **Layers Panel** - Hierarchical object list with visibility/lock toggles
5. **Properties Panel** - Live-updating form for selected object properties
6. **Real-time Cursors** - See collaborators' cursor positions and selections
7. **Version History** - Browse and restore previous versions
8. **File Browser** - Grid view of files with create/delete actions

### Non-Functional Requirements

- **Performance**: 60fps canvas rendering with 10,000+ objects
- **Latency**: < 50ms for local operations, cursor updates visible within 100ms
- **Responsiveness**: Usable on 1280px+ screens, graceful degradation on smaller
- **Accessibility**: Keyboard shortcuts, focus management, screen reader support for panels

### Out of Scope

- Component library management
- Prototyping/interactions
- Export functionality
- Plugin system

---

## Step 2: Frontend Architecture Overview (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              App.tsx                                        │
│                    (Route: FileBrowser <-> Editor)                          │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
┌──────────────────────┐               ┌───────────────────────────────────────┐
│    FileBrowser.tsx   │               │              Editor.tsx               │
│  ┌────────────────┐  │               │  (Main workspace container)           │
│  │ File grid      │  │               │                                       │
│  │ Create/Delete  │  │               │  ┌─────────────────────────────────┐  │
│  └────────────────┘  │               │  │           Toolbar.tsx           │  │
└──────────────────────┘               │  │  [Select|Hand|Shapes|Zoom|User] │  │
                                       │  └─────────────────────────────────┘  │
                                       │                                       │
                                       │  ┌─────────┬───────────┬───────────┐  │
                                       │  │ Layers  │  Canvas   │ Properties│  │
                                       │  │ Panel   │           │  Panel    │  │
                                       │  │ .tsx    │  .tsx     │  .tsx     │  │
                                       │  └─────────┴───────────┴───────────┘  │
                                       │                                       │
                                       │  ┌─────────────────────────────────┐  │
                                       │  │    VersionHistory.tsx (Modal)   │  │
                                       │  └─────────────────────────────────┘  │
                                       └───────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Framework | React 19 | Component architecture, hooks |
| Build | Vite | Fast HMR, TypeScript |
| State | Zustand | Global editor state |
| Rendering | PixiJS (WebGL) | GPU-accelerated canvas |
| Styling | Tailwind CSS | Utility-first styles |
| WebSocket | Native API | Real-time sync |
| Routing | TanStack Router | File browser navigation |

---

## Step 3: Deep Dive - PixiJS Canvas Renderer (10 minutes)

### Why PixiJS for Design Tools

PixiJS provides hardware-accelerated 2D rendering via WebGL with a simple API.

### PixiRenderer Class Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                       PixiRenderer                              │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  PIXI.Application │  │  objectMap       │                    │
│  │  (WebGL context)  │  │  Map<id, DisplayObject>              │
│  └──────────────────┘  └──────────────────┘                    │
│                                                                 │
│  PIXI.Stage                                                     │
│  ├── objectsContainer    (z-index 0: design objects)           │
│  ├── selectionContainer  (z-index 1: selection bounds/handles) │
│  └── presenceContainer   (z-index 2: collaborator cursors)     │
│                                                                 │
│  Methods:                                                       │
│  • render(canvasData, selectedIds, viewport)                   │
│  • renderPresence(collaborators, viewport)                     │
│  • hitTest(x, y) → objectId | null                             │
│  • destroy()                                                    │
└────────────────────────────────────────────────────────────────┘
```

**Rendering flow:**
1. Apply viewport transform (pan + zoom) to objectsContainer
2. Sync objects: remove deleted, add new, update existing
3. Apply visibility and opacity to each display object
4. Update selection overlay for selected objects

### ShapeFactory for Object Types

```
┌─────────────────────────────────────────────────────┐
│                    ShapeFactory                      │
├─────────────────────────────────────────────────────┤
│  create(obj: DesignObject) → Graphics | Text        │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Rectangle   │  │  Ellipse    │  │   Text      │ │
│  │ drawRect()  │  │ drawEllipse │  │ PIXI.Text   │ │
│  │ fill+stroke │  │ fill+stroke │  │ TextStyle   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                      │
│  update(displayObj, obj) - sync position, rotation  │
│  colorToHex(cssColor) - convert #hex to 0xhex      │
└─────────────────────────────────────────────────────┘
```

### SelectionOverlay with Resize Handles

```
┌─────────────────────────────────────────────────┐
│              Selection Overlay                   │
│                                                  │
│      [NW]────────[N]────────[NE]                │
│        │                      │                  │
│        │    Selection Box     │                  │
│        │    (blue outline)    │                  │
│       [W]                    [E]                 │
│        │                      │                  │
│        │                      │                  │
│      [SW]────────[S]────────[SE]                │
│                                                  │
│  8 resize handles (8x8 white squares)           │
│  Cursor changes per handle direction            │
└─────────────────────────────────────────────────┘
```

---

## Step 4: Deep Dive - Zustand State Management (10 minutes)

### Editor Store Design

```
┌────────────────────────────────────────────────────────────────────┐
│                         EditorStore                                 │
├────────────────────────────────────────────────────────────────────┤
│  State:                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │ canvasData       │  │ selectedIds[]    │  │ activeTool       │ │
│  │ { objects: [] }  │  │ string[]         │  │ select|hand|...  │ │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘ │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │ viewport         │  │ collaborators[]  │  │ history[]        │ │
│  │ {x, y, zoom}     │  │ Presence[]       │  │ CanvasData[]     │ │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘ │
│                                                                     │
│  Actions:                                                           │
│  • setCanvasData(data)      • addObject(obj)                       │
│  • updateObject(id, patch)  • deleteObjects(ids)                   │
│  • setSelectedIds(ids)      • setActiveTool(tool)                  │
│  • setViewport(viewport)    • updateCollaborators(list)            │
│  • undo() / redo()          • pushHistory()                        │
└────────────────────────────────────────────────────────────────────┘
```

### Immer for Immutable Updates

Using `zustand/middleware/immer` enables direct mutations in reducers while maintaining immutability. This simplifies complex nested updates like `state.canvasData.objects[idx].x = newX`.

### Derived Selectors

```
┌─────────────────────────────────────────────────────────┐
│                    Derived Selectors                     │
├─────────────────────────────────────────────────────────┤
│  useSelectedObjects()                                    │
│  → filters objects by selectedIds                        │
│                                                          │
│  useSingleSelectedObject()                               │
│  → returns object if exactly one selected, else null    │
│                                                          │
│  useCanUndo() / useCanRedo()                            │
│  → boolean based on historyIndex position               │
│                                                          │
│  useActiveCollaborators()                                │
│  → filters out current user from collaborators list     │
└─────────────────────────────────────────────────────────┘
```

---

## Step 5: Deep Dive - Canvas Component with Event Handling (8 minutes)

### Event Flow Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                      Canvas Event Handling                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Mouse Down                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│  │ Tool: Hand  │    │ Tool: Select│    │ Tool: Shape │            │
│  │ → pan mode  │    │ → hit test  │    │ → create obj│            │
│  └─────────────┘    └──────┬──────┘    └─────────────┘            │
│                            │                                        │
│                    ┌───────┴───────┐                               │
│                    ▼               ▼                                │
│              Hit Object?     No Hit                                 │
│              → move mode     → clear selection                     │
│                                                                     │
│  Mouse Move (while dragging)                                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│  │ Pan Mode    │    │ Move Mode   │    │ Draw Mode   │            │
│  │ → viewport  │    │ → objects   │    │ → resize    │            │
│  │   offset    │    │   x,y delta │    │   new shape │            │
│  └─────────────┘    └─────────────┘    └─────────────┘            │
│                                                                     │
│  Mouse Up                                                           │
│  → pushHistory() if move or draw completed                         │
│                                                                     │
│  Mouse Wheel                                                        │
│  → zoom toward cursor position                                     │
│  → clamp zoom between 0.1 and 5                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Coordinate Conversion

```
screenToCanvas(screenX, screenY):
  canvasX = (screenX - viewport.x) / viewport.zoom
  canvasY = (screenY - viewport.y) / viewport.zoom
```

---

## Step 6: Deep Dive - Panels and UI Components (5 minutes)

### Layers Panel Architecture

```
┌──────────────────────────────────────────┐
│              Layers Panel                 │
│  ┌────────────────────────────────────┐  │
│  │ Header: "Layers"                   │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │ Layer Item (reversed z-order)      │  │
│  │ ┌────┬────────────────┬────┬────┐ │  │
│  │ │Icon│   Object Name   │ 👁 │ 🔒 │ │  │
│  │ └────┴────────────────┴────┴────┘ │  │
│  │                                    │  │
│  │ • Click: select (replace)         │  │
│  │ • Shift+Click: toggle selection   │  │
│  │ • Eye icon: toggle visibility     │  │
│  │ • Lock icon: toggle locked        │  │
│  └────────────────────────────────────┘  │
│  (scrollable list)                       │
└──────────────────────────────────────────┘
```

### Properties Panel Architecture

```
┌──────────────────────────────────────────┐
│           Properties Panel                │
├──────────────────────────────────────────┤
│  [No selection: "Select an object..."]   │
│                                           │
│  Position Section                         │
│  ┌──────────┬──────────┐                 │
│  │ X: [___] │ Y: [___] │                 │
│  │ W: [___] │ H: [___] │                 │
│  └──────────┴──────────┘                 │
│                                           │
│  Appearance Section                       │
│  ┌──────────────────────┐                │
│  │ Fill:   [■] #cccccc  │                │
│  │ Stroke: [■] #000000  │                │
│  │ Stroke Width: [___]  │                │
│  │ Opacity: [___] %     │                │
│  └──────────────────────┘                │
│                                           │
│  Text Section (if type=text)             │
│  ┌──────────────────────┐                │
│  │ [textarea for text]  │                │
│  │ Font Size: [___]     │                │
│  └──────────────────────┘                │
│                                           │
│  Changes trigger updateObject()          │
│  onBlur triggers pushHistory()           │
└──────────────────────────────────────────┘
```

---

## Step 7: Real-time Collaboration Hook (3 minutes)

### WebSocket Message Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   WebSocket Communication                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Client → Server:                                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ subscribe      │  │ operation      │  │ presence       │    │
│  │ {fileId,       │  │ {operations:   │  │ {cursor: {x,y},│    │
│  │  userId,       │  │  [{type,       │  │  selection:    │    │
│  │  userName}     │  │    objectId,   │  │  [...ids]}     │    │
│  │                │  │    payload}]}  │  │                │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                  │
│  Server → Client:                                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ sync           │  │ operation      │  │ presence       │    │
│  │ {file: {       │  │ {operations:   │  │ {presence:     │    │
│  │   canvasData}, │  │  [...]}        │  │  [{userId,     │    │
│  │  yourColor}    │  │ (broadcast)    │  │    cursor}]}   │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                  │
│  Reconnection: 2s backoff on close                              │
└─────────────────────────────────────────────────────────────────┘
```

### Operation Types

| Type | Payload | Description |
|------|---------|-------------|
| create | Full DesignObject | New shape added |
| update | Partial properties | Object modified |
| delete | objectId only | Object removed |

---

## Step 8: Trade-offs and Decisions (2 minutes)

### Key Trade-offs

| Decision | Trade-off |
|----------|-----------|
| PixiJS over raw Canvas 2D | Higher memory, but 60fps with complex scenes |
| Zustand over Redux | Less boilerplate, simpler for this use case |
| Full rerender on state change | Simpler logic vs. fine-grained updates |
| In-memory undo history | Limited to 50 steps to save memory |
| Immediate property updates | Responsive feel, but more WebSocket traffic |

### Alternatives Considered

1. **Raw WebGL shaders**
   - More control but significantly more complex
   - PixiJS abstracts the shader complexity

2. **Canvas 2D API**
   - Simpler but slower with many objects
   - No GPU acceleration

3. **React-konva**
   - React integration built-in
   - Less flexibility than raw PixiJS

---

## Closing Summary

"I've designed the frontend architecture for a Figma-like collaborative design tool with:

1. **PixiJS Renderer** - GPU-accelerated canvas with object management, selection overlays, and collaborator cursors
2. **Zustand State Management** - Centralized store with immer for immutable updates, history for undo/redo
3. **Canvas Component** - Event handling for selection, moving, drawing, panning, and zooming
4. **Panels** - Layers panel with visibility/lock, Properties panel with live updates
5. **WebSocket Hook** - Real-time collaboration with reconnection logic

The key insight is separating rendering (PixiJS) from state (Zustand) and letting React orchestrate the data flow. Happy to dive deeper into any component."

---

## Future Enhancements

1. **Virtual Rendering** - Only render objects in viewport for 100k+ object files
2. **Web Workers** - Offload hit testing and geometry calculations
3. **Gesture Support** - Touch events for tablet users
4. **Keyboard Shortcuts** - Full shortcut system with customization
5. **Accessibility** - Screen reader support for layer navigation
