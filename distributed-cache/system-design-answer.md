# Distributed Cache - System Design Interview Answer

## Introduction

"Today I'll design a distributed caching system similar to Redis or Memcached. The core challenge is building a high-performance key-value store that can scale horizontally while maintaining low latency and high availability. This involves interesting problems around consistent hashing, replication, and cache coherence."

---

## Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm what we're building:

1. **Key-Value Operations**: GET, SET, DELETE with optional TTL
2. **Data Types**: Strings, lists, sets, hashes (like Redis)
3. **Atomic Operations**: Increment, compare-and-swap
4. **Expiration**: TTL-based automatic expiration
5. **Pub/Sub**: Optional publish-subscribe messaging

Should I also consider persistence (like Redis RDB/AOF) or focus on pure in-memory caching?"

### Non-Functional Requirements

"For a distributed cache:

- **Latency**: Sub-millisecond for GET (<1ms p99)
- **Throughput**: 1 million operations per second per node
- **Availability**: 99.99% uptime
- **Scalability**: Linear scaling with added nodes
- **Consistency**: Tunable (eventual to strong)"

---

## Step 2: Scale Estimation

"Let me work through the numbers:

**Cluster Size:**
- 10 cache nodes
- Each node: 64 GB RAM, 100K ops/second
- Total capacity: 640 GB, 1M ops/second

**Data Characteristics:**
- Average key size: 50 bytes
- Average value size: 500 bytes
- Total items: ~1 billion (with overhead)

**Network:**
- 1M ops/second * 550 bytes = ~550 MB/second
- Need 10 Gbps network per node

**Memory Overhead:**
- Key-value data: ~550 GB
- Metadata (hash tables, expiration): ~20% overhead
- Total: ~660 GB across cluster"

---

## Step 3: High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client Applications                           │
│                   (with Smart Client Library)                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────────────────┐
          ▼                      ▼                                  ▼
┌─────────────────┐    ┌─────────────────┐            ┌─────────────────┐
│   Cache Node 1  │    │   Cache Node 2  │    ...     │   Cache Node N  │
│   (Primary)     │◄──►│   (Primary)     │◄──────────►│   (Primary)     │
│                 │    │                 │            │                 │
│  Partition: 0-3 │    │  Partition: 4-7 │            │ Partition: 12-15│
└─────────────────┘    └─────────────────┘            └─────────────────┘
         │                      │                              │
         ▼                      ▼                              ▼
┌─────────────────┐    ┌─────────────────┐            ┌─────────────────┐
│   Replica 1a    │    │   Replica 2a    │            │   Replica Na    │
└─────────────────┘    └─────────────────┘            └─────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Configuration Service (ZooKeeper/etcd)            │
│                    - Cluster membership                              │
│                    - Partition map                                   │
│                    - Leader election                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step 4: Data Partitioning with Consistent Hashing

"This is the core of any distributed cache. Let me explain consistent hashing in detail.

### Why Consistent Hashing?

**Naive Approach (Modulo):**
```
node = hash(key) % num_nodes
```

Problem: If we add a node (10 → 11), almost all keys remap!
- Key 'foo' was on node 7, now on node 3
- Massive cache invalidation, thundering herd to database

**Consistent Hashing Solution:**
- Nodes and keys both hashed onto a ring (0 to 2^32-1)
- Key assigned to first node clockwise from its position
- Adding/removing node only affects neighbors

### Implementation

```python
import hashlib
from bisect import bisect_right

class ConsistentHashRing:
    def __init__(self, virtual_nodes=150):
        self.ring = {}  # hash -> node
        self.sorted_hashes = []
        self.virtual_nodes = virtual_nodes  # For even distribution

    def add_node(self, node_id):
        for i in range(self.virtual_nodes):
            virtual_key = f'{node_id}:vn{i}'
            hash_val = self._hash(virtual_key)
            self.ring[hash_val] = node_id
            self.sorted_hashes.append(hash_val)
        self.sorted_hashes.sort()

    def remove_node(self, node_id):
        for i in range(self.virtual_nodes):
            virtual_key = f'{node_id}:vn{i}'
            hash_val = self._hash(virtual_key)
            del self.ring[hash_val]
            self.sorted_hashes.remove(hash_val)

    def get_node(self, key):
        if not self.ring:
            return None

        hash_val = self._hash(key)
        idx = bisect_right(self.sorted_hashes, hash_val)

        # Wrap around to beginning if past end
        if idx == len(self.sorted_hashes):
            idx = 0

        return self.ring[self.sorted_hashes[idx]]

    def _hash(self, key):
        return int(hashlib.md5(key.encode()).hexdigest(), 16) % (2**32)
```

### Virtual Nodes

"Why 150 virtual nodes per physical node?

Without virtual nodes:
- 10 nodes on ring might cluster together
- Uneven distribution: some nodes get 20% data, others 5%

With virtual nodes:
- Each physical node has 150 positions on ring
- Statistical evening out of distribution
- When node fails, load spreads across many nodes

**Trade-off**: More memory for routing table, but much better balance."

---

## Step 5: Cache Node Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cache Node                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  Network Layer  │    │  Protocol Parser │                    │
│  │  (Event Loop)   │───►│  (RESP/Custom)   │                    │
│  └─────────────────┘    └────────┬─────────┘                    │
│                                  │                               │
│                                  ▼                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Command Processor                      │    │
│  │   GET, SET, DELETE, INCR, EXPIRE, LPUSH, SADD, etc.     │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                    │                    │              │
│         ▼                    ▼                    ▼              │
│  ┌─────────────┐    ┌─────────────────┐    ┌───────────────┐   │
│  │   Hash      │    │   Expiration    │    │  Replication  │   │
│  │   Table     │    │   Manager       │    │   Handler     │   │
│  │ (In-Memory) │    │ (TTL Tracking)  │    │               │   │
│  └─────────────┘    └─────────────────┘    └───────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Single-Threaded Event Loop (Like Redis)

"Why single-threaded?

1. **No Locking**: All operations are atomic without mutexes
2. **Simpler Code**: No race conditions, easier to reason about
3. **CPU-Bound Limit**: At 100K ops/sec, single core is bottleneck
4. **I/O Multiplexing**: epoll/kqueue handles thousands of connections

**Modern Approach (Redis 6+)**: Thread-per-core with sharded keyspace

```python
class EventLoop:
    def __init__(self):
        self.epoll = select.epoll()
        self.connections = {}
        self.data_store = {}

    def run(self):
        while True:
            events = self.epoll.poll(timeout=1)
            for fd, event in events:
                if event & select.EPOLLIN:
                    self.handle_read(fd)
                elif event & select.EPOLLOUT:
                    self.handle_write(fd)

    def handle_read(self, fd):
        conn = self.connections[fd]
        data = conn.socket.recv(4096)
        command = parse_command(data)
        result = self.execute(command)
        conn.write_buffer.append(result)
```"

---

## Step 6: Expiration and Eviction

### TTL-Based Expiration

"Two approaches for handling expired keys:

**Lazy Expiration (Primary):**
- Check TTL on every access
- If expired, delete and return nil
- Pro: No background CPU usage
- Con: Memory not reclaimed until accessed

```python
def get(self, key):
    item = self.data[key]
    if item.expires_at and item.expires_at < time.time():
        del self.data[key]
        return None
    return item.value
```

**Active Expiration (Secondary):**
- Background thread samples random keys
- Deletes if expired
- Runs 10 times per second, samples 20 keys
- Keeps memory usage bounded

```python
def expire_cycle(self):
    while True:
        sample = random.sample(self.data.keys(), min(20, len(self.data)))
        expired = 0

        for key in sample:
            if self.is_expired(key):
                del self.data[key]
                expired += 1

        # If >25% expired, run again immediately
        if expired / len(sample) > 0.25:
            continue

        time.sleep(0.1)
```"

### Eviction Policies

"When memory is full, we need to evict. Common policies:

| Policy | Description | Use Case |
|--------|-------------|----------|
| LRU | Least Recently Used | General purpose |
| LFU | Least Frequently Used | Hot/cold access patterns |
| Random | Random eviction | Simple, low overhead |
| TTL | Evict soonest-expiring | When TTLs are meaningful |
| No Eviction | Return error | When data loss unacceptable |

**Approximate LRU (Redis-style):**
- True LRU requires doubly-linked list (overhead)
- Sample 5 random keys, evict oldest
- Nearly as good, much less memory

```python
class ApproximateLRU:
    def evict(self):
        candidates = random.sample(self.data.keys(), 5)
        oldest = min(candidates, key=lambda k: self.data[k].last_access)
        del self.data[oldest]
```"

---

## Step 7: Replication

### Leader-Follower Replication

```
                    ┌─────────────┐
       Writes ─────►│   Leader    │
                    │   Node 1    │
                    └──────┬──────┘
                           │ Replication Stream
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌───────────┐ ┌───────────┐ ┌───────────┐
       │ Follower  │ │ Follower  │ │ Follower  │
       │  Node 2   │ │  Node 3   │ │  Node 4   │
       └───────────┘ └───────────┘ └───────────┘
              │
              ▼
         Reads (optional)
```

### Synchronous vs Asynchronous Replication

**Asynchronous (Default):**
```python
def set(self, key, value):
    # Write to local store
    self.data[key] = value

    # Queue replication (don't wait)
    self.replication_queue.put((key, value))

    return "OK"
```
- Pro: Lower latency (1ms vs 3ms)
- Con: Data loss on leader failure (few ms of writes)

**Synchronous:**
```python
async def set(self, key, value):
    self.data[key] = value

    # Wait for at least one replica
    await self.replicate_to_followers(key, value, wait_for=1)

    return "OK"
```
- Pro: No data loss if one replica survives
- Con: Higher latency, reduced availability

**Configurable Quorum:**
- WAIT command: `SET key value` then `WAIT 2 1000`
- Wait for 2 replicas to acknowledge within 1000ms"

### Replication Protocol

```
Replication Stream Format:
┌────────────────────────────────────────────────────┐
│ REPLICATE                                          │
│ offset: 12345                                      │
│ commands:                                          │
│   [SET, user:123, {"name": "Alice"}]              │
│   [EXPIRE, user:123, 3600]                        │
│   [INCR, counter:views]                           │
└────────────────────────────────────────────────────┘

Follower tracks:
- Last applied offset
- On reconnect, resume from last offset
- If gap too large, full resync
```

---

## Step 8: Handling Hot Keys

"A 'hot key' is one key receiving disproportionate traffic (e.g., viral tweet).

### Problem

```
1M RPS to cluster
Single key 'viral:post:123' gets 100K RPS
That key is on Node 3
Node 3 is overwhelmed, others are idle
```

### Solutions

**1. Read Replicas:**
```
                    ┌─────────────┐
       Writes ─────►│   Leader    │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
  ┌───────────┐     ┌───────────┐     ┌───────────┐
  │  Replica  │     │  Replica  │     │  Replica  │
  │     1     │     │     2     │     │     3     │
  └─────┬─────┘     └─────┬─────┘     └─────┬─────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                     Reads spread
```

**2. Local Client Caching:**
```python
class SmartCacheClient:
    def __init__(self):
        self.local_cache = TTLCache(maxsize=1000, ttl=1)
        self.hot_key_threshold = 100  # requests per second

    def get(self, key):
        # Check local cache first
        if key in self.local_cache:
            return self.local_cache[key]

        # Track access frequency
        self.access_counter[key] += 1

        if self.access_counter[key] > self.hot_key_threshold:
            # Hot key detected, cache locally
            value = self.remote_get(key)
            self.local_cache[key] = value
            return value

        return self.remote_get(key)
```

**3. Key Replication Across Nodes:**
```python
def handle_hot_key(self, key):
    # Replicate to additional nodes
    additional_nodes = self.ring.get_n_nodes(key, n=3)

    for node in additional_nodes:
        node.replicate_key(key, self.data[key])

    # Update routing to spread load
    self.hot_key_routes[key] = additional_nodes
```"

---

## Step 9: Cache Invalidation

"The hardest problem in computer science. Let me cover patterns:

### Pattern 1: TTL-Based

```python
# Set with expiration
cache.set('user:123', user_data, ex=3600)  # 1 hour TTL

# Pro: Simple, eventual consistency
# Con: Stale data until expiration
```

### Pattern 2: Write-Through

```python
def update_user(user_id, data):
    # Update database
    db.update('users', user_id, data)

    # Update cache
    cache.set(f'user:{user_id}', data)

# Pro: Cache always consistent
# Con: Write latency, cache may hold data never read
```

### Pattern 3: Write-Behind (Write-Back)

```python
def update_user(user_id, data):
    # Update cache immediately
    cache.set(f'user:{user_id}', data)

    # Queue database write
    write_queue.put(('users', user_id, data))

# Pro: Fast writes
# Con: Data loss if cache fails before DB write
```

### Pattern 4: Cache-Aside

```python
def get_user(user_id):
    # Try cache
    user = cache.get(f'user:{user_id}')
    if user:
        return user

    # Cache miss, load from DB
    user = db.query('SELECT * FROM users WHERE id = ?', user_id)

    # Populate cache
    cache.set(f'user:{user_id}', user, ex=3600)

    return user

def update_user(user_id, data):
    # Update DB
    db.update('users', user_id, data)

    # Invalidate cache (delete, don't update)
    cache.delete(f'user:{user_id}')

# Pro: Simple, works well
# Con: Cache stampede on invalidation
```

### Handling Cache Stampede

"When a popular key expires, many requests hit database simultaneously.

```python
class AntiStampede:
    def get(self, key, loader_fn, ttl):
        value = cache.get(key)

        if value is not None:
            return value

        # Try to acquire lock
        lock_key = f'lock:{key}'
        if cache.setnx(lock_key, '1', ex=10):
            # We got the lock, load value
            value = loader_fn()
            cache.set(key, value, ex=ttl)
            cache.delete(lock_key)
            return value
        else:
            # Another request is loading, wait and retry
            time.sleep(0.1)
            return self.get(key, loader_fn, ttl)
```"

---

## Step 10: Client Library Design

"The client is as important as the server.

### Smart Client Features

```python
class DistributedCacheClient:
    def __init__(self, config_service):
        # Get cluster topology
        self.nodes = config_service.get_nodes()
        self.ring = ConsistentHashRing()
        for node in self.nodes:
            self.ring.add_node(node)

        # Connection pooling
        self.pools = {node: ConnectionPool(node) for node in self.nodes}

        # Subscribe to topology changes
        config_service.watch_changes(self.on_topology_change)

    def get(self, key):
        node = self.ring.get_node(key)
        conn = self.pools[node].acquire()
        try:
            return conn.execute('GET', key)
        finally:
            self.pools[node].release(conn)

    def on_topology_change(self, new_topology):
        # Update ring, refresh connections
        self.ring = ConsistentHashRing()
        for node in new_topology:
            self.ring.add_node(node)
```

### Connection Pooling

```python
class ConnectionPool:
    def __init__(self, node, size=10):
        self.node = node
        self.pool = queue.Queue(maxsize=size)
        for _ in range(size):
            self.pool.put(self.create_connection())

    def acquire(self, timeout=5):
        try:
            return self.pool.get(timeout=timeout)
        except queue.Empty:
            raise ConnectionPoolExhausted()

    def release(self, conn):
        if conn.is_healthy():
            self.pool.put(conn)
        else:
            self.pool.put(self.create_connection())
```

### Pipelining

```python
# Without pipelining: 10 round trips
for i in range(10):
    cache.get(f'key:{i}')  # 1ms each = 10ms total

# With pipelining: 1 round trip
pipeline = cache.pipeline()
for i in range(10):
    pipeline.get(f'key:{i}')
results = pipeline.execute()  # 1ms total
```"

---

## Step 11: Cluster Coordination

### Configuration Service (etcd/ZooKeeper)

```
Configuration Data:
{
  "cluster_id": "cache-prod-1",
  "nodes": [
    {"id": "node-1", "host": "10.0.1.1", "port": 6379, "role": "primary"},
    {"id": "node-2", "host": "10.0.1.2", "port": 6379, "role": "replica", "primary": "node-1"},
    {"id": "node-3", "host": "10.0.1.3", "port": 6379, "role": "primary"}
  ],
  "partitions": {
    "0-5460": "node-1",
    "5461-10922": "node-3",
    "10923-16383": "node-5"
  },
  "version": 42
}
```

### Leader Election

```python
class LeaderElection:
    def __init__(self, etcd, node_id):
        self.etcd = etcd
        self.node_id = node_id
        self.lease = None

    async def run_for_leader(self, partition_id):
        # Create lease (TTL-based lock)
        self.lease = await self.etcd.lease(ttl=10)

        # Try to become leader
        key = f'/cache/leaders/{partition_id}'
        success = await self.etcd.put_if_absent(
            key, self.node_id, lease=self.lease
        )

        if success:
            # We're the leader, keep lease alive
            asyncio.create_task(self.keep_alive())
            return True

        return False

    async def keep_alive(self):
        while True:
            await self.lease.refresh()
            await asyncio.sleep(3)
```

---

## Step 12: Trade-offs and Alternatives

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| Partitioning | Consistent Hashing | Range-based | Better balance on add/remove |
| Threading | Single-threaded + IO multiplex | Multi-threaded | Simpler, no locking |
| Replication | Async (default) | Sync | Performance vs durability trade-off |
| Eviction | Approximate LRU | True LRU | Memory efficient |
| Coordination | etcd/ZooKeeper | Gossip | Consistency for cluster state |

### Redis vs Memcached Comparison

| Feature | Redis | Memcached |
|---------|-------|-----------|
| Data Types | Strings, Lists, Sets, Hashes | Strings only |
| Persistence | RDB, AOF | None |
| Replication | Built-in | None |
| Clustering | Redis Cluster | Client-side |
| Memory Efficiency | Moderate | Higher |
| Throughput | ~100K/sec | ~200K/sec |

---

## Step 13: Monitoring and Operations

### Key Metrics

```yaml
Cache Metrics:
  - hit_rate: Percentage of successful cache hits
  - memory_usage: Current memory consumption
  - eviction_rate: Keys evicted per second
  - connection_count: Active client connections
  - replication_lag: Seconds behind primary
  - command_latency_p99: 99th percentile latency

Alerts:
  - hit_rate < 80%: Investigate cache effectiveness
  - memory_usage > 90%: Add capacity or tune eviction
  - replication_lag > 10s: Check network or replica health
  - command_latency_p99 > 5ms: Check for slow commands
```

### Operational Commands

```bash
# Monitor real-time stats
cache-cli MONITOR

# Get memory breakdown
cache-cli MEMORY STATS

# Find big keys
cache-cli --bigkeys

# Slow query log
cache-cli SLOWLOG GET 10

# Force failover
cache-cli CLUSTER FAILOVER
```

---

## Summary

"To summarize my distributed cache design:

1. **Partitioning**: Consistent hashing with virtual nodes for even distribution
2. **Node Architecture**: Single-threaded event loop for simplicity and atomicity
3. **Expiration**: Lazy + active expiration, approximate LRU eviction
4. **Replication**: Async leader-follower with configurable durability
5. **Hot Keys**: Client-side caching, read replicas, key replication
6. **Cluster Coordination**: etcd for topology management, leader election

The key insights are:
- Consistent hashing is foundational - it determines how well the system scales
- Single-threaded design trades peak throughput for simplicity and correctness
- Cache invalidation is genuinely hard - pick the right pattern for your use case
- Client library design matters as much as server design

What aspects would you like me to elaborate on?"
