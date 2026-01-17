# Facebook Live Comments - System Design Interview Answer

## Introduction

"Today I'll design a real-time commenting system for live video streams, similar to Facebook Live or YouTube Live. The core challenge is handling massive write throughput during popular streams while delivering comments to millions of viewers with minimal latency. This involves interesting problems around fan-out, ordering, and spam prevention."

---

## Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm what we're building:

1. **Real-Time Comments**: Users post comments that appear instantly for all viewers
2. **Comment Display**: Show comments overlaid on video or in sidebar
3. **Reactions**: Quick emoji reactions (hearts, likes, etc.)
4. **Threading**: Reply to specific comments (optional)
5. **Moderation**: Filter spam, profanity, block users
6. **Comment Highlighting**: Surface interesting comments (pinned, creator responses)

Should I also design the video streaming infrastructure, or focus on comments?"

### Non-Functional Requirements

"For a live comments system:

- **Scale**: Top streams have 500K+ concurrent viewers
- **Write Throughput**: Popular streams: 10,000+ comments per second
- **Read Throughput**: 500K viewers * 1 poll/sec = 500K reads/sec per stream
- **Latency**: Comments visible within 2-3 seconds of posting
- **Ordering**: Comments should appear in roughly chronological order"

---

## Step 2: Scale Estimation

"Let me work through the numbers for a popular live stream:

**Single Popular Stream:**
- 500,000 concurrent viewers
- 10,000 comments per second peak
- Each comment: ~200 bytes

**Platform-Wide:**
- 10,000 concurrent live streams
- Average 1,000 viewers per stream
- Total: 10 million concurrent users
- Average comments: 100/second per stream = 1M comments/second platform-wide

**Storage:**
- 1M comments/sec * 200 bytes = 200 MB/sec
- 1 hour stream = 720 GB (temporary, archived to cold storage)

**Fan-out Challenge:**
- 1 comment → 500,000 deliveries
- 10,000 comments/sec * 500,000 = 5 billion deliveries/second
- This is the hard problem"

---

## Step 3: High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Live Stream Viewers                          │
│                    (500K concurrent per stream)                      │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Load Balancer / CDN                           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Comment Write  │    │  Comment Read   │    │  WebSocket      │
│  Service        │    │  Service        │    │  Gateway        │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Stream Partitioned Kafka                          │
│                  (Topic per stream or stream range)                  │
└────────────────────────────────┬────────────────────────────────────┘
         │                       │                      │
         ▼                       ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Persistence    │    │  Fan-out        │    │  Moderation     │
│  Service        │    │  Service        │    │  Service        │
└────────┬────────┘    └─────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Cassandra (Comments) + Redis (Recent Cache)             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step 4: Comment Posting Flow

### Write Path

```
1. User posts comment
2. Write Service validates (auth, rate limit, profanity check)
3. Write to Kafka (stream_id as partition key)
4. Return acknowledgment to user
5. Async: Persist to Cassandra
6. Async: Push to fan-out service
```

### Implementation

```python
class CommentWriteService:
    async def post_comment(self, stream_id, user_id, content):
        # 1. Validate
        if not await self.rate_limiter.allow(user_id, stream_id):
            raise RateLimitExceeded()

        if self.profanity_filter.contains_banned(content):
            raise ContentViolation()

        # 2. Create comment
        comment = Comment(
            id=generate_snowflake_id(),  # Time-ordered ID
            stream_id=stream_id,
            user_id=user_id,
            content=content,
            timestamp=time.time_ns()
        )

        # 3. Publish to Kafka (async, fire-and-forget for low latency)
        await self.kafka.send(
            topic=f'comments-{stream_id % 1000}',  # Partitioned topics
            key=stream_id,
            value=comment.serialize()
        )

        # 4. Return immediately
        return comment

    async def persist_comment(self, comment):
        # Runs async, doesn't block user
        await self.cassandra.insert(comment)
        await self.redis.lpush(f'recent:{comment.stream_id}', comment.serialize())
        await self.redis.ltrim(f'recent:{comment.stream_id}', 0, 999)
```

### Snowflake ID Generation

"Snowflake IDs provide time-ordered, unique identifiers:

```
64-bit ID:
┌─────────────────────────────────────────────────────────────────┐
│ 41 bits timestamp │ 10 bits machine │ 12 bits sequence          │
└─────────────────────────────────────────────────────────────────┘

- 41 bits: Milliseconds since epoch (69 years)
- 10 bits: Machine ID (1024 machines)
- 12 bits: Sequence (4096 IDs per millisecond per machine)
```

Benefits:
- Roughly time-ordered (can sort by ID)
- No coordination needed between machines
- 4 million IDs per second per machine"

---

## Step 5: Comment Reading and Fan-out

### The Fan-out Problem

"500K viewers need to see every comment. Two approaches:

**Push (Fan-out on write):**
- When comment posted, push to all 500K connections
- Problem: 10K comments * 500K viewers = 5 billion messages/sec

**Pull (Fan-out on read):**
- Viewers poll for new comments every second
- Problem: 500K polls/sec per stream

**Hybrid (Our Approach):**
- Maintain recent comments buffer per stream
- Viewers connect via WebSocket, receive batched updates
- Server pushes batches every 100-200ms"

### Comment Fan-out Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Fan-out Strategy                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐                                                │
│  │   Kafka Topic   │                                                │
│  │ (stream comments)│                                               │
│  └────────┬────────┘                                                │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                │
│  │  Fan-out Worker │  (One per stream or stream-range)              │
│  │                 │                                                │
│  │  - Consumes from Kafka                                           │
│  │  - Batches comments (100ms windows)                              │
│  │  - Publishes to Redis Pub/Sub                                    │
│  └────────┬────────┘                                                │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                │
│  │  Redis Pub/Sub  │  Channel: stream:{stream_id}:comments          │
│  └────────┬────────┘                                                │
│           │                                                          │
│     ┌─────┴─────┬─────────┬─────────┐                               │
│     ▼           ▼         ▼         ▼                                │
│  ┌──────┐   ┌──────┐  ┌──────┐  ┌──────┐                            │
│  │ WS   │   │ WS   │  │ WS   │  │ WS   │   WebSocket Gateways       │
│  │ GW 1 │   │ GW 2 │  │ GW 3 │  │ GW N │   (10K connections each)   │
│  └──────┘   └──────┘  └──────┘  └──────┘                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### WebSocket Gateway

```python
class WebSocketGateway:
    def __init__(self):
        self.connections = defaultdict(set)  # stream_id -> set of websockets
        self.redis = Redis()

    async def handle_connection(self, websocket, stream_id):
        # Add to connection pool
        self.connections[stream_id].add(websocket)

        # Subscribe to stream's comment channel
        if stream_id not in self.subscriptions:
            await self.subscribe_to_stream(stream_id)

        try:
            # Keep connection alive
            async for message in websocket:
                # Handle client messages (e.g., post comment)
                await self.handle_client_message(websocket, message)
        finally:
            self.connections[stream_id].remove(websocket)

    async def subscribe_to_stream(self, stream_id):
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(f'stream:{stream_id}:comments')

        async for message in pubsub.listen():
            if message['type'] == 'message':
                await self.broadcast_to_viewers(stream_id, message['data'])

    async def broadcast_to_viewers(self, stream_id, comments_batch):
        websockets = self.connections[stream_id]
        await asyncio.gather(*[
            ws.send(comments_batch)
            for ws in websockets
        ])
```

### Batching for Efficiency

```python
class CommentBatcher:
    def __init__(self, stream_id, batch_interval=0.1):
        self.stream_id = stream_id
        self.batch_interval = batch_interval
        self.buffer = []

    async def add_comment(self, comment):
        self.buffer.append(comment)

    async def run_batch_loop(self):
        while True:
            await asyncio.sleep(self.batch_interval)

            if self.buffer:
                batch = self.buffer
                self.buffer = []

                # Publish batch to Redis
                await self.redis.publish(
                    f'stream:{self.stream_id}:comments',
                    json.dumps([c.to_dict() for c in batch])
                )
```

---

## Step 6: Comment Storage

### Cassandra Schema

```cql
-- Comments by stream (for replay, scrollback)
CREATE TABLE comments_by_stream (
    stream_id UUID,
    comment_id BIGINT,  -- Snowflake ID (time-ordered)
    user_id UUID,
    content TEXT,
    created_at TIMESTAMP,
    is_highlighted BOOLEAN,
    PRIMARY KEY (stream_id, comment_id)
) WITH CLUSTERING ORDER BY (comment_id DESC);

-- Comments by user (for moderation, user history)
CREATE TABLE comments_by_user (
    user_id UUID,
    stream_id UUID,
    comment_id BIGINT,
    content TEXT,
    created_at TIMESTAMP,
    PRIMARY KEY (user_id, created_at, comment_id)
) WITH CLUSTERING ORDER BY (created_at DESC);
```

### Redis Cache (Recent Comments)

```redis
# List of recent comments per stream (last 1000)
LPUSH recent:stream:{stream_id} {comment_json}
LTRIM recent:stream:{stream_id} 0 999

# Sorted set for time-range queries
ZADD comments:stream:{stream_id} {timestamp} {comment_json}
ZREMRANGEBYRANK comments:stream:{stream_id} 0 -1001  # Keep only 1000

# Stream metadata
HSET stream:{stream_id} viewer_count 500000 comment_count 1234567
```

---

## Step 7: Comment Ordering and Consistency

### Ordering Challenges

"With 10K comments/second from multiple data centers, strict ordering is expensive.

**Options:**

1. **Global Ordering (Expensive)**
   - Single sequencer assigns sequence numbers
   - Bottleneck, adds latency

2. **Per-Stream Ordering (Better)**
   - Partition Kafka by stream_id
   - Single partition per stream = ordered within stream

3. **Approximate Ordering (Our Choice)**
   - Use Snowflake IDs (roughly ordered by time)
   - Accept small reordering (few ms)
   - Sort client-side if needed"

### Implementation

```python
class CommentOrderer:
    def __init__(self):
        self.comment_buffer = []
        self.last_displayed_id = 0

    def add_comments(self, comments):
        self.comment_buffer.extend(comments)
        # Sort by ID (time-ordered)
        self.comment_buffer.sort(key=lambda c: c.id)

    def get_display_comments(self, count=20):
        # Get next batch of ordered comments
        displayable = [
            c for c in self.comment_buffer
            if c.id > self.last_displayed_id
        ][:count]

        if displayable:
            self.last_displayed_id = displayable[-1].id

        return displayable
```

---

## Step 8: Spam Prevention and Moderation

### Multi-Layer Defense

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Moderation Pipeline                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Layer 1: Pre-Send Validation (Synchronous, <10ms)                  │
│  ├── Rate limiting (5 comments per 30 seconds per user)             │
│  ├── Banned word filter (regex)                                     │
│  ├── Duplicate detection (exact match in last 100)                  │
│  └── Account age check (no comments if account < 1 day)            │
│                                                                      │
│  Layer 2: ML Classification (Async, <100ms)                         │
│  ├── Spam classifier                                                │
│  ├── Toxicity scorer                                                │
│  └── Scam/phishing detector                                         │
│                                                                      │
│  Layer 3: Community Moderation                                       │
│  ├── User reports                                                   │
│  ├── Moderator actions                                              │
│  └── Auto-hide if N reports in M minutes                            │
│                                                                      │
│  Layer 4: Post-Hoc Analysis                                         │
│  ├── Batch ML re-evaluation                                         │
│  ├── Cross-stream pattern detection                                 │
│  └── Account-level spam detection                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Rate Limiting

```python
class CommentRateLimiter:
    def __init__(self, redis):
        self.redis = redis

    async def allow(self, user_id, stream_id):
        # Global rate limit (across all streams)
        global_key = f'ratelimit:global:{user_id}'
        global_count = await self.redis.incr(global_key)
        if global_count == 1:
            await self.redis.expire(global_key, 60)
        if global_count > 30:  # 30 per minute globally
            return False

        # Per-stream rate limit
        stream_key = f'ratelimit:stream:{stream_id}:{user_id}'
        stream_count = await self.redis.incr(stream_key)
        if stream_count == 1:
            await self.redis.expire(stream_key, 30)
        if stream_count > 5:  # 5 per 30 seconds per stream
            return False

        return True
```

### Adaptive Rate Limiting

```python
class AdaptiveRateLimiter:
    def get_limit(self, user_id, stream_id):
        user_reputation = self.get_reputation(user_id)

        if user_reputation > 0.9:
            return 10  # Trusted users get higher limit
        elif user_reputation > 0.5:
            return 5   # Normal limit
        else:
            return 2   # Suspicious users get lower limit
```

---

## Step 9: Reactions (Emoji Bursts)

"Reactions are even higher volume than comments - thousands per second.

### Aggregation Strategy

```python
class ReactionAggregator:
    def __init__(self, stream_id):
        self.stream_id = stream_id
        self.reaction_counts = defaultdict(int)
        self.last_broadcast = time.time()
        self.broadcast_interval = 0.5  # 500ms

    async def add_reaction(self, reaction_type):
        self.reaction_counts[reaction_type] += 1

    async def broadcast_loop(self):
        while True:
            await asyncio.sleep(self.broadcast_interval)

            if self.reaction_counts:
                # Broadcast aggregated counts, not individual reactions
                await self.broadcast({
                    'type': 'reactions',
                    'counts': dict(self.reaction_counts),
                    'timestamp': time.time()
                })
                self.reaction_counts.clear()
```

### Client-Side Rendering

```javascript
class ReactionRenderer {
    constructor(container) {
        this.container = container;
        this.animationPool = [];
    }

    handleReactionBurst(counts) {
        // Animate reactions floating up
        for (const [emoji, count] of Object.entries(counts)) {
            // Don't animate all - sample for performance
            const displayCount = Math.min(count, 20);
            for (let i = 0; i < displayCount; i++) {
                this.animateReaction(emoji);
            }
        }
    }

    animateReaction(emoji) {
        const element = this.getFromPool() || this.createElement();
        element.textContent = emoji;
        element.className = 'reaction-float';

        // Random horizontal position
        element.style.left = Math.random() * 100 + '%';

        this.container.appendChild(element);

        // Remove after animation
        setTimeout(() => {
            element.remove();
            this.animationPool.push(element);
        }, 2000);
    }
}
```

---

## Step 10: Handling Viral Streams

"When a stream suddenly goes viral (celebrity, breaking news):

### Auto-Scaling Detection

```python
class StreamScaler:
    def __init__(self):
        self.stream_metrics = {}

    async def monitor(self, stream_id):
        current = await self.get_metrics(stream_id)

        if stream_id in self.stream_metrics:
            previous = self.stream_metrics[stream_id]

            # Detect rapid growth
            viewer_growth = current.viewers / max(previous.viewers, 1)
            comment_growth = current.comments_per_sec / max(previous.comments_per_sec, 1)

            if viewer_growth > 2 or comment_growth > 3:
                await self.scale_up(stream_id)

        self.stream_metrics[stream_id] = current

    async def scale_up(self, stream_id):
        # 1. Increase Kafka partitions for this stream
        # 2. Spin up dedicated fan-out workers
        # 3. Add WebSocket gateway capacity
        # 4. Switch to aggressive comment batching (200ms → 500ms)
        pass
```

### Graceful Degradation

```python
class DegradationPolicy:
    def get_policy(self, viewer_count):
        if viewer_count < 10000:
            return {
                'batch_interval': 100,  # ms
                'max_comments_per_batch': 50,
                'show_all_comments': True
            }
        elif viewer_count < 100000:
            return {
                'batch_interval': 200,
                'max_comments_per_batch': 30,
                'show_all_comments': True
            }
        else:
            return {
                'batch_interval': 500,
                'max_comments_per_batch': 20,
                'show_all_comments': False,  # Sample/curate
                'sampling_rate': 0.1  # Show 10% of comments
            }
```

### Comment Sampling for Massive Streams

```python
class CommentSampler:
    def sample(self, comments, sampling_rate, preferences):
        if sampling_rate >= 1.0:
            return comments

        # Priority scoring
        scored = []
        for comment in comments:
            score = 0
            # Boost verified users
            if comment.user.is_verified:
                score += 10
            # Boost creator responses
            if comment.user.is_creator:
                score += 100
            # Boost comments with reactions
            score += comment.reaction_count * 2
            # Boost questions
            if '?' in comment.content:
                score += 5
            scored.append((score, comment))

        # Sort by score, take top N
        scored.sort(reverse=True)
        count = int(len(comments) * sampling_rate)
        return [c for _, c in scored[:count]]
```

---

## Step 11: Architecture for Global Scale

### Multi-Region Deployment

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Global Architecture                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  US-West Region                    US-East Region                    │
│  ┌─────────────────┐              ┌─────────────────┐               │
│  │  Write Service  │              │  Write Service  │               │
│  │  Fan-out Workers│              │  Fan-out Workers│               │
│  │  WS Gateways    │              │  WS Gateways    │               │
│  │  Redis Cluster  │              │  Redis Cluster  │               │
│  └────────┬────────┘              └────────┬────────┘               │
│           │                                │                         │
│           └────────────┬───────────────────┘                        │
│                        ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  Kafka (Cross-Region)                        │   │
│  │            Replicates comments between regions               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               Cassandra (Multi-Region)                       │   │
│  │           Async replication for persistence                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Latency Considerations

"For a stream originating in US-West with global viewers:

- US-West viewers: ~50ms latency
- US-East viewers: ~100ms (cross-region Kafka replication)
- EU viewers: ~200ms (cross-Atlantic)
- Asia viewers: ~300ms (cross-Pacific)

**Optimization**: Edge caching for read-heavy workloads, accept higher latency for comments from distant regions."

---

## Step 12: Trade-offs and Alternatives

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| Transport | WebSocket | SSE, Long-poll | Bidirectional, lower overhead |
| Queue | Kafka | RabbitMQ | Throughput, replayability |
| Storage | Cassandra | PostgreSQL | Write throughput, scale |
| Fan-out | Redis Pub/Sub | Kafka Consumer Groups | Lower latency for real-time |
| Ordering | Approximate (Snowflake) | Global sequencer | Latency vs strict order |

---

## Step 13: Monitoring

"Key metrics to track:

**Latency:**
- Comment post to display: p50, p95, p99
- Fan-out latency
- WebSocket message delivery

**Throughput:**
- Comments per second (per stream, global)
- Reactions per second
- Active WebSocket connections

**Health:**
- Kafka consumer lag
- Redis pub/sub subscriber count
- WebSocket connection errors

**Moderation:**
- Spam detection rate
- False positive rate
- Moderation queue depth"

---

## Summary

"To summarize my Facebook Live Comments design:

1. **Write Path**: Kafka for durability and ordering, async persistence to Cassandra
2. **Fan-out**: Redis Pub/Sub to WebSocket gateways, batched updates every 100-500ms
3. **Ordering**: Snowflake IDs for approximate time ordering without global coordination
4. **Moderation**: Multi-layer defense with pre-send validation and async ML
5. **Scale**: Comment sampling and degradation policies for viral streams

The key insights are:
- Fan-out is the hardest problem - solved by batching and pub/sub
- Approximate ordering is acceptable for real-time experience
- Different scale requires different policies (sampling for mega-streams)
- Reactions need aggregation, not individual delivery

What aspects would you like me to elaborate on?"
