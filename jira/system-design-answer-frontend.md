# Design Jira - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Introduction (2 minutes)

"Thanks for the opportunity. Today I'll design Jira, an issue tracking and project management system. From a frontend perspective, Jira presents fascinating UI challenges:

1. **Complex board interactions** with drag-and-drop across columns
2. **Inline editing** for issue fields with validation
3. **Dynamic forms** that adapt to issue type and project settings
4. **Real-time updates** when teammates modify issues
5. **JQL search interface** with autocomplete and syntax highlighting

I'll focus on the board component architecture, the issue detail panel, and how we handle optimistic updates for a responsive UX."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For the user interface:

1. **Board View**: Kanban columns with drag-and-drop reordering
2. **Issue Detail**: Slide-out panel with inline editing
3. **Quick Search**: JQL autocomplete with recent queries
4. **Project Sidebar**: Navigation and quick filters
5. **Issue Creation**: Modal with dynamic field rendering"

### Non-Functional Requirements

"For user experience:

- **Responsiveness**: Immediate feedback on all interactions
- **Accessibility**: WCAG 2.1 AA compliance, keyboard navigation
- **Performance**: Smooth drag-and-drop with 100+ issues visible
- **Offline Support**: Optimistic updates with conflict resolution"

---

## Component Architecture (10 minutes)

### Application Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Frontend Architecture                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         Components                               │    │
│  ├──────────────────────┬──────────────────────┬───────────────────┤    │
│  │      Board Views     │    Issue Detail      │    UI Primitives  │    │
│  │  ┌────────────────┐  │  ┌────────────────┐  │  ┌─────────────┐  │    │
│  │  │ Board.tsx      │  │  │ IssueDetail.tsx│  │  │ ui.tsx      │  │    │
│  │  │ BoardColumn.tsx│  │  │ Header.tsx     │  │  │ Avatar      │  │    │
│  │  │ IssueCard.tsx  │  │  │ Sidebar.tsx    │  │  │ Spinner     │  │    │
│  │  │ CreateModal.tsx│  │  │ SummaryEditor  │  │  │ Icons       │  │    │
│  │  └────────────────┘  │  │ Tabs.tsx       │  │  └─────────────┘  │    │
│  │                      │  │ CommentsTab    │  │                   │    │
│  │                      │  │ HistoryTab     │  │                   │    │
│  │                      │  └────────────────┘  │                   │    │
│  └──────────────────────┴──────────────────────┴───────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                          Hooks                                   │    │
│  │  ┌──────────────────┐  ┌────────────────┐  ┌─────────────────┐  │    │
│  │  │ useIssueDetail   │  │ useDragAndDrop │  │ useJQLComplete  │  │    │
│  │  │ Issue state mgmt │  │ Board DnD logic│  │ Search suggest  │  │    │
│  │  └──────────────────┘  └────────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         Stores (Zustand)                         │    │
│  │  ┌──────────────────┐  ┌────────────────┐  ┌─────────────────┐  │    │
│  │  │ boardStore       │  │ issueStore     │  │ projectStore    │  │    │
│  │  │ Board columns    │  │ Issue cache    │  │ Project config  │  │    │
│  │  │ Optimistic moves │  │ Detail state   │  │ Workflow defs   │  │    │
│  │  └──────────────────┘  └────────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌───────────────────────────────┬─────────────────────────────────┐    │
│  │         Services              │            Types                 │    │
│  │  ┌─────────────────────────┐  │  ┌───────────────────────────┐  │    │
│  │  │ api.ts - API client     │  │  │ index.ts - TypeScript     │  │    │
│  │  │ REST calls to backend   │  │  │ Issue, Project, Status    │  │    │
│  │  └─────────────────────────┘  │  │ Transition, BoardColumn   │  │    │
│  │                               │  └───────────────────────────┘  │    │
│  └───────────────────────────────┴─────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core Type Definitions

**Project**: id, key, name, lead (User), workflow (Workflow)

**Issue**:
- id (number), key (string like 'PROJ-123')
- summary, description
- issueType, status, priority
- assignee (User | null), reporter (User)
- storyPoints (number | null)
- customFields (Record<string, any>)
- version (number) - For optimistic locking
- createdAt, updatedAt

**Status**: id, name, category ('todo' | 'in_progress' | 'done')

**Transition**: id, name, to (Status)

**BoardColumn**: status (Status), issues (Issue[])

**IssueType**: id, name, icon ('story' | 'bug' | 'task' | 'epic' | 'subtask')

**Priority**: id, name, icon ('highest' | 'high' | 'medium' | 'low' | 'lowest')

---

## Deep Dive: Board Component (12 minutes)

### Board Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Board Container                             │
│  flex gap-4 overflow-x-auto p-4 h-full                                  │
├───────────────────┬───────────────────┬───────────────────┬─────────────┤
│                   │                   │                   │             │
│   ┌───────────┐   │   ┌───────────┐   │   ┌───────────┐   │   ┌─────┐   │
│   │  TO DO    │   │   │IN PROGRESS│   │   │   DONE    │   │   │ ... │   │
│   │   (12)    │   │   │    (5)    │   │   │    (8)    │   │   │     │   │
│   ├───────────┤   │   ├───────────┤   │   ├───────────┤   │   └─────┘   │
│   │           │   │   │           │   │   │           │   │             │
│   │ ┌───────┐ │   │   │ ┌───────┐ │   │   │ ┌───────┐ │   │             │
│   │ │ Card  │ │   │   │ │ Card  │ │   │   │ │ Card  │ │   │             │
│   │ │PROJ-1 │ │   │   │ │PROJ-3 │ │   │   │ │PROJ-7 │ │   │             │
│   │ └───────┘ │   │   │ └───────┘ │   │   │ └───────┘ │   │             │
│   │           │   │   │           │   │   │           │   │             │
│   │ ┌───────┐ │   │   │ ┌───────┐ │   │   │ ┌───────┐ │   │             │
│   │ │ Card  │ │   │   │ │ Card  │ │   │   │ │ Card  │ │   │             │
│   │ │PROJ-2 │ │   │   │ │PROJ-4 │ │   │   │ │PROJ-8 │ │   │             │
│   │ └───────┘ │   │   │ └───────┘ │   │   │ └───────┘ │   │             │
│   │           │   │   │           │   │   │           │   │             │
│   │   ...     │   │   │   ...     │   │   │   ...     │   │             │
│   │           │   │   │           │   │   │           │   │             │
│   └───────────┘   │   └───────────┘   │   └───────────┘   │             │
│   w-72 flex-shrink│   Drop Zone       │                   │             │
│                   │   bg-blue-50 when │                   │             │
│                   │   drag over       │                   │             │
└───────────────────┴───────────────────┴───────────────────┴─────────────┘
```

### Board Container Behavior

**Loading State**: Shows BoardSkeleton
- 4 column placeholders with pulsing animation
- Each column: header skeleton + 3 card skeletons

**Loaded State**:
- Maps columns from useBoardStore
- Passes dragState and handlers from useDragAndDrop hook
- Each column receives: column data, dragState, event handlers

### Board Column Features

**Header Section**:
- StatusDot colored by category (gray=todo, blue=in_progress, green=done)
- Column name (status.name)
- Issue count badge

**Drop Zone**:
- Highlighted (bg-blue-50, border-blue-300 dashed) when drag over
- Normal state: bg-gray-50
- ARIA region with descriptive label

**Issue Rendering**:
- Maps issues with space-y-2 spacing
- Each card marked if currently being dragged (opacity-50, rotate-2, scale-105)

### Issue Card Component

```
┌─────────────────────────────────────────────────────────────┐
│ Issue Card                                                   │
│ bg-white rounded-lg shadow-sm border p-3                    │
│ hover:shadow-md hover:border-blue-300                       │
│ focus:ring-2 focus:ring-blue-500                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Fix login timeout issue when session expires                │
│  (line-clamp-2 for long summaries)                          │
│                                                              │
├──────────────────────────────┬──────────────────────────────┤
│ Left:                        │ Right:                        │
│ ┌────┐                       │      ┌────┐ ┌────┐ ┌────┐    │
│ │ [] │ PROJ-123              │      │ ^^ │ │ 5  │ │ AB │    │
│ └────┘ (issue type + key)    │      └────┘ └────┘ └────┘    │
│                              │      Priority Points Avatar   │
└──────────────────────────────┴──────────────────────────────┘
```

**Interactions**:
- draggable attribute for HTML5 DnD
- onClick opens issue detail panel (pushState to /browse/{key})
- Keyboard: Enter opens detail
- tabIndex=0 for keyboard focus
- ARIA: role="button", aria-label with key and summary

**Visual States**:
- isDragging: opacity-50, rotate-2, scale-105 transform
- Focus visible: ring-2 blue outline
- Hover: shadow elevation + blue border

### Drag and Drop Hook

**DragState Interface**:
- draggingIssue: Issue | null
- overStatus: Status | null

**Event Handlers**:

1. **handleDragStart(issue)**
   - Sets draggingIssue, clears overStatus

2. **handleDragOver(event, status)**
   - Calls preventDefault to allow drop
   - Updates overStatus for visual feedback

3. **handleDrop(status)**
   - Exits if no dragging issue or same column
   - Resets drag state immediately
   - Calls onMove with issueId and statusId

4. **handleDragEnd**
   - Resets entire drag state

---

## Deep Dive: Issue Detail Panel (10 minutes)

### Panel Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Issue Detail Panel                                │
│  fixed inset-y-0 right-0 w-[800px] bg-white shadow-xl z-50              │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     IssueDetailHeader                              │  │
│  │  [Issue Type Icon] PROJ-123    [Watch] [Share] [Actions] [X]      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌───────────────────────────────────────────┬──────────────────────┐   │
│  │              Main Content                  │      Sidebar         │   │
│  │           flex-1 overflow-y-auto p-6      │    w-64 border-l    │   │
│  │                                            │    bg-gray-50 p-4   │   │
│  │  ┌──────────────────────────────────────┐ │                      │   │
│  │  │        IssueSummaryEditor            │ │  Status             │   │
│  │  │  [Click to edit summary...]          │ │  ┌────────────────┐ │   │
│  │  │                                       │ │  │ In Progress  v │ │   │
│  │  │  Description                          │ │  └────────────────┘ │   │
│  │  │  [Click to edit description...]       │ │                      │   │
│  │  └──────────────────────────────────────┘ │  Assignee            │   │
│  │                                            │  ┌────────────────┐ │   │
│  │  ┌──────────────────────────────────────┐ │  │ [AB] Alice     │ │   │
│  │  │          IssueDetailTabs             │ │  └────────────────┘ │   │
│  │  │  [Comments] [History] [Links]         │ │                      │   │
│  │  ├──────────────────────────────────────┤ │  Priority            │   │
│  │  │  Comment thread / History list        │ │  ┌────────────────┐ │   │
│  │  │                                       │ │  │ ^^ Highest     │ │   │
│  │  │                                       │ │  └────────────────┘ │   │
│  │  └──────────────────────────────────────┘ │                      │   │
│  │                                            │  Story Points        │   │
│  │                                            │  ┌────────────────┐ │   │
│  │                                            │  │       5        │ │   │
│  │                                            │  └────────────────┘ │   │
│  │                                            │                      │   │
│  │                                            │  Reporter (readonly) │   │
│  │                                            │  [JD] John Doe       │   │
│  │                                            │                      │   │
│  │                                            │  ─────────────────   │   │
│  │                                            │  Created: Jan 15     │   │
│  │                                            │  Updated: Jan 20     │   │
│  └───────────────────────────────────────────┴──────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### State Management Pattern

**useIssueDetail Hook State**:
- issue: Issue | null
- transitions: Transition[]
- comments: Comment[]
- history: HistoryEntry[]
- isLoading: boolean
- isSaving: boolean
- error: string | null

**Actions Returned**:
- updateIssue(updates) - Optimistic update with rollback
- executeTransition(transitionId) - Status change
- addComment(body) - Add new comment
- refetch() - Reload issue data

### Inline Editing Flow

**Summary Editor**:

1. **View Mode** (default)
   - h1 displaying issue.summary
   - hover:bg-gray-100 for edit hint
   - role="button", tabIndex=0

2. **Edit Mode** (on click/Enter)
   - Input with current value
   - Auto-focus via useEffect
   - Keyboard: Enter saves, Escape cancels
   - onBlur triggers save

3. **Save Flow**
   - Skip if unchanged (trim and compare)
   - Call onSave with updates
   - On success: exit edit mode
   - On error: revert to original value

**Description Editor**:
- Similar pattern but with textarea
- Shows Save/Cancel buttons explicitly
- Multi-line editing with resize-y

### Status Transition Dropdown

```
┌────────────────────────────────────────────┐
│ Status Dropdown                             │
├────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │ In Progress                        v │  │  <- Current status button
│  │ bg-blue-100 text-blue-700           │  │     Color by category
│  └──────────────────────────────────────┘  │
│                                             │
│  On click:                                  │
│  ┌──────────────────────────────────────┐  │
│  │ Start Progress    → In Progress      │  │  <- Available transitions
│  │ Resolve           → Done             │  │     Shows destination status
│  │ Won't Do          → Cancelled        │  │
│  └──────────────────────────────────────┘  │
│  role="listbox" with role="option" items   │
└────────────────────────────────────────────┘
```

**Color Categories**:
- todo: bg-gray-200 text-gray-700
- in_progress: bg-blue-100 text-blue-700
- done: bg-green-100 text-green-700

---

## State Management (5 minutes)

### Board Store Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Optimistic Update Flow                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User Action           Store Update              API Call               │
│   ───────────           ────────────              ────────               │
│                                                                          │
│   1. User drags     ──▶ 2. moveIssue called                             │
│      issue to            ┌─────────────┐                                 │
│      new column          │ Find issue  │                                 │
│                          │ Find columns│                                 │
│                          └──────┬──────┘                                 │
│                                 │                                        │
│                                 ▼                                        │
│                          3. Optimistic Update                            │
│                          ┌─────────────────────────────────────────┐    │
│                          │ Remove issue from source column         │    │
│                          │ Add issue to target column              │    │
│                          │ Update issue.status to new status       │    │
│                          │ set({ columns: updatedColumns })        │    │
│                          └──────────────────────┬──────────────────┘    │
│                                                 │                        │
│   UI updates                                    │                        │
│   immediately                                   ▼                        │
│                                          4. API Request                  │
│                                          ┌─────────────────────────┐    │
│                                          │ api.transitionIssue()   │    │
│                                          │ issueId, toStatusId     │    │
│                                          └───────────┬─────────────┘    │
│                                                      │                   │
│                              ┌───────────────────────┴───────────────┐  │
│                              │                                        │  │
│                              ▼                                        ▼  │
│                         Success                                   Failure │
│                         ┌─────────┐                         ┌──────────┐ │
│                         │ Done!   │                         │ Rollback │ │
│                         │ Keep UI │                         │ Restore  │ │
│                         └─────────┘                         │ original │ │
│                                                             │ columns  │ │
│                                                             └──────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Issue Detail Hook Flow

**Initial Load**:
1. Set isLoading = true
2. Parallel fetch: issue, transitions, comments, history
3. Set all state on success, or error on failure

**Update Issue**:
1. Save previous issue for rollback
2. Optimistic update: merge updates into issue, set isSaving
3. API call with version for conflict detection
4. On success: update with server response
5. On failure: rollback to previous, show error message
6. Sync to boardStore for board view consistency

**Conflict Handling**:
- API returns 409 if version mismatch
- Error message: "Issue was modified by another user. Please refresh."
- User must refetch to resolve

### Store Synchronization

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Store Sync Pattern                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────┐       ┌─────────────────────────┐          │
│  │       boardStore        │       │     useIssueDetail      │          │
│  │  ┌───────────────────┐  │       │  ┌───────────────────┐  │          │
│  │  │ columns[]         │  │       │  │ issue             │  │          │
│  │  │ - issues[]        │◀─┼───────┼──│ updateIssue()     │  │          │
│  │  └───────────────────┘  │       │  └───────────────────┘  │          │
│  │                         │       │                         │          │
│  │  updateIssue(id, data)  │       │  After API success:     │          │
│  │  Called by detail hook  │       │  boardStore.updateIssue │          │
│  │  to sync board view     │       │  (issue.id, updates)    │          │
│  └─────────────────────────┘       └─────────────────────────┘          │
│                                                                          │
│  Result: Changes in detail panel reflect in board immediately           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## UI Primitives (3 minutes)

### Issue Type Icons

| Type    | Shape       | Color        |
|---------|-------------|--------------|
| story   | Rectangle   | text-green-600 |
| bug     | Circle      | text-red-600   |
| task    | Rounded rect| text-blue-600  |
| epic    | Triangle    | text-purple-600|
| subtask | Small rect  | text-blue-400  |

### Priority Icons

| Priority | Symbol | Color          |
|----------|--------|----------------|
| highest  | ^^     | text-red-600   |
| high     | ^      | text-orange-500|
| medium   | =      | text-yellow-500|
| low      | v      | text-blue-500  |
| lowest   | vv     | text-blue-300  |

### Avatar Component

**With Image**:
- img element with rounded-full
- Sizes: sm (w-6 h-6), md (w-8 h-8), lg (w-10 h-10)

**Fallback (no image)**:
- Div with initials from name
- bg-blue-100 text-blue-600
- Centered with flex

### Spinner Component

- SVG with animate-spin
- Circle with opacity-25 for track
- Arc path for active portion
- Sizes match avatar sizes

---

## Accessibility Considerations

### Keyboard Navigation

1. **Board columns**: Tab through issue cards
2. **Issue cards**: Enter to open, Escape to cancel drag
3. **Inline editors**: Enter to save, Escape to cancel
4. **Dropdowns**: Arrow keys, Enter to select

### ARIA Implementation

| Element          | ARIA Attribute                                  |
|------------------|------------------------------------------------|
| Board column     | role="region" aria-label="{status} column..."   |
| Issue card       | role="button" aria-label="Issue {key}: {summary}"|
| Status dropdown  | aria-haspopup="listbox" aria-expanded           |
| Transition list  | role="listbox" with role="option" items         |
| Inline editors   | role="button" on view mode elements             |

### Focus Management

- Auto-focus input when entering edit mode (useEffect with ref)
- Focus trap in modals and slide-out panels
- Visible focus indicators (ring-2 ring-blue-500)
- Skip to main content link

### Screen Reader Announcements

- Status change announcements after transitions
- Save confirmation after inline edits
- Error messages in aria-live regions
- Drag operation start/end announcements

---

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Drag library | Native HTML5 | react-beautiful-dnd | Simpler, no extra dependencies |
| State | Zustand | Redux Toolkit | Lighter weight, less boilerplate |
| Inline editing | Custom | react-contenteditable | Full control over UX |
| Issue panel | Slide-out | Route/modal | Maintains board context |
| Optimistic updates | Manual rollback | TanStack Query | Finer control over UX |

---

## Summary

"I've designed Jira's frontend with:

1. **Board Component**: Drag-and-drop columns with visual feedback and accessibility
2. **Issue Cards**: Compact display with type, priority, assignee indicators
3. **Issue Detail Panel**: Slide-out with inline editing for summary/description
4. **Sidebar Fields**: Status transitions, assignee picker, priority selector
5. **Optimistic Updates**: Immediate UI feedback with automatic rollback on failure
6. **State Management**: Zustand stores for board and issue state with sync between components

The design prioritizes responsiveness through optimistic updates while maintaining data integrity with version-based conflict detection."
