# LeetCode (Online Judge) - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

---

## 🎯 Problem Statement

Design the frontend architecture for an online coding practice platform that allows users to:
- Browse and filter coding problems by difficulty and tags
- Write and edit code in a syntax-highlighted editor
- Submit code and view real-time execution results
- Track progress across problems
- Participate in timed contests

---

## 📋 Requirements Clarification

### Functional Requirements

1. **Problem Browser**: Filterable, sortable list of coding problems
2. **Code Editor**: Syntax highlighting, multiple language support, auto-complete
3. **Test Runner**: Execute code against sample test cases
4. **Submission Results**: Real-time status updates with test case details
5. **Progress Dashboard**: Visualize solved problems, streaks, rankings

### Non-Functional Requirements

1. **Responsive**: Support desktop, tablet, and mobile layouts
2. **Performance**: Editor responsive at 60fps, instant UI feedback
3. **Accessibility**: Keyboard navigation, screen reader support
4. **Offline Resilience**: Cache problems for offline viewing

### UI/UX Requirements

- Clean, distraction-free coding environment
- Clear visual feedback for submission status
- Intuitive navigation between problems
- Real-time progress updates without page refresh

---

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            React Application                                 │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        TanStack Router                                  │ │
│  │    /                    ──▶ Problem List                               │ │
│  │    /problems/:slug      ──▶ Problem Detail + Editor                    │ │
│  │    /submissions         ──▶ Submission History                         │ │
│  │    /progress            ──▶ User Dashboard                             │ │
│  │    /contests/:id        ──▶ Contest View                               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌───────────────┐  ┌───────────────────────────────────────────────────┐  │
│  │   Sidebar     │  │              Main Content Area                     │  │
│  │  ┌─────────┐  │  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │ Problem │  │  │  │           Problem Description               │  │  │
│  │  │  List   │  │  │  │  - Title, difficulty badge                  │  │  │
│  │  │         │  │  │  │  - Description markdown                     │  │  │
│  │  │ Filters │  │  │  │  - Examples with I/O                        │  │  │
│  │  │ - Easy  │  │  │  └─────────────────────────────────────────────┘  │  │
│  │  │ - Med   │  │  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │ - Hard  │  │  │  │              Code Editor                    │  │  │
│  │  │         │  │  │  │  - Language selector                        │  │  │
│  │  │ Tags    │  │  │  │  - CodeMirror with syntax highlighting     │  │  │
│  │  │ Status  │  │  │  │  - Run / Submit buttons                     │  │  │
│  │  └─────────┘  │  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────┘  │  ┌─────────────────────────────────────────────┐  │  │
│                     │  │           Test Results Panel                │  │  │
│                     │  │  - Status badges (Pass/Fail/TLE/MLE)       │  │  │
│                     │  │  - Expected vs Actual output                │  │  │
│                     │  │  - Runtime and memory stats                 │  │  │
│                     │  └─────────────────────────────────────────────┘  │  │
│                     └───────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Zustand Store                                   │ │
│  │  problems[] │ submissions[] │ currentCode │ language │ user            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Deep Dive: Code Editor Architecture

### CodeMirror 6 Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                      CodeEditor Component                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    EditorState                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │ │
│  │  │ basicSetup   │  │ langExtension│  │    oneDark       │  │ │
│  │  │ (line nums,  │  │ (python/js/  │  │    theme         │  │ │
│  │  │  folding)    │  │  java/cpp)   │  │                  │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    EditorView                               │ │
│  │  - updateListener ──▶ onChange callback                    │ │
│  │  - lineWrapping                                             │ │
│  │  - Recreates on language change                             │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Trade-off 1: CodeMirror 6 vs Monaco Editor

| Approach | Pros | Cons |
|----------|------|------|
| ✅ CodeMirror 6 | 150KB bundle, excellent mobile, highly customizable | Less IDE-like features |
| ❌ Monaco Editor | Full VS Code experience, IntelliSense, multi-cursor | 2MB bundle, poor mobile support |

> "I chose CodeMirror 6 over Monaco for the code editor, and this decision significantly impacts our frontend architecture. Monaco provides the full VS Code editing experience—IntelliSense, go-to-definition, multi-cursor editing—but at 2MB it would triple our bundle size and dominate our initial load time. For a coding practice platform, Monaco's IntelliSense is actually less useful than it sounds: users implement specific function signatures against known inputs, not exploring unfamiliar APIs. CodeMirror 6's 150KB footprint means our editor loads in under 500ms even on 3G connections. The mobile experience is where CodeMirror truly wins—its touch handling, virtual keyboard interaction, and viewport management are production-ready, while Monaco is effectively unusable on mobile. The trade-off is that power users won't get VS Code muscle memory shortcuts, but we can add common keybindings as CodeMirror extensions. For users who practice during commutes or breaks, mobile support is essential—and Monaco doesn't offer it."

---

## 🔧 Deep Dive: State Management

### Zustand Store Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Zustand Problem Store                        │
│                                                                  │
│  ┌──────────────────────────────┬──────────────────────────────┐│
│  │          State               │           Actions            ││
│  ├──────────────────────────────┼──────────────────────────────┤│
│  │  problems[]                  │  setFilter()                 ││
│  │  filters {                   │  setCurrentProblem()         ││
│  │    difficulty: all/easy/...  │  setLanguage()               ││
│  │    status: all/solved/...    │  setCode()                   ││
│  │    search: string            │  submitCode()                ││
│  │  }                           │                              ││
│  │  currentProblem              │  ┌────────────────────────┐  ││
│  │  currentLanguage             │  │  getFilteredProblems() │  ││
│  │  code: { [slug]: code }      │  │  (computed selector)   │  ││
│  │  submissions[]               │  └────────────────────────┘  ││
│  │  activeSubmission            │                              ││
│  └──────────────────────────────┴──────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              persist() middleware                           │ │
│  │  Saves to localStorage:                                     │ │
│  │  - code drafts (keyed by problem slug)                      │ │
│  │  - currentLanguage preference                               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Trade-off 2: Zustand vs Redux vs Context

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Zustand | 1KB, minimal boilerplate, built-in persist | Smaller ecosystem |
| ❌ Redux Toolkit | Mature, large ecosystem, devtools | 7KB, more boilerplate |
| ❌ Context API | Zero dependencies, built-in | Re-renders, no persistence |

> "I chose Zustand with the persist middleware over Redux or Context for state management. The key requirement driving this decision is code draft persistence—users must never lose their work if they accidentally close the browser or navigate away. Redux could achieve this with redux-persist, but that's 3 additional packages (redux, @reduxjs/toolkit, redux-persist) totaling 15KB+ and requiring action creators, reducers, and middleware configuration. Zustand's persist middleware is built-in and configures in 5 lines. Context API would require building persistence from scratch. The trade-off is Redux's richer devtools and middleware ecosystem, but for a coding practice app where state is straightforward (problems, code drafts, submissions), Zustand's simplicity wins. The real architectural benefit is that Zustand doesn't require Provider wrapping, so our component tree stays clean and we avoid the 'provider hell' of combining multiple contexts. For computed values like filtered problem lists, Zustand's selector pattern prevents unnecessary re-renders—only components subscribing to filters re-render when filters change."

---

## 🔧 Deep Dive: Submission Results UI

### Real-time Status Polling Flow

```
┌────────────────┐         ┌────────────────┐         ┌────────────────┐
│   Submit Code  │         │   Backend API  │         │   Job Queue    │
└───────┬────────┘         └───────┬────────┘         └───────┬────────┘
        │                          │                          │
        │  POST /submissions       │                          │
        │─────────────────────────▶│                          │
        │                          │   Queue execution job    │
        │                          │─────────────────────────▶│
        │  { submissionId }        │                          │
        │◀─────────────────────────│                          │
        │                          │                          │
        ├──────────────────────────── POLLING LOOP ───────────┤
        │                          │                          │
        │  GET /status/{id}        │                          │
        │─────────────────────────▶│                          │
        │  { status: "running",    │                          │
        │    currentTest: 3 }      │                          │
        │◀─────────────────────────│                          │
        │                          │                          │
        │  ...poll every 1s...     │                          │
        │                          │                          │
        │  { status: "accepted",   │                          │
        │    runtimeMs: 42 }       │                          │
        │◀─────────────────────────│                          │
        │                          │                          │
        │  STOP POLLING            │                          │
        ▼                          ▼                          ▼
```

### Status Badge Configuration

| Status | Color | Icon | User Message |
|--------|-------|------|--------------|
| accepted | Green | CheckCircle | All tests passed |
| wrong_answer | Red | XCircle | Output mismatch on test N |
| time_limit_exceeded | Yellow | Clock | Solution too slow |
| memory_limit_exceeded | Orange | HardDrive | Memory limit exceeded |
| runtime_error | Red | AlertTriangle | Code crashed |
| compile_error | Purple | AlertCircle | Syntax error |
| pending | Gray | Clock | Waiting in queue |
| running | Blue | Loader (animated) | Running test N of M |

### Trade-off 3: Polling vs WebSocket for Status Updates

| Approach | Pros | Cons |
|----------|------|------|
| ✅ HTTP Polling | Stateless, proxy-friendly, simpler error handling | 1s latency, more requests |
| ❌ WebSocket | Real-time updates, fewer requests | Stateful, reconnection logic needed |

> "I chose HTTP polling over WebSocket for submission status updates. For a code execution flow, the ~1 second polling interval is imperceptible—users expect 2-5 seconds for their code to run anyway. Polling simplifies our frontend architecture significantly: we use a simple useEffect with setInterval, handle errors with standard try/catch, and don't need reconnection logic for network interruptions. WebSocket would require connection state management, heartbeats, and graceful reconnection with exponential backoff. The real killer for WebSocket is corporate environments—many companies' proxies block or interfere with WebSocket connections, but HTTP always works. The trade-off is slightly higher server load, but the backend caches status in Valkey making each poll sub-millisecond. If we later need streaming output (showing compilation errors as they happen), we can upgrade specific flows to WebSocket while keeping the simple polling for status. For 10K concurrent contest users polling every second, that's 10K requests/second to a cached endpoint—easily handled."

---

## 🔧 Deep Dive: Problem List with Virtualization

### TanStack Virtual Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ProblemList Component                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 Sticky Header (always visible)              │ │
│  │  ┌──────────┬───────────────────┬───────────┬────────────┐ │ │
│  │  │  Status  │       Title       │ Difficulty│ Acceptance │ │ │
│  │  └──────────┴───────────────────┴───────────┴────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              useVirtualizer (TanStack Virtual)              │ │
│  │                                                             │ │
│  │  Total items: 3000 problems                                 │ │
│  │  Rendered: ~15 visible + 10 overscan = 25 DOM nodes         │ │
│  │                                                             │ │
│  │  Viewport: [ row 45 ] [ row 46 ] [ row 47 ] [ row 48 ]     │ │
│  │            ───────────────────────────────────────          │ │
│  │                        visible rows                         │ │
│  │                                                             │ │
│  │  Config:                                                    │ │
│  │  - estimateSize: 56px per row                              │ │
│  │  - overscan: 10 (extra rows above/below)                   │ │
│  │  - getScrollElement: parentRef.current                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    ProblemRow (per item)                    │ │
│  │  - StatusIcon (solved/attempted/unsolved)                  │ │
│  │  - Title (clickable link)                                  │ │
│  │  - DifficultyBadge (Easy=green, Medium=yellow, Hard=red)   │ │
│  │  - Acceptance rate percentage                              │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

> "I use TanStack Virtual for the problem list because LeetCode has 3000+ problems. Without virtualization, rendering 3000 table rows creates 3000 DOM nodes—causing multi-second initial render, janky scrolling, and high memory usage. Virtualization renders only visible rows plus overscan buffer (~25 DOM nodes total). The trade-off is implementation complexity: we manage scroll position, calculate which items are visible, and position them with CSS transforms. But for a list that users scroll frequently while searching for problems, smooth 60fps scrolling is essential. The estimateSize of 56px allows fast initial render, and since all rows have identical height, we don't need dynamic measurement."

---

## 🔧 Deep Dive: Resizable Panels

### Split Pane Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ProblemView (react-resizable-panels)             │
│                                                                          │
│  ┌─────────────────────────────┐ ║ ┌─────────────────────────────────┐  │
│  │                             │ ║ │                                 │  │
│  │     Problem Description     │ ║ │         PanelGroup              │  │
│  │                             │ ║ │         (vertical)              │  │
│  │  ┌───────────────────────┐  │ ║ │  ┌───────────────────────────┐ │  │
│  │  │  Title + Difficulty   │  │ R │  │                           │ │  │
│  │  └───────────────────────┘  │ E │  │      Code Editor          │ │  │
│  │                             │ S │  │                           │ │  │
│  │  ┌───────────────────────┐  │ I │  │  ┌─────────────────────┐  │ │  │
│  │  │  Description HTML     │  │ Z │  │  │ Language Selector   │  │ │  │
│  │  │  (markdown rendered)  │  │ E │  │  │ Run / Submit btns   │  │ │  │
│  │  └───────────────────────┘  │   │  │  └─────────────────────┘  │ │  │
│  │                             │ H │  │                           │ │  │
│  │  ┌───────────────────────┐  │ A │  └───────────────────────────┘ │  │
│  │  │  Examples             │  │ N │  ════════════════════════════  │  │
│  │  │  Input → Output       │  │ D │  ┌───────────────────────────┐ │  │
│  │  └───────────────────────┘  │ L │  │      Test Results         │ │  │
│  │                             │ E │  │  - Status banner           │ │  │
│  │  Panel: 40% default         │ ║ │  │  - Runtime/Memory stats    │ │  │
│  │          25% minimum        │ ║ │  │  - Failed test details     │ │  │
│  │                             │ ║ │  └───────────────────────────┘ │  │
│  └─────────────────────────────┘ ║ │  Panel: 60% / 40% split       │  │
│                                  ║ └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

> "I use react-resizable-panels for the split layout because users have different preferences for problem description vs code editor space. Some users want a narrow description panel to maximize coding area; others need full width for complex problem descriptions. The nested PanelGroup creates vertical split within the right panel (editor/results). Panel sizes persist to localStorage so users don't re-adjust every session. The trade-off is an additional dependency and DOM complexity, but this is a core UX pattern for IDE-style interfaces."

---

## ⚡ Performance Optimizations

### Code Draft Debouncing

```
┌────────────────┐     keystroke      ┌─────────────────┐
│  CodeEditor    │───────────────────▶│  In-memory ref  │
│  onChange      │                    │  (instant)      │
└────────────────┘                    └────────┬────────┘
                                               │
                                      500ms debounce
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │  setCode()      │
                                      │  (Zustand +     │
                                      │   localStorage) │
                                      └─────────────────┘
```

### Lazy Loading Strategy

```
┌────────────────────────────────────────────────────────────┐
│  Route-based Code Splitting                                 │
│                                                             │
│  /                ──▶ ProblemList (eager)                  │
│  /problems/:slug  ──▶ lazy(() => import(ProblemView))      │
│  /submissions     ──▶ lazy(() => import(SubmissionHistory))│
│  /progress        ──▶ lazy(() => import(Dashboard))        │
│                                                             │
│  CodeEditor loaded only when needed (150KB)                 │
│  Suspense fallback: EditorSkeleton                          │
└────────────────────────────────────────────────────────────┘
```

### Service Worker Caching

```
┌────────────────┐     fetch /api/problems/two-sum     ┌────────────────┐
│    Browser     │────────────────────────────────────▶│  Service Worker│
└────────────────┘                                     └───────┬────────┘
                                                               │
                 ┌─────────────────────────────────────────────┤
                 │                                             │
                 ▼                                             ▼
        ┌────────────────┐                           ┌────────────────┐
        │  Cache Match?  │──── yes ─────────────────▶│ Return cached  │
        └───────┬────────┘                           └────────────────┘
                │ no
                ▼
        ┌────────────────┐     ┌─────────────────────────────────────┐
        │  Network fetch │────▶│  cache.put() + return response      │
        └────────────────┘     └─────────────────────────────────────┘
```

---

## ♿ Accessibility

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + Enter | Submit code |
| Ctrl/Cmd + ' | Run against sample tests |
| Tab | Navigate between UI elements |
| Escape | Close modals/panels |
| Ctrl/Cmd + / | Toggle line comment |
| Ctrl/Cmd + S | Save draft (visual feedback only) |

### ARIA Implementation

| Element | ARIA Attributes | Purpose |
|---------|-----------------|---------|
| Submit button | aria-label, aria-busy, disabled | Announce state to screen readers |
| Status updates | role="status", aria-live="polite" | Announce test progress |
| Problem list | role="table", aria-sort | Sortable table semantics |
| Editor | role="textbox", aria-label | Identify as code input |

---

## ⚖️ Trade-offs Summary

| Decision | Choice | Trade-off |
|----------|--------|-----------|
| Editor | ✅ CodeMirror 6 | Less IDE features vs 10x smaller bundle + mobile |
| State | ✅ Zustand + persist | Smaller ecosystem vs simplicity + persistence |
| Status | ✅ HTTP Polling | 1s latency vs stateless simplicity |
| List | ✅ TanStack Virtual | Implementation complexity vs 60fps scrolling |
| Layout | ✅ Resizable panels | Extra dependency vs user-customizable layout |

---

## 🔮 Future Frontend Enhancements

1. **Monaco Editor Option**: Feature flag for power users who want IDE features
2. **WebSocket Upgrade**: Real-time submission status for contests
3. **Collaborative Editing**: Pair programming mode with CRDT
4. **Code Playback**: Step-through execution visualization
5. **Mobile App**: React Native version for on-the-go practice

---

## 📝 Closing Summary

> "I've designed a frontend architecture for an online judge with CodeMirror 6 for a lightweight, mobile-friendly editor, Zustand for state management with automatic code draft persistence, and HTTP polling for submission status. The key architectural decisions prioritize initial load time and mobile support over IDE-like features—users practice algorithms, not explore APIs, so IntelliSense matters less than bundle size. List virtualization ensures smooth scrolling through 3000+ problems, and resizable panels let users customize their workspace. The polling-based status updates trade 1-second latency for dramatically simpler implementation and better proxy compatibility."
