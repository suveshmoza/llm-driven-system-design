# Gmail (Email Client) - Development with Claude

## Project Context

Building an email client system to understand thread-based messaging, per-user state management, full-text search with privacy controls, and draft conflict detection.

**Key Learning Goals:**
- Design a thread model where recipients have independent state (read/labels)
- Implement full-text search with Elasticsearch and per-user visibility
- Build draft conflict detection using optimistic locking
- Understand email label system design (system + custom labels)

---

## Key Challenges Explored

### 1. Thread Model with Independent User State

**Problem**: In Gmail, each user has their own view of a thread -- one person can mark it as read while another sees it as unread. Labels are per-user too.

**Solution**: Separate `thread_user_state` table with per-user flags (is_read, is_starred, is_archived, is_trashed, is_spam). Thread labels are also per-user via `thread_labels` table with a (thread_id, label_id, user_id) unique constraint.

### 2. Full-Text Search with Privacy

**Problem**: Users should only see emails they are a participant in. A BCC recipient should not be visible to others.

**Solution**: Each message indexed in Elasticsearch includes a `visible_to` array containing the sender and all recipient user IDs. Search queries always filter by `visible_to` to enforce privacy.

### 3. Draft Conflict Detection

**Problem**: If a user has Gmail open in multiple tabs, simultaneous edits to the same draft can cause data loss.

**Solution**: Optimistic locking via a `version` column on drafts. Updates include `WHERE version = $expected`, returning 409 Conflict if the version has changed.

### 4. Label System

**Problem**: Gmail has both system labels (INBOX, SENT, TRASH) and user-created custom labels, all with per-user assignment to threads.

**Solution**: System labels created automatically during user registration. Custom labels use the same table with `is_system = false`. Labels assigned per-user via `thread_labels`.

---

## Development Phases

### Phase 1: Core Infrastructure (Complete)
- [x] PostgreSQL schema for users, threads, messages, labels
- [x] Redis for sessions and caching
- [x] Session-based auth
- [x] System label creation on registration

### Phase 2: Email Send/Receive (Complete)
- [x] Send message with thread creation
- [x] Reply to existing thread
- [x] Auto-label (SENT for sender, INBOX for recipients)
- [x] Contact auto-creation and frequency tracking

### Phase 3: Thread Management (Complete)
- [x] Thread list filtered by label
- [x] Thread detail with all messages
- [x] Per-user state (read, starred, archived, trashed, spam)
- [x] Unread counts per label

### Phase 4: Search (Complete)
- [x] Elasticsearch integration
- [x] Search indexer worker
- [x] Gmail-style search operators (from:, to:, has:attachment)
- [x] Per-user visibility filtering

### Phase 5: Drafts (Complete)
- [x] CRUD drafts
- [x] Optimistic locking with version column
- [x] 409 Conflict response on version mismatch

### Phase 6: Frontend (Complete)
- [x] Gmail-style layout (sidebar, thread list, thread view)
- [x] Virtualized thread list
- [x] Compose modal with CC/BCC
- [x] Contact autocomplete
- [x] Search bar with advanced operators
- [x] Star/archive/trash with optimistic updates

---

## Design Decisions Log

### Decision 1: Per-User Thread State vs. Per-Thread Flags
**Context**: Each user needs independent read/starred/archived state
**Decision**: Separate `thread_user_state` table
**Trade-off**: More joins on read, but correct per-user semantics

### Decision 2: Elasticsearch for Search vs. PostgreSQL Full-Text
**Context**: Need privacy-aware search with advanced operators
**Decision**: Elasticsearch with `visible_to` field
**Trade-off**: Additional infrastructure, but richer search capabilities

### Decision 3: Optimistic Locking for Drafts
**Context**: Multi-tab editing can cause lost updates
**Decision**: Version column with conditional update
**Trade-off**: Client must handle 409 conflicts, but prevents silent data loss

### Decision 4: Worker-Based Search Indexing
**Context**: Indexing inline with send would add latency
**Decision**: Background worker polls for new messages
**Trade-off**: Search results may lag a few seconds behind, acceptable for email

---

## Resources

- [Gmail API Design](https://developers.google.com/gmail/api)
- [Elasticsearch Best Practices](https://www.elastic.co/guide/en/elasticsearch/reference/current/best-practices.html)
- [Optimistic Locking Patterns](https://www.postgresql.org/docs/current/mvcc-intro.html)
