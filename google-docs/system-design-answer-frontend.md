# Google Docs - System Design Interview Answer (Frontend Focus)

> **Role Focus**: Frontend Engineer - Rich Text Editor, Real-time Collaboration UI, Presence Indicators, State Management, Accessibility

## Opening Statement

"Today I'll design Google Docs, a real-time collaborative document editing platform. As a frontend engineer, I'll focus on the rich text editor implementation with TipTap/ProseMirror, the real-time collaboration UI with cursor sharing and presence indicators, optimistic updates for low-latency editing, and offline support with local-first architecture."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Rich text editing** - Bold, italic, headings, lists, links, images
2. **Real-time collaboration** - See others' edits appear live
3. **Cursor and selection sharing** - Visual indicators for collaborators
4. **Comments and suggestions** - Inline comments with threads, track changes
5. **Version history** - View and restore previous versions
6. **Document management** - Create, share, organize documents

### Non-Functional Requirements (Frontend-Specific)

- **Latency**: < 50ms for local keystroke response, < 100ms sync to collaborators
- **Offline**: Continue editing without network, sync on reconnect
- **Accessibility**: WCAG 2.1 AA compliant, full keyboard navigation
- **Performance**: Smooth editing on documents up to 100 pages

### Frontend Challenges I'll Focus On

1. **Rich Text Editor**: TipTap/ProseMirror integration with custom extensions
2. **Collaboration UI**: Cursor avatars, selection highlighting, presence list
3. **State Management**: Zustand for UI state, ProseMirror for document state
4. **Offline Support**: IndexedDB for local storage, operation queue
5. **Performance**: Virtualized rendering for large documents

---

## Step 2: Component Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DocumentPage                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Toolbar                                   │    │
│  │  [B][I][U][S] │ [H1][H2][H3] │ [•][1.][✓] │ [Link][Image] │ [...] │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────┐  ┌──────────────────────────┐ │
│  │           Editor                      │  │     Sidebar              │ │
│  │  ┌────────────────────────────────┐  │  │  ┌────────────────────┐  │ │
│  │  │     CollaboratorCursors        │  │  │  │  PresenceList      │  │ │
│  │  │  (overlay layer)               │  │  │  │  Alice (editing)   │  │ │
│  │  └────────────────────────────────┘  │  │  │  Bob (viewing)     │  │ │
│  │  ┌────────────────────────────────┐  │  │  └────────────────────┘  │ │
│  │  │     TipTapEditor               │  │  │  ┌────────────────────┐  │ │
│  │  │  (ProseMirror core)            │  │  │  │  CommentsList      │  │ │
│  │  │                                │  │  │  │  Comment 1         │  │ │
│  │  │  [Document content here...]    │  │  │  │  Comment 2         │  │ │
│  │  │                                │  │  │  └────────────────────┘  │ │
│  │  └────────────────────────────────┘  │  │  ┌────────────────────┐  │ │
│  │  ┌────────────────────────────────┐  │  │  │  VersionHistory    │  │ │
│  │  │     InlineComments             │  │  │  │  Today, 2:30 PM    │  │ │
│  │  │  (margin annotations)          │  │  │  │  Today, 1:15 PM    │  │ │
│  │  └────────────────────────────────┘  │  │  └────────────────────┘  │ │
│  └──────────────────────────────────────┘  └──────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      StatusBar                                   │    │
│  │  [Saving...] │ [3 collaborators] │ [Last edit: 2 min ago]       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Hierarchy

The app structure starts with DocumentListPage containing DocumentGrid (virtualized), NewDocumentButton, and SearchBar. DocumentPage includes Toolbar (FormatButtons, HeadingDropdown, ListButtons, InsertMenu), EditorContainer (CollaboratorCursors overlay, TipTapEditor, InlineComments), Sidebar (PresenceList, CommentsList, VersionHistory), and StatusBar. Additional components include ShareModal, CommentPopover, and SuggestionBubble.

---

## Step 3: Deep Dive - TipTap Editor Implementation (10 minutes)

### Editor Setup with Custom Extensions

"I'm choosing TipTap with ProseMirror as the editor foundation because it provides excellent extension support for collaborative features. The key configuration disables local history since OT handles undo/redo, and integrates collaboration extensions for real-time sync."

The TipTapEditor component configures StarterKit (with history disabled for OT), Collaboration extension connected to the provider document, CollaborationCursor extension for cursor sharing with user name and avatar color, Highlight extension with multicolor support, Link extension with styling, Placeholder extension, and custom CommentMark and SuggestionMark extensions.

The editor props set styling classes for prose formatting, focus outline removal, minimum height, and padding. A useEffect hook updates awareness with cursor position on selectionUpdate events, sending the from/to selection range.

### Custom Comment Mark Extension

The CommentMark extension creates a custom mark with a commentId attribute. It parses from span elements with data-comment-id attributes and renders with yellow background and border styling to indicate commented text. Commands include setComment(commentId) and unsetComment() for applying and removing the mark.

### Custom Suggestion Mark Extension

The SuggestionMark extension handles track changes with attributes for suggestionId, type (insert/delete), authorId, authorName, and authorColor. Insert suggestions render with green background and underline, while delete suggestions render with red background and strikethrough. The border color matches the author's assigned color.

---

## Step 4: Deep Dive - Collaborator Cursors (8 minutes)

### Cursor Overlay Component

"I'm implementing cursor overlays as an absolutely positioned layer above the editor. This approach gives precise control over cursor rendering without interfering with ProseMirror's DOM management."

The CollaboratorCursors component listens to awareness state changes, filtering out the local client and collecting collaborator positions (id, name, color, cursor range). Each collaborator renders a CollaboratorCursor component.

CollaboratorCursor calculates DOM coordinates from the document position using editor.view.coordsAtPos(), subtracting the editor's bounding rectangle to get relative positioning. For range selections (from !== to), it renders a SelectionHighlight component.

The cursor line is a 2px wide div with smooth transitions, positioned absolutely. Above it floats a name label with the collaborator's name on a color-coded background.

### Selection Highlight Component

SelectionHighlight handles both single-line and multi-line selections. For single-line, it creates one DOMRect from start to end coordinates. For multi-line, it iterates through each line, creating separate rectangles. Each rectangle renders as a semi-transparent overlay matching the collaborator's color.

### Presence List Sidebar

The PresenceList component displays all users viewing the document, sorted with active users (those with cursor) first, then alphabetically by name. Each user shows a color indicator dot, their name, and an "editing" status badge if they have an active cursor.

---

## Step 5: Deep Dive - Toolbar Component (5 minutes)

### Rich Text Toolbar

The Toolbar component renders a sticky header with formatting controls organized into groups separated by dividers:

**Undo/Redo Group**: Undo and Redo buttons with disabled state based on editor.can() checks.

**Text Formatting Group**: Bold (Ctrl+B), Italic (Ctrl+I), Underline (Ctrl+U), Strikethrough buttons with isActive state for toggle styling.

**Headings Group**: H1, H2, H3 toggle buttons checking editor.isActive('heading', { level }).

**Lists Group**: Bullet list, Ordered list, and Task/checklist toggle buttons.

**Insert Group**: Link button prompting for URL, Image button prompting for image URL.

**Collaboration Group**: Comment button (disabled when selection is empty), Version history button.

ToolbarButton is a reusable component with onClick, disabled, isActive, and title props. It applies hover/focus styles, disabled opacity, and active state highlighting (blue background for active toggles).

---

## Step 6: Deep Dive - Comments System (5 minutes)

### Inline Comments Component

"I'm positioning comments in the right margin, aligned with their anchor positions in the document. This gives visual context while keeping the main content area clean."

InlineComments tracks commentPositions by finding each comment's mark position in the editor and calculating DOM coordinates. The newCommentAnchor state holds the selection range for new comments.

When adding a comment, the component generates a UUID, applies the comment mark to the selection using editor.chain().setComment(commentId), then saves to the server. On success, the anchor is cleared.

### Comment Card Component

CommentCard renders positioned absolutely based on the comment's top coordinate. It displays:
- Header with author avatar (color circle), name, and relative timestamp
- Comment content text
- Replies section (indented with left border) if replies exist
- Reply input field and button (when active and not resolved)
- Resolve button to close the thread

The card shows active state with blue border and shadow, and resolved state with reduced opacity.

---

## Step 7: Deep Dive - Version History (5 minutes)

### Version History Sidebar

The VersionHistory component groups versions by date using a Map structure. Each date section has a sticky header, and versions within show time, optional named version badge, author name, and changes summary.

Clicking a version triggers handlePreview which fetches the version content from the API and stores it in previewContent state. The selected version highlights with blue background.

The footer shows a "Restore this version" button when a version is selected. A VersionPreviewModal renders the document content in read-only mode for comparison before restoring.

---

## Step 8: State Management (5 minutes)

### Document Store with Zustand

"I'm using Zustand with persist middleware for state management. The store handles UI state while ProseMirror manages document content separately, avoiding duplication."

The DocumentState interface includes:
- **currentUser**: User object or null
- **activeDocumentId/documentMeta**: Currently open document
- **sidebarView**: 'comments' | 'versions' | 'outline' | null
- **isOffline**: Network status boolean
- **saveStatus**: 'saved' | 'saving' | 'error'
- **pendingOperations**: Queue for offline operations

Actions include setCurrentUser, setActiveDocument, setSidebarView, setOffline, setSaveStatus, addPendingOperation, and clearPendingOperations.

The persist middleware saves currentUser and pendingOperations to localStorage, enabling offline recovery.

### Collaboration Provider Hook

useCollaborationProvider manages the WebSocket connection and Yjs document lifecycle. It creates a Y.Doc and WebsocketProvider on mount, sets local awareness state with user info and null cursor, and handles connection status events to update offline state and save status.

The hook returns provider, awareness, connectionStatus, and ydoc reference. Cleanup destroys both provider and document on unmount.

---

## Step 9: Offline Support (3 minutes)

### Offline Queue with IndexedDB

"I'm using IndexedDB via the idb library for structured offline storage. This handles larger documents than localStorage and provides indexed access for efficient queries."

The OfflineQueue class manages two object stores: operations (keyed by id) and documents (keyed by id with content, version, lastModified).

Key methods:
- **queueOperation**: Store pending operation
- **getQueuedOperations**: Retrieve operations for a document, sorted by timestamp
- **clearOperations**: Remove synced operations by ID array
- **saveDocumentLocally**: Cache document content and version
- **getLocalDocument**: Retrieve cached document

### Sync on Reconnect Hook

useOfflineSync monitors isOffline state and syncs pending operations when coming back online. It fetches queued operations from IndexedDB, sends each to the server via provider.send(), clears synced operations on success, and updates the Zustand store.

---

## Step 10: Keyboard Accessibility (3 minutes)

### Keyboard Navigation Hook

useEditorKeyboard sets up global keyboard shortcuts:
- **Ctrl+Alt+M**: Create comment (when text selected)
- **Ctrl+K**: Insert link with URL prompt
- **Ctrl+Alt+1/2/3**: Toggle heading levels
- **Ctrl+Shift+7**: Toggle ordered list
- **Ctrl+Shift+8**: Toggle bullet list

The hook checks for modifier keys (Ctrl/Cmd) and prevents default browser behavior before executing editor commands.

### Focus Management

FocusTrap component manages focus within modals and dialogs. It queries all focusable elements (button, [href], input, select, textarea, [tabindex]), traps Tab/Shift+Tab navigation to cycle between first and last elements, and auto-focuses the first element on activation.

---

## Step 11: Performance Optimizations (2 minutes)

### Large Document Handling

useLargeDocumentOptimizations applies three strategies:

1. **Throttled cursor updates**: Limit awareness updates to 20/second max, reducing WebSocket traffic
2. **Debounced save status**: Delay "saved" indicator by 1 second to avoid flicker
3. **Virtual rendering**: For documents exceeding 100,000 characters, enable scroll handlers that update visible paragraph range on requestAnimationFrame, rendering only visible content

---

## Step 12: Trade-offs (2 minutes)

| Decision | Chosen | Alternative | Trade-off |
|----------|--------|-------------|-----------|
| ✅ TipTap/ProseMirror | Slate.js, Quill | Better OT support, steeper learning curve |
| ✅ Zustand | Redux, Jotai | Simpler API, less boilerplate, smaller bundle |
| ✅ CSS cursor overlay | ProseMirror decorations | More control, but manual position calculations |
| ✅ IndexedDB offline | Service Worker cache | Better for structured data, more complex API |
| ✅ WebSocket (Yjs) | Custom OT implementation | Proven library, less control over protocol |
| ✅ Comment marks | Decorations | Persisted with document, requires anchor tracking |

---

## Closing Summary

"I've designed a collaborative document editor frontend with:

1. **TipTap/ProseMirror integration** with custom extensions for comments and suggestions
2. **Real-time cursor sharing** using awareness protocol with smooth animations
3. **Rich toolbar** with full formatting controls and keyboard shortcuts
4. **Comments system** with inline anchors that track document changes
5. **Offline support** using IndexedDB for local storage and operation queuing
6. **Accessibility** with WCAG 2.1 AA compliance and full keyboard navigation

The key insight is that ProseMirror's transaction model naturally integrates with OT, while the awareness protocol provides low-latency presence sharing. The offline-first architecture ensures editing continues seamlessly during network interruptions."

---

## Potential Follow-up Questions

1. **How would you optimize for very large documents (100+ pages)?**
   - Virtualized rendering (only render visible paragraphs)
   - Lazy loading of document sections
   - Debounced/batched operation broadcasts

2. **How would you implement real-time spell checking?**
   - Web Worker for spell check computation
   - Decorations for underlines (not marks, for performance)
   - Dictionary loaded progressively

3. **How would you handle image uploads in the editor?**
   - Drop zone with preview
   - Upload to object storage, insert placeholder
   - Replace placeholder with final URL on complete
