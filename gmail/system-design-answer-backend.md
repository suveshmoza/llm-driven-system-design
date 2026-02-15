# Gmail (Email Client) - Backend System Design Answer

## 🎯 1. Requirements Clarification

"Before diving in, let me clarify scope. We are building an email system with thread-based conversations. Key backend challenges I want to focus on: the thread model where each user has independent state, privacy-aware full-text search, and draft conflict detection. I will scope out spam filtering, attachment processing, and POP3/IMAP protocol support."

**Functional:**
- Send/receive emails with To, CC, BCC recipients
- Thread-based conversations with reply chains
- Per-user state: read, starred, archived, trashed, spam
- Label system: system labels auto-created, custom labels with colors
- Full-text search with Gmail-style operators (from:, to:, has:attachment, date ranges)
- Draft auto-save with conflict detection across tabs
- Contact autocomplete ranked by communication frequency

**Non-Functional:**

| Requirement | Target |
|-------------|--------|
| Availability | 99.99% uptime |
| Latency | p99 < 200ms inbox load, p99 < 500ms search |
| Throughput | 100K emails/second globally |
| Storage | Petabytes, indefinite retention |
| Consistency | Strong for send/receive, eventual for search index |
| Privacy | Users only see emails where they are a participant |

---

## 📊 2. Capacity Estimation

"At Gmail scale: 1.8B MAU, 300B emails/day. Average email 75KB text + 500KB attachments. That is roughly 22PB/day storage growth. Search indexes add 30% overhead. For our design, I will focus on the data model and search architecture that enables this scale."

| Metric | Value |
|--------|-------|
| Emails sent per second | ~3.5 million |
| Search queries per second | ~115,000 |
| Concurrent connections | ~100 million |
| Thread list reads per second | ~10 million |

"The read-to-write ratio is roughly 100:1 -- users check their inbox far more often than they send email. This drives our caching and read-replica strategy."

---

## 🏗️ 3. High-Level Architecture

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

"The core insight is separating concerns: PostgreSQL owns the source of truth for emails and state, Elasticsearch handles search with privacy filtering, Redis accelerates read-heavy workloads like inbox listing and unread counts, and a background worker bridges PostgreSQL to Elasticsearch without adding latency to the send path."

---

## 💾 4. Data Model

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

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash | email, username | Display name and avatar for thread list rendering |
| threads | id (UUID PK), subject, snippet, message_count, last_message_at | last_message_at DESC | Snippet is first ~100 chars of latest message body |
| messages | id (UUID PK), thread_id (FK), sender_id (FK), in_reply_to (FK), body_text, body_html, has_attachments | (thread_id, created_at) | in_reply_to enables reply chain reconstruction |
| message_recipients | id (UUID PK), message_id (FK), user_id (FK), recipient_type | (user_id, message_id) | recipient_type is constrained to 'to', 'cc', 'bcc' |
| thread_user_state | id (UUID PK), thread_id (FK), user_id (FK), is_read, is_starred, is_archived, is_trashed, is_spam | (user_id, is_trashed, is_archived) | UNIQUE(thread_id, user_id) -- one row per user per thread |
| labels | id (UUID PK), user_id (FK), name, color, is_system | UNIQUE(user_id, name) | System labels: INBOX, SENT, TRASH, SPAM, STARRED, DRAFTS, ALL_MAIL, IMPORTANT |
| thread_labels | id (UUID PK), thread_id (FK), label_id (FK), user_id (FK) | (user_id, thread_id) | UNIQUE(thread_id, label_id, user_id) -- per-user label assignment |
| drafts | id (UUID PK), user_id (FK), thread_id (FK), subject, body_text, to/cc/bcc_recipients (JSONB), version | (user_id, updated_at DESC) | Version column for optimistic locking |
| contacts | id (UUID PK), user_id (FK), contact_email, contact_name, frequency, last_contacted_at | (user_id, frequency DESC) | Frequency drives autocomplete ranking |
| attachments | id (UUID PK), message_id (FK), filename, content_type, size_bytes, storage_key | (message_id) | storage_key references object in blob storage (S3/MinIO) |

"I chose a separate `thread_user_state` table rather than embedding state in the thread. The alternative -- a JSONB column like `{alice: {read: true}}` -- cannot be efficiently indexed. With per-user state in a dedicated table, I can index on `(user_id, is_trashed, is_archived)` for fast inbox queries."

### Label Assignment

"Labels are per-user too. When Bob labels a thread 'Work', Alice does not see that label. The `thread_labels` table has a unique constraint on `(thread_id, label_id, user_id)`, giving each user independent label assignments."

---

## 🔌 5. API Design

### Authentication

```
POST /api/v1/auth/register    → Create account, auto-create system labels
POST /api/v1/auth/login       → Start session, return user object
POST /api/v1/auth/logout      → Destroy session
GET  /api/v1/auth/me          → Return current user from session
```

### Thread Operations

```
GET    /api/v1/threads?label=INBOX&page=1    → List threads by label with pagination
GET    /api/v1/threads/unread-counts         → Unread count per label for sidebar
GET    /api/v1/threads/:threadId             → Thread detail with all messages, auto-marks read
PATCH  /api/v1/threads/:threadId/state       → Update read/starred/archived/trashed/spam
```

### Message Operations

```
POST   /api/v1/messages/send     → Send new email (creates thread if needed)
POST   /api/v1/messages/reply    → Reply to existing thread
```

### Label Operations

```
GET    /api/v1/labels                     → List all labels for current user
POST   /api/v1/labels                     → Create custom label with name and color
PUT    /api/v1/labels/:labelId            → Update label name or color
DELETE /api/v1/labels/:labelId            → Delete custom label (system labels protected)
POST   /api/v1/labels/:labelId/assign     → Assign label to thread for current user
POST   /api/v1/labels/:labelId/remove     → Remove label from thread for current user
```

### Draft Operations

```
GET    /api/v1/drafts              → List all drafts for current user
GET    /api/v1/drafts/:draftId     → Get draft with current version
POST   /api/v1/drafts              → Create new draft
PUT    /api/v1/drafts/:draftId     → Update draft (requires version for conflict detection)
DELETE /api/v1/drafts/:draftId     → Delete draft
```

### Search and Contacts

```
GET    /api/v1/search?q=query      → Full-text search with operator parsing
GET    /api/v1/contacts?q=term     → Contact autocomplete ranked by frequency
```

"All endpoints require authentication via session cookie except register and login. Rate limits are applied per-user: 50 sends per hour, 60 searches per minute, 1000 general requests per minute."

---

## 🔧 6. Deep Dive: Search Architecture

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

"Each indexed document includes a `visible_to` keyword array with all participant user IDs. The search query always includes a term filter on `visible_to` matching the current user. This way BCC recipients can find the email, but it never leaks to other participants."

### Search Operator Parsing

"I parse Gmail-style operators before constructing the Elasticsearch query:"

| Operator | Example | Elasticsearch Behavior |
|----------|---------|------------------------|
| from: | from:alice | Match on sender_name or term filter on sender_email |
| to: | to:bob | Match on recipient_names or term on recipients |
| has:attachment | has:attachment | Term filter: has_attachments equals true |
| before: | before:2024-01-01 | Range filter: created_at less than or equal |
| after: | after:2024-01-01 | Range filter: created_at greater than or equal |
| (free text) | project report | Multi-match on subject (boosted 3x) and body_text |

"Operators are extracted via regex parsing. Remaining text after operator extraction becomes the free-text query. Subject is boosted 3x because users typically remember subject lines better than body content."

### Trade-off: Why Not PostgreSQL Full-Text Search?

"PostgreSQL FTS with `tsvector` could handle basic keyword search, but it fails for our privacy requirement. To enforce 'only show results where this user is a participant,' we would need to JOIN with message_recipients on every search query. At 300B emails/day, this JOIN becomes the bottleneck -- the message_recipients table grows at 3-5x the rate of messages (each message has multiple recipients), making it the largest table in the system. Elasticsearch's inverted index with term filtering on `visible_to` handles this in O(1) per document, making it the right choice despite the operational overhead of maintaining a separate search cluster. The trade-off is infrastructure complexity: we need a background indexer, health monitoring for the ES cluster, and we accept 5-10 second search lag for newly sent messages."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Elasticsearch with visible_to | Privacy at O(1) per doc, rich operators, relevance scoring | Separate infrastructure, search lag |
| ❌ PostgreSQL FTS | No extra infrastructure, strong consistency | Privacy requires expensive JOINs, limited operators |

---

## 🔧 7. Deep Dive: Draft Conflict Detection

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

"I use a `version` column on the drafts table. Every update includes a WHERE clause checking the expected version. If another tab saved first, the version has already incremented, so the conditional UPDATE matches zero rows. The API returns 409 with the current draft state, letting the client show 'This draft was modified elsewhere.'"

### Why Not Pessimistic Locking?

"Drafts auto-save every few seconds. A SELECT FOR UPDATE would hold a row lock for the entire editing session -- potentially hours. With hundreds of millions of concurrent users, this creates massive lock contention and connection exhaustion on the database. Optimistic locking has zero contention in the common case (single tab editing) and handles conflicts gracefully in the rare case. The trade-off is that the client must handle 409 responses, but this is straightforward UI work compared to the operational nightmare of millions of long-held row locks."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Optimistic locking (version column) | Zero contention normally, simple server logic | Client must handle 409 conflicts |
| ❌ Pessimistic locking (SELECT FOR UPDATE) | Simpler conflict model | Lock contention on auto-save, connection exhaustion |

---

## 🔧 8. Deep Dive: Send Flow Transaction

"Sending an email touches multiple tables atomically:"

```
BEGIN TRANSACTION
├── Check idempotency key (prevent duplicate sends)
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

"The transaction ensures atomicity -- if any step fails, the entire send rolls back. This prevents partial states like 'message exists but no recipients' or 'thread created but no labels assigned.' The idempotency key at the top of the flow prevents duplicate sends from network retries or double-clicks."

---

## 🗄️ 9. Caching Strategy

| Data | Cache Key Pattern | TTL | Invalidation Trigger |
|------|-------------------|-----|----------------------|
| Thread list | threads:{userId}:{label}:{page} | 30s | On send, receive, state change |
| Unread counts | unread:{userId} | 30s | On message receive, mark read |
| Labels | labels:{userId} | 300s | On label create/update/delete |
| Thread detail | thread:{userId}:{threadId} | 60s | On new message, state change |
| Search indexer position | search-indexer:last-indexed | None | Updated by worker after each batch |

"I chose short TTLs (30s) for thread lists rather than event-driven invalidation because the complexity of tracking all cache invalidation paths (send, receive, archive, trash, label assign, label remove) across multiple users is not worth the marginal latency improvement. A 30-second TTL means worst case a user sees a stale inbox for half a minute, which is acceptable for email."

> "At scale, cache hit rates above 95% are critical. With 10 million thread list reads per second, even a 1% improvement in cache hit rate removes 100,000 database queries per second. The 30-second TTL gives us roughly 97% hit rate for active users who refresh every few seconds."

---

## 📈 10. Scalability Path

### What Breaks First

"The first bottleneck is the thread_user_state table. Every inbox load queries it, every state change writes to it, and it grows proportionally to users multiplied by threads. At 1.8B users with an average of 10,000 threads each, this table has 18 trillion rows."

### Database Sharding

"I would shard by user_id hash. All of a user's data (thread_user_state, thread_labels, drafts, contacts) is accessed with user_id, making it a natural partition key. Cross-shard queries only happen for thread participant lookups during send, which is low-frequency compared to reads."

### Read Replicas

"Thread list queries and unread counts are the highest-volume reads. These can be served from read replicas with a few seconds of replication lag, which is acceptable for inbox display. Writes (send, state changes) always go to the primary."

### Search Index Partitioning

"Elasticsearch indices partitioned by time (monthly) with user_id routing. Recent months on hot nodes (SSD), older months on warm nodes (HDD). This optimizes the 80/20 pattern where most searches target recent emails."

### Archive Strategy

"Threads older than two years move to cold storage. The thread metadata stays in PostgreSQL (for label queries), but message bodies move to blob storage with an on-demand fetch pattern. This keeps the hot dataset manageable."

---

## 🛡️ 11. Failure Handling

### Circuit Breakers

"I apply circuit breakers (Opossum pattern) to Elasticsearch calls. When search fails more than 50% of requests in a 30-second window, the circuit opens and search returns empty results with a user-facing message rather than timing out. The circuit enters half-open state after 30 seconds, allowing a test request through. If it succeeds, the circuit closes and normal search resumes."

> "The key insight is that Elasticsearch being down should not prevent users from sending and receiving email. Search is a degraded-but-functional experience, not a hard dependency."

### Retry Strategy

"Database connections use automatic reconnection via the PostgreSQL connection pool. Redis uses exponential backoff starting at 100ms with a 3-second cap. The search indexer worker continues polling on error -- it logs failures and retries on the next cycle. Since the indexer only advances its checkpoint after successful indexing, no messages are ever lost."

### Graceful Degradation

| Component Down | Impact | Mitigation |
|----------------|--------|------------|
| Elasticsearch | Search returns empty | Send/receive still works, circuit breaker prevents timeouts |
| Redis | Sessions fail, cache misses | Users re-login, all reads go to database |
| Search indexer | New emails not searchable | Backlog clears automatically when indexer recovers |
| Read replica | Slight latency increase | Reads fall back to primary |

---

## 🔍 12. Observability

"I expose Prometheus metrics at a /metrics endpoint for scraping:"

| Metric | Type | Purpose |
|--------|------|---------|
| http_request_duration_seconds | Histogram | Latency percentiles per endpoint |
| emails_sent_total | Counter | Send volume for capacity planning |
| search_queries_total | Counter | Search volume and error rates |
| search_duration_seconds | Histogram | Search latency separate from general HTTP |
| draft_conflicts_total | Counter | Frequency of 409 conflicts |
| indexed_messages_total | Counter | Indexer throughput |
| circuit_breaker_state | Gauge | 0=closed, 1=open, 2=half-open |
| cache_hit_ratio | Gauge | Cache effectiveness per key pattern |
| rate_limit_hits_total | Counter | Rate limit violations by endpoint |

"Structured JSON logging via Pino includes request IDs for distributed tracing, user context for debugging, and query timing to detect slow queries above one second. Health endpoints at /api/health provide liveness checks and detailed dependency status for orchestration."

---

## 🔒 13. Security Considerations

"Session-based authentication with Redis-backed store provides immediate revocability -- if a session is compromised, deleting the Redis key instantly invalidates it. Passwords use bcrypt with 12 salt rounds."

"Rate limiting is applied per-user via Redis: 5 login attempts per minute (brute-force prevention), 50 sends per hour (spam prevention), 60 searches per minute (abuse prevention). The rate limiter uses a sliding window algorithm stored in Redis for consistency across multiple API server instances."

"All database queries use parameterized queries to prevent SQL injection. Input validation enforces length limits on usernames, password complexity requirements, and required fields. CORS is restricted to the frontend origin, and cookies use HTTP-only with SameSite=lax to prevent CSRF."

> "BCC privacy is enforced at two levels: the API never returns BCC recipients in thread detail responses, and the search index includes BCC recipients in visible_to without exposing the recipient type. This defense-in-depth approach means even if one layer has a bug, the other still protects privacy."

---

## ⚖️ 14. Trade-offs Summary

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Per-user state table | Clean indexes, efficient queries | More JOINs per request |
| ❌ JSONB state column | Simpler schema | Cannot index efficiently |
| ✅ ES with visible_to | Privacy at O(1) per doc | Separate infrastructure |
| ❌ PostgreSQL FTS | No extra infrastructure | Privacy requires expensive JOINs |
| ✅ Optimistic locking | Zero contention normally | Client must handle 409 |
| ❌ Pessimistic locking | Simple logic | Lock contention on auto-save |
| ✅ Background indexer | No send latency hit | Search lags 5-10 seconds |
| ❌ Inline indexing | Instant search availability | Adds 50-100ms to send latency |
| ✅ Short TTL caching | Simple invalidation | 30s staleness window |
| ❌ Event-driven invalidation | Instant freshness | Complex invalidation graph |
| ✅ User_id sharding | Natural partition key | Cross-shard sends |
| ❌ Thread_id sharding | Co-locates thread data | Scatters user data across shards |
