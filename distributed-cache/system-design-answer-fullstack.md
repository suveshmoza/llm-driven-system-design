# Distributed Cache - System Design Answer (Fullstack Focus)

## 45-minute system design interview format - Fullstack Engineer Position

---

## 1. Requirements Clarification (3-4 minutes)

### Functional Requirements
- **Core Operations**: GET, SET, DELETE with string keys and arbitrary values
- **TTL Support**: Per-key expiration with configurable time-to-live
- **Distribution**: Partition data across multiple cache nodes
- **Admin Dashboard**: Monitor cluster health and manage cache entries
- **Replication**: Data redundancy for fault tolerance

### Non-Functional Requirements
- **Latency**: < 5ms for cache operations through coordinator
- **Availability**: Survive single node failures
- **Consistency**: Configurable via quorum settings
- **Usability**: Intuitive admin interface for operations

### Integration Points
- Frontend dashboard communicates with coordinator REST API
- Coordinator routes requests to cache nodes
- Nodes store data locally with LRU eviction

---

## 2. Shared Type Definitions (5 minutes)

### API Types

**CacheEntry**
- `key` (string) - unique identifier
- `value` (unknown) - arbitrary cached data
- `ttl?` (number) - TTL in milliseconds
- `createdAt?` (number) - Unix timestamp
- `expiresAt?` (number) - Unix timestamp
- `size?` (number) - Estimated size in bytes

**Request/Response Types**
- `SetRequest`: value, optional TTL
- `SetResponse`: key, stored flag, replicas count, quorum count
- `GetResponse`: key, value, source (hot-key-cache or node)
- `DeleteResponse`: key, deleted flag, nodesUpdated count

**Cluster Types**
- `NodeHealth`: id, address, healthy flag, lastCheck, consecutiveFailures
- `NodeStats`: entries, memoryBytes, maxEntries, maxMemoryBytes, hits, misses, hitRate, evictions, expirations
- `ClusterStatus`: totalNodes, healthyNodes, nodes array, replicationFactor, writeQuorum, readQuorum
- `KeyDistribution`: sampleSize, virtualNodesPerNode, distribution record

### Validation Schemas (Zod)

| Schema | Rules |
|--------|-------|
| `setRequestSchema` | value: unknown, ttl: positive number (optional) |
| `keyParamSchema` | key: string, min 1, max 512 chars |
| `searchQuerySchema` | pattern: string 1-256 chars, limit: 1-1000 (default 100) |

---

## 3. Backend: LRU Cache Implementation (6 minutes)

### LRU Cache Data Structure

```
┌──────────────────────────────────────────────────────────────────────┐
│                      LRU Cache with Doubly-Linked List               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Map<key, CacheNode>          Doubly-Linked List                    │
│   ┌─────────────────┐          ┌──────┐   ┌──────┐   ┌──────┐       │
│   │ "user:1" → ─────┼─────────►│ HEAD │◄─►│ node │◄─►│ TAIL │       │
│   │ "user:2" → ─────┼──────┐   │ MRU  │   │      │   │ LRU  │       │
│   │ "user:3" → ─────┼────┐ │   └──────┘   └──────┘   └──────┘       │
│   └─────────────────┘    │ │       ▲                     │          │
│                          │ └───────┴─────────────────────┘          │
│                          └──────────────────────┘                   │
│                                                                      │
│   GET: O(1) lookup + move to head                                   │
│   SET: O(1) insert at head + evict from tail if needed              │
│   DELETE: O(1) remove from map and list                             │
└──────────────────────────────────────────────────────────────────────┘
```

### CacheNode Structure
- `key` (string) - cache key
- `value` (T) - stored value
- `size` (number) - estimated bytes via JSON serialization
- `expiresAt` (number | null) - null means no expiration
- `prev` / `next` (CacheNode | null) - linked list pointers

### LRU Cache Operations

```
┌─────────────────────────────────────────────────────────────────────┐
│                              GET(key)                                │
├─────────────────────────────────────────────────────────────────────┤
│   1. Lookup in Map              → O(1)                              │
│   2. If not found               → return null                       │
│   3. Check expiration (lazy)    → if expired, delete & return null  │
│   4. Move node to head          → mark as recently used             │
│   5. Return value                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       SET(key, value, ttl?)                          │
├─────────────────────────────────────────────────────────────────────┤
│   1. Estimate size via JSON.stringify                               │
│   2. Calculate expiresAt = now + ttl (or null)                      │
│   3. If key exists             → remove old node, subtract memory   │
│   4. Add to current memory                                          │
│   5. Evict LRU entries while over limits                            │
│   6. Create new node at head                                        │
│   7. Add to Map                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                              EVICT                                   │
├─────────────────────────────────────────────────────────────────────┤
│   While (size >= maxEntries OR memory >= maxMemoryBytes):           │
│     1. Get tail node (least recently used)                          │
│     2. Subtract its size from currentMemory                         │
│     3. Update tail pointer to prev                                  │
│     4. Remove from Map                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Backend: Consistent Hash Ring (5 minutes)

### Hash Ring with Virtual Nodes

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Consistent Hash Ring (0 to 2^32)                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                           0                                          │
│                           ●                                          │
│                      ╱         ╲                                     │
│                 N1:42          N2:8                                  │
│                ●                    ●                                │
│              ╱                        ╲                              │
│          N3:127                      N1:22                           │
│          ●                              ●                            │
│          │                              │                            │
│          │      hash("user:123")        │                            │
│          │            ↓                 │                            │
│          │         0x4A2B               │                            │
│          │            ↓                 │                            │
│          │     binary search            │                            │
│          │            ↓                 │                            │
│          │       → node1                │                            │
│          ●                              ●                            │
│          N2:89                      N3:51                            │
│              ╲                        ╱                              │
│               N1:98                N2:67                             │
│                  ●                ●                                  │
│                      ╲        ╱                                      │
│                        N3:78                                         │
│                           ●                                          │
│                                                                      │
│   150 virtual nodes per physical node → even key distribution        │
└──────────────────────────────────────────────────────────────────────┘
```

### Hash Ring Operations

| Operation | Complexity | Description |
|-----------|------------|-------------|
| `hash(key)` | O(1) | MD5 first 8 hex chars → 32-bit int |
| `addNode(id, addr)` | O(V log N) | Add V virtual nodes, sort ring |
| `removeNode(id)` | O(N) | Filter out virtual nodes |
| `getNode(key)` | O(log N) | Binary search for first node >= hash |
| `getNodes(key, count)` | O(log N + count) | Walk ring for distinct physical nodes |

---

## 5. Backend: Coordinator with Quorum (6 minutes)

### Coordinator Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| `REPLICATION_FACTOR` | 2 | Number of nodes to store each key |
| `WRITE_QUORUM` | 2 | Minimum writes for success |
| `READ_QUORUM` | 1 | Minimum reads for success |
| `REQUEST_TIMEOUT` | 5000ms | Per-node timeout |
| `HEALTH_CHECK_INTERVAL` | 5000ms | How often to ping nodes |
| `MAX_FAILURES` | 3 | Failures before marking unhealthy |

### Node Health Tracking

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Health Check Loop (every 5s)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   For each node in nodeHealth Map:                                  │
│     │                                                               │
│     ├── GET /health (timeout: 2s)                                   │
│     │       │                                                       │
│     │       ├── Success → healthy=true, failures=0                  │
│     │       │                                                       │
│     │       └── Failure → failures++                                │
│     │                     │                                         │
│     │                     └── If failures >= 3:                     │
│     │                           healthy=false                       │
│     │                           ring.removeNode(id)                 │
│     │                                                               │
│     └── Update lastCheck timestamp                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Coordinator API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/cache/:key` | Read from R quorum nodes |
| `PUT` | `/cache/:key` | Write to W quorum nodes |
| `DELETE` | `/cache/:key` | Delete from all replica nodes |
| `GET` | `/cluster/status` | Return cluster health info |

### Request Routing Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PUT /cache/:key Request                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   1. Validate key (1-512 chars) and body (value, optional ttl)     │
│   2. getNodes(key, RF=2) → [node1, node2]                          │
│   3. If nodes.length < WRITE_QUORUM → 503 error                    │
│   4. Parallel PUT to all nodes (Promise.all)                       │
│   5. Count successes                                                │
│   6. If successes >= WRITE_QUORUM → 201 {stored: true}             │
│   7. Else → 503 {error: "quorum not achieved"}                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    GET /cache/:key Request                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   1. Validate key parameter                                         │
│   2. getNodes(key, RF=2) → [node1, node2]                          │
│   3. If no nodes → 503 error                                       │
│   4. Try first READ_QUORUM nodes sequentially                      │
│   5. On success → 200 {key, value}                                 │
│   6. On 404 → 404 {error: "Key not found"}                         │
│   7. On all failures → 503 {error: "All nodes failed"}             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Frontend: Zustand Stores (5 minutes)

### Cluster Store State

| Field | Type | Description |
|-------|------|-------------|
| `status` | ClusterStatus | null | Current cluster info |
| `nodeStats` | Map<string, NodeStats> | Per-node statistics |
| `distribution` | KeyDistribution | null | Key distribution info |
| `loading` | boolean | Fetch in progress |
| `error` | string | null | Last error message |
| `lastUpdated` | number | null | Timestamp of last fetch |

### Cluster Store Actions

```
┌─────────────────────────────────────────────────────────────────────┐
│                         fetchStatus()                                │
├─────────────────────────────────────────────────────────────────────┤
│   1. Set loading=true, error=null                                   │
│   2. GET /cluster/status                                            │
│   3. For each healthy node (parallel):                              │
│        └── fetchNodeStats(nodeId)                                   │
│   4. Update state: status, nodeStats, lastUpdated                   │
│   5. On error: set error message                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Aggregated Stats (Computed)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      useAggregatedStats()                            │
├─────────────────────────────────────────────────────────────────────┤
│   totalEntries = sum(node.entries for all nodes)                    │
│   totalMemory  = sum(node.memoryBytes for all nodes)                │
│   avgHitRate   = avg(node.hitRate for all nodes)                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Frontend: Cache Operations Store (4 minutes)

### Cache Store State

| Field | Type | Description |
|-------|------|-------------|
| `entries` | CacheEntry[] | Recently accessed entries |
| `searchQuery` | string | Current search filter |
| `loading` | boolean | Operation in progress |
| `operationPending` | boolean | Optimistic update pending |
| `error` | string | null | Last error message |

### Cache Store Actions with Optimistic Updates

```
┌─────────────────────────────────────────────────────────────────────┐
│                    setKey(key, value, ttl?)                          │
├─────────────────────────────────────────────────────────────────────┤
│   1. Save prevEntries (for rollback)                                │
│   2. Optimistic update:                                             │
│        entries = [{key, value, ttl}, ...filtered(prevEntries)]      │
│   3. PUT /cache/:key {value, ttl}                                   │
│   4. On success → return true                                       │
│   5. On error → rollback entries, set error, return false           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         deleteKey(key)                               │
├─────────────────────────────────────────────────────────────────────┤
│   1. Save prevEntries                                               │
│   2. Optimistic update:                                             │
│        entries = prevEntries.filter(e => e.key !== key)             │
│   3. DELETE /cache/:key                                             │
│   4. On success → return true                                       │
│   5. On error → rollback entries, set error, return false           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Frontend: Dashboard Component (5 minutes)

### Dashboard Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Cache Dashboard                            Last updated: 10:15:32   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────┐│
│  │ Cluster Health │ │ Total Entries  │ │ Memory Usage   │ │Hit Rate││
│  │                │ │                │ │                │ │        ││
│  │    2/3 nodes   │ │    1,234       │ │   45.2 MB      │ │  95.1% ││
│  │    healthy     │ │   cached keys  │ │  across cluster│ │  cache ││
│  │   ⚠ warning    │ │                │ │                │ │ effic. ││
│  └────────────────┘ └────────────────┘ └────────────────┘ └────────┘│
│                                                                      │
│  ┌────────────────────────────┐ ┌────────────────────────────────┐  │
│  │       Node Status          │ │       Key Distribution          │  │
│  │ ┌────────────────────────┐ │ │                                 │  │
│  │ │ node1 ● HEALTHY        │ │ │      ┌─────────────────────┐    │  │
│  │ │ 450 entries | 15.2 MB  │ │ │      │     Hash Ring       │    │  │
│  │ └────────────────────────┘ │ │      │                     │    │  │
│  │ ┌────────────────────────┐ │ │      │  node1: 33%         │    │  │
│  │ │ node2 ● HEALTHY        │ │ │      │  node2: 34%         │    │  │
│  │ │ 420 entries | 14.8 MB  │ │ │      │  node3: 33%         │    │  │
│  │ └────────────────────────┘ │ │      │                     │    │  │
│  │ ┌────────────────────────┐ │ │      └─────────────────────┘    │  │
│  │ │ node3 ○ UNHEALTHY      │ │ │                                 │  │
│  │ │ 3 failures             │ │ │                                 │  │
│  │ └────────────────────────┘ │ │                                 │  │
│  └────────────────────────────┘ └────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Dashboard Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Dashboard useEffect                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   On mount:                                                         │
│     ├── fetchStatus()                                               │
│     ├── fetchDistribution()                                         │
│     └── Start interval (every 5s) → fetchStatus()                   │
│                                                                     │
│   On unmount:                                                       │
│     └── Clear interval                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### StatsCard Status Colors

| Status | Condition | Color |
|--------|-----------|-------|
| `good` | All nodes healthy, hitRate >= 90% | Green |
| `warning` | Some nodes healthy, hitRate 70-90% | Yellow |
| `bad` | No healthy nodes, hitRate < 70% | Red |

---

## 9. End-to-End Data Flow (4 minutes)

### Cache SET Operation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SET user:123 = {...}                               │
└──────────────────────────────────────────────────────────────────────────────┘

Frontend                    Coordinator                   Cache Nodes
   │                            │                             │
   │ PUT /cache/user:123        │                             │
   │ {value: {...}, ttl: 300}   │                             │
   ├───────────────────────────►│                             │
   │                            │                             │
   │                            │ hash("user:123") = 0x4A2B   │
   │                            │ getNodes(key, RF=2)         │
   │                            │ → [node1, node2]            │
   │                            │                             │
   │                            │ PUT /cache/user:123 (parallel)
   │                            ├─────────────────────────────►│ Node 1
   │                            ├─────────────────────────────►│ Node 2
   │                            │                             │
   │                            │     {stored: true} ◄────────┤
   │                            │     {stored: true} ◄────────┤
   │                            │                             │
   │                            │ successes >= WRITE_QUORUM?  │
   │                            │ 2 >= 2 ✓                    │
   │                            │                             │
   │   201 Created              │                             │
   │   {stored: true,           │                             │
   │    replicas: 2,            │                             │
   │    quorum: 2}              │                             │
   │◄───────────────────────────┤                             │
   │                            │                             │
   │ Optimistic update verified │                             │
   │ (already showed success)   │                             │
   │                            │                             │
```

### Cache GET Operation

```
Frontend                    Coordinator                   Cache Nodes
   │                            │                             │
   │ GET /cache/user:123        │                             │
   ├───────────────────────────►│                             │
   │                            │                             │
   │                            │ hash("user:123") = 0x4A2B   │
   │                            │ getNodes(key, RF=2)         │
   │                            │ → [node1, node2]            │
   │                            │                             │
   │                            │ READ_QUORUM = 1             │
   │                            │ GET from node1 first        │
   │                            ├─────────────────────────────►│ Node 1
   │                            │                             │
   │                            │  Check TTL expiration       │
   │                            │  If not expired:            │
   │                            │  - Move to head (LRU)       │
   │                            │  - Return value             │
   │                            │                             │
   │                            │    {key, value} ◄───────────┤
   │                            │                             │
   │   200 OK                   │                             │
   │   {key: "user:123",        │                             │
   │    value: {...}}           │                             │
   │◄───────────────────────────┤                             │
   │                            │                             │
```

### Node Failure Handling

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Node 2 becomes unhealthy                            │
└──────────────────────────────────────────────────────────────────────────────┘

                          Health Check Loop (every 5s)
                                   │
                   ┌───────────────┴───────────────┐
                   │                               │
                   ▼                               ▼
              GET /health                    GET /health
              Node 1 ✓                       Node 2 ✗ (timeout)
                                                  │
                                    consecutiveFailures++
                                    (now: 1)
                                                  │
                   ┌──────────────────────────────┘
                   │        5 seconds later
                   ▼
              GET /health                    GET /health
              Node 1 ✓                       Node 2 ✗ (timeout)
                                                  │
                                    consecutiveFailures++
                                    (now: 2)
                                                  │
                   ┌──────────────────────────────┘
                   │        5 seconds later
                   ▼
              GET /health                    GET /health
              Node 1 ✓                       Node 2 ✗ (timeout)
                                                  │
                                    consecutiveFailures >= 3
                                    → ring.removeNode("node2")
                                    → health.healthy = false
                                                  │
┌─────────────────────────────────────────────────┴─────────────────────────────┐
│                                                                               │
│   Subsequent requests:                                                        │
│   - getNodes("user:123", 2) → [node1, node3]  (node2 excluded)               │
│   - Keys that were on node2 now route to next node on ring                   │
│   - Write quorum may fail if only 1 healthy node remains                     │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Testing Strategy (3 minutes)

### Backend Integration Tests

| Test Case | Expected Behavior |
|-----------|-------------------|
| PUT with write quorum | Returns 201, stored=true, replicas >= 2 |
| PUT with quorum failure | Returns 503, error contains "quorum" |
| GET existing key | Returns 200 with value |
| GET missing key | Returns 404 |
| DELETE existing key | Returns deleted=true, nodesUpdated count |

### Frontend Component Tests

| Component | Test Cases |
|-----------|------------|
| `StatsCard` | Renders title, value, subtitle; applies status colors |
| `NodeStatusList` | Shows healthy/unhealthy indicators |
| `HashRingViz` | Displays distribution percentages |

---

## 11. Error Handling Across the Stack

### Backend Error Types

| Error Type | Status Code | Handling |
|------------|-------------|----------|
| `ApiError` | Custom | Return statusCode and message |
| `ZodError` | 400 | Return "Validation failed" with details |
| Unhandled | 500 | Return "Internal server error" |

### Frontend Error Boundary

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ErrorBoundary Component                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   On error in child tree:                                           │
│     1. getDerivedStateFromError → {hasError: true, error}           │
│     2. componentDidCatch → log error to console                     │
│     3. Render fallback UI:                                          │
│        ┌──────────────────────────────────────┐                     │
│        │    Something went wrong              │                     │
│        │    [error message]                   │                     │
│        │    [ Reload ]                        │                     │
│        └──────────────────────────────────────┘                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 12. Key Fullstack Trade-offs

| Layer | Decision | Trade-off |
|-------|----------|-----------|
| **Shared** | Zod for validation | Runtime overhead, but type-safe API contracts |
| **Backend** | HTTP REST vs Redis protocol | Easier debugging, higher latency |
| **Backend** | Coordinator vs smart client | Extra hop, but simpler clients |
| **Frontend** | Polling vs WebSocket | Simpler, but higher latency for updates |
| **Frontend** | Optimistic updates | Better UX, risk of showing incorrect state |
| **Both** | Quorum configuration | Tuneable consistency vs availability |

### Consistency Modes

| Mode | RF | W | R | Use Case |
|------|-----|-----|-----|----------|
| Strong | 3 | 2 | 2 | Banking, auth tokens (W+R > N) |
| Eventual | 3 | 1 | 1 | Sessions, recommendations |
| Read-heavy | 3 | 3 | 1 | Product catalog |

---

## Summary

This fullstack distributed cache design demonstrates:

1. **Shared Types**: TypeScript interfaces and Zod schemas used by both layers
2. **Backend Core**: LRU cache with O(1) operations, consistent hashing, quorum replication
3. **API Design**: RESTful coordinator with proper error handling and validation
4. **Frontend State**: Zustand stores with optimistic updates and polling
5. **Visualization**: Hash ring display and cluster monitoring dashboard
6. **Error Handling**: Consistent error patterns across the stack
7. **Testing**: Integration tests for coordinator, component tests for UI

The coordinator pattern adds latency but provides a clean separation between clients and cache topology, enabling features like health monitoring, hot key detection, and quorum management in a single place.
