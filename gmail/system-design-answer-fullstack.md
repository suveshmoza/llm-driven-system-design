# Gmail (Email Client) - Fullstack System Design Answer

## 🎯 1. Requirements Clarification

"I will design a full email client system. The three most interesting technical challenges are: (1) the thread model where each recipient has independent state, (2) privacy-aware full-text search, and (3) draft conflict detection. I will cover both the backend data model and the frontend UX that surfaces these capabilities."

**Functional:** Send/receive emails, thread conversations, per-user state (read/starred/archived), labels (system + custom), full-text search with operators, drafts with conflict detection, contact autocomplete

**Scale:** 1.8B MAU, 300B emails/day, p99 < 200ms inbox, p99 < 500ms search

---

## 🏗️ 2. Architecture Overview

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

## 💾 3. Data Model: Thread with Per-User State

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

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash | email | Display name for thread rendering |
| threads | id (UUID PK), subject, snippet, message_count, last_message_at | last_message_at DESC | Snippet shows latest message preview |
| messages | id (UUID PK), thread_id (FK), sender_id (FK), body_text, has_attachments | (thread_id, created_at) | Ordered within thread by creation time |
| message_recipients | message_id (FK), user_id (FK), recipient_type | (user_id, message_id) | Type constrained to to/cc/bcc |
| thread_user_state | thread_id (FK), user_id (FK), is_read, is_starred, is_archived, is_trashed | (user_id, is_trashed, is_archived) | UNIQUE(thread_id, user_id) |
| labels | id (UUID PK), user_id (FK), name, color, is_system | UNIQUE(user_id, name) | System labels auto-created on registration |
| thread_labels | thread_id (FK), label_id (FK), user_id (FK) | (user_id, thread_id) | Per-user label assignment |
| drafts | id (UUID PK), user_id (FK), subject, body_text, version | (user_id, updated_at DESC) | Version for optimistic locking |
| contacts | user_id (FK), contact_email, frequency | (user_id, frequency DESC) | Drives autocomplete ranking |

"The `thread_user_state` table has a UNIQUE constraint on (thread_id, user_id). When Bob sends Alice an email, we INSERT a row for each user with `is_read = true` for Bob (sender) and `is_read = false` for Alice (recipient)."

### Trade-off: Per-User State Table vs. Embedded State

"I considered putting read/starred state in a JSONB column on threads: `{alice_id: {read: true, starred: false}}`. But this cannot be indexed efficiently. The query 'find all unread threads for Alice sorted by date' would require a full table scan with JSONB extraction. With a dedicated table, I index on `(user_id, is_trashed, is_archived)` and the query is a simple B-tree lookup."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Separate thread_user_state table | Indexable, efficient queries, clean schema | More JOINs per request |
| ❌ JSONB column on threads | Fewer tables | Cannot index, full scan for per-user queries |

### Label System

"Labels are also per-user via `thread_labels(thread_id, label_id, user_id)`. System labels (INBOX, SENT, TRASH) are auto-created during registration. Custom labels let users organize with colors."

---

## 📨 4. Send Flow (Backend + Frontend)

### Backend Transaction

```
sendMessage(senderId, {to, cc, bcc, subject, bodyText})
├── BEGIN TRANSACTION
├── Check idempotency key (prevent duplicate sends)
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

"The idempotency key is a UUID generated when the compose modal opens. If the same key is submitted twice (due to network retry or double-click), the server returns the previously created message without re-executing the transaction. This prevents the most damaging email bug: duplicate sends."

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

## 🔧 5. Deep Dive: Search (Full Stack)

### Frontend: Search Bar with Operators

"Users type in a search bar that supports Gmail operators:"

```
┌───────────────────────────────────────┐
│ from:bob has:attachment report         │
└───────────────────────────────────────┘
         │ (submit)
         ▼
Parsed → text: "report"
         from: "bob"
         hasAttachment: true
```

"Results appear as a dropdown overlay with highlighted snippets. Clicking a result navigates to the thread view. The dropdown preserves inbox context -- users can dismiss and return to their thread list without navigation."

### Backend: Operator Parsing + ES Query

| Operator | Example | Elasticsearch Behavior |
|----------|---------|------------------------|
| from: | from:bob | Match on sender_name or term on sender_email |
| to: | to:alice | Match on recipient_names or term on recipients |
| has:attachment | has:attachment | Term filter: has_attachments equals true |
| before: | before:2024-01-01 | Range filter: created_at less than or equal |
| after: | after:2024-01-01 | Range filter: created_at greater than or equal |
| (free text) | report | Multi-match on subject (boosted 3x) and body_text |

"Subject is boosted 3x because users typically remember subject lines better than body content. The remaining free text after operator extraction becomes the multi-match query."

### Privacy Architecture

"Each message indexed with `visible_to: [sender, to, cc, bcc]`. When Alice searches, Elasticsearch only returns documents where `visible_to` contains Alice's ID. If Alice BCCs Charlie, Charlie can find the email but Bob cannot see Charlie was included. This is the key insight: the `visible_to` array is per-document, not per-query, so BCC privacy is maintained at the index level."

### Indexing: Background Worker

```
Search Indexer Worker (polls every 5s):
├── Read last_indexed timestamp from Redis
├── SELECT messages WHERE created_at > last_indexed
├── For each message:
│   ├── Resolve all recipients
│   ├── Build visible_to array
│   └── Index in Elasticsearch (upsert by message ID)
└── Update last_indexed only after successful batch
```

"The indexer uses the message ID as the Elasticsearch document ID, making re-indexing idempotent. If the worker crashes and restarts, it replays from the last checkpoint without creating duplicates."

### Trade-off: Background Indexer vs. Inline Indexing

"Inline indexing during send would add 50-100ms latency to every email send -- unacceptable when users send 50+ emails/day. Background indexing means search results lag 5-10 seconds, but email is not a real-time medium. Users rarely search for something they sent seconds ago."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Background indexer | No send latency impact, crash-safe replay | 5-10 second search lag |
| ❌ Inline indexing on send | Instant search availability | 50-100ms added to every send |

---

## 🔧 6. Deep Dive: Draft Conflict Detection (Full Stack)

### Backend: Optimistic Locking

"Drafts have a `version` column. Updates include a conditional check on the expected version:"

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

"When the frontend receives 409, it shows a notification: 'This draft was modified in another window.' The user sees the latest version and can continue editing. Auto-save resumes with the new version number, so subsequent saves succeed unless another conflict occurs."

### Trade-off: Optimistic vs. Pessimistic Locking

"Pessimistic locking with SELECT FOR UPDATE would hold a row lock for the entire editing session. Drafts auto-save every few seconds. At scale, this means millions of long-held row locks, causing connection pool exhaustion and deadlocks. Optimistic locking has zero overhead in the common case (single-tab editing) and gracefully handles the rare multi-tab case. The trade-off is client-side complexity: the UI must detect 409 responses, display a notification, and restart auto-save with the updated version. But this is straightforward compared to debugging database lock contention at scale."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Optimistic locking | Zero contention normally, simple server logic | Client must handle 409 |
| ❌ Pessimistic locking | Simpler conflict model | Millions of long-held locks at scale |

---

## 🖥️ 7. Frontend Architecture

### Routing (TanStack Router)

```
/login              → LoginPage
/register           → RegisterPage
/label/:labelName   → ThreadList (filtered by label)
/thread/:threadId   → ThreadView (all messages)
```

### State Management (Zustand)

"Two stores: `authStore` for user session, `mailStore` for threads/labels/state. Zustand's selector subscriptions prevent unnecessary re-renders -- when unread counts change, only the sidebar label badges re-render, not the entire thread list."

### Optimistic Updates

"Star, archive, and trash use optimistic patterns:"

```
toggleStar(threadId):
1. Immediately update threads[] in store (UI shows star)
2. PATCH /threads/:id/state {isStarred: true}
3. On failure: revert threads[] (UI reverts), show error toast
```

"This makes every action feel instant (<16ms). The revert window is typically <200ms."

### Thread List Virtualization

"I use `@tanstack/react-virtual` to render only visible threads. With `estimateSize: 40px` (Gmail's compact row), a list of 1000 threads renders ~20 DOM nodes. Overscan of 5 prevents blank flashes during fast scrolling. Pagination bounds memory usage so we never accumulate thousands of threads in state."

---

## 🔄 8. End-to-End Flow: Reading an Email

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
     │    ├── Check Redis cache (thread:{userId}:{threadId})
     │    ├── Cache miss: query PostgreSQL
     │    │   ├── SELECT thread + user_state
     │    │   ├── SELECT messages ORDER BY created_at
     │    │   ├── SELECT recipients for each message
     │    │   └── SELECT labels for this user
     │    ├── UPDATE thread_user_state SET is_read = true
     │    ├── Cache result in Redis (60s TTL)
     │    └── Return thread detail
     │
     ├──▶ Frontend: render ThreadView
     │    ├── Subject + labels in header
     │    ├── MessageCards (last one expanded, others collapsed)
     │    └── Reply box at bottom
     │
     └──▶ Frontend: update unread count in sidebar (optimistic -1)
```

---

## 🗄️ 9. Caching and Performance

| Data | Cache Key | TTL | Invalidation |
|------|-----------|-----|-------------|
| Thread list | threads:{userId}:{label}:{page} | 30s | On send, state change |
| Unread counts | unread:{userId} | 30s | On message receive |
| Thread detail | thread:{userId}:{threadId} | 60s | On new message in thread |
| Labels | labels:{userId} | 300s | On label mutation |

> "I chose 30-second TTLs over event-driven invalidation because the cache invalidation graph for email is extremely complex. A single send operation can invalidate cache entries for multiple recipients across multiple labels. Tracking all these paths reliably is harder than accepting 30 seconds of staleness."

---

## 📊 10. Sidebar: Label Navigation with Unread Counts

```
┌──────────────────────┐
│  [Compose]           │
│                      │
│  INBOX          (3)  │  ← unread count from API
│  Starred             │
│  Sent                │
│  Drafts              │
│  Trash               │
│  Spam                │
│  ─────────────────   │
│  All Mail            │
│  Important           │
│  ─────────────────   │
│  Labels              │
│  Work            (1) │
│  Personal            │
└──────────────────────┘
```

"Unread counts are fetched on mount and after any state-changing action (send, read, archive). The sidebar uses `fetchUnreadCounts()` which caches for 30 seconds. Each label in the sidebar uses a Zustand selector to subscribe only to its own count, preventing full-sidebar re-renders."

---

## 🛡️ 11. Failure Handling

"Circuit breakers protect against Elasticsearch failures: when search error rate exceeds 50%, the circuit opens and returns empty results rather than cascading timeouts. Send and receive continue to work because they depend only on PostgreSQL. If Redis is down, sessions fail (users must re-login) and cache misses fall through to the database, increasing latency but maintaining correctness."

"The search indexer is crash-safe by design. It advances its checkpoint only after successful indexing. If the worker crashes, it restarts from the last checkpoint and re-processes any missed messages. Since indexing is idempotent (upsert by message ID), replays produce no duplicates."

---

## ⚖️ 12. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Per-user state | ✅ Separate table | ❌ JSONB column | Indexable, efficient queries |
| Search engine | ✅ Elasticsearch | ❌ PostgreSQL FTS | Privacy filtering, rich operators |
| Draft conflicts | ✅ Optimistic locking | ❌ Pessimistic locks | No contention on auto-save |
| Search indexing | ✅ Background worker | ❌ Inline on send | No send latency impact |
| Frontend state | ✅ Zustand | ❌ React Context | Selector subscriptions |
| Thread list | ✅ Virtual scrolling | ❌ Render all | Performance at 1000+ threads |
| Compose UX | ✅ Floating modal | ❌ Full page | Persistent across navigation |
| Contact input | ✅ Chip-based | ❌ Free text | Unambiguous addresses |
| Search UX | ✅ Dropdown results | ❌ Full page | Quick lookup, preserves context |
| Caching | ✅ Short TTL (30s) | ❌ Event-driven | Simpler than tracking invalidation graph |
| Duplicate prevention | ✅ Idempotency keys | ❌ Client-side disable | Server-side guarantee, network-retry safe |
