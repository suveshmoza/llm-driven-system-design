# MD Reader - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 📋 Introduction

Today I'll design MD Reader, a Progressive Web App for editing and previewing Markdown documents. While this is primarily a client-side application, the "backend" challenge here focuses on the **client-side data layer architecture** - essentially building a local database system within the browser. This includes IndexedDB persistence, service worker caching, data integrity mechanisms, and designing the system to support future server synchronization.

The interesting aspect of this problem is that we're essentially building a distributed system where the "server" lives in the browser. We need to think about durability, consistency, and recovery the same way we would for a traditional backend.

---

## 🎯 Requirements

### Functional Requirements

**Must Have:**
- Document storage with full CRUD operations performed locally
- Auto-save functionality that persists changes as the user types
- Complete offline support with no degradation in core functionality
- Document management supporting multiple documents with metadata

**Nice to Have:**
- Export and import capabilities for backup
- Future cloud synchronization pathway

### Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Durability | Zero document loss | User trust depends on never losing their work |
| Save Latency | Under 100ms | User should never wait for saves |
| Storage Capacity | 50MB+ total | Support 100+ documents with rich content |
| Offline Availability | 100% functionality | Core value proposition of the app |

### Storage Estimates

Let me work through the capacity planning:

- **Active documents per user:** 50 to 100
- **Average document size:** 10KB of markdown content
- **Maximum document size:** 500KB for very large documents
- **Metadata overhead:** Approximately 1KB per document
- **Total storage need:** Up to 50MB per user

This immediately rules out localStorage as our primary storage mechanism, as we'll discuss shortly.

---

## 🏗️ High-Level Design

Here's the overall architecture of the client-side data layer:

```
+------------------------------------------------------------------+
|                    Browser (PWA Container)                        |
+------------------------------------------------------------------+
|                                                                   |
|   +-----------------------------------------------------------+   |
|   |                   Application Layer                        |   |
|   |               (React + Monaco Editor)                      |   |
|   +-----------------------------------------------------------+   |
|                              |                                    |
|                              v                                    |
|   +-----------------------------------------------------------+   |
|   |                   State Layer (Zustand)                    |   |
|   |   - Current document in memory                             |   |
|   |   - Document list for sidebar                              |   |
|   |   - UI preferences and theme                               |   |
|   +-----------------------------------------------------------+   |
|                              |                                    |
|            +-----------------+------------------+                  |
|            |                                    |                  |
|            v                                    v                  |
|   +--------------------+            +--------------------+         |
|   |     IndexedDB      |            |   localStorage     |         |
|   |  (Primary Store)   |            |    (Fallback)      |         |
|   |  - Documents       |            |  - Preferences     |         |
|   |  - Metadata        |            |  - Last doc ID     |         |
|   |  - Sync queue      |            |  - Document backup |         |
|   +--------------------+            +--------------------+         |
|                                                                   |
+-------------------------------------------------------------------+
|              Service Worker (Workbox - Asset Caching)             |
|   - App shell cache (HTML, CSS, JS bundles)                       |
|   - Runtime cache (fonts, icons)                                  |
|   - Precached manifest for offline-first loading                  |
+-------------------------------------------------------------------+
```

The key insight here is that we have a **dual-storage strategy** with IndexedDB as the primary store and localStorage as a backup mechanism. The service worker layer handles caching of application assets separately from user data.

---

## 🔍 Deep Dive

### Deep Dive 1: Primary Storage Selection

This is the foundational decision for the entire data layer.

#### Why IndexedDB Over localStorage?

| Factor | IndexedDB | localStorage | Winner |
|--------|-----------|--------------|--------|
| Storage limit | 50MB+ (browser dependent, often gigabytes) | 5MB hard limit | IndexedDB |
| API type | Asynchronous (non-blocking) | Synchronous (blocks main thread) | IndexedDB |
| Data structure | Key-value with indexes, transactions | Strings only | IndexedDB |
| Query capability | Indexes, cursors, ranges | Key lookup only | IndexedDB |
| Transaction support | Full ACID transactions | None | IndexedDB |

**Decision: ✅ IndexedDB**

> "I'm choosing IndexedDB as our primary storage because we need to support 50MB or more of user data, which immediately exceeds localStorage's 5MB limit. More critically, localStorage operations are synchronous and block the main thread - when a user is typing in the editor, I cannot have save operations causing UI jank. IndexedDB's asynchronous API means we can persist data without impacting the user experience. The structured storage with indexes also lets us efficiently query documents by update time for the sidebar, which would require deserializing everything with localStorage."

---

### Deep Dive 2: IndexedDB API Approach

Raw IndexedDB has a notoriously difficult API based on callbacks and event handlers.

#### Why idb Wrapper Over Raw IndexedDB API?

| Factor | idb Library | Raw IndexedDB | Winner |
|--------|-------------|---------------|--------|
| API style | Promise-based, async/await | Callback-based, event-driven | idb |
| Code readability | Clean, linear flow | Nested callbacks | idb |
| Error handling | Standard try/catch | Event listeners | idb |
| TypeScript support | Full generic types | Manual typing | idb |
| Bundle size | ~3KB gzipped | 0KB (native) | Raw (marginal) |
| Maintenance | Active development | N/A | idb |

**Decision: ✅ idb Library**

> "I'm choosing the idb wrapper library over raw IndexedDB because developer productivity matters significantly here. The raw IndexedDB API uses callbacks and event handlers from a pre-Promise era of JavaScript, making code hard to read and error-prone. With idb, I can use async/await and try/catch, which integrates naturally with the rest of our modern codebase. The library is only about 3KB gzipped - a negligible cost for dramatically improved code maintainability. The TypeScript support with generics also gives us compile-time safety for our document schema."

---

### Deep Dive 3: Save Strategy

How we persist user changes has major implications for both performance and durability.

#### Why Debounced Auto-Save (2 seconds) Over Immediate Saves?

| Factor | Debounced (2s) | Immediate Save | Winner |
|--------|----------------|----------------|--------|
| Write operations | Batched, reduced | Every keystroke | Debounced |
| IndexedDB load | Low | Very high | Debounced |
| Battery impact | Minimal | Significant | Debounced |
| Disk wear (SSDs) | Reduced | Heavy | Debounced |
| Data freshness | 2s behind | Real-time | Immediate |
| Crash recovery | Lose 2s of work | No data loss | Immediate |

**Decision: ✅ Debounced (2 seconds)**

> "I'm choosing a 2-second debounce for auto-save because the alternative - saving on every keystroke - would be excessive and wasteful. Consider a user typing at 60 words per minute: that's roughly 5 keystrokes per second, meaning 300 IndexedDB write operations per minute. Each write has overhead for transaction creation, serialization, and I/O. By debouncing, we collapse rapid changes into single writes. The 2-second window is a deliberate trade-off: short enough that losing 2 seconds of typing in a crash is acceptable, long enough to meaningfully reduce write frequency. We also implement a force-save on window blur and beforeunload events to catch the edge cases."

The save flow looks like this:

```
User Types     Timer Resets    Timer Expires    IndexedDB Write
    |               |               |                 |
    v               v               v                 v
[keystroke] --> [clear timer] --> [2s wait] --> [persist to DB]
    |               ^
    |               |
    +---------------+
    (each keystroke resets)
```

---

### Deep Dive 4: Service Worker and Caching

For a PWA, the service worker is critical for offline functionality.

#### Why Workbox Over Manual Service Worker?

| Factor | Workbox | Manual Service Worker | Winner |
|--------|---------|----------------------|--------|
| Development time | Hours | Days/weeks | Workbox |
| Caching strategies | Built-in, tested | Must implement | Workbox |
| Precaching | Automatic manifest | Manual file list | Workbox |
| Cache versioning | Handled | Must implement | Workbox |
| Bug risk | Battle-tested | High | Workbox |
| Customization | Extensible plugins | Full control | Manual (marginal) |

**Decision: ✅ Workbox**

> "I'm choosing Workbox because writing a correct service worker from scratch is surprisingly difficult and error-prone. Cache invalidation, version management, handling edge cases during updates - Workbox has solved these problems across millions of PWAs. It provides pre-built caching strategies like Cache-First, Network-First, and Stale-While-Revalidate that we can apply declaratively. The Vite plugin generates a precache manifest automatically from our build output, so assets are cached correctly without manual maintenance. The time saved here is better spent on our actual product features."

Our caching strategy by content type:

```
+------------------+---------------------------+-------------------------+
|   Content Type   |    Caching Strategy       |       Rationale         |
+------------------+---------------------------+-------------------------+
| App Shell        | Precache (build time)     | Instant offline startup |
| (HTML, JS, CSS)  |                           |                         |
+------------------+---------------------------+-------------------------+
| Static Assets    | Cache-First               | Immutable, hash in URL  |
| (images, icons)  | (30 day expiry)           |                         |
+------------------+---------------------------+-------------------------+
| Google Fonts     | Stale-While-Revalidate    | Works offline, updates  |
|                  | (1 year expiry)           | in background           |
+------------------+---------------------------+-------------------------+
| Future API calls | Network-First             | Fresh data preferred,   |
|                  | (3s timeout, fallback)    | cache for offline       |
+------------------+---------------------------+-------------------------+
```

---

### Deep Dive 5: Data Integrity

Documents are the user's creative work - we must protect them from corruption.

#### Why SHA-256 Checksums for Data Integrity?

| Factor | SHA-256 Checksum | No Verification | Winner |
|--------|------------------|-----------------|--------|
| Corruption detection | Yes | No | SHA-256 |
| Implementation complexity | Moderate | None | No Verification |
| Performance overhead | Minimal (WebCrypto) | Zero | No Verification (marginal) |
| User trust | High | Lower | SHA-256 |
| Recovery capability | Can detect and attempt | Silent corruption | SHA-256 |

**Decision: ✅ SHA-256 Checksums**

> "I'm choosing to compute and store SHA-256 checksums for each document because data integrity is paramount for a note-taking application. While IndexedDB corruption is rare, it can happen - browser bugs, storage errors, interrupted writes during crashes. By storing a checksum alongside the content, we can verify integrity on load and detect problems before the user sees corrupted data. The Web Crypto API provides hardware-accelerated SHA-256, so performance impact is negligible - a few milliseconds for typical documents. When corruption is detected, we can attempt recovery from our localStorage backup layer."

The integrity verification flow:

```
Document Save:                    Document Load:
+------------+                    +------------+
| Content    |                    | Read from  |
+-----+------+                    |  IndexedDB |
      |                           +-----+------+
      v                                 |
+------------+                          v
| Compute    |                    +------------+
| SHA-256    |                    | Compute    |
+-----+------+                    | SHA-256    |
      |                           +-----+------+
      v                                 |
+------------+                          v
| Store both |                    +-----------+     +----------------+
| content +  |                    | Compare   |---->| Match? Load OK |
| checksum   |                    | checksums |     +----------------+
+------------+                    +-----------+
                                        |
                                        v (mismatch)
                                  +----------------+
                                  | Attempt backup |
                                  |   recovery     |
                                  +----------------+
```

---

### Deep Dive 6: Backup Strategy

The dual-write approach provides defense in depth against data loss.

#### Why Dual-Write (IndexedDB + localStorage Backup)?

| Factor | Dual-Write | IndexedDB Only | Winner |
|--------|------------|----------------|--------|
| Durability | Two copies | Single copy | Dual-Write |
| Storage usage | Higher | Lower | IndexedDB Only |
| Recovery options | Fallback available | None | Dual-Write |
| Complexity | Higher | Simpler | IndexedDB Only |
| User confidence | High | Moderate | Dual-Write |

**Decision: ✅ Dual-Write with Selective Backup**

> "I'm implementing a dual-write strategy where we back up recent documents to localStorage as a secondary copy. This is not a full backup of everything - localStorage is too small for that. Instead, we backup the current active document after each successful save to IndexedDB. If IndexedDB becomes corrupted or inaccessible, we have a recovery path. The localStorage backup is capped at 100KB per document to respect size limits, and we clean up old backups when space is needed. This layered approach means a user would need simultaneous failures of both storage mechanisms to lose data - an extremely unlikely scenario."

```
Save Operation Flow:

+------------+
| Save       |
| triggered  |
+-----+------+
      |
      v
+------------+        Success         +------------------+
| Write to   +----------------------->| Backup to        |
| IndexedDB  |                        | localStorage     |
+-----+------+                        | (if < 100KB)     |
      |                               +------------------+
      | Failure
      v
+------------+
| Retry with |
| exponential|
| backoff    |
+------------+
```

---

## 📊 Data Flow

Here's how a typical document edit flows through the system:

```
User Types in Editor
        |
        v
+----------------+
| Monaco Editor  |
| onChange event |
+-------+--------+
        |
        v
+----------------+
| Zustand Store  |
| Update content |
+-------+--------+
        |
        +---------------------------+
        |                           |
        v                           v
+----------------+          +----------------+
| Debounce Timer |          | UI Re-render   |
| (2 seconds)    |          | (immediate)    |
+-------+--------+          +----------------+
        |
        | Timer expires
        v
+----------------+
| Document       |
| Repository     |
+-------+--------+
        |
        +---------------------------+
        |                           |
        v                           v
+----------------+          +----------------+
| IndexedDB      |          | Compute        |
| Transaction    |          | SHA-256        |
+-------+--------+          +-------+--------+
        |                           |
        v                           v
+----------------+          +----------------+
| Write document |          | Store checksum |
| + metadata     |          | with document  |
+-------+--------+          +----------------+
        |
        v
+----------------+
| Backup to      |
| localStorage   |
+----------------+
        |
        v
+----------------+
| Queue for      |
| future sync    |
+----------------+
```

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Key Rationale |
|----------|--------|-------------|---------------|
| Primary Storage | IndexedDB | localStorage | 50MB+ capacity, async API prevents UI blocking |
| DB Wrapper | idb library | Raw IndexedDB | Promise-based API, dramatically better DX |
| Save Strategy | Debounced (2s) | Immediate | Reduces writes by 100x during active typing |
| Backup Layer | localStorage | None | Recovery path if IndexedDB corrupted |
| Caching | Workbox | Manual SW | Battle-tested, handles versioning correctly |
| Integrity | SHA-256 checksums | None | Detect corruption before user sees it |

The overall philosophy here is **defense in depth for user data**. We accept increased complexity and storage overhead in exchange for maximum durability. For a note-taking application, losing user data is the worst possible outcome.

---

## 🚀 Future Enhancements

**Cloud Synchronization:** The sync queue we've built in IndexedDB is designed with future server sync in mind. Each operation is logged with a unique ID for idempotency and a status for tracking. When we add a backend, we process this queue and use the operation IDs to ensure exactly-once delivery even with network retries.

**Incremental Sync:** Rather than sending full documents on every sync, we could implement diff-based updates. Store a version hash and send only changed portions. This reduces bandwidth and speeds up sync for large documents.

**CRDT Support:** For real-time collaboration in the future, we could integrate Conflict-free Replicated Data Types. Libraries like Yjs or Automerge would let multiple users edit simultaneously with automatic conflict resolution, though this adds significant complexity.

**Cross-Tab Coordination:** Currently each browser tab maintains its own state. Using BroadcastChannel API, we could synchronize state across tabs so edits in one tab appear in others without requiring a page refresh.

---

## 📝 Summary

I've designed the client-side data layer for MD Reader, a Progressive Web App for Markdown editing. The key architectural decisions are:

**IndexedDB as primary storage** provides the capacity and async API we need for a document-heavy application. The idb wrapper makes the API usable with modern JavaScript patterns.

**Debounced auto-save with 2-second delay** balances write efficiency against data freshness, reducing IndexedDB operations by roughly 100x during active typing while keeping the risk window acceptably small.

**Workbox-based service worker** handles asset caching with proven strategies, giving us reliable offline support without reinventing complex caching logic.

**SHA-256 checksums and localStorage backups** provide defense in depth for user data. We can detect corruption and recover from a secondary store if needed.

The system is designed with **future sync capability** built in - a queued operations table in IndexedDB is ready to be processed when we add server-side storage.

This architecture treats the browser as a first-class data layer, applying traditional backend thinking about durability, consistency, and recovery to client-side storage. The result is an application that works entirely offline while maintaining the data guarantees users expect from their documents.
