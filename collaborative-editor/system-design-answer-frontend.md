# Collaborative Editor - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

## Opening Statement (1 minute)

"I'll design the frontend for a real-time collaborative document editor like Google Docs. My focus will be on building a responsive rich text editor with optimistic local updates, implementing client-side Operational Transformation for instant feedback, creating an intuitive presence system showing other users' cursors, and designing state management that handles concurrent edits gracefully.

The core UX challenges are: making edits feel instant despite network latency, visualizing other users' cursors and selections without distraction, handling reconnection gracefully when network drops, and providing clear feedback during conflict resolution."

## Requirements Clarification (3 minutes)

### User Experience Requirements
- **Instant Feedback**: Local edits appear immediately (< 16ms)
- **Presence Awareness**: See who's editing and where
- **Seamless Sync**: Remote changes merge smoothly without disrupting typing
- **Offline Resilience**: Continue editing when disconnected
- **Clear History**: Navigate document versions easily

### Frontend-Specific Requirements
- **Performance**: 60fps during typing, smooth cursor animations
- **Accessibility**: Full keyboard navigation, screen reader support
- **Responsive**: Works on desktop and tablet
- **Touch Support**: Mobile-friendly text selection

### Target Metrics
- Time to interactive: < 2s
- Input latency: < 16ms (1 frame)
- Remote cursor updates: < 100ms
- Bundle size: < 200KB gzipped

## Component Architecture (5 minutes)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              EditorApp                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  EditorHeader                                                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────┐  │  │
│  │  │  DocumentTitle  │  │   ShareButton   │  │    PresenceBar     │  │  │
│  │  └─────────────────┘  └─────────────────┘  └────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  EditorToolbar                                                      │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌─────────┐                   │  │
│  │  │ Bold │ │Italic│ │Lists │ │ Link │ │ History │                   │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └─────────┘                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  EditorCanvas                                                       │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  RichTextEditor                                               │  │  │
│  │  │  ┌────────────────────────────────────────────────────────┐  │  │  │
│  │  │  │  ContentEditable                                        │  │  │  │
│  │  │  │  ┌─────────────────────────────────────────────────┐   │  │  │  │
│  │  │  │  │ Paragraph 1                                      │   │  │  │  │
│  │  │  │  ├─────────────────────────────────────────────────┤   │  │  │  │
│  │  │  │  │ Paragraph 2  [Remote Cursor]                     │   │  │  │  │
│  │  │  │  └─────────────────────────────────────────────────┘   │  │  │  │
│  │  │  └────────────────────────────────────────────────────────┘  │  │  │
│  │  │  ┌────────────────────────────────────────────────────────┐  │  │  │
│  │  │  │  CursorOverlay (remote cursors)                         │  │  │  │
│  │  │  └────────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  SidePanel (contextual)                                             │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                  │  │
│  │  │   VersionHistory    │  │      Comments       │                  │  │
│  │  └─────────────────────┘  └─────────────────────┘                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
┌─ EditorApp
│  ├─ EditorHeader
│  │  ├─ DocumentTitle (inline editable)
│  │  ├─ SaveIndicator (auto-save status)
│  │  ├─ ShareButton + ShareModal
│  │  └─ PresenceBar (user avatars)
│  ├─ EditorToolbar
│  │  ├─ FormatButtons (bold, italic, underline)
│  │  ├─ BlockButtons (heading, list, quote)
│  │  ├─ InsertButtons (link, image, table)
│  │  └─ HistoryButtons (undo, redo, version history)
│  ├─ EditorCanvas
│  │  ├─ RichTextEditor
│  │  │  ├─ ContentEditable
│  │  │  └─ SelectionManager
│  │  ├─ CursorOverlay
│  │  │  └─ RemoteCursor (one per collaborator)
│  │  └─ SelectionOverlay
│  │     └─ RemoteSelection (highlight ranges)
│  ├─ SidePanel
│  │  ├─ VersionHistory (timeline + restore)
│  │  └─ CommentsPanel (threaded comments)
│  └─ ConnectionStatus (banner when disconnected)
```

## Deep Dive: Collaborative Editor Component (10 minutes)

### Core Editor with OT Integration

The CollaborativeEditor component manages the main editing experience:

**Key Props**: documentId, userId

**State from Store**:
- content: current document text
- serverVersion: last acknowledged version
- inflightOp: operation sent but not yet acknowledged
- pendingOps: operations applied locally, not yet sent

**Hooks Used**:
- useSyncEngine: manages WebSocket connection, sends operations/cursors
- usePresence: tracks remote cursors and selections

**Lifecycle**:
1. On mount, subscribe to sync engine for init/ack/operation/resync events
2. On local change, apply operation immediately (optimistic), then send to server
3. On selection change, broadcast cursor position to other users

**UI Structure**:
- Connection status banner (shown when disconnected)
- Main editor container with RichTextEditor component
- CursorOverlay for remote user cursors
- SelectionOverlay for remote user selections
- SyncIndicator showing save status (Offline/Saving.../Saved)

### Rich Text Editor Component

The RichTextEditor handles text input and change detection:

**Core Approach**: Uses contentEditable with manual diff computation

**Key Behaviors**:
- Syncs external content changes while preserving cursor position
- Computes text operations from input events via diffToOperation
- Handles Tab key for indentation
- Handles Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo

**Selection Utilities**:
- saveSelection: captures cursor position as text offset
- restoreSelection: restores cursor after external DOM updates
- getTextOffset: walks DOM tree to compute character offset

### Cursor and Selection Overlays

**CursorOverlay**:
- Renders remote cursors as positioned elements
- Filters out stale cursors (older than 30 seconds)
- Animates cursor appearance/disappearance with Framer Motion
- Shows colored cursor line with username label

**SelectionOverlay**:
- Renders remote selections as semi-transparent highlight rectangles
- Computes DOM rects for selection ranges
- Uses getCoordinatesAtOffset to position highlights

## Deep Dive: State Management (8 minutes)

### Editor Store with OT

The Zustand store manages all editor state:

**Document State**:
- content: current document text
- serverVersion: monotonically increasing version number
- clientId: unique identifier for this client

**Operation State**:
- inflightOp: operation currently awaiting acknowledgment
- inflightOpId: ID of inflight operation
- pendingOps: queue of operations applied locally

**History State**:
- undoStack: inverse operations for undo
- redoStack: inverse operations for redo

**Key Actions**:

**setInitialState**: Initializes document from server, clears all pending state

**applyLocalOperation**:
1. Apply operation to content immediately
2. Compose with pending operations if any
3. Compute inverse for undo stack
4. Clear redo stack

**applyRemoteOperation**:
1. Update server version
2. Transform operation against inflight operation (if any)
3. Transform against all pending operations
4. Apply transformed operation to content
5. Transform undo stack against the operation

**acknowledgeOperation**: Clears inflight, triggers send of next pending

**undo/redo**: Applies inverse operations, maintains stacks

### WebSocket Sync Hook

The useSyncEngine hook manages server communication:

**Connection Management**:
- Establishes WebSocket connection to document endpoint
- Handles onopen, onmessage, onclose, onerror events
- Implements exponential backoff reconnection (1s, 2s, 4s... max 30s)

**Message Handling**:
- init: server sends initial document state
- ack: server acknowledges our operation, flush more pending
- operation: remote operation received, apply to store
- resync: full document resync on error

**Operation Sending**:
- Composes all pending operations into one before sending
- Marks composed operation as inflight
- Uses unique operationId for tracking

**Cursor Broadcasting**:
- Sends cursor position updates via WebSocket

### Presence Hook

The usePresence hook manages collaborative awareness:

**State**:
- remoteCursors: array of cursor positions from other users
- remoteSelections: array of selection ranges from other users
- localCursor: current user's cursor position

**Event Handling**:
- cursor: update remote cursor position
- selection: update remote selection range
- client_join: new user joined document
- client_leave: remove cursor/selection for departed user

**Stale Cursor Cleanup**: Runs every 5 seconds, removes cursors older than 30 seconds

## Deep Dive: Presence Bar and User Avatars (5 minutes)

### Presence Bar Component

The PresenceBar shows collaborators currently in the document:

**Sorting Logic**:
1. Active users first
2. Then by last active time (most recent first)

**Display**:
- Shows up to maxVisible avatars (default 5)
- Overflow users shown in "+N" indicator with dropdown

### UserAvatar Component

**Display Elements**:
- Circular avatar image or initial letter on colored background
- Border color matches user's cursor color
- Activity indicator dot (green = active, gray = away)
- Tooltip on hover showing username and "away" time if inactive

### OverflowIndicator Component

- Shows "+N" badge for additional collaborators
- Dropdown on hover lists all overflow users

## Deep Dive: Version History (5 minutes)

### VersionHistory Component

**State**:
- versions: list of document versions from server
- loading: fetch in progress
- previewVersion: currently previewed version (if any)

**Actions**:
- loadVersions: fetches version list from API
- handlePreview: loads version content for preview
- handleRestore: restores document to selected version (with confirmation)

**UI**:
- Header with title and instructions
- Scrollable list of VersionItem components
- Loading spinner during fetch

### VersionItem Component

**Display**:
- Version label ("Current version" or "Version N")
- Relative timestamp (e.g., "3 hours ago")
- Author name

**Interaction**:
- Click to preview
- "Restore this version" button when previewing (non-current)

## Trade-offs and Alternatives (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Editor | ContentEditable | Prosemirror/Slate | Simpler for learning, direct DOM access |
| State | Zustand | Redux | Lighter weight, simpler OT integration |
| Cursors | Overlay div | SVG | Easier positioning and styling |
| Animations | Framer Motion | CSS | More control over layout animations |
| Diff | Custom OT | diff-match-patch | Learning purpose, OT integration |
| Selection | Manual tracking | Native API | Cross-browser consistency |

### ContentEditable vs Rich Text Framework

**Chose ContentEditable because:**
- Direct control over DOM for OT integration
- No framework abstraction to work around
- Better for learning OT concepts

**Trade-off:** More manual work for formatting, but cleaner OT integration

### CSS Layout

**Main Editor Layout**: CSS Grid with 3 rows (header, toolbar, canvas)

**Editor Canvas**: Grid with main content + 300px side panel

**Mobile Responsive**: Single column layout, side panel slides in as overlay

**Cursor Animations**: 1s blink animation with ease-in-out

## Accessibility Considerations

**Keyboard Shortcuts**:
- Mod-z: Undo
- Mod-Shift-z: Redo
- Mod-b: Bold
- Mod-i: Italic
- Mod-k: Insert link

**Screen Reader Announcements**: Live region announces save status, remote changes, and version restores

## Future Enhancements

1. **Rich Text Formatting** - Bold, italic, headings with operation attributes
2. **Comments** - Inline threaded comments with range anchoring
3. **Offline Mode** - Service worker with IndexedDB for local persistence
4. **Mobile Optimization** - Touch-friendly selection and toolbar
5. **Dark Mode** - Theme support with CSS variables
6. **Keyboard Shortcuts Panel** - Discoverable shortcuts overlay
