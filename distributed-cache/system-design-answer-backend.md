# Distributed Cache - System Design Answer (Backend Focus)

## 45-minute system design interview format - Backend Engineer Position

---

## 1. Requirements Clarification (3-4 minutes)

### Functional Requirements
- **GET/SET/DELETE**: Core cache operations with string keys and arbitrary values
- **TTL Support**: Per-key expiration with configurable time-to-live
- **Eviction**: LRU eviction when memory limits are exceeded
- **Distribution**: Partition data across multiple nodes for scale
- **Replication**: Data redundancy for fault tolerance

### Non-Functional Requirements
- **Latency**: Sub-millisecond for local cache, < 5ms for distributed reads
- **Throughput**: 100K+ operations per second per node
- **Availability**: 99.9% uptime, survive single node failures
- **Consistency**: Eventual consistency with configurable guarantees
- **Memory Efficiency**: Maximize useful cache storage, minimize overhead

### Scale Estimation
- **Cache Size**: 10K entries per node, 100MB memory limit
- **Cluster Size**: 3-10 nodes typical deployment
- **Key Distribution**: Even spread via consistent hashing
- **Replication Factor**: 2-3 replicas per key

---

## 2. High-Level Architecture (5 minutes)

```
                                    ┌─────────────────┐
                                    │   Coordinator   │
                                    │   (Router)      │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
                    ▼                        ▼                        ▼
            ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
            │  Cache Node 1 │        │  Cache Node 2 │        │  Cache Node 3 │
            │   Port 3001   │        │   Port 3002   │        │   Port 3003   │
            └───────────────┘        └───────────────┘        └───────────────┘
                    │                        │                        │
                    └────────────────────────┼────────────────────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  Consistent     │
                                    │  Hash Ring      │
                                    └─────────────────┘
```

### Component Responsibilities
- **Coordinator**: Routes requests to appropriate nodes, health monitoring
- **Cache Nodes**: Store data, handle TTL, perform eviction
- **Hash Ring**: Determines key-to-node mapping with virtual nodes

---

## 3. Consistent Hashing Implementation (8 minutes)

### Hash Ring with Virtual Nodes

The consistent hash ring uses MD5 hashing with 150 virtual nodes per physical node.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONSISTENT HASH RING                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Data Structures:                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ ring: VirtualNode[]  ─── sorted array for binary search            │   │
│   │   ├─ hash: number    (MD5 first 32 bits)                           │   │
│   │   ├─ nodeId: string  (physical node identifier)                    │   │
│   │   └─ virtualIndex: number                                          │   │
│   │                                                                     │   │
│   │ nodes: Map<nodeId, address>  ─── physical node lookup              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Hash Function:                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ key ──► MD5(key) ──► first 8 hex chars ──► parseInt(hex, 16)       │   │
│   │                                                                     │   │
│   │ Example: "user:123" → "a3f2b1c4..." → 0xa3f2b1c4 → 2750492100      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Operations:                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ addNode(id, address):                                               │   │
│   │   for i = 0 to 149:                                                 │   │
│   │     virtualKey = "{id}:{i}"                                         │   │
│   │     ring.push({ hash: hash(virtualKey), nodeId: id, virtualIndex }) │   │
│   │   ring.sort(by hash)                                                │   │
│   │                                                                     │   │
│   │ getNode(key):                                                       │   │
│   │   keyHash = hash(key)                                               │   │
│   │   index = binarySearch(ring, keyHash)  ─── O(log n)                │   │
│   │   return nodes.get(ring[index % length].nodeId)                     │   │
│   │                                                                     │   │
│   │ getNodes(key, count):  ─── for replication                          │   │
│   │   Walk clockwise from keyHash                                       │   │
│   │   Collect distinct physical nodes until count reached               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why 150 Virtual Nodes?

| Virtual Nodes | Standard Deviation | Memory Overhead |
|--------------|-------------------|-----------------|
| 50           | ~8%               | Low             |
| 100          | ~5%               | Medium          |
| 150          | ~3%               | Medium          |
| 500          | ~1%               | High            |

150 provides good balance: < 5% variance in key distribution with reasonable memory.

---

## 4. LRU Cache with TTL (8 minutes)

### Doubly-Linked List for O(1) Operations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LRU CACHE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Data Structures:                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ cache: Map<key, CacheEntry>                                         │   │
│   │                                                                     │   │
│   │ CacheEntry {                                                        │   │
│   │   key: string                                                       │   │
│   │   value: T                                                          │   │
│   │   size: number       ─── estimated memory (JSON.stringify length)   │   │
│   │   createdAt: number                                                 │   │
│   │   expiresAt: number | null                                          │   │
│   │   prev: CacheEntry | null  ─┐                                       │   │
│   │   next: CacheEntry | null  ─┼── doubly-linked list pointers         │   │
│   │ }                           │                                       │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Linked List Layout:                                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   HEAD (MRU)                                       TAIL (LRU)       │   │
│   │      │                                                │             │   │
│   │      ▼                                                ▼             │   │
│   │   ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐         │   │
│   │   │ key1 │◄──►│ key2 │◄──►│ key3 │◄──►│ key4 │◄──►│ key5 │         │   │
│   │   └──────┘    └──────┘    └──────┘    └──────┘    └──────┘         │   │
│   │     newest                                          oldest          │   │
│   │                                                      ↑              │   │
│   │                                            evict this first         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Operations (all O(1)):                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ get(key):                                                           │   │
│   │   entry = cache.get(key)                                            │   │
│   │   if expired: delete and return null  ─── lazy expiration           │   │
│   │   moveToHead(entry)                                                 │   │
│   │   return entry.value                                                │   │
│   │                                                                     │   │
│   │ set(key, value, ttl):                                               │   │
│   │   if exists: remove from list, subtract memory                      │   │
│   │   create entry with expiresAt = now + ttl                           │   │
│   │   evictIfNeeded()  ─── by count or memory                           │   │
│   │   cache.set(key, entry)                                             │   │
│   │   moveToHead(entry)                                                 │   │
│   │                                                                     │   │
│   │ evictIfNeeded():                                                    │   │
│   │   while (size >= maxEntries OR memory >= maxBytes):                 │   │
│   │     removeTail()  ─── evict LRU entry                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Active Expiration (background):                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Every 1 second:                                                     │   │
│   │   Sample 20 random keys                                             │   │
│   │   Delete any that are expired                                       │   │
│   │                                                                     │   │
│   │ Prevents memory bloat from expired but unaccessed keys              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Expiration Strategy Comparison

| Strategy | Pros | Cons |
|----------|------|------|
| Lazy only | Zero CPU overhead | Memory bloat with many expired keys |
| Active only | Predictable cleanup | CPU overhead even when idle |
| Lazy + Active | Best of both | Slightly more complex |

We use lazy + active: check on access (lazy) plus sample 20 random keys every second (active).

---

## 5. Cache Node HTTP Server (6 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CACHE NODE API                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Configuration:                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ maxEntries: 10,000                                                  │   │
│   │ maxMemoryBytes: 100MB                                               │   │
│   │ defaultTTLMs: 300,000 (5 minutes)                                   │   │
│   │ activeExpirationInterval: 1,000ms                                   │   │
│   │ activeExpirationSampleSize: 20                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Endpoints:                                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ GET /cache/:key                                                     │   │
│   │   → 200: { key, value }                                             │   │
│   │   → 404: { error: "Key not found" }                                 │   │
│   │                                                                     │   │
│   │ PUT /cache/:key                                                     │   │
│   │   Body: { value, ttl? }                                             │   │
│   │   → 201: { key, stored: true }                                      │   │
│   │   → 400: { error: "Value is required" }                             │   │
│   │                                                                     │   │
│   │ DELETE /cache/:key                                                  │   │
│   │   → 200: { key, deleted: boolean }                                  │   │
│   │                                                                     │   │
│   │ GET /health                                                         │   │
│   │   → 200: { status: "healthy", timestamp }                           │   │
│   │                                                                     │   │
│   │ GET /stats                                                          │   │
│   │   → 200: { entries, memoryBytes, hits, misses, hitRate,             │   │
│   │           evictions, expirations }                                  │   │
│   │                                                                     │   │
│   │ GET /metrics  ─── Prometheus format                                 │   │
│   │   cache_entries, cache_memory_bytes, cache_hits_total,              │   │
│   │   cache_misses_total, cache_hit_rate, cache_evictions_total,        │   │
│   │   cache_expirations_total                                           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Coordinator Service (6 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COORDINATOR SERVICE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Configuration:                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ HEALTH_CHECK_INTERVAL: 5,000ms                                      │   │
│   │ MAX_CONSECUTIVE_FAILURES: 3                                         │   │
│   │ REPLICATION_FACTOR: 2                                               │   │
│   │ WRITE_QUORUM: 2                                                     │   │
│   │ READ_QUORUM: 1                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Health Tracking:                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ nodeHealth: Map<nodeId, {                                           │   │
│   │   address: string                                                   │   │
│   │   healthy: boolean                                                  │   │
│   │   lastCheck: timestamp                                              │   │
│   │   consecutiveFailures: number                                       │   │
│   │ }>                                                                  │   │
│   │                                                                     │   │
│   │ Health Check Loop (every 5s):                                       │   │
│   │   for each node:                                                    │   │
│   │     GET /health with 2s timeout                                     │   │
│   │     if success: reset failures, mark healthy                        │   │
│   │     if failure: increment failures                                  │   │
│   │       if failures >= 3: mark unhealthy, remove from ring            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Request Flow:                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   GET /cache/:key (Read Quorum = 1)                                 │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │ nodes = ring.getNodes(key, REPLICATION_FACTOR)              │   │   │
│   │   │ for node in nodes[0:READ_QUORUM]:                           │   │   │
│   │   │   try: return node.get(key)                                 │   │   │
│   │   │   catch 404: return not found                               │   │   │
│   │   │   catch error: try next node                                │   │   │
│   │   │ return 503 "All nodes failed"                               │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                                                                     │   │
│   │   PUT /cache/:key (Write Quorum = 2)                                │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │ nodes = ring.getNodes(key, REPLICATION_FACTOR)              │   │   │
│   │   │ if nodes.length < WRITE_QUORUM: return 503                  │   │   │
│   │   │                                                             │   │   │
│   │   │ results = parallel PUT to all replica nodes                 │   │   │
│   │   │ successes = count successful writes                         │   │   │
│   │   │                                                             │   │   │
│   │   │ if successes >= WRITE_QUORUM:                               │   │   │
│   │   │   return 201 { stored: true, replicas: successes }          │   │   │
│   │   │ else:                                                       │   │   │
│   │   │   return 503 "Write quorum not achieved"                    │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                                                                     │   │
│   │   DELETE /cache/:key                                                │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │ nodes = ring.getNodes(key, REPLICATION_FACTOR)              │   │   │
│   │   │ parallel DELETE to all nodes                                │   │   │
│   │   │ return { deleted: anySucceeded, nodesUpdated: successCount }│   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Cluster Endpoints:                                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ GET /cluster/status                                                 │   │
│   │   → { totalNodes, healthyNodes, nodes[], replicationFactor,         │   │
│   │       writeQuorum, readQuorum }                                     │   │
│   │                                                                     │   │
│   │ GET /cluster/distribution                                           │   │
│   │   Sample 10,000 keys, show distribution across nodes                │   │
│   │   → { sampleSize, distribution: { node1: { count, percentage } } }  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Replication and Consistency (5 minutes)

### Quorum Configuration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        QUORUM CONFIGURATIONS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Variables:                                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ N = Replication Factor (total replicas)                             │   │
│   │ W = Write Quorum (writes that must succeed)                         │   │
│   │ R = Read Quorum (reads that must succeed)                           │   │
│   │                                                                     │   │
│   │ Strong consistency when: W + R > N                                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Configurations:                                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Strong Consistency:   N=3, W=2, R=2  (2+2=4 > 3) ✓                  │   │
│   │ Eventual Consistency: N=3, W=1, R=1  (favor availability)           │   │
│   │ Read-Heavy Workload:  N=3, W=3, R=1  (all must ack write)           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Read Repair

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            READ REPAIR                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Flow:                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Read from all replicas in parallel                               │   │
│   │ 2. Collect { node, value, version } from each                       │   │
│   │ 3. Find newest version                                              │   │
│   │ 4. Identify stale replicas (different version)                      │   │
│   │ 5. Asynchronously update stale replicas with newest value           │   │
│   │ 6. Return newest value to client                                    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Example:                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │   Client reads key "user:123"                                       │   │
│   │                                                                     │   │
│   │   Node A: value="Alice", version=5  ← newest                        │   │
│   │   Node B: value="Alice", version=5                                  │   │
│   │   Node C: value="Ally", version=3   ← stale                         │   │
│   │                                                                     │   │
│   │   Response: { value: "Alice", repaired: true }                      │   │
│   │   Background: Update Node C with version=5                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Hot Key Detection and Mitigation (4 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HOT KEY DETECTION                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   HotKeyDetector:                                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ accessCounts: Map<key, count>                                       │   │
│   │ windowMs: 60,000 (1 minute window)                                  │   │
│   │ threshold: 1,000 (accesses to be considered "hot")                  │   │
│   │                                                                     │   │
│   │ recordAccess(key):                                                  │   │
│   │   if window expired: clear counts, reset window                     │   │
│   │   increment count for key                                           │   │
│   │   return count >= threshold                                         │   │
│   │                                                                     │   │
│   │ getHotKeys():                                                       │   │
│   │   return keys with count >= threshold, sorted by count desc         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Coordinator Integration:                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ localHotKeyCache: Map<key, { value, expiresAt }>                    │   │
│   │ HOT_KEY_LOCAL_TTL: 1,000ms (1 second)                               │   │
│   │                                                                     │   │
│   │ GET /cache/:key:                                                    │   │
│   │   1. Check localHotKeyCache first                                   │   │
│   │      if found and not expired: return from local cache              │   │
│   │                                                                     │   │
│   │   2. Record access, check if hot                                    │   │
│   │                                                                     │   │
│   │   3. Route to cache node normally                                   │   │
│   │                                                                     │   │
│   │   4. If key is hot: store in localHotKeyCache                       │   │
│   │      (short TTL prevents staleness)                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Hot Key Mitigation Strategies

| Strategy | Pros | Cons |
|----------|------|------|
| Local caching | Simple, effective | Stale data briefly |
| Read replicas | Distributes load | More infrastructure |
| Key sharding | Eliminates bottleneck | Complex key management |
| Rate limiting | Protects system | Impacts users |

---

## 9. Cache Invalidation Patterns (3 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CACHE INVALIDATION PATTERNS                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Pattern 1: Write-Through (Synchronous)                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Client ──► Update Database ──► Update Cache ──► Response            │   │
│   │                                                                     │   │
│   │ Pros: Strong consistency                                            │   │
│   │ Cons: Higher latency                                                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Pattern 2: Write-Behind (Asynchronous)                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Client ──► Update Cache ──► Response                                │   │
│   │                    │                                                │   │
│   │                    └──► Queue ──► Background Worker ──► Database    │   │
│   │                                                                     │   │
│   │ Pros: Low latency                                                   │   │
│   │ Cons: Data loss risk if crash before flush                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Pattern 3: Cache-Aside with TTL                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Read:                                                               │   │
│   │   Check cache ──► Hit? Return                                       │   │
│   │                   Miss? Fetch DB ──► Populate cache (with TTL)      │   │
│   │                                                                     │   │
│   │ Write:                                                              │   │
│   │   Update DB ──► Invalidate cache                                    │   │
│   │                                                                     │   │
│   │ Pros: Simple, self-healing via TTL                                  │   │
│   │ Cons: Cache miss penalty                                            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Pattern 4: Pub/Sub Invalidation (Multi-Node)                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │   Writer ──► Publish to "cache-invalidation" channel                │   │
│   │                         │                                           │   │
│   │         ┌───────────────┼───────────────┐                           │   │
│   │         ▼               ▼               ▼                           │   │
│   │   ┌──────────┐    ┌──────────┐    ┌──────────┐                      │   │
│   │   │ Cache 1  │    │ Cache 2  │    │ Cache 3  │                      │   │
│   │   │ delete() │    │ delete() │    │ delete() │                      │   │
│   │   └──────────┘    └──────────┘    └──────────┘                      │   │
│   │                                                                     │   │
│   │ Message: { key, action: "delete", timestamp }                       │   │
│   │                                                                     │   │
│   │ Pros: Immediate invalidation across cluster                         │   │
│   │ Cons: Redis/message broker dependency                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Key Backend Trade-offs

### Decision Matrix

| Decision | Choice | Trade-off |
|----------|--------|-----------|
| Hash function | MD5 | Fast, good distribution, not cryptographic (fine for hashing) |
| Virtual nodes | 150 | ~3% variance, moderate memory overhead |
| Expiration | Lazy + Active | CPU for sampling, but prevents memory bloat |
| Protocol | HTTP | Higher overhead than binary, but easier to debug |
| Consistency | Quorum-based | Configurable W/R for CAP trade-offs |
| Replication | Synchronous writes | Higher latency, but strong durability |

### When to Use Each Consistency Level

```
Strong Consistency (W + R > N):
- Financial data
- User authentication tokens
- Configuration that must be consistent

Eventual Consistency (W=1, R=1):
- Session data
- View counts
- Recommendations
- Any data that tolerates brief staleness
```

---

## 11. Production Considerations

### Circuit Breaker for Node Failures

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CIRCUIT BREAKER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   States:                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ CLOSED ──(error threshold 50%)──► OPEN                              │   │
│   │    ▲                                 │                              │   │
│   │    │                                 │ (30s timeout)                │   │
│   │    │                                 ▼                              │   │
│   │    └───────(success)───────── HALF-OPEN                             │   │
│   │                                      │                              │   │
│   │                              (failure)                              │   │
│   │                                      └──► OPEN                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Configuration:                                                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ timeout: 5,000ms                                                    │   │
│   │ errorThresholdPercentage: 50                                        │   │
│   │ resetTimeout: 30,000ms                                              │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Behavior:                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ CLOSED: Requests pass through normally                              │   │
│   │ OPEN: Requests fail fast (no attempt to call node)                  │   │
│   │ HALF-OPEN: Allow one test request to check recovery                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Graceful Shutdown

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GRACEFUL SHUTDOWN                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   On SIGTERM:                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Stop accepting new requests (server.close())                     │   │
│   │ 2. If persistence enabled: persist cache snapshot to disk           │   │
│   │ 3. Close health check timers (cache.shutdown())                     │   │
│   │ 4. Exit process                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

This distributed cache implementation demonstrates key backend concepts:

1. **Consistent Hashing**: O(log n) lookup with virtual nodes for even distribution
2. **LRU Cache**: O(1) operations with doubly-linked list
3. **TTL Expiration**: Lazy + active hybrid for efficiency
4. **Replication**: Quorum-based for configurable consistency
5. **Hot Key Handling**: Detection and local caching at coordinator
6. **Invalidation**: Multiple patterns for different use cases
7. **Observability**: Prometheus metrics, health checks, circuit breakers

The coordinator pattern adds a network hop but simplifies client implementation and enables cluster-wide features like hot key detection and health monitoring.
