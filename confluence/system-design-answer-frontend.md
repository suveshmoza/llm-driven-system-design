# System Design: Confluence Wiki (Frontend Focus)

## 🎯 1. Requirements Clarification

> "I will design the frontend for a Confluence-like wiki platform. The key frontend challenges are: rendering a recursive page tree in the sidebar with drag-and-drop reordering, building a rich text editor with contentEditable and a formatting toolbar, rendering structured macros as interactive React components, displaying version diffs in a side-by-side viewer, and managing complex page state. I will scope out real-time collaborative editing and file attachments."

**Functional Requirements:**
- Space dashboard showing recent pages and spaces
- Sidebar page tree with expandable/collapsible nodes and drag-and-drop reordering
- Page viewer rendering wiki-styled HTML content with macros
- Rich text editor with formatting toolbar (bold, italic, headings, lists, links, macros)
- Version history timeline with side-by-side diff viewer
- Threaded comment section with resolve/unresolve
- Content approval banner with request/approve/reject actions
- Full-text search with highlighted result snippets
- Breadcrumb navigation reflecting page hierarchy

**Non-Functional Requirements:**
- Instant page tree expand/collapse (< 50ms)
- Editor input latency < 16ms (60fps typing)
- Smooth diff rendering for pages with 1000+ lines
- Page tree rendering for spaces with 500+ pages
- Responsive layout for desktop and tablet viewports

---

## 🧩 2. Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      App Shell                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │                    Router                          │  │
│  │  ┌──────────┬────────────┬───────────┬─────────┐  │  │
│  │  │Dashboard │ Space View │ Page View │ Search  │  │  │
│  │  │          │            │           │ Results │  │  │
│  │  └──────────┴────────────┴───────────┴─────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Layout Components:                                     │
│  ┌──────────────┐  ┌──────────────────────────────┐    │
│  │   Sidebar    │  │       Main Content Area       │    │
│  │  ┌────────┐  │  │  ┌────────────────────────┐  │    │
│  │  │PageTree│  │  │  │  Breadcrumbs           │  │    │
│  │  │(recurs)│  │  │  │  PageViewer / Editor   │  │    │
│  │  │        │  │  │  │  CommentSection        │  │    │
│  │  │        │  │  │  │  VersionHistory        │  │    │
│  │  └────────┘  │  │  └────────────────────────┘  │    │
│  └──────────────┘  └──────────────────────────────┘    │
│                                                         │
│  State Layer:                                           │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐        │
│  │AuthStore │  │ SpaceStore│  │  EditorStore  │        │
│  │(Zustand) │  │ (Zustand) │  │  (Zustand)   │        │
│  └──────────┘  └───────────┘  └──────────────┘        │
│                                                         │
│  Service Layer:                                         │
│  ┌──────────────┐  ┌────────────────┐                  │
│  │  API Client  │  │  Search Client │                  │
│  │  (REST/fetch)│  │  (debounced)   │                  │
│  └──────────────┘  └────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

### State Management

| Store | Update Frequency | Contents |
|-------|-----------------|----------|
| **AuthStore** | Rarely (login/logout) | Current user, loading state |
| **SpaceStore** | On navigation | Current space, page tree, selected page, breadcrumbs |
| **EditorStore** | On every keystroke | Editor content, dirty flag, format state, macro list |

> "I chose Zustand over Redux because wiki editing state changes on every keystroke. Zustand's selector-based subscriptions mean that typing in the editor only re-renders the editor component, not the sidebar tree or the breadcrumbs. With Redux, achieving this granularity requires careful memoization that is easy to get wrong."

---

## 🔧 3. Deep Dive: Rich Text Editor Architecture

> "The editor is the core interactive component. Users expect formatting shortcuts, toolbar buttons, macro insertion, and immediate visual feedback. The fundamental choice is between contentEditable and a structured editor framework like ProseMirror or Tiptap."

### contentEditable Approach

```
┌─────────────────────────────────────────────────┐
│  Formatting Toolbar                              │
│  [B] [I] [U] [H1] [H2] [H3] [UL] [OL] [Link]  │
│  [Info] [Warning] [Note] [Code] [TOC]            │
├─────────────────────────────────────────────────┤
│                                                  │
│  contentEditable div                             │
│  ┌──────────────────────────────────────────┐   │
│  │ <h1>Page Title</h1>                      │   │
│  │ <p>Some paragraph text with <b>bold</b>  │   │
│  │ and <i>italic</i> formatting.</p>         │   │
│  │                                           │   │
│  │ <div class="macro macro-info">            │   │
│  │   ℹ️ This is an info callout              │   │
│  │ </div>                                    │   │
│  │                                           │   │
│  │ <p>More text after the macro.</p>         │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### How Formatting Works

> "When the user clicks the Bold button or presses Ctrl+B, I execute `document.execCommand('bold')` which wraps the current selection in a `<b>` tag. The contentEditable div handles cursor management, text selection, and insertion point tracking natively. The toolbar reads the current selection state to highlight active formats -- if the cursor is inside a `<b>` tag, the Bold button appears pressed."

**Toolbar state detection flow:**

```
User moves cursor or changes selection
       │
       ▼
onSelectionChange event fires
       │
       ▼
queryCommandState('bold')     -> true/false -> highlight B button
queryCommandState('italic')   -> true/false -> highlight I button
queryCommandState('underline')-> true/false -> highlight U button
queryCommandValue('formatBlock') -> 'h1','h2','p' -> highlight heading button
       │
       ▼
Update toolbar UI (active format indicators)
```

### Trade-off: contentEditable vs ProseMirror/Tiptap

| Approach | Pros | Cons |
|----------|------|------|
| ✅ contentEditable | Zero dependencies, native browser behavior, small bundle | Limited undo/redo, inconsistent across browsers, unstructured content |
| ❌ ProseMirror/Tiptap | Structured editing, collaborative-ready, consistent behavior | 50-100KB bundle, significant learning curve, complex state model |

> "I chose contentEditable because this is a wiki editor, not Google Docs. Users write documentation -- headings, paragraphs, lists, and macros. They do not need real-time collaboration, complex table editing, or drag-and-drop content blocks. contentEditable handles these basic formatting needs natively with zero bundle cost. The trade-off is browser inconsistency: Firefox and Chrome handle `execCommand` slightly differently for list nesting and heading insertion. Production Confluence would use Tiptap or ProseMirror to eliminate these inconsistencies and enable collaborative editing, but for the scope of this design, contentEditable is sufficient."

### Macro Insertion in the Editor

> "When a user clicks the 'Info' macro button in the toolbar, I insert a styled div at the current cursor position with contentEditable=true on the inner content area. This creates an editable region within the macro container."

```
User clicks [Info] button
       │
       ▼
Get current cursor position (window.getSelection())
       │
       ▼
Create macro HTML:
  <div class="macro macro-info" contenteditable="false">
    <div class="macro-content" contenteditable="true">
      Type here...
    </div>
  </div>
       │
       ▼
Insert at cursor position
       │
       ▼
Focus the inner editable div
```

> "The outer div has contentEditable=false so users cannot accidentally edit the macro structure. The inner content area has contentEditable=true so they can type within the callout. This nested contentEditable pattern is well-supported across browsers and gives macros a distinct visual boundary."

---

## 🔧 4. Deep Dive: Recursive Tree Rendering Performance

> "The page tree sidebar must render a hierarchical list of all pages in a space, with expand/collapse behavior, visual nesting indicators, and drag-and-drop reordering. The challenge is performance: a space can have 500+ pages nested 5+ levels deep."

### Recursive PageTree Component

```
┌────────────────────────┐
│  Sidebar               │
│                        │
│  ▼ Engineering         │  ← expanded (bold = current)
│    ▼ Backend           │  ← expanded
│      ● API Design      │  ← current page
│      ○ Database Guide  │
│      ○ Auth Patterns   │
│    ▶ Frontend          │  ← collapsed (children hidden)
│    ▶ DevOps            │  ← collapsed
│  ▶ Product             │  ← collapsed
│  ▶ Design              │  ← collapsed
│                        │
└────────────────────────┘
```

> "The tree component recursively renders itself: each PageTreeNode checks if it has children, and if expanded, maps over its children to render another set of PageTreeNodes. The recursion naturally handles arbitrary nesting depth."

### Performance Optimization: Lazy Expansion

> "With 500 pages and an average branching factor of 10, expanding the full tree would render 500 React components simultaneously. Instead, I only render children of expanded nodes. A collapsed node with 50 descendants renders as a single component."

```
Space has 500 pages total
       │
Initial render: only root-level pages (typically 5-10)
       │
User expands "Engineering" (20 children)
       │
Now rendering: 5 root + 20 Engineering children = 25 components
       │
User expands "Backend" (8 children)
       │
Now rendering: 5 + 20 + 8 = 33 components
```

> "The expanded/collapsed state is stored in a Set in the SpaceStore. Toggling expansion is O(1) -- add or delete from the Set. The tree data itself comes from the API as a flat list with parent_id references, and I build the tree structure in-memory on the client once when the space loads."

### Building the Tree from Flat Data

> "The API returns pages as a flat array with parent_id. I transform this into a nested tree structure in a single O(n) pass using a lookup map."

```
API returns flat list:
[
  { id: 1, parent_id: null, title: "Engineering" },
  { id: 2, parent_id: 1, title: "Backend" },
  { id: 3, parent_id: 2, title: "API Design" },
  { id: 4, parent_id: 1, title: "Frontend" },
]

Build lookup map: { 1: node1, 2: node2, 3: node3, 4: node4 }
For each node: lookup[parent_id].children.push(node)

Result tree:
Engineering
├── Backend
│   └── API Design
└── Frontend
```

> "This O(n) transformation runs once per space load and is cached in the SpaceStore. Subsequent renders simply walk the cached tree. Even with 1,000 pages, the transformation takes under 5ms."

### Drag-and-Drop Reordering

> "Users can drag a page in the sidebar to reorder within its siblings or move to a different parent. I track three pieces of state during a drag operation: the dragged page, the drop target, and the drop position (before, after, or as-child-of the target)."

```
Drag "API Design" from Backend to Frontend:

Before:                          After:
Engineering                      Engineering
├── Backend                      ├── Backend
│   ├── API Design  ← drag      │   └── Auth Patterns
│   └── Auth Patterns            └── Frontend
└── Frontend         ← drop         └── API Design
```

> "On drop, I send a PUT /pages/:id/move request with the new parent_id and position. The frontend optimistically reorders the tree in the SpaceStore immediately, then rolls back if the API returns an error. The backend wraps the move in a transaction to reorder siblings at both source and destination."

---

## 🔧 5. Deep Dive: Real-Time Collaboration Considerations

> "While I am not implementing full real-time collaboration, it is worth discussing how the architecture would evolve to support it, since this is a natural follow-up question in a frontend interview."

### Current Architecture (No Collaboration)

```
Editor A saves ──▶ PUT /pages/:id ──▶ PostgreSQL
                                          │
Editor B loads  ──▶ GET /pages/:id ──▶ (gets latest)
```

> "Without collaboration, the last writer wins. If Editor A and Editor B both load version 3, edit independently, and save, whichever save arrives last overwrites the other. The version control system preserves both versions, so no data is truly lost, but the second editor does not know their edit conflicted."

### Adding Collaboration: WebSocket + CRDT

```
Editor A ──▶ WebSocket ──▶ Collaboration Server ──◀── WebSocket ──◀── Editor B
                                  │
                           CRDT Document
                           (shared state)
                                  │
                          Periodic persistence
                                  │
                            PostgreSQL
```

> "Real-time collaboration requires replacing contentEditable with a CRDT-backed editor like Yjs + Tiptap. Each keystroke generates a CRDT operation that is broadcast via WebSocket to all other editors. The CRDT guarantees convergence -- all editors see the same document regardless of message ordering. This is a significant architectural change: the editor must switch from storing raw HTML to storing structured operations, and the save model changes from 'save entire document' to 'persist accumulated operations periodically.'"

### Trade-off: contentEditable vs CRDT Editor

| Approach | Pros | Cons |
|----------|------|------|
| ✅ contentEditable (current) | Zero dependencies, simple save model, native performance | No collaboration, inconsistent cross-browser, last-writer-wins |
| ❌ Yjs + Tiptap | Real-time collaboration, structured editing, conflict-free | 150KB+ bundle, WebSocket infrastructure, fundamentally different architecture |

> "The key insight is that adding collaboration is not incremental -- it requires replacing the entire editor subsystem, adding WebSocket infrastructure, and changing the persistence model. This is why I designed the current system with clean separation between the editor and the data layer. If collaboration becomes a requirement, only the editor component and the save/load API calls need to change; the page tree, macros, comments, and approval workflow remain untouched."

---

## 📄 6. Page Viewer and Macro Rendering

### Wiki Content Styling

> "The page viewer renders `content_html` from the API using `dangerouslySetInnerHTML`. The wiki content area has scoped CSS that styles standard HTML elements (headings, paragraphs, lists, tables, links) with Confluence-like typography -- larger heading sizes, comfortable line heights, and proper spacing between elements."

### Macro Rendering as React Components

> "Macros stored in `content_json` are rendered as React components. Each macro type has a dedicated component that handles its specific styling and behavior."

```
┌──────────────────────────────────────────────┐
│  MacroRenderer                                │
│                                               │
│  ┌──────────────────────────────────────┐    │
│  │  ℹ️ Info Macro                       │    │
│  │  ┌──────────────────────────────┐    │    │
│  │  │ Blue left border, light      │    │    │
│  │  │ blue background. Used for    │    │    │
│  │  │ informational callouts.      │    │    │
│  │  └──────────────────────────────┘    │    │
│  └──────────────────────────────────────┘    │
│                                               │
│  ┌──────────────────────────────────────┐    │
│  │  ⚠️ Warning Macro                   │    │
│  │  ┌──────────────────────────────┐    │    │
│  │  │ Orange left border, light    │    │    │
│  │  │ yellow background. Used for  │    │    │
│  │  │ important cautions.          │    │    │
│  │  └──────────────────────────────┘    │    │
│  └──────────────────────────────────────┘    │
│                                               │
│  ┌──────────────────────────────────────┐    │
│  │  📑 TOC Macro                        │    │
│  │  ┌──────────────────────────────┐    │    │
│  │  │ 1. Introduction              │    │    │
│  │  │ 2. Getting Started           │    │    │
│  │  │    2.1 Installation          │    │    │
│  │  │    2.2 Configuration         │    │    │
│  │  │ 3. API Reference             │    │    │
│  │  └──────────────────────────────┘    │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

> "The TOC macro is generated client-side by scanning the rendered HTML for heading tags. I query the content area DOM for all h1-h6 elements, extract their text and nesting level, and render a clickable table of contents with smooth scroll-to-heading behavior. This means the TOC updates dynamically as the user edits in the editor view."

---

## 📜 7. Version History and Diff Viewer

### Version Timeline

```
┌────────────────────────────────────────────┐
│  Version History                            │
│                                             │
│  ● v5 (current)   Alice   2 hours ago      │
│  │  "Updated API endpoints section"         │
│  │                                          │
│  ○ v4             Bob     1 day ago         │
│  │  "Added authentication details"          │
│  │                                          │
│  ○ v3             Alice   3 days ago        │
│  │  "Restructured page layout"              │
│  │                                          │
│  ○ v2             Charlie 1 week ago        │
│  │  "Initial content draft"                 │
│  │                                          │
│  ○ v1             Alice   2 weeks ago       │
│     "Created page"                          │
│                                             │
│  [Compare Selected]  [Restore v4]           │
└────────────────────────────────────────────┘
```

### Side-by-Side Diff Viewer

> "When comparing two versions, the diff viewer shows them side by side with color-coded changes. The API returns an array of diff segments, each marked as added, removed, or unchanged."

```
┌─────────────────────────┬─────────────────────────┐
│  Version 3               │  Version 5               │
├─────────────────────────┼─────────────────────────┤
│  # API Design            │  # API Design            │
│                          │                          │
│  ## Overview             │  ## Overview             │
│  ░░░░░░░░░░░░░░░░░░░░░░ │  The API uses REST...   │  ← green (added)
│  The API follows...      │  The API follows...      │
│  standard patterns       │  standard patterns       │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │                          │  ← red (removed)
│  with rate limiting      │                          │
│                          │                          │
│  ## Endpoints            │  ## Endpoints            │
│  GET /api/users          │  GET /api/v1/users       │  ← yellow (modified)
└─────────────────────────┴─────────────────────────┘
```

> "I render diffs using a simple mapping: each segment gets a CSS class -- `diff-added` (green background), `diff-removed` (red background), or `diff-unchanged` (no highlight). The two panels scroll in sync using a shared scroll handler that sets scrollTop on both containers simultaneously."

---

## 🔍 8. Search Experience

### Search Results UI

```
┌─────────────────────────────────────────────────┐
│  🔍 [search query                          ] [⏎] │
│                                                   │
│  3 results in "Engineering" space                 │
│                                                   │
│  📄 API Design Guide                             │
│     Engineering > Backend > API Design            │
│     ...the REST API uses **search query** for     │
│     authentication and...                         │
│                                                   │
│  📄 Getting Started                               │
│     Engineering > Onboarding                      │
│     ...configure the **search query** in your     │
│     local environment...                          │
│                                                   │
│  📄 Architecture Overview                         │
│     Engineering > Architecture                    │
│     ...the **search query** pattern ensures       │
│     consistent behavior across...                 │
│                                                   │
└─────────────────────────────────────────────────┘
```

> "Search input is debounced at 300ms to avoid overwhelming the backend with keystroke-by-keystroke queries. The Elasticsearch response includes highlighted snippets with matching terms wrapped in `<em>` tags, which I render with bold styling. Results show the breadcrumb trail so users understand where each page lives in the space hierarchy."

---

## 🗂️ 9. State Management Details

### SpaceStore Structure

> "The SpaceStore manages the most complex state in the application: the page tree, expansion state, and the currently selected page."

| Field | Type | Purpose |
|-------|------|---------|
| currentSpace | Space or null | Currently viewed space metadata |
| pageTree | TreeNode[] | Nested tree built from flat API response |
| expandedNodes | Set of string | Page IDs of expanded tree nodes |
| selectedPageId | string or null | Currently viewed page |
| breadcrumbs | Page[] | Ancestor chain for current page |
| isTreeLoading | boolean | Loading state for sidebar |

### EditorStore Structure

| Field | Type | Purpose |
|-------|------|---------|
| isEditing | boolean | View mode vs edit mode toggle |
| content | string | Current HTML content in the editor |
| isDirty | boolean | Whether unsaved changes exist |
| activeFormats | Set of string | Currently active text formats at cursor |
| originalContent | string | Content when edit started (for discard) |

> "The isDirty flag is checked before navigation and before closing the tab. If the user has unsaved changes, I show a confirmation dialog using the beforeunload event. This prevents accidental data loss during editing."

---

## 📱 10. Responsive Layout

| Viewport | Sidebar | Content Area | Editor Toolbar |
|----------|---------|-------------|----------------|
| Desktop (1200px+) | 280px fixed sidebar | Fluid main area | Full toolbar with labels |
| Tablet (768-1199px) | Collapsible overlay | Full width when sidebar closed | Compact icons only |
| Mobile (< 768px) | Hidden, hamburger toggle | Full width | Scrollable single-row toolbar |

> "The sidebar and content area use a CSS Grid layout with `grid-template-columns: 280px 1fr`. On tablet, the sidebar transitions to an overlay that slides in from the left. On mobile, the sidebar is accessible via a hamburger menu. The page tree is always available regardless of viewport size -- hiding it completely would make navigation impossible in deeply nested spaces."

---

## ♿ 11. Accessibility

- **Keyboard navigation:** Arrow keys navigate the page tree (up/down between siblings, right to expand, left to collapse)
- **ARIA tree role:** The page tree uses `role="tree"` with `role="treeitem"` on each node, `aria-expanded` for collapse state
- **Editor keyboard shortcuts:** Standard shortcuts (Ctrl+B, Ctrl+I, Ctrl+U) are intercepted and mapped to formatting commands
- **Focus management:** Entering edit mode focuses the editor; saving returns focus to the page viewer
- **Color contrast:** Diff viewer uses color plus text markers (+/-) so diffs are readable without color perception
- **Skip links:** A skip-to-content link bypasses the sidebar for keyboard users

---

## ⚖️ 12. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Editor approach | contentEditable | ProseMirror/Tiptap | Zero bundle cost, sufficient for wiki editing |
| Tree rendering | Recursive components | Flat list with indent | Natural nesting, handles arbitrary depth |
| Tree data structure | Client-side tree build | Server returns nested JSON | Flat data is cheaper to transfer, O(n) transform |
| Expansion state | In-memory Set | LocalStorage persistence | Simpler, resets on space switch intentionally |
| Diff rendering | Side-by-side panels | Inline unified diff | Easier to compare visually, Confluence convention |
| State management | Zustand (3 stores) | Redux | Selector subscriptions prevent editor cascade |
| Macro rendering | Dual (server HTML + client React) | Server-only | Client rendering enables interactive macros (TOC) |
| Search debounce | 300ms | No debounce / 100ms | Balances responsiveness with API load |
| Drag-and-drop | Custom handlers | react-dnd library | Fewer dependencies, tree-specific logic is simpler custom |
| Routing | TanStack Router | React Router | Type-safe params, space key in URL |
