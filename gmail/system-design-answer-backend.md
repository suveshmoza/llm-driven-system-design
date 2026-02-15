# Gmail (Email Client) - Backend System Design Answer

## 1. Requirements Clarification

"Before diving in, let me clarify scope. We are building an email system with thread-based conversations. Key backend challenges I want to focus on: the thread model where each user has independent state, privacy-aware full-text search, and draft conflict detection. I will scope out spam filtering and attachment processing."

**Functional:** Send/receive emails, thread conversations, per-user read/starred/archived state, label system, full-text search, draft auto-save

**Non-Functional:** 99.99% uptime, p99 < 200ms inbox load, p99 < 500ms search, strong consistency for send, eventual for search index

---

## 2. Capacity Estimation

"At Gmail scale: 1.8B MAU, 300B emails/day. Average email 75KB text + 500KB attachments. That is roughly 22PB/day storage growth. Search indexes add 30% overhead. For our design, I will focus on the data model and search architecture that enables this scale."

---

## 3. High-Level Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Clients   │────▶│  API Gateway│────▶│  API Servers│
└─────────────┘     │ (Rate Limit)│     │  (Node.js)  │
                    └─────────────┘     └──────┬──────┘
                                               │
                    ┌──────────────┬────────────┼────────────┐
                    ▼              ▼            ▼            ▼
              ┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐
              │PostgreSQL│  │  Redis   │ │Elastic-  │ │  Search  │
              │ (Primary)│  │ (Cache + │ │search    │ │ Indexer  │
              │          │  │ Sessions)│ │(Search)  │ │ (Worker) │
              └──────────┘  └──────────┘ └──────────┘ └──────────┘
```

"The core insight is separating concerns: PostgreSQL owns the source of truth for emails and state, Elasticsearch handles search with privacy filtering, and a background worker bridges the two."

---

## 4. Data Model

### Thread Model with Per-User State

"The fundamental challenge is that Gmail threads have independent state per user. If Alice and Bob are in the same thread, Alice can mark it read while Bob sees it as unread. Alice can archive it while Bob has it in INBOX."

```
┌──────────┐     ┌──────────────────┐     ┌──────────┐
│ threads  │────▶│thread_user_state │◀────│  users   │
│          │     │                  │     │          │
│ id       │     │ thread_id (FK)   │     │ id       │
│ subject  │     │ user_id (FK)     │     │ username │
│ snippet  │     │ is_read          │     │ email    │
│ msg_count│     │ is_starred       │     └──────────┘
│ last_msg │     │ is_archived      │          │
└──────────┘     │ is_trashed       │          │
     │           │ is_spam          │          │
     │           └──────────────────┘          │
     ▼                                         ▼
┌──────────┐     ┌──────────────────┐   ┌──────────┐
│ messages │────▶│message_recipients│   │  labels  │
│          │     │                  │   │          │
│ id       │     │ message_id       │   │ id       │
│ thread_id│     │ user_id          │   │ user_id  │
│ sender_id│     │ recipient_type   │   │ name     │
│ body_text│     │ (to/cc/bcc)      │   │ is_system│
└──────────┘     └──────────────────┘   └──────────┘
```

"I chose a separate `thread_user_state` table rather than embedding state in the thread. The alternative -- a JSONB column like `{alice: {read: true}}` -- cannot be efficiently indexed. With per-user state in a dedicated table, I can index on `(user_id, is_trashed, is_archived)` for fast inbox queries."

### Label Assignment

"Labels are per-user too. When Bob labels a thread 'Work', Alice does not see that label. The `thread_labels` table has a unique constraint on `(thread_id, label_id, user_id)`, giving each user independent label assignments."

---

## 5. Deep Dive: Search Architecture

### Privacy-Aware Search with Elasticsearch

"Search in email is uniquely challenging because of privacy. If Alice BCCs Charlie on an email to Bob, Charlie must be able to find this email in search, but Bob must not know Charlie received it."

```
┌──────────────┐                    ┌──────────────┐
│  API Server  │──── search ───────▶│Elasticsearch │
│              │     request        │              │
│ Always adds: │                    │ Index: emails│
│ visible_to = │                    │              │
│ current_user │                    │ visible_to:  │
└──────────────┘                    │ [sender,     │
                                    │  to_recips,  │
       ┌──────────┐                 │  cc_recips,  │
       │ Indexer  │─── index ──────▶│  bcc_recips] │
       │ Worker   │    message      │              │
       └──────────┘                 └──────────────┘
```

"Each indexed document includes a `visible_to` keyword array with all participant user IDs. The search query always includes `{term: {visible_to: userId}}`. This way BCC recipients can find the email, but it never leaks to other participants."

### Search Operator Parsing

"I parse Gmail-style operators before querying ES:"

| Operator | Example | ES Query |
|----------|---------|----------|
| from: | from:alice | match on sender_name OR term on sender_email |
| to: | to:bob | match on recipient_names OR term on recipients |
| has:attachment | has:attachment | term: has_attachments = true |
| before: | before:2024-01-01 | range: created_at lte |
| after: | after:2024-01-01 | range: created_at gte |

### Trade-off: Why Not PostgreSQL Full-Text Search?

"PostgreSQL FTS with `tsvector` could handle basic keyword search, but it fails for our privacy requirement. To enforce 'only show results where this user is a participant,' we would need to JOIN with message_recipients on every search query. At 300B emails/day, this JOIN becomes the bottleneck. Elasticsearch's inverted index with term filtering on `visible_to` handles this in O(1) per document, making it the right choice despite the operational overhead of maintaining a separate search cluster."

---

## 6. Deep Dive: Draft Conflict Detection

"When a user has Gmail open in two tabs and edits the same draft, we need to prevent silent data loss."

### Optimistic Locking Pattern

```
Tab A loads draft (version=3)        Tab B loads draft (version=3)
     │                                    │
     ▼                                    ▼
Tab A saves: UPDATE ... WHERE ver=3   Tab B saves: UPDATE ... WHERE ver=3
     │                                    │
     ▼                                    ▼
  Success! ver → 4                    0 rows affected!
                                      → Return 409 Conflict
                                      → Include current draft state
```

"I use a `version` column on the drafts table. Every update includes `WHERE version = $expectedVersion`. If another tab saved first, the version has already incremented, so the conditional UPDATE matches zero rows. The API returns 409 with the current draft state, letting the client show 'This draft was modified elsewhere.'"

### Why Not Pessimistic Locking?

"Drafts auto-save every few seconds. `SELECT ... FOR UPDATE` would hold a row lock for the entire editing session -- potentially hours. With hundreds of millions of concurrent users, this creates massive lock contention and connection exhaustion on the database. Optimistic locking has zero contention in the common case (single tab editing) and handles conflicts gracefully in the rare case."

---

## 7. Deep Dive: Send Flow Transaction

"Sending an email touches multiple tables atomically:"

```
BEGIN TRANSACTION
├── Look up recipient user IDs by email address
├── Create thread (or update existing for replies)
├── INSERT message record
├── INSERT message_recipients (to, cc, bcc entries)
├── Add SENT label to sender's thread_labels
├── For each recipient:
│   ├── Add INBOX label to recipient's thread_labels
│   ├── Create/update thread_user_state (is_read = false)
│   └── Invalidate recipient's cache
├── Update sender's contacts table (frequency++)
COMMIT
```

"The transaction ensures atomicity -- if any step fails, the entire send rolls back. This prevents partial states like 'message exists but no recipients' or 'thread created but no labels assigned.'"

---

## 8. Caching Strategy

| Data | Cache Key | TTL | Invalidation |
|------|-----------|-----|-------------|
| Thread list | threads:{userId}:{label}:{page} | 30s | On send, state change |
| Unread counts | unread:{userId} | 30s | On message receive |
| Labels | labels:{userId} | 300s | On label mutation |
| Search indexer position | search-indexer:last-indexed | None | Updated by worker |

"I chose short TTLs (30s) for thread lists rather than event-driven invalidation because the complexity of tracking all cache invalidation paths (send, receive, archive, trash, label assign, label remove) across multiple users is not worth the marginal latency improvement."

---

## 9. Scalability Path

### Database Sharding

"At scale, I would shard by user_id hash. All of a user's data (thread_user_state, thread_labels, drafts, contacts) is accessed with user_id, making it a natural partition key. Cross-shard queries only happen for thread participant lookups during send, which is low-frequency."

### Search Index Partitioning

"Elasticsearch indices partitioned by time (monthly) with user_id routing. Recent months on hot nodes (SSD), older months on warm nodes (HDD). This optimizes the 80/20 pattern where most searches target recent emails."

---

## 10. Trade-offs Summary

| Approach | Pros | Cons |
|----------|------|------|
| Per-user state table | Clean indexes, efficient queries | More JOINs per request |
| ❌ JSONB state column | Simpler schema | Cannot index efficiently |
| ES with visible_to | Privacy at O(1) per doc | Separate infrastructure |
| ❌ PostgreSQL FTS | No extra infrastructure | Privacy requires expensive JOINs |
| Optimistic locking | Zero contention normally | Client must handle 409 |
| ❌ Pessimistic locking | Simple logic | Lock contention on auto-save |
| Background indexer | No send latency hit | Search lags 5-10 seconds |
| ❌ Inline indexing | Instant search availability | Adds 50-100ms to send latency |
