# Gmail (Email Client) - Frontend System Design Answer

## 1. Requirements Clarification

"For the frontend, I want to focus on three key challenges: the Gmail-style layout with virtualized thread lists, the compose experience with contact autocomplete and CC/BCC, and the search UX with advanced operator support. I will also cover how we handle optimistic updates for actions like star/archive."

**Core Screens:** Login, Inbox (thread list), Thread view, Compose modal, Search results

**Key Interactions:** Star/archive with instant feedback, compose with autocomplete, inline reply, label management

---

## 2. Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        App Shell                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │                    Header                         │   │
│  │  ┌──────┐  ┌──────────────────┐  ┌──────────┐   │   │
│  │  │ Logo │  │   SearchBar      │  │UserMenu  │   │   │
│  │  └──────┘  └──────────────────┘  └──────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │          │  │                                    │   │
│  │ Sidebar  │  │         Content Area               │   │
│  │          │  │  ┌────────────────────────────┐    │   │
│  │ Compose  │  │  │      ThreadList            │    │   │
│  │ INBOX(3) │  │  │  ┌──────────────────────┐  │    │   │
│  │ Starred  │  │  │  │  ThreadListItem      │  │    │   │
│  │ Sent     │  │  │  │  ThreadListItem      │  │    │   │
│  │ Drafts   │  │  │  │  ThreadListItem      │  │    │   │
│  │ Trash    │  │  │  └──────────────────────┘  │    │   │
│  │ Spam     │  │  └────────────────────────────┘    │   │
│  │          │  │                                    │   │
│  │ Labels   │  │  OR                                │   │
│  │ ─ Work   │  │                                    │   │
│  │ ─ Personal│  │  ┌────────────────────────────┐    │   │
│  │          │  │  │      ThreadView             │    │   │
│  └──────────┘  │  │  ┌──────────────────────┐  │    │   │
│                │  │  │    MessageCard        │  │    │   │
│                │  │  │    MessageCard        │  │    │   │
│                │  │  │    Reply Box          │  │    │   │
│                │  │  └──────────────────────┘  │    │   │
│                │  └────────────────────────────┘    │   │
│                └────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────┐                   │
│  │        ComposeModal              │  (floating)       │
│  │  To: [autocomplete chips]       │                   │
│  │  Cc: [autocomplete chips]       │                   │
│  │  Subject: ___________           │                   │
│  │  Body: ______________           │                   │
│  │  [Send] [Discard]               │                   │
│  └──────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. State Management

"I use Zustand for global state with two stores:"

### Auth Store
```
authStore
├── user: User | null
├── isAuthenticated: boolean
├── isLoading: boolean
├── login(username, password)
├── register(username, email, password)
├── logout()
└── checkAuth()
```

### Mail Store
```
mailStore
├── threads: Thread[]
├── totalThreads: number
├── currentThread: ThreadDetail | null
├── labels: Label[]
├── unreadCounts: Record<string, number>
├── currentLabel: string
├── composeOpen: boolean
├── fetchThreads(label, page)
├── fetchThread(threadId)
├── fetchLabels()
├── fetchUnreadCounts()
├── toggleStar(threadId)      ← optimistic
├── markAsRead(threadId)      ← optimistic
├── moveToTrash(threadId)     ← optimistic
├── archiveThread(threadId)   ← optimistic
└── setComposeOpen(boolean)
```

"I chose Zustand over Context because it avoids re-rendering the entire tree when one piece of state changes. The mail store has many frequently-updated properties (unread counts, thread read state), and Zustand's selector-based subscriptions keep renders minimal."

---

## 4. Deep Dive: Thread List Virtualization

"The inbox can have thousands of threads. Rendering all of them as DOM nodes would cause jank on scroll and high memory usage."

### Virtual Scrolling with TanStack Virtual

```
┌──────────────────────────────────┐
│ Viewport (visible area)          │
│ ┌──────────────────────────────┐ │
│ │ ThreadListItem (rendered)    │ │ ← overscan: 5 items above
│ │ ThreadListItem (rendered)    │ │
│ │ ThreadListItem (rendered)    │ │ ← visible items
│ │ ThreadListItem (rendered)    │ │
│ │ ThreadListItem (rendered)    │ │
│ │ ThreadListItem (rendered)    │ │ ← overscan: 5 items below
│ └──────────────────────────────┘ │
│                                  │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ ← not rendered (100+ items)
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────┘
```

"I use `@tanstack/react-virtual` with `estimateSize: () => 40` (Gmail's compact row height). The virtualizer only renders items in the viewport plus 5 overscan items above and below. For 1000 threads, this means ~20 DOM nodes instead of 1000."

### Why Not Infinite Scroll?

"Gmail uses pagination, not infinite scroll. With email, users often know approximately when they received something ('it was last week') and use page navigation to jump there. Infinite scroll would force sequential loading, which is frustrating for this use case."

---

## 5. Deep Dive: Compose Modal

### Floating Compose Window

"Gmail's compose is a floating window that stays visible while navigating. I implement this as a fixed-position modal at the bottom-right, with minimize/maximize support."

```
States:
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│ Full (560px) │────▶│ Minimized    │────▶│  Closed  │
│              │     │ (title bar)  │     │          │
│ To, CC, BCC  │     │              │     │          │
│ Subject      │◀────│              │     │          │
│ Body         │     └──────────────┘     └──────────┘
│ Send/Discard │
└─────────────┘
```

### Contact Autocomplete

"The To/CC/BCC fields use chip-based input with debounced autocomplete:"

```
User types "bo" (200ms debounce)
     │
     ▼
GET /api/v1/contacts?q=bo
     │
     ▼
┌──────────────────────┐
│ Bob Smith             │
│ bob@gmail.local       │
├──────────────────────┤
│ Bobby Tables          │
│ bobby@example.com     │
└──────────────────────┘
     │ (user clicks)
     ▼
[bob@gmail.local] [___________]
     chip               input
```

"Contacts are ranked by frequency (most-emailed first). The debounce prevents API calls on every keystroke. Chips can be removed with backspace or click."

### Trade-off: Chip Input vs. Plain Text

| Approach | Pros | Cons |
|----------|------|------|
| Chip input | Clear visual, easy remove | Complex implementation |
| ❌ Plain text | Simple | Hard to parse, ambiguous |

"Chips make it unambiguous which addresses are included. The implementation complexity is worth it because email address parsing from free-text is error-prone."

---

## 6. Deep Dive: Search UX

### Search Bar with Advanced Operators

"The search bar parses Gmail-style operators and provides inline hints:"

```
┌───────────────────────────────────────────┐
│ 🔍 from:alice has:attachment project      │
└───────────────────────────────────────────┘
                    │
                    ▼ (on submit)
┌───────────────────────────────────────────┐
│ Search Results (inline dropdown)          │
│ ┌───────────────────────────────────────┐ │
│ │ Alice Johnson <alice@gmail.local>     │ │
│ │ Project Update - Q4 Report            │ │
│ │ ...Q4 report with <em>project</em>...│ │
│ ├───────────────────────────────────────┤ │
│ │ Alice Johnson <alice@gmail.local>     │ │
│ │ Code Review: Auth Module              │ │
│ │ ...review my PR for the <em>project...│ │
│ └───────────────────────────────────────┘ │
│ [Close]                                   │
└───────────────────────────────────────────┘
```

"Results appear as a dropdown overlay. Clicking a result navigates to the thread view. The search response includes highlighted snippets from Elasticsearch, which I render with `dangerouslySetInnerHTML` for the `<em>` tags."

### Trade-off: Dropdown vs. Full Page Search

| Approach | Pros | Cons |
|----------|------|------|
| Dropdown overlay | Quick glance, no navigation | Limited space |
| ❌ Full page | More room for results | Loses inbox context |

"I chose dropdown because most email searches are quick lookups -- the user knows what they are looking for and just needs to find the thread. A full-page search feels heavyweight for this use case."

---

## 7. Optimistic Updates

"For star, archive, and trash actions, I update the UI immediately before the API responds:"

```
User clicks star
     │
     ├──▶ UI instantly shows filled star (optimistic)
     │
     └──▶ PATCH /api/v1/threads/:id/state {isStarred: true}
              │
              ├── Success: keep UI state
              └── Failure: revert to unfilled star
```

"This makes the UI feel instant. The revert-on-failure pattern means we never show incorrect state for more than the API round-trip time (typically <200ms). For archive and trash, we also optimistically remove the thread from the list."

---

## 8. Routing Strategy

"I use TanStack Router with file-based routing:"

```
routes/
├── __root.tsx         → App shell (sidebar + header + outlet)
├── index.tsx          → Redirect to /label/INBOX
├── login.tsx          → Login page
├── register.tsx       → Registration page
├── label.$labelName.tsx → Thread list filtered by label
└── thread.$threadId.tsx → Thread detail view
```

"The root layout handles auth gating: if not authenticated, it renders the outlet without sidebar/header (showing login/register). If authenticated, it shows the full Gmail layout."

---

## 9. Performance Considerations

| Technique | Where | Impact |
|-----------|-------|--------|
| Virtual scrolling | ThreadList | Renders ~20 nodes instead of 1000+ |
| Debounced search | ContactAutocomplete, SearchBar | Reduces API calls by 80% |
| Optimistic updates | Star, archive, trash | Perceived 0ms latency |
| Zustand selectors | All components | Minimal re-renders |
| Conditional expansion | MessageCard in ThreadView | Only last message expanded |
| Short cache TTL | Thread list, unread counts | 30s freshness balance |

---

## 10. Trade-offs Summary

| Approach | Pros | Cons |
|----------|------|------|
| Zustand | Selector subscriptions, minimal re-renders | Another library to learn |
| ❌ React Context | Built-in, no dependencies | Re-renders entire tree |
| TanStack Virtual | Efficient DOM, smooth scroll | Complexity for fixed-height |
| ❌ Render all | Simple implementation | Jank at 500+ threads |
| Floating compose | Persistent across navigation | Z-index management |
| ❌ Full-page compose | Simpler layout | Loses inbox context |
| Chip input for recipients | Unambiguous addresses | More complex to implement |
| ❌ Free text input | Simple | Parsing errors, ambiguity |
