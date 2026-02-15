# Gmail (Email Client) - System Architecture

## System Overview

Gmail is a web-based email client supporting thread-based conversations, per-user state management, full-text search with privacy controls, label-based organization, and draft auto-save with conflict detection. This design explores the unique challenges of email systems: each message has multiple recipients who maintain independent state (read, labels, archive), search must enforce privacy (BCC recipients hidden), and drafts need conflict-safe concurrent editing support.

**Learning Goals:**
- Thread model with independent per-user state
- Privacy-aware full-text search using Elasticsearch
- Optimistic locking for draft conflict detection
- Label system design (system + custom, per-user assignment)
- Contact frequency tracking for autocomplete

---

## Requirements

### Functional Requirements

1. **Account Management**: User registration, login, logout with session-based auth
2. **Email Composition**: Send emails with To, CC, BCC recipients
3. **Thread Conversations**: Messages grouped into threads with reply chains
4. **Per-User State**: Each user independently manages read, starred, archived, trashed, spam status
5. **Label System**: System labels (INBOX, SENT, TRASH, SPAM, STARRED, DRAFTS, ALL_MAIL, IMPORTANT) auto-created; custom labels with colors
6. **Full-Text Search**: Search email content with advanced operators (from:, to:, has:attachment, date ranges)
7. **Drafts**: Auto-save drafts with optimistic locking for conflict detection
8. **Contact Autocomplete**: Suggest contacts based on communication frequency

### Non-Functional Requirements (Production Scale)

| Requirement | Target |
|-------------|--------|
| Availability | 99.99% uptime |
| Latency | p99 < 200ms for inbox load, p99 < 500ms for search |
| Throughput | 100K emails/second globally |
| Storage | Petabytes of email data, indefinite retention |
| Consistency | Strong for send/receive, eventual for search index |
| Privacy | Users can only search/view emails they are participants in |

---

## Capacity Estimation

### Production Scale

| Metric | Value |
|--------|-------|
| Monthly Active Users | 1.8 billion |
| Emails sent/received per day | 300 billion |
| Average email size | 75 KB (text) + 500 KB (attachments) |
| Search queries per day | 10 billion |
| Storage growth per day | ~22 PB |

### Local Development Scale

| Metric | Value |
|--------|-------|
| Users | 3-10 |
| Emails | Hundreds |
| Threads | Dozens |
| Single PostgreSQL instance | Handles all data |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Sidebar  │  │Thread    │  │ Thread   │  │   Compose    │   │
│  │ (Labels) │  │ List     │  │  View    │  │    Modal     │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS
                         ▼
               ┌─────────────────┐
               │   API Gateway   │
               │  (Rate Limit)   │
               └────────┬────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  API Server │  │  API Server │  │  API Server │
│   (Node.js) │  │   (Node.js) │  │   (Node.js) │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
     ┌──────────┬───────┼───────┬───────────┐
     ▼          ▼       ▼       ▼           ▼
┌────────┐ ┌────────┐ ┌────┐ ┌──────┐ ┌─────────┐
│Postgres│ │ Redis/ │ │ ES │ │Search│ │  Blob   │
│ (Data) │ │ Valkey │ │    │ │Indexer│ │ Storage │
│        │ │(Cache) │ │    │ │Worker│ │  (S3)   │
└────────┘ └────────┘ └────┘ └──────┘ └─────────┘
```

---

## Core Components

### 1. API Server (Express + Node.js)

Handles all client requests through RESTful endpoints:

- **Auth Routes** (`/api/v1/auth/*`): Register, login, logout, session management
- **Thread Routes** (`/api/v1/threads/*`): List by label, get thread detail, update state
- **Message Routes** (`/api/v1/messages/*`): Send new email, reply to thread
- **Label Routes** (`/api/v1/labels/*`): CRUD labels, assign/remove from threads
- **Draft Routes** (`/api/v1/drafts/*`): CRUD drafts with version-based conflict detection
- **Search Routes** (`/api/v1/search`): Full-text search with advanced operators
- **Contact Routes** (`/api/v1/contacts`): Autocomplete by communication frequency

### 2. Thread Service

Manages thread listing, detail retrieval, and per-user state:

```
listThreads(userId, labelName, page)
├── Query threads by label join (thread_labels + labels)
├── Filter by thread_user_state (not trashed, not spam)
├── Join participants (senders + recipients)
├── Join labels for each thread
└── Return with pagination

getThread(userId, threadId)
├── Get thread with user state
├── Get all messages ordered by created_at
├── Get recipients for each message
├── Get labels for this user
└── Auto-mark as read
```

### 3. Message Service

Handles email send flow within a database transaction:

```
sendMessage(senderId, {to, cc, bcc, subject, bodyText, threadId})
├── BEGIN TRANSACTION
├── Look up recipient user IDs by email
├── Create or update thread
│   ├── New thread: INSERT with subject and snippet
│   └── Existing: UPDATE snippet, message_count, last_message_at
├── INSERT message
├── INSERT message_recipients (to, cc, bcc)
├── Add SENT label for sender
├── Add INBOX label + unread state for each recipient
├── Update contacts (frequency, last_contacted_at)
├── COMMIT
└── Invalidate caches
```

### 4. Search Service

Parses Gmail-style search operators and queries Elasticsearch:

```
search("from:alice has:attachment project")
├── Parse operators:
│   ├── from: "alice" → filter by sender_name or sender_email
│   ├── has:attachment → filter has_attachments: true
│   └── remaining text: "project" → multi_match on subject + body
├── Always filter: visible_to contains userId
├── Sort by relevance score, then recency
└── Return with highlights
```

### 5. Search Indexer Worker

Background process that polls for new messages and indexes them:

```
Poll Loop (every 5 seconds):
├── Read last_indexed timestamp from Redis
├── Query messages with created_at > last_indexed (LIMIT 100)
├── For each message:
│   ├── Get recipients
│   ├── Build visible_to = [sender_id, ...recipient_ids]
│   └── Index in Elasticsearch
├── Update last_indexed timestamp
└── Sleep 5 seconds
```

### 6. Draft Service

CRUD operations with optimistic locking:

```
updateDraft(userId, draftId, data, expectedVersion)
├── UPDATE drafts SET ... WHERE id = $1 AND version = $expected
├── If 0 rows affected:
│   ├── Check if draft exists
│   ├── If exists: return 409 Conflict with current version
│   └── If not: return 404
└── If updated: return new draft with version + 1
```

---

## Data Model

### Entity Relationship

```
┌──────────┐     ┌──────────┐     ┌──────────────────┐
│  users   │────▶│ messages │────▶│message_recipients│
│          │     │          │     │                  │
│ id       │     │ id       │     │ message_id       │
│ username │     │ thread_id│     │ user_id          │
│ email    │     │ sender_id│     │ recipient_type   │
│ password │     │ body_text│     │ (to/cc/bcc)      │
└──────────┘     └──────────┘     └──────────────────┘
     │                │
     │           ┌────┴────┐
     │           │ threads │
     │           │         │
     │           │ id      │
     │           │ subject │
     │           │ snippet │
     │           └─────────┘
     │                │
     ▼                ▼
┌──────────┐   ┌──────────────────┐
│  labels  │   │thread_user_state │
│          │   │                  │
│ id       │   │ thread_id        │
│ user_id  │   │ user_id          │
│ name     │   │ is_read          │
│ color    │   │ is_starred       │
│ is_system│   │ is_archived      │
└──────────┘   │ is_trashed       │
     │         └──────────────────┘
     ▼
┌──────────────┐
│thread_labels │
│              │
│ thread_id    │
│ label_id     │
│ user_id      │
└──────────────┘
```

### Full SQL Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(30) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject VARCHAR(500) NOT NULL,
  snippet TEXT,
  message_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  in_reply_to UUID REFERENCES messages(id),
  body_text TEXT NOT NULL,
  body_html TEXT,
  has_attachments BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  recipient_type VARCHAR(3) NOT NULL CHECK (recipient_type IN ('to', 'cc', 'bcc')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) DEFAULT '#666666',
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE TABLE thread_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(thread_id, label_id, user_id)
);

CREATE TABLE thread_user_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  is_trashed BOOLEAN DEFAULT false,
  is_spam BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(thread_id, user_id)
);

CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES threads(id),
  in_reply_to UUID REFERENCES messages(id),
  subject VARCHAR(500),
  body_text TEXT,
  body_html TEXT,
  to_recipients JSONB DEFAULT '[]',
  cc_recipients JSONB DEFAULT '[]',
  bcc_recipients JSONB DEFAULT '[]',
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_email VARCHAR(255) NOT NULL,
  contact_name VARCHAR(100),
  frequency INT DEFAULT 0,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_email)
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100),
  size_bytes BIGINT,
  storage_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Key Indexes

```sql
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX idx_message_recipients_user ON message_recipients(user_id, message_id);
CREATE INDEX idx_thread_labels_user ON thread_labels(user_id, thread_id);
CREATE INDEX idx_thread_user_state_user ON thread_user_state(user_id, is_trashed, is_archived);
CREATE INDEX idx_drafts_user ON drafts(user_id, updated_at DESC);
CREATE INDEX idx_contacts_user ON contacts(user_id, frequency DESC);
CREATE INDEX idx_threads_last_message ON threads(last_message_at DESC);
```

---

## API Design

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/auth/register | Register new user |
| POST | /api/v1/auth/login | Login |
| POST | /api/v1/auth/logout | Logout |
| GET | /api/v1/auth/me | Get current user |

### Threads

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/threads?label=INBOX&page=1 | List threads by label |
| GET | /api/v1/threads/unread-counts | Get unread counts per label |
| GET | /api/v1/threads/:threadId | Get thread with messages |
| PATCH | /api/v1/threads/:threadId/state | Update read/starred/archive/trash |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/v1/messages/send | Send new email |
| POST | /api/v1/messages/reply | Reply to thread |

### Labels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/labels | List user labels |
| POST | /api/v1/labels | Create custom label |
| PUT | /api/v1/labels/:labelId | Update custom label |
| DELETE | /api/v1/labels/:labelId | Delete custom label |
| POST | /api/v1/labels/:labelId/assign | Assign label to thread |
| POST | /api/v1/labels/:labelId/remove | Remove label from thread |

### Drafts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/drafts | List drafts |
| GET | /api/v1/drafts/:draftId | Get draft |
| POST | /api/v1/drafts | Create draft |
| PUT | /api/v1/drafts/:draftId | Update draft (with version) |
| DELETE | /api/v1/drafts/:draftId | Delete draft |

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/search?q=query | Search emails |

### Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/contacts?q=term | Autocomplete contacts |

---

## Key Design Decisions

### 1. Per-User Thread State Table

**Decision**: Separate `thread_user_state` table rather than embedding state in the thread or message table.

**Why it works**: A single email thread can have 5 participants. Alice reads it, Bob has not. Charlie archived it. Each user needs independent flags. A separate table with a UNIQUE(thread_id, user_id) constraint makes this natural -- each row is one user's view of one thread.

**Why the alternative fails**: Embedding read/starred flags in the thread table would force a single state for all users. Using a JSONB column like `user_states: {alice: {read: true}}` would make queries painfully slow at scale -- you cannot efficiently index inside JSONB for "find all unread threads for user X".

**Trade-off**: More JOINs on every thread list query (thread + thread_user_state + thread_labels + labels). We accept this because the JOIN is on indexed columns and the query pattern is predictable.

### 2. Elasticsearch with visible_to for Search Privacy

**Decision**: Index each message in Elasticsearch with a `visible_to` keyword array containing all participant user IDs. Every search query includes a `term` filter on `visible_to`.

**Why it works**: BCC recipients see the message in their search results because their user ID is in `visible_to`. But other recipients do not see the BCC recipient because `visible_to` is per-document, not per-query. The indexer includes `[sender, to_recipients, cc_recipients, bcc_recipients]` in `visible_to`, so each participant can find the message.

**Why PostgreSQL full-text search fails**: PostgreSQL `tsvector` search does not natively support "only return results where this user is a participant." You would need to JOIN with message_recipients on every search, which destroys performance at scale. Elasticsearch's inverted index with term filtering handles this efficiently.

**Trade-off**: Requires maintaining a separate search index via a background worker. Search results may lag 5-10 seconds behind newly sent messages. For email, this latency is acceptable.

### 3. Optimistic Locking for Drafts

**Decision**: Version column on drafts with conditional UPDATE.

**Why it works**: When Tab A loads draft version 3 and Tab B loads draft version 3, both see the same content. Tab A saves first, incrementing to version 4. Tab B tries to save with `WHERE version = 3`, which matches 0 rows. The API returns 409 Conflict with the current draft state, and the client can show "This draft was modified in another window."

**Why pessimistic locking (SELECT FOR UPDATE) fails**: Drafts auto-save every few seconds. Holding a row lock for the duration of editing would block other tabs indefinitely. With hundreds of millions of users, lock contention on the drafts table would be catastrophic.

**Trade-off**: The client must handle 409 responses gracefully. We implement a simple "last write wins" with user notification rather than complex merge logic.

---

## Security and Auth

- **Session-based authentication** with Redis-backed store (express-session + connect-redis)
- **bcrypt password hashing** with salt rounds = 12
- **Rate limiting** on login (5/min), send (50/hr), search (60/min), general (1000/min)
- **CORS** restricted to frontend origin
- **HTTP-only cookies** with SameSite=lax
- **Input validation** on all endpoints (username length, password strength, required fields)
- **SQL injection prevention** via parameterized queries

---

## Monitoring and Observability

### Prometheus Metrics

- `gmail_http_request_duration_seconds` - Request latency histogram
- `gmail_emails_sent_total` - Counter of sent emails
- `gmail_search_queries_total` - Counter of search queries
- `gmail_search_duration_seconds` - Search latency histogram
- `gmail_draft_conflicts_total` - Counter of draft version conflicts
- `gmail_indexed_messages_total` - Counter of messages indexed in ES
- `gmail_circuit_breaker_state` - Circuit breaker state gauge
- `gmail_rate_limit_hits_total` - Rate limit violations

### Structured Logging

Pino JSON logger with request tracing:
- Request ID propagation via `x-trace-id` header
- User context (userId, username) in log entries
- Query timing for slow query detection (>1s triggers warning)
- Cache hit/miss tracking

### Health Checks

- `/api/health` - Simple liveness
- `/api/health/detailed` - PostgreSQL + Redis connectivity with latency
- `/api/health/live` - Process alive check

---

## Failure Handling

### Circuit Breakers (Opossum)

Applied to external service calls (Elasticsearch):
- **Threshold**: 50% failure rate triggers open
- **Reset**: 30-second timeout before half-open test
- **Fallback**: Return empty results for search when ES is down

### Retry Strategy

- Database connections: Automatic reconnect via pg pool
- Redis: Exponential backoff (100ms base, 3s max)
- Search indexer: Continues polling on error, logs and retries

### Graceful Degradation

- If Elasticsearch is down: Search returns empty results, send/receive still works
- If Redis is down: Sessions fail (users need to re-login), cache misses fall through to DB
- If search indexer is behind: Recently sent emails may not appear in search for a few seconds

---

## Scalability Considerations

### Database Scaling Path

1. **Read replicas** for thread list queries (read-heavy workload)
2. **Partitioning** thread_user_state by user_id hash for horizontal sharding
3. **Archive tables** for old messages (move threads older than 2 years)

### Search Scaling

1. **Index sharding** in Elasticsearch by user_id range
2. **Separate hot/warm indices** (recent 30 days vs. older)
3. **Query routing** to specific shards based on user_id

### Caching Strategy

- Thread lists: 30-second TTL, invalidated on send/state change
- Unread counts: 30-second TTL, invalidated on message receive
- Labels: Cached until mutation (long TTL)

---

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Thread state | Per-user table | JSONB in thread | Queryable indexes, clean schema |
| Search engine | Elasticsearch | PostgreSQL FTS | Privacy filtering, advanced operators |
| Draft conflict | Optimistic locking | Pessimistic locks | No lock contention on auto-save |
| Search indexing | Background worker | Inline on send | No send latency increase |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler |
| Label assignment | Per-user | Per-thread | Users need independent label views |
| Contact ranking | Frequency counter | ML model | Simple, effective for autocomplete |

---

## Implementation Notes

### Production-Grade Patterns Implemented

1. **Circuit Breakers (Opossum)**: Protects against Elasticsearch failures. When search fails >50% of requests, circuit opens and returns empty results rather than timing out.

2. **Rate Limiting (express-rate-limit + Redis)**: Distributed rate limiting across multiple API server instances using Redis as shared state.

3. **Prometheus Metrics (prom-client)**: HTTP request duration, email send counts, search latency, draft conflicts, cache hit ratios -- all exposed at `/metrics`.

4. **Structured Logging (Pino)**: JSON-formatted logs with request ID tracing, user context, and query timing. Enables log aggregation and distributed tracing.

5. **Health Checks**: Liveness, readiness, and detailed health endpoints checking all dependencies.

### What Was Simplified

- Single PostgreSQL instance instead of sharded cluster
- Simulated email delivery (messages stay within the system)
- No attachment storage (schema ready, MinIO integration omitted)
- Session auth instead of OAuth/JWT
- Single Elasticsearch node instead of clustered setup

### What Was Omitted

- CDN for static assets
- Multi-region deployment
- Kubernetes orchestration
- Email spam filtering (ML-based)
- POP3/IMAP protocol support
- Push notifications
- Calendar integration
- Real-time updates (WebSocket for new mail notifications)
