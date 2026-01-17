# YouTube Top K Videos - System Design Interview Answer

## Opening Statement (1 minute)

"I'll design a real-time analytics system for tracking video views and computing trending videos across different time windows and categories. The core challenge is maintaining accurate Top K rankings when processing thousands of view events per second while supporting multiple dimensions like time windows and categories.

This involves three key technical challenges: building a high-throughput view counting system that can handle 10K+ events per second, implementing windowed aggregation for computing trends over configurable time periods, and designing real-time push updates so users see trending changes as they happen."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **View Counting**: Track video views with high throughput
- **Trending Calculation**: Compute Top K videos within configurable time windows (1 hour, 24 hours, 7 days)
- **Category Trends**: Support trending by category (music, gaming, sports, etc.)
- **Real-time Updates**: Push trending updates to connected clients

### Non-Functional Requirements
- **Scalability**: Handle 10K+ views per second
- **Availability**: 99.9% uptime
- **Latency**: < 100ms for trending queries, < 50ms for view recording
- **Consistency**: Eventual consistency acceptable (5-second refresh)

### Scale Estimates
- **Views/second**: 10,000+ at peak
- **Videos**: Millions
- **Categories**: 20-30
- **Active users**: Millions viewing trending page

### Key Questions I'd Ask
1. How fresh must trending data be? (Real-time vs. 5-minute delay)
2. Should we weight views (new viewers vs. repeat views)?
3. How do we handle view fraud/bots?

## High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend                                   │
│              React + TypeScript + Tanstack Router                   │
│                    + Zustand + SSE Client                           │
└─────────────────────────────────────────────────────────────────────┘
                                  │ HTTP / SSE
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         API Gateway / LB                             │
│                      (nginx / HAProxy)                               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
    ┌──────────┐           ┌──────────┐           ┌──────────┐
    │ API      │           │ API      │           │ API      │
    │ Server 1 │           │ Server 2 │           │ Server 3 │
    │ :3001    │           │ :3002    │           │ :3003    │
    └────┬─────┘           └────┬─────┘           └────┬─────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
      ┌──────────────┐                   ┌──────────────┐
      │    Redis     │                   │  PostgreSQL  │
      │   :6379      │                   │    :5432     │
      │              │                   │              │
      │ - View       │                   │ - Videos     │
      │   counters   │                   │ - Snapshots  │
      │ - Time       │                   │ - Events     │
      │   buckets    │                   │              │
      └──────────────┘                   └──────────────┘
```

### Core Components

1. **API Server**: REST API for views and trending, SSE for real-time updates
2. **TrendingService**: Background process computing Top K periodically
3. **Redis**: Time-bucketed sorted sets for windowed counting
4. **PostgreSQL**: Video metadata, historical snapshots

## Deep Dive: Windowed View Counting (8 minutes)

The core challenge is counting views within sliding time windows efficiently.

### Time-Bucketed Approach

```javascript
class ViewCounter {
  constructor(redis) {
    this.redis = redis;
    this.bucketSizeMs = 60000;  // 1-minute buckets
    this.windowSizeMs = 3600000; // 1-hour window
  }

  async recordView(videoId, category) {
    const bucket = Math.floor(Date.now() / this.bucketSizeMs);
    const keys = [
      `views:bucket:all:${bucket}`,
      `views:bucket:${category}:${bucket}`
    ];

    const pipeline = this.redis.pipeline();

    for (const key of keys) {
      // Increment view count for this video in this bucket
      pipeline.zincrby(key, 1, videoId);
      // Set expiry (window + buffer)
      pipeline.expire(key, Math.ceil((this.windowSizeMs + 600000) / 1000));
    }

    // Also increment total views (for display)
    pipeline.hincrby('views:total', videoId, 1);

    await pipeline.exec();
  }

  async getTopK(category, k, windowMs) {
    const now = Date.now();
    const bucketSize = this.bucketSizeMs;
    const numBuckets = Math.ceil(windowMs / bucketSize);

    // Get all bucket keys for the window
    const bucketKeys = [];
    for (let i = 0; i < numBuckets; i++) {
      const bucket = Math.floor((now - i * bucketSize) / bucketSize);
      bucketKeys.push(`views:bucket:${category}:${bucket}`);
    }

    // Aggregate buckets into temporary sorted set
    const tempKey = `temp:topk:${category}:${Date.now()}`;

    await this.redis.zunionstore(
      tempKey,
      bucketKeys.length,
      ...bucketKeys
    );
    await this.redis.expire(tempKey, 60);

    // Get top K
    const topK = await this.redis.zrevrange(
      tempKey,
      0,
      k - 1,
      'WITHSCORES'
    );

    // Parse results
    const results = [];
    for (let i = 0; i < topK.length; i += 2) {
      results.push({
        videoId: topK[i],
        viewCount: parseInt(topK[i + 1])
      });
    }

    return results;
  }
}
```

### Why Time Buckets?

| Approach | Pros | Cons |
|----------|------|------|
| Global counter | Simple | No time window support |
| Per-video timestamps | Accurate | Expensive aggregation |
| Time buckets | Efficient aggregation | Bucket boundary effects |

Time buckets let us use ZUNIONSTORE for O(n log n) aggregation of the window, where n is the number of videos with views in that window.

### Bucket Size Trade-offs

```
1-second buckets: Most accurate, 3600 keys per hour
1-minute buckets: Good balance, 60 keys per hour (chosen)
5-minute buckets: Fewer keys, coarser granularity
```

## Deep Dive: Top K Algorithms (7 minutes)

### Min-Heap Based Top K

```javascript
class TopK {
  constructor(k) {
    this.k = k;
    this.heap = new MinHeap();
    this.itemMap = new Map(); // videoId -> heap position
  }

  update(videoId, score) {
    if (this.itemMap.has(videoId)) {
      // Update existing item
      this.heap.updateScore(this.itemMap.get(videoId), score);
    } else if (this.heap.size() < this.k) {
      // Room in heap, just add
      const position = this.heap.push({ id: videoId, score });
      this.itemMap.set(videoId, position);
    } else if (score > this.heap.peek().score) {
      // New item beats minimum, replace
      const evicted = this.heap.pop();
      this.itemMap.delete(evicted.id);

      const position = this.heap.push({ id: videoId, score });
      this.itemMap.set(videoId, position);
    }
  }

  getTop() {
    return this.heap.toSortedArray();
  }
}
```

### Approximate Algorithms (At Scale)

When exact counting becomes expensive, we can use approximate algorithms:

**Count-Min Sketch** (for frequency estimation):

```javascript
class CountMinSketch {
  constructor(width, depth) {
    this.width = width;
    this.depth = depth;
    this.table = Array(depth).fill(null)
      .map(() => Array(width).fill(0));
    this.hashFunctions = this.generateHashFunctions(depth);
  }

  increment(key) {
    for (let i = 0; i < this.depth; i++) {
      const j = this.hashFunctions[i](key) % this.width;
      this.table[i][j]++;
    }
  }

  estimate(key) {
    let minCount = Infinity;
    for (let i = 0; i < this.depth; i++) {
      const j = this.hashFunctions[i](key) % this.width;
      minCount = Math.min(minCount, this.table[i][j]);
    }
    return minCount; // May overestimate, never underestimates
  }
}
```

**Space-Saving** (for heavy hitters):

```javascript
class SpaceSaving {
  constructor(capacity) {
    this.capacity = capacity;
    this.counters = new Map(); // key -> count
    this.minCount = 0;
  }

  increment(key) {
    if (this.counters.has(key)) {
      this.counters.set(key, this.counters.get(key) + 1);
    } else if (this.counters.size < this.capacity) {
      this.counters.set(key, 1);
    } else {
      // Replace minimum element
      const minKey = this.findMinKey();
      this.minCount = this.counters.get(minKey);
      this.counters.delete(minKey);
      this.counters.set(key, this.minCount + 1);
    }
  }

  getTopK(k) {
    return [...this.counters.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);
  }
}
```

### Algorithm Choice

| Algorithm | Accuracy | Memory | Use Case |
|-----------|----------|--------|----------|
| Exact (sorted set) | 100% | O(n) | < 1M videos |
| Count-Min Sketch | Approximate | O(width * depth) | Frequency estimation |
| Space-Saving | Guaranteed top | O(k) | Heavy hitters only |

For most use cases, Redis sorted sets with time buckets provide exact counts with acceptable memory usage.

## Deep Dive: Real-Time Updates with SSE (5 minutes)

### Server-Sent Events Implementation

```javascript
class TrendingService {
  constructor(viewCounter, redis) {
    this.viewCounter = viewCounter;
    this.redis = redis;
    this.clients = new Set();
    this.refreshIntervalMs = 5000; // 5 seconds
  }

  start() {
    setInterval(() => this.computeAndBroadcast(), this.refreshIntervalMs);
  }

  async computeAndBroadcast() {
    const categories = ['all', 'music', 'gaming', 'sports', 'news'];
    const trending = {};

    for (const category of categories) {
      trending[category] = await this.viewCounter.getTopK(
        category,
        10,
        3600000 // 1 hour
      );
    }

    // Broadcast to all connected clients
    for (const client of this.clients) {
      client.write(`data: ${JSON.stringify(trending)}\n\n`);
    }
  }

  handleSSEConnection(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Send initial data
    this.sendInitialData(res);

    // Register client
    this.clients.add(res);

    // Handle disconnect
    req.on('close', () => {
      this.clients.delete(res);
    });
  }
}
```

### Why SSE over WebSocket?

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Server → Client | Bidirectional |
| Reconnection | Built-in | Manual |
| Protocol | HTTP | Upgrade required |
| Complexity | Low | Higher |

For trending updates, we only need server-to-client push, making SSE ideal.

## Trade-offs and Alternatives (5 minutes)

### 1. Exact vs. Approximate Counting

**Chose: Exact (Redis sorted sets)**
- Pro: Accurate counts
- Pro: Simpler to reason about
- Con: Higher memory usage
- Trade-off: Acceptable for millions of videos

### 2. Time Bucket Granularity

**Chose: 1-minute buckets**
- Pro: Good balance of accuracy and key count
- Pro: 60 keys per hour per category
- Con: ~1 minute boundary effects
- Alternative: Sliding window (more accurate, more complex)

### 3. Push vs. Poll for Updates

**Chose: SSE push**
- Pro: Real-time updates
- Pro: Efficient (no polling overhead)
- Con: Connection management
- Alternative: Long polling (simpler, less efficient)

### 4. Single Redis vs. Cluster

**Chose: Single Redis (for learning)**
- Pro: Simple operations
- Pro: ZUNIONSTORE works natively
- Con: Scalability limit
- Alternative: Redis Cluster with smart key design

### 5. View Deduplication

**Chose: Simple increment (no dedup)**
- Pro: Lowest latency
- Con: Inflated counts from refreshes
- Trade-off: Could add session-based dedup if needed

### Rate Limiting for View Fraud

```javascript
class ViewValidator {
  async isValidView(videoId, sessionId, ip) {
    // Check rate limit per session
    const sessionKey = `rate:session:${sessionId}:${videoId}`;
    const sessionCount = await redis.incr(sessionKey);
    await redis.expire(sessionKey, 3600);

    if (sessionCount > 5) return false; // Max 5 views per video per session per hour

    // Check rate limit per IP
    const ipKey = `rate:ip:${ip}:${videoId}`;
    const ipCount = await redis.incr(ipKey);
    await redis.expire(ipKey, 60);

    if (ipCount > 10) return false; // Max 10 views per video per IP per minute

    return true;
  }
}
```

## Database Schema

```sql
-- Videos table
CREATE TABLE videos (
  id UUID PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  thumbnail_url VARCHAR(500),
  channel_name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL,
  duration_seconds INTEGER NOT NULL,
  total_views BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_videos_category ON videos(category);
CREATE INDEX idx_videos_views ON videos(total_views DESC);

-- View events (for analytics/auditing)
CREATE TABLE view_events (
  id SERIAL PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  session_id VARCHAR(100)
);

CREATE INDEX idx_view_events_time ON view_events(viewed_at);

-- Trending snapshots (for historical analysis)
CREATE TABLE trending_snapshots (
  id SERIAL PRIMARY KEY,
  window_type VARCHAR(50) NOT NULL,  -- 'hourly', 'daily', 'weekly'
  category VARCHAR(100),
  video_rankings JSONB NOT NULL,
  snapshot_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Closing Summary (1 minute)

"The YouTube Top K system is built around three core mechanisms:

1. **Time-bucketed counting with Redis sorted sets** - Views are recorded in 1-minute buckets per category, enabling efficient ZUNIONSTORE aggregation for any time window. This gives us O(n log n) Top K computation where n is the number of active videos.

2. **Background computation with SSE push** - The TrendingService computes Top K every 5 seconds and pushes updates to connected clients via Server-Sent Events, avoiding expensive polling.

3. **Layered storage** - Redis for real-time counting (speed), PostgreSQL for video metadata and historical snapshots (durability).

The main trade-off is accuracy vs. efficiency. We chose 1-minute buckets because sub-minute granularity isn't perceptible to users and saves significant memory. For future improvements, I'd implement geographic trending, anomaly detection for viral spikes, and personalized trending based on user preferences."
