# MD Reader - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

---

## 📋 Introduction

"I'll be designing MD Reader, a Progressive Web App for editing and previewing Markdown documents. This is a full-stack challenge that focuses heavily on client-side architecture since we're building an offline-first application with no backend initially. The key challenges are coordinating data flow from the editor through state management to persistence, implementing PWA service worker strategies, and preparing the architecture for future cloud sync."

---

## 🎯 Requirements

### Functional Requirements

1. **Unified Editor Experience**: Monaco Editor with live split-pane preview
2. **Seamless Persistence**: Auto-save with full offline support
3. **Document Lifecycle**: Create, read, update, delete documents across sessions
4. **Cross-Platform PWA**: Installable and functional offline on any device

### Non-Functional Requirements

1. **Latency**: Preview updates within 150ms, saves within 500ms
2. **Durability**: Zero data loss across crashes, tab closes, and app updates
3. **Consistency**: Read-your-writes guarantee within session
4. **Installability**: Lighthouse PWA score of 100

### Scale Estimates

- **Documents**: 100 documents per user, average 10KB each (1MB total per user)
- **Session Length**: 30-120 minutes of active editing
- **Write Frequency**: Up to 30 auto-saves per minute during active editing

---

## 🏗️ High-Level Design

"Let me sketch the overall architecture. This is a client-heavy PWA where most logic lives in the browser."

```
+------------------------------------------------------------------+
|                        Browser (PWA)                              |
+------------------------------------------------------------------+
|                                                                   |
|  +--------------------+  +------------------+  +----------------+ |
|  |   Editor Layer     |  |   State Layer    |  | Persistence    | |
|  |                    |  |                  |  |    Layer       | |
|  |  +------------+    |  |  +-----------+   |  | +-----------+  | |
|  |  |   Monaco   |----+->|  |  Zustand  |---+->| | IndexedDB |  | |
|  |  |   Editor   |    |  |  |  Store    |   |  | +-----------+  | |
|  |  +------------+    |  |  +-----------+   |  |      |         | |
|  |                    |  |       |          |  | +-----------+  | |
|  |  +------------+    |  |       v          |  | |localStorage| | |
|  |  |  Preview   |<---+--+  (subscriptions) |  | | (backup)   | | |
|  |  |  Renderer  |    |  |                  |  | +-----------+  | |
|  |  +------------+    |  |                  |  |                | |
|  +--------------------+  +------------------+  +----------------+ |
|                                                                   |
+------------------------------------------------------------------+
|                    Service Worker (Workbox)                       |
|  +---------------+  +----------------+  +----------------------+  |
|  | App Shell     |  | Runtime Cache  |  | Background Sync      |  |
|  | (Precached)   |  | (Fonts, CDN)   |  | Queue (Future)       |  |
|  +---------------+  +----------------+  +----------------------+  |
+------------------------------------------------------------------+
```

### Layer Responsibilities

**Editor Layer**: Monaco Editor for code input, markdown-it for preview rendering. Handles user interaction and text manipulation.

**State Layer**: Zustand store as single source of truth. Manages current document, document list, loading states, and save status. Provides reactive subscriptions to components.

**Persistence Layer**: IndexedDB as primary storage with localStorage as crash-recovery backup. Handles all document CRUD operations.

**Service Worker**: Workbox-powered caching for offline support. Precaches app shell, runtime caches external resources, and prepares sync queue for future cloud integration.

---

## 🔍 Deep Dive

### Deep Dive 1: State Management Choice

#### Why Zustand Over Redux?

| Factor | Zustand | Redux | Winner |
|--------|---------|-------|--------|
| Boilerplate | Minimal setup | Actions, reducers, store config | Zustand |
| Bundle size | ~2KB | ~7KB + toolkit | Zustand |
| Learning curve | Simple hooks-based | Steeper (actions, dispatch) | Zustand |
| Persistence | Built-in middleware | Requires redux-persist | Zustand |
| DevTools | Optional integration | First-class support | Redux |
| Ecosystem | Growing | Massive | Redux |

**Decision: Zustand**

> "I'm choosing Zustand because for a single-user client-side app, Redux's ceremony adds friction without proportional benefit. Zustand's built-in persist middleware handles localStorage sync out of the box, and the API is just functions - no action creators, no dispatch calls. For a small team or solo project, this means faster iteration. If we later need time-travel debugging or complex middleware chains, we can migrate, but I doubt a markdown editor will need that."

### Deep Dive 2: Persistence Strategy

#### Why IndexedDB Plus localStorage Dual-Write?

| Factor | IndexedDB Only | localStorage Only | Dual-Write | Winner |
|--------|----------------|-------------------|------------|--------|
| Storage quota | 50MB+ | 5MB limit | Both available | Dual |
| API type | Async | Sync (blocks UI) | Best of both | Dual |
| Crash recovery | Transaction rollback | Instant write | Double safety | Dual |
| Query capability | Indexes, cursors | Key-value only | Full power | Dual |
| Complexity | Moderate | Simple | Higher | IndexedDB |
| Browser support | Universal modern | Universal | Universal | Tie |

**Decision: IndexedDB Primary + localStorage Backup**

> "I'm using IndexedDB as the primary store because it handles structured data with proper indexing - I can query documents by updated timestamp or search by title. But IndexedDB transactions can fail or be interrupted by tab closes. So I also write a backup to localStorage for the current document. It's only 5MB, but that's enough for one document's crash recovery. If IndexedDB becomes unavailable - say on a browser with strict privacy settings - we gracefully degrade to localStorage-only mode. This dual-write pattern guarantees zero data loss."

### Deep Dive 3: Service Worker Strategy

#### Why Workbox Over Manual Service Worker?

| Factor | Workbox | Manual SW | Winner |
|--------|---------|-----------|--------|
| Cache strategies | 5 built-in strategies | Write from scratch | Workbox |
| Precaching | Manifest-based, versioned | Manual file lists | Workbox |
| Runtime caching | Declarative routing | Custom fetch handling | Workbox |
| Cache cleanup | Automatic expiration | Manual management | Workbox |
| Bundle size | ~10KB | 0KB | Manual |
| Debugging | Good logging | DIY | Workbox |
| Update handling | Proven patterns | Common pitfalls | Workbox |

**Decision: Workbox**

> "I'm choosing Workbox because service workers are notoriously tricky to get right. Cache invalidation, handling updates, version conflicts - these are solved problems in Workbox. The slight bundle size increase is worth not spending days debugging why users see stale content. Workbox's precaching integrates with Vite's build to automatically hash asset URLs, and the expiration plugin prevents cache bloat. Writing this manually would be reinventing the wheel."

### Deep Dive 4: Cache Strategy Per Resource Type

#### Why Cache-First for Static, Network-First for API?

| Resource Type | Strategy | Rationale |
|---------------|----------|-----------|
| App shell (HTML, JS, CSS) | Cache-First | Static assets rarely change, instant loads |
| Google Fonts stylesheets | Stale-While-Revalidate | Fonts update rarely, show cached while checking |
| Font files (.woff2) | Cache-First, 1 year | Immutable after first load |
| CDN resources (highlight.js) | Cache-First, 30 days | Versioned URLs, long expiration |
| Future API calls | Network-First | Fresh data, fall back to cache offline |

**Decision: Mixed Strategies Based on Resource Mutability**

> "I'm matching cache strategy to resource characteristics. Static assets get cache-first because a hash change in the URL triggers a new cache entry anyway - there's no staleness risk. For fonts, stale-while-revalidate gives instant rendering while silently updating in background. When we add cloud sync, API calls will use network-first so users see fresh data when online, but can still read their documents offline. This isn't one-size-fits-all - each resource type has the optimal strategy for its update pattern."

### Deep Dive 5: Sync Architecture (Future)

#### Why Queue-Based Sync Over Real-Time WebSocket?

| Factor | Queue-Based Sync | WebSocket Real-Time | Winner |
|--------|------------------|---------------------|--------|
| Offline support | Queue locally, sync later | Fails when offline | Queue |
| Conflict handling | Merge at sync time | Real-time conflicts | Queue |
| Battery/bandwidth | Efficient batching | Always-on connection | Queue |
| Implementation | Simpler | Complex reconnection logic | Queue |
| Latency | Seconds to minutes | Milliseconds | WebSocket |
| Multi-user collab | Not supported | Enabled | WebSocket |

**Decision: Queue-Based Sync (for future implementation)**

> "I'm designing for queue-based sync because this is a personal document editor, not Google Docs. Real-time collaboration would require operational transforms or CRDTs, WebSocket infrastructure, and conflict resolution UI for every keystroke collision. Overkill for a solo user. Instead, I'll queue operations locally in IndexedDB and sync when online. If the user edits on two devices while offline, we detect conflicts at sync time and show a three-way merge UI. This matches how Obsidian and other note-taking apps work - it's a proven pattern for single-user sync."

### Deep Dive 6: Type Sharing Strategy

#### Why Shared TypeScript Interfaces Over GraphQL Codegen?

| Factor | Shared Interfaces | GraphQL Codegen | Winner |
|--------|-------------------|-----------------|--------|
| Setup complexity | Copy types | Schema + codegen + hooks | Shared |
| Runtime overhead | Zero | Query parsing | Shared |
| Backend requirement | None | GraphQL server | Shared |
| Type safety | Manual discipline | Generated from schema | GraphQL |
| Flexibility | Arbitrary types | Schema-constrained | Shared |
| Learning curve | Minimal | GraphQL knowledge | Shared |

**Decision: Shared TypeScript Interfaces**

> "I'm using plain TypeScript interfaces shared across layers because there's no backend yet. GraphQL codegen shines when you have a schema as source of truth, but for a client-only PWA, it's premature complexity. I define Document, DocumentMeta, and EditorState types in a shared types file, and all layers import from there. When we add a backend, we can introduce GraphQL and generate client types from the schema. But right now, that's YAGNI - You Ain't Gonna Need It."

### Deep Dive 7: Debounce Timing Choices

#### Why 500ms for Saves vs 150ms for Preview?

| Operation | Timing | Rationale |
|-----------|--------|-----------|
| Preview render | 150ms debounce | Fast feedback loop for editing |
| IndexedDB save | 500ms debounce | Reduce I/O, still responsive |
| localStorage backup | On save | Piggyback on IndexedDB write |
| Document list update | 1000ms debounce | Less critical, reduce re-renders |

**Decision: Tiered Debouncing Based on Criticality**

> "I'm using different debounce timings for different operations based on user perception. Preview needs to feel instant - 150ms is the threshold where users perceive lag, so I debounce to that. But saving to IndexedDB doesn't need to happen on every keystroke - 500ms groups bursts of typing into single writes, reducing I/O and battery usage on mobile. The localStorage backup happens at save time, not independently. Document list updates are even slower at 1000ms because the sidebar isn't the focus during editing. This tiered approach balances responsiveness with efficiency."

### Deep Dive 8: Data Integrity

#### Why Client-Side Checksums?

| Factor | With Checksums | Without Checksums | Winner |
|--------|----------------|-------------------|--------|
| Corruption detection | SHA-256 hash | Silent failure | Checksums |
| Duplicate detection | Content-addressable | Title matching only | Checksums |
| Sync conflict detection | Compare hashes | Full content diff | Checksums |
| CPU overhead | ~1ms per 10KB | Zero | Without |
| Storage overhead | 64 bytes per doc | Zero | Without |

**Decision: SHA-256 Checksums**

> "I'm computing SHA-256 checksums for each document save because browser storage can silently corrupt data - especially on mobile when storage pressure forces eviction. When loading a document, I can verify the checksum matches content. During import, I detect duplicates by checksum rather than relying on titles. And when cloud sync arrives, I'll compare checksums to detect conflicts without transmitting full content. The 1ms compute cost is invisible to users, and 64 bytes storage per document is negligible. It's cheap insurance against data integrity issues."

---

## 📊 Data Flow

### Document Save Flow

```
User Types
    |
    v
+--------+     immediate      +---------+      150ms        +----------+
| Monaco |------------------>| Zustand |-------------------->| Preview  |
| Editor |                   | Store   |   (fast path)      | Renderer |
+--------+                   +---------+                     +----------+
                                  |
                                  | 500ms debounce (slow path)
                                  v
                            +-----------+
                            | Save Hook |
                            +-----------+
                                  |
           +----------------------+----------------------+
           |                                             |
           v                                             v
    +------------+                              +-------------+
    | IndexedDB  |                              | localStorage|
    | (Primary)  |                              | (Backup)    |
    +------------+                              +-------------+
```

### Document Load Flow

```
Route Change / App Start
         |
         v
   +-----------+
   | Load Hook |
   +-----------+
         |
         v
+------------------+
| Try IndexedDB    |---> Success ---> Validate Checksum ---> Load to Store
+------------------+
         |
         | Fail
         v
+------------------+
| Try localStorage |---> Success ---> Restore to IndexedDB ---> Load to Store
+------------------+
         |
         | Fail
         v
   Show "Not Found" Error
```

### Service Worker Lifecycle

```
User Visits App
       |
       v
+------------------+     Cache Hit      +------------+
| Service Worker   |------------------>| Serve from  |
| (Active)         |                   | Cache       |
+------------------+                   +------------+
       |
       | Cache Miss (CDN resource)
       v
+------------------+     Fetch         +------------+
| Runtime Cache    |<------------------| Network    |
| (with strategy)  |                   | Request    |
+------------------+                   +------------+

------- On Deploy -------

+------------------+     New SW        +------------------+
| Browser detects  |------------------>| Install new SW   |
| new SW script    |                   | (waiting state)  |
+------------------+                   +------------------+
                                              |
                                              v
                                       +------------------+
                                       | Show "Update     |
                                       | Available" toast |
                                       +------------------+
                                              |
                                     User clicks "Update"
                                              v
                                       +------------------+
                                       | postMessage:     |
                                       | SKIP_WAITING     |
                                       +------------------+
                                              |
                                              v
                                       +------------------+
                                       | New SW activates |
                                       | Page reloads     |
                                       +------------------+
```

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State Management | Zustand | Redux | Simpler API, built-in persistence, smaller bundle |
| Primary Storage | IndexedDB | localStorage | Larger quota, async API, structured queries |
| Crash Recovery | Dual-write | Single storage | Zero data loss guarantee |
| Service Worker | Workbox | Manual SW | Proven patterns, easier cache management |
| Static Assets | Cache-First | Network-First | Instant loads, hash-based invalidation |
| API Calls (Future) | Network-First | Cache-First | Fresh data when online, offline fallback |
| Sync Strategy | Queue-based | WebSocket | Offline support, simpler conflicts |
| Type Sharing | Interfaces | GraphQL codegen | No backend yet, simpler setup |
| Save Debounce | 500ms | Real-time | Balance responsiveness with I/O efficiency |
| Preview Debounce | 150ms | 500ms | Fast feedback within perception threshold |
| Data Integrity | SHA-256 checksums | None | Corruption detection, duplicate detection |

---

## 🚀 Future Enhancements

1. **Cloud Sync**: Optional Google Drive or Dropbox integration with OAuth. Queue operations locally, sync on reconnection with conflict detection.

2. **Collaborative Editing**: WebRTC with Yjs CRDT for real-time multi-user editing. Would require significant architecture changes from queue-based to real-time.

3. **Version History**: Store document snapshots in IndexedDB for undo/revert beyond session. Could use diff compression to minimize storage.

4. **Client-Side Encryption**: Encrypt documents before cloud sync using Web Crypto API. User-controlled keys for privacy.

5. **Cross-Tab Sync**: BroadcastChannel API for syncing state across browser tabs. Prevent conflicts when same document is open in multiple tabs.

6. **Background Sync**: Service Worker Background Sync API for guaranteed delivery even if app is closed. Queue mutations and sync when connectivity returns.

7. **Progressive Enhancement**: Graceful degradation for browsers without IndexedDB or Service Worker support. Core editing works everywhere, PWA features enhance where available.

8. **Virtual Rendering**: For very large documents (10K+ lines), virtualize the preview pane to only render visible content. Maintain smooth scrolling at scale.

---

## 📝 Summary

"MD Reader is an offline-first Progressive Web App that prioritizes data durability and responsive editing. The architecture separates concerns across three layers: Monaco Editor for input, Zustand for state management, and IndexedDB with localStorage backup for persistence. Workbox handles service worker complexity with appropriate caching strategies per resource type.

Key trade-offs favor simplicity and reliability: Zustand over Redux for less boilerplate, dual-write storage for crash recovery, queue-based sync over WebSockets for offline-first design. The debounce timing is tuned differently for preview (150ms for perceived responsiveness) versus persistence (500ms to batch I/O).

The architecture is ready for cloud sync through the IndexedDB sync queue and checksum-based conflict detection. This design would scale to hundreds of documents per user while maintaining sub-second interaction latency and zero data loss guarantees."
