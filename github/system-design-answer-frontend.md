# System Design Interview: GitHub - Code Hosting Platform (Frontend Focus)

## Role Focus

> This answer emphasizes **frontend architecture**: repository file browser, code viewer with syntax highlighting, pull request diff visualization, inline review comments, search results with highlighting, and real-time notifications.

---

## Opening Statement

"Today I'll design the frontend for a code hosting platform like GitHub. The core UI challenges are building a performant file browser for large repositories, rendering code with syntax highlighting, displaying pull request diffs with inline commenting, and implementing real-time notifications for collaborative workflows."

---

## Step 1: Requirements Clarification (3 minutes)

### Functional Requirements

1. **Repository Browser**: Navigate file trees, view file contents with syntax highlighting
2. **Pull Request UI**: Display diffs, inline comments, review submission
3. **Code Search**: Search results with highlighted matches
4. **Notifications**: Real-time updates for mentions, reviews, CI status
5. **Responsive Design**: Desktop-first with mobile support

### Non-Functional Requirements

- **Performance**: File tree renders < 100ms, diffs virtualized for large PRs
- **Accessibility**: Full keyboard navigation, screen reader support
- **SEO**: Server-rendered for public repositories (optional)
- **Offline**: Basic caching for recently viewed files

### Scale Assumptions

- Single repository may have 100,000+ files
- PR diffs can span 1000+ files with 10,000+ line changes
- Users expect instant navigation between files

---

## Step 2: Component Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Root Layout                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Header / Navigation                       │   │
│  │  [Logo] [Search Bar] [Notifications] [User Menu]            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Repository Header                         │   │
│  │  owner/repo-name  [Watch] [Fork] [Star]                     │   │
│  │  [Code] [Issues] [Pull Requests] [Actions] [Settings]       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────┬──────────────────────────────────────────────┐   │
│  │  File Tree   │              Main Content                     │   │
│  │              │  (FileViewer / DiffViewer / IssueList / ...)  │   │
│  │  ├── src/    │                                               │   │
│  │  │   └── ... │                                               │   │
│  │  └── README  │                                               │   │
│  └──────────────┴──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### State Management Architecture

Zustand store structure with the following slices:

| Slice | Purpose |
|-------|---------|
| Repository state | currentRepo, fileTree, expandedPaths |
| File viewer state | currentFile, currentRef (branch/SHA) |
| Pull request state | currentPR, diffFiles, expandedDiffs, pendingComments |
| Notifications | notifications list, unreadCount |
| UI state | sidebarOpen, searchQuery, searchResults |

---

## Step 3: Deep Dive - File Tree Browser (8 minutes)

### The Challenge

Large repositories have 100,000+ files. Rendering all nodes at once causes:
- Memory bloat
- Slow initial render
- Laggy interactions

### Virtualized Tree Implementation

```
┌────────────────────────────────────────┐
│           FileTree Component           │
├────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │     TanStack Virtual Scroller    │  │
│  │  ┌─────────────────────────────┐ │  │
│  │  │ Visible Window (50 nodes)   │ │  │
│  │  │  ▼ src/                     │ │  │
│  │  │    ├── components/          │ │  │
│  │  │    ├── utils/               │ │  │
│  │  │    └── index.ts             │ │  │
│  │  │  ▶ tests/ (collapsed)       │ │  │
│  │  │  ▶ docs/  (collapsed)       │ │  │
│  │  └─────────────────────────────┘ │  │
│  └──────────────────────────────────┘  │
│                                        │
│  Flattening: Tree → Visible Nodes      │
│  Memoized on expandedPaths change      │
└────────────────────────────────────────┘
```

**Key Implementation Details:**
- Flatten tree for virtualization (only expanded nodes)
- Each row is 28px height with depth-based indentation
- Overscan of 10 items for smooth scrolling
- Click handler toggles expand for directories, opens files

### Lazy Loading Tree Nodes

API returns only immediate children, not full recursive tree. The `useTreeLoader` hook:
1. Maintains a Map of path -> children
2. Fetches subdirectory contents on expand
3. Caches results to avoid re-fetching

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow Down | Focus next visible node |
| Arrow Up | Focus previous visible node |
| Arrow Right | Expand directory or move to first child |
| Arrow Left | Collapse directory or move to parent |
| Enter/Space | Toggle expand or open file |

### Performance Optimizations

| Technique | Benefit |
|-----------|---------|
| Virtual list | Only render visible nodes (50 vs 100,000) |
| Lazy loading | Fetch subdirectories on expand |
| Memoized flattening | Recalculate only on expand/collapse |
| CSS containment | Isolate repaints to tree container |

---

## Step 4: Deep Dive - Code Viewer with Syntax Highlighting (10 minutes)

### Syntax Highlighting Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                     CodeViewer Component                     │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Toolbar: [filename.ts] [150 lines] [Copy] [Download]  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌────────┬──────────────────────────────────────────────┐  │
│  │ Line # │ Highlighted Code Content                     │  │
│  │   1    │ import { useState } from 'react';            │  │
│  │   2    │                                              │  │
│  │   3    │ export function Counter() {                  │  │
│  │   4    │   const [count, setCount] = useState(0);     │  │
│  │  ...   │ ...                                          │  │
│  └────────┴──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Highlighting Flow:**
1. Dynamically import language grammar (lazy loading)
2. Use Refractor (Prism-based) to highlight content
3. Convert AST to HTML with `hast-util-to-html`
4. Fallback to plain text on error

**Grammar Cache:** Map of language -> Promise to avoid duplicate imports

### Line Selection and Permalinks

- Parse hash on mount (e.g., `#L10-L20`)
- Support shift-click for range selection
- Update URL hash on selection
- Scroll to selected lines on load

### Blame View Integration

```
┌────────────────────────────────────────────────────────────┐
│                      Blame View                             │
├───────────────────┬────────────────────────────────────────┤
│  Blame Info       │  Code Content                          │
│  abc1234 alice 2d │  import { useState } from 'react';     │
│  "      "    "    │                                        │
│  def5678 bob   1w │  export function Counter() {           │
│  "      "    "    │    const [count, setCount] = ...       │
│  ...              │  ...                                   │
└───────────────────┴────────────────────────────────────────┘
```

Dim repeated commits for visual grouping.

---

## Step 5: Deep Dive - Pull Request Diff Viewer (10 minutes)

### Diff Rendering Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PR Header                                     │
│  [Conversation] [Commits (12)] [Checks (3)] [Files Changed (42)]    │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  Files Changed (42)                    [Unified] [Split] [Hide WS]  │
├─────────────────────────────────────────────────────────────────────┤
│  ▼ src/components/Button.tsx (+24, -12)                             │
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ @@ -15,6 +15,8 @@ export function Button...                     ││
│  │   15    15  │ const classes = clsx(                             ││
│  │   16       │-  'px-4 py-2',                                     ││
│  │        16  │+  'px-4 py-2 rounded-md',                          ││
│  │        17  │+  'transition-colors duration-200',                ││
│  │   17    18 │   variant === 'primary' && 'bg-blue-500',          ││
│  │  [+] Add comment                                                 ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ Comment: @reviewer: Consider using a CSS variable here          ││
│  │    [Reply]                                                       ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ▶ src/components/Input.tsx (+8, -2)         (collapsed)            │
│  ▶ src/styles/theme.css (+100, -0)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Virtualized Diff Component

**Row Types with Dynamic Heights:**

| Row Type | Height | Description |
|----------|--------|-------------|
| file-header | 48px | File path, +/- counts, expand toggle |
| hunk-header | 32px | `@@ -15,6 +15,8 @@` context line |
| diff-line | 24px | Context, addition, or deletion line |
| comments | 100px + 80px/comment | Inline comment thread |

**Flattening Logic:**
1. Iterate through files
2. Add file header row
3. If file expanded, iterate hunks and lines
4. Include inline comments at appropriate positions

### Inline Comment Component

```
┌─────────────────────────────────────────────────────────┐
│  Inline Comment Form                                     │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────┐  │
│  │ Leave a comment...                                │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│  [Markdown supported]     [Cancel] [Add review comment] │
└─────────────────────────────────────────────────────────┘
```

- Auto-resize textarea based on content
- Store pending comments in state until review submission
- Show `[+]` button on hover for each line

### Diff View Modes

**Unified View:**
- Single column with old/new line numbers
- Prefix: `-` for deletions, `+` for additions
- Background: red-50 for deletions, green-50 for additions

**Split View:**
- Two columns side by side
- Left: deletions and context
- Right: additions and context
- Divider between columns

---

## Step 6: Search Results with Highlighting (7 minutes)

### Search Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Search Results                            │
├─────────────────────────────────────────────────────────────┤
│  Search header: "1,234 results"                             │
│  Filters: [Language ▼] [Repository ▼]                       │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │ owner/repo / src/utils/helper.ts  [TypeScript]        │  │
│  │ ┌─────────────────────────────────────────────────┐   │  │
│  │ │  42 │ function [highlightedMatch](...) {        │   │  │
│  │ │  43 │   return [highlightedMatch].filter(...)   │   │  │
│  │ └─────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ owner/repo2 / lib/core.ts  [TypeScript]               │  │
│  │ ...                                                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  [Load more trigger - Intersection Observer]                │
└─────────────────────────────────────────────────────────────┘
```

**Infinite Scroll Implementation:**
- useInfiniteQuery with cursor-based pagination
- Intersection Observer on load-more trigger element
- Flatten all pages into single results array

### Highlighted Text Rendering

**Match Range Processing:**
1. Sort ranges by start position
2. Build array of text parts:
   - Plain text before match
   - `<mark>` wrapped match with yellow background
   - Plain text after last match

---

## Step 7: Real-time Notifications (5 minutes)

### WebSocket Notification System

```
┌─────────────────────────────────────────────────────────────┐
│                  Notification Bell                           │
├─────────────────────────────────────────────────────────────┤
│  [Bell Icon] (9+)  ◄── Unread count badge                   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Dropdown Panel                                        │  │
│  │ ┌─────────────────────────────────────────────────┐   │  │
│  │ │ Notifications          [Mark all as read]       │   │  │
│  │ ├─────────────────────────────────────────────────┤   │  │
│  │ │ PR Review Requested                     ● (new) │   │  │
│  │ │ owner/repo#123 needs your review                │   │  │
│  │ │ 5 minutes ago                                   │   │  │
│  │ ├─────────────────────────────────────────────────┤   │  │
│  │ │ CI Failed                                       │   │  │
│  │ │ Build failed on feature-branch                  │   │  │
│  │ │ 1 hour ago                                      │   │  │
│  │ └─────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**WebSocket Connection:**
- Connect to `/notifications` endpoint
- Parse incoming JSON messages
- Add to notification store
- Show browser Notification if permitted
- Reconnect with exponential backoff on close

### Notification Types

| Type | Icon | Example |
|------|------|---------|
| pr.review_requested | GitPullRequest | "Review requested on #123" |
| pr.merged | GitMerge | "PR #123 was merged" |
| issue.mentioned | AtSign | "@you was mentioned in #456" |
| ci.failed | XCircle (red) | "Build failed on main" |
| ci.success | CheckCircle (green) | "All checks passed" |

---

## Step 8: Accessibility Implementation (5 minutes)

### Keyboard Navigation Map

| Context | Key | Action |
|---------|-----|--------|
| File Tree | Arrow Up/Down | Navigate between nodes |
| File Tree | Arrow Right | Expand directory |
| File Tree | Arrow Left | Collapse directory |
| File Tree | Enter | Open file |
| Code Viewer | g + l | Go to line |
| Code Viewer | y | Copy permalink |
| Diff Viewer | j/k | Next/previous file |
| Diff Viewer | x | Expand/collapse file |
| Diff Viewer | c | Add comment |
| Global | / | Focus search |
| Global | ? | Show keyboard shortcuts |

### Focus Management

**Focus Trap for Modals:**
- Query all focusable elements in container
- Focus first element on open
- Tab wraps from last to first element
- Shift+Tab wraps from first to last

### Screen Reader Announcements

**Live Region Pattern:**
- Hidden `<div>` with `role="status"` and `aria-live="polite"`
- Update textContent to announce dynamic changes
- Clear after short delay to allow repeated announcements

---

## Step 9: Key Design Decisions and Trade-offs (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Tree virtualization | TanStack Virtual | Full render | 100,000+ files would crash browser |
| Syntax highlighting | Refractor (Prism-based) | Shiki, Monaco | Lighter weight, lazy grammar loading |
| Diff view | Custom virtualized | Monaco diff | More control over inline comments |
| State management | Zustand | Redux, Context | Simple API, good devtools, small bundle |
| Real-time updates | WebSocket | SSE, polling | Bi-directional for typing indicators |

### Performance Optimizations Summary

| Technique | Applied To | Impact |
|-----------|-----------|--------|
| Virtualization | File tree, diff viewer, search | Render 50 items vs 10,000+ |
| Lazy loading | Tree nodes, language grammars | Smaller initial bundle |
| Memoization | Tree flattening, diff rows | Prevent recalculation |
| Code splitting | Routes, heavy components | Faster initial load |
| CSS containment | Tree, diff containers | Isolated repaints |

---

## Closing Summary

I've designed a frontend for a code hosting platform with four core UI systems:

1. **File Tree Browser**: Virtualized tree with lazy loading for repositories with 100,000+ files, full keyboard navigation, and expand-on-demand

2. **Code Viewer**: Syntax highlighting with lazy grammar loading, line selection for permalinks, and blame integration

3. **Pull Request Diff Viewer**: Virtualized diff display supporting unified and split views, inline commenting with pending comment collection, and expandable file sections

4. **Search and Notifications**: Infinite scroll search results with highlighted matches, real-time WebSocket notifications with browser notification integration

**Key frontend trade-offs:**
- Virtualization over full render (performance vs implementation complexity)
- Custom diff viewer over Monaco (control vs built-in features)
- Lazy grammar loading over preloading (initial load vs highlight delay)

**Future enhancements:**
- Monaco editor integration for file editing
- Collaborative editing with operational transforms
- Offline support with service workers
- Mobile-optimized touch gestures for diff review
