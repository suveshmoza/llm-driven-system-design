# Gmail (Email Client) - Fullstack System Design Answer

## 1. Requirements Clarification

"I will design a full email client system. The three most interesting technical challenges are: (1) the thread model where each recipient has independent state, (2) privacy-aware full-text search, and (3) draft conflict detection. I will cover both the backend data model and the frontend UX that surfaces these capabilities."

**Functional:** Send/receive emails, thread conversations, per-user state, labels, search, drafts, contact autocomplete

**Scale:** 1.8B MAU, 300B emails/day, p99 < 200ms inbox, p99 < 500ms search

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Frontend (React)                   │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │Sidebar │ │ThreadList│ │ThreadView│ │ Compose  │  │
│  │(Labels)│ │(Virtual) │ │(Messages)│ │ (Modal)  │  │
│  └────────┘ └──────────┘ └──────────┘ └──────────┘  │
└──────────────────────┬───────────────────────────────┘
                       │ REST API
                       ▼
┌──────────────────────────────────────────────────────┐
│              API Server (Node.js + Express)           │
│  ┌──────┐ ┌────────┐ ┌────────┐ ┌──────┐ ┌───────┐  │
│  │ Auth │ │Threads │ │Messages│ │Search│ │Drafts │  │
│  └──────┘ └────────┘ └────────┘ └──────┘ └───────┘  │
└─────────┬──────────────┬──────────────┬──────────────┘
          │              │              │
    ┌─────┴─────┐  ┌─────┴─────┐  ┌────┴──────┐
    │PostgreSQL │  │   Redis   │  │Elastic-   │
    │           │  │(Cache +   │  │search     │
    │           │  │ Sessions) │  │           │
    └───────────┘  └───────────┘  └─────▲─────┘
                                        │
                                  ┌─────┴─────┐
                                  │  Indexer  │
                                  │  Worker   │
                                  └───────────┘
```

---

## 3. Data Model: Thread with Per-User State

"The core challenge: in a thread between Alice and Bob, Alice can read it while Bob has not. Alice can star it while Bob archives it. Each user needs independent state."

### Schema Design

```
┌──────────┐     ┌──────────────────┐
│ threads  │────▶│thread_user_state │
│          │     │ (per-user view)  │
│ id       │     │                  │
│ subject  │     │ thread_id ──FK── │
│ snippet  │     │ user_id  ──FK──  │
│ msg_count│     │ is_read          │
└──────────┘     │ is_starred       │
     │           │ is_archived      │
     ▼           │ is_trashed       │
┌──────────┐     └──────────────────┘
│ messages │
│          │     ┌──────────────────┐
│ id       │────▶│message_recipients│
│ thread_id│     │ message_id       │
│ sender_id│     │ user_id          │
│ body_text│     │ type (to/cc/bcc) │
└──────────┘     └──────────────────┘
```

"The `thread_user_state` table has a UNIQUE constraint on (thread_id, user_id). When Bob sends Alice an email, we INSERT a row for each user with `is_read = true` for Bob (sender) and `is_read = false` for Alice (recipient)."

### Label System

"Labels are also per-user via `thread_labels(thread_id, label_id, user_id)`. System labels (INBOX, SENT, TRASH) are auto-created during registration. Custom labels let users organize with colors."

### Trade-off: Per-User State Table vs. Embedded State

"I considered putting read/starred state in a JSONB column on threads: `{alice_id: {read: true, starred: false}}`. But this cannot be indexed efficiently. The query 'find all unread threads for Alice sorted by date' would require a full table scan with JSONB extraction. With a dedicated table, I index on `(user_id, is_trashed, is_archived)` and the query is a simple B-tree lookup."

---

## 4. Send Flow (Backend + Frontend)

### Backend Transaction

```
sendMessage(senderId, {to, cc, bcc, subject, bodyText})
├── BEGIN TRANSACTION
├── Resolve recipient emails → user IDs
├── Create/update thread
├── INSERT message + message_recipients
├── Add SENT label for sender
├── For each recipient:
│   ├── Add INBOX label
│   ├── Set thread_user_state.is_read = false
│   └── Invalidate cache
├── Update contacts frequency
└── COMMIT
```

### Frontend Compose Flow

```
┌──────────────────────────────────┐
│ ComposeModal (floating, bottom-right)
│                                  │
│ To: [bob@g...] [___] ← chip input with autocomplete
│ Cc: [charlie@g...] [___]        │
│ Subject: [Project Update_____]   │
│                                  │
│ [Email body textarea]            │
│                                  │
│ [Send]              [Discard]    │
└──────────────────────────────────┘
```

"The compose modal floats persistently -- users can navigate the inbox while composing. Contact autocomplete debounces 200ms and ranks by frequency. Chips provide unambiguous address display."

---

## 5. Deep Dive: Search (Full Stack)

### Frontend: Search Bar with Operators

"Users type in a search bar that supports Gmail operators:"

```
┌───────────────────────────────────────┐
│ 🔍 from:bob has:attachment report     │
└───────────────────────────────────────┘
         │ (submit)
         ▼
Parsed → text: "report"
         from: "bob"
         hasAttachment: true
```

"Results appear as a dropdown overlay with highlighted snippets."

### Backend: Operator Parsing + ES Query

```
parseSearchQuery("from:bob has:attachment report")
├── Extract from: "bob" → sender_name/email filter
├── Extract has:attachment → has_attachments: true
├── Remaining text: "report" → multi_match on subject^3 + body
└── Always add: term {visible_to: userId}
```

### Privacy Architecture

"Each message indexed with `visible_to: [sender, to, cc, bcc]`. When Alice searches, ES only returns documents where `visible_to` contains Alice's ID. If Alice BCCs Charlie, Charlie can find the email but Bob cannot see Charlie was included."

### Indexing: Background Worker

```
Search Indexer Worker (polls every 5s):
├── Read last_indexed timestamp from Redis
├── SELECT messages WHERE created_at > last_indexed
├── For each message:
│   ├── Resolve all recipients
│   ├── Build visible_to array
│   └── Index in Elasticsearch
└── Update last_indexed
```

### Trade-off: Background Indexer vs. Inline Indexing

"Inline indexing during send would add 50-100ms latency to every email send -- unacceptable when users send 50+ emails/day. Background indexing means search results lag 5-10 seconds, but email is not a real-time medium. Users rarely search for something they sent seconds ago."

---

## 6. Deep Dive: Draft Conflict Detection (Full Stack)

### Backend: Optimistic Locking

"Drafts have a `version` column. Updates include `WHERE version = $expected`:"

```
Tab A: GET /drafts/123 → version: 3
Tab B: GET /drafts/123 → version: 3

Tab A: PUT /drafts/123 {version: 3, ...}
  → UPDATE ... WHERE version = 3
  → Success, version → 4

Tab B: PUT /drafts/123 {version: 3, ...}
  → UPDATE ... WHERE version = 3
  → 0 rows affected → 409 Conflict
  → Response includes current draft (version 4)
```

### Frontend: Conflict Handling

"When the frontend receives 409, it shows a notification: 'This draft was modified in another window.' The user sees the latest version and can continue editing."

### Trade-off: Optimistic vs. Pessimistic Locking

"Pessimistic locking (`SELECT FOR UPDATE`) would hold a row lock for the entire editing session. Drafts auto-save every few seconds. At scale, this means millions of long-held row locks, causing connection pool exhaustion and deadlocks. Optimistic locking has zero overhead in the common case (single-tab editing) and gracefully handles the rare multi-tab case."

---

## 7. Frontend Architecture

### Routing (TanStack Router)

```
/login              → LoginPage
/register           → RegisterPage
/label/:labelName   → ThreadList (filtered by label)
/thread/:threadId   → ThreadView (all messages)
```

### State Management (Zustand)

"Two stores: `authStore` for user session, `mailStore` for threads/labels/state. Zustand's selector subscriptions prevent unnecessary re-renders."

### Optimistic Updates

"Star, archive, and trash use optimistic patterns:"

```
toggleStar(threadId):
1. Immediately update threads[] in store (UI shows star)
2. PATCH /threads/:id/state {isStarred: true}
3. On failure: revert threads[] (UI reverts)
```

"This makes every action feel instant (<16ms). The revert window is typically <200ms."

### Thread List Virtualization

"I use `@tanstack/react-virtual` to render only visible threads. With `estimateSize: 40px` (Gmail's compact row), a list of 1000 threads renders ~20 DOM nodes. Overscan of 5 prevents blank flashes during fast scrolling."

---

## 8. End-to-End Flow: Reading an Email

```
User clicks thread in inbox
     │
     ├──▶ Frontend: navigate to /thread/:threadId
     │
     ├──▶ Frontend: fetchThread(threadId)
     │         │
     │         ▼
     │    GET /api/v1/threads/:threadId
     │         │
     │         ▼
     │    Backend:
     │    ├── SELECT thread + user_state
     │    ├── SELECT messages ORDER BY created_at
     │    ├── SELECT recipients for each message
     │    ├── SELECT labels for this user
     │    ├── UPDATE thread_user_state SET is_read = true
     │    └── Return thread detail
     │
     ├──▶ Frontend: render ThreadView
     │    ├── Subject + labels in header
     │    ├── MessageCards (last one expanded)
     │    └── Reply box at bottom
     │
     └──▶ Frontend: update unread count in sidebar
```

---

## 9. Sidebar: Label Navigation with Unread Counts

```
┌──────────────────────┐
│  [✏️ Compose]        │
│                      │
│  📥 Inbox      (3)  │  ← unread count from API
│  ⭐ Starred         │
│  📤 Sent            │
│  📝 Drafts          │
│  🗑️ Trash           │
│  ⚠️ Spam            │
│  ─────────────────  │
│  📁 All Mail        │
│  ❗ Important        │
│  ─────────────────  │
│  Labels             │
│  🔵 Work       (1)  │
│  🟢 Personal        │
└──────────────────────┘
```

"Unread counts are fetched on mount and after any state-changing action (send, read, archive). The sidebar uses `fetchUnreadCounts()` which caches for 30 seconds."

---

## 10. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Per-user state | Separate table | JSONB column | Indexable, efficient queries |
| Search engine | Elasticsearch | PostgreSQL FTS | Privacy filtering, operators |
| Draft conflicts | Optimistic locking | Pessimistic locks | No contention on auto-save |
| Search indexing | Background worker | Inline on send | No send latency impact |
| Frontend state | Zustand | React Context | Selector subscriptions |
| Thread list | Virtual scrolling | Render all | Performance at scale |
| Compose | Floating modal | Full page | Persistent across navigation |
| Contact input | Chip-based | Free text | Unambiguous addresses |
| Search UX | Dropdown results | Full page | Quick lookup pattern |
| Unread counts | Short TTL cache | Event-driven | Simpler invalidation logic |
