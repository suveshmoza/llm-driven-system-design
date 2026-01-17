# Facebook News Feed - System Design Interview Answer

## Introduction

"Today I'll design a personalized news feed system similar to Facebook's. The core challenge is generating a personalized, ranked feed of content for each of billions of users, while handling the write amplification problem when popular users post. This involves interesting problems around feed generation strategies, ranking algorithms, and real-time updates."

---

## Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm what we're building:

1. **Feed Generation**: Show personalized content from friends and followed pages
2. **Post Creation**: Users create posts (text, images, videos, links)
3. **Ranking**: Order posts by relevance, not just chronologically
4. **Real-Time Updates**: New posts appear without manual refresh
5. **Interactions**: Like, comment, share reflected in feed
6. **Mixed Content Types**: Posts, photos, videos, life events, ads

Should I also design the social graph, or assume that's a separate service?"

### Non-Functional Requirements

"For a news feed at Facebook scale:

- **Scale**: 2 billion daily active users
- **Latency**: Feed loads in <500ms
- **Availability**: 99.99% uptime
- **Freshness**: New posts visible within seconds
- **Personalization**: Feed feels curated for each user"

---

## Step 2: Scale Estimation

"Let me work through the numbers:

**Users:**
- 2 billion DAU
- Average 300 friends per user
- Average 5 posts per user per day

**Posts:**
- 2B users * 5 posts = 10 billion posts per day
- ~115,000 posts per second

**Feed Requests:**
- 2B users * 10 feed loads per day = 20 billion feed requests/day
- ~230,000 feed requests per second

**The Fan-out Problem:**
- Popular user (10M followers) posts
- Naive approach: 10M writes to 10M feeds
- 100 celebrities post per hour = 1B writes per hour

**Storage:**
- 10B posts/day * 1KB average = 10 TB/day
- With replication and indexes: ~50 TB/day"

---

## Step 3: High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Applications                          │
│                    (Web, iOS, Android)                               │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Load Balancer                                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Post Service  │    │   Feed Service  │    │  Ranking        │
│   (Write Posts) │    │   (Get Feed)    │    │  Service        │
└────────┬────────┘    └────────┬────────┘    └─────────────────┘
         │                      │
         ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Fan-out Service                                   │
│              (Distributes posts to followers' feeds)                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Feed Cache    │    │  Post Store     │    │  Social Graph   │
│   (Redis)       │    │  (Cassandra)    │    │  Service        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Step 4: Post Creation and Storage

### Post Data Model

```python
class Post:
    id: UUID                    # Snowflake ID (time-ordered)
    author_id: UUID
    content: str
    media_ids: List[UUID]       # References to media service
    post_type: str              # text, photo, video, link, life_event
    privacy: str                # public, friends, custom
    created_at: datetime
    updated_at: datetime
    is_deleted: bool
```

### Storage Schema (Cassandra)

```cql
-- Posts by author (for profile view)
CREATE TABLE posts_by_user (
    user_id UUID,
    post_id TIMEUUID,
    content TEXT,
    media_ids LIST<UUID>,
    post_type TEXT,
    privacy TEXT,
    created_at TIMESTAMP,
    PRIMARY KEY (user_id, post_id)
) WITH CLUSTERING ORDER BY (post_id DESC);

-- Posts by ID (for direct access)
CREATE TABLE posts (
    post_id TIMEUUID PRIMARY KEY,
    user_id UUID,
    content TEXT,
    media_ids LIST<UUID>,
    post_type TEXT,
    privacy TEXT,
    created_at TIMESTAMP
);
```

### Post Creation Flow

```python
class PostService:
    async def create_post(self, user_id, content, media_ids, privacy):
        # 1. Validate and create post
        post = Post(
            id=generate_snowflake_id(),
            author_id=user_id,
            content=content,
            media_ids=media_ids,
            privacy=privacy,
            created_at=datetime.utcnow()
        )

        # 2. Persist to database
        await self.db.insert(post)

        # 3. Trigger fan-out (async)
        await self.fanout_queue.enqueue({
            'post_id': post.id,
            'author_id': user_id,
            'created_at': post.created_at
        })

        return post
```

---

## Step 5: Feed Generation Strategies

"This is the core architectural decision. Two main approaches:

### Strategy 1: Push (Fan-out on Write)

```
When user posts:
  For each follower:
    Add post_id to follower's feed cache
```

**Pros:**
- Fast reads (feed already built)
- Simple feed retrieval

**Cons:**
- Celebrity problem: 10M followers = 10M writes
- Wasted work for inactive users
- Write amplification

### Strategy 2: Pull (Fan-out on Read)

```
When user requests feed:
  Get list of friends
  For each friend:
    Get recent posts
  Merge and rank
  Return feed
```

**Pros:**
- No write amplification
- No wasted work

**Cons:**
- Slow reads (fetch from many sources)
- Complex aggregation at read time

### Strategy 3: Hybrid (Facebook's Approach)

```
For regular users (<1000 followers):
  Use push model (fast reads)

For celebrities (>10K followers):
  Use pull model (avoid write amplification)

At read time:
  Fetch pre-computed feed
  Fetch posts from celebrities user follows
  Merge and rank
```

**This is what I'd recommend.**"

---

## Step 6: Hybrid Fan-out Implementation

### Fan-out Service

```python
class FanoutService:
    CELEBRITY_THRESHOLD = 10000

    async def fanout_post(self, post_id, author_id, created_at):
        follower_count = await self.social_graph.get_follower_count(author_id)

        if follower_count > self.CELEBRITY_THRESHOLD:
            # Celebrity: Don't fan out, will be pulled at read time
            await self.celebrity_posts.add(author_id, post_id)
            return

        # Regular user: Fan out to followers
        followers = await self.social_graph.get_followers(author_id)

        # Batch write to feed caches
        for batch in chunks(followers, 1000):
            await self.feed_cache.add_to_feeds(batch, post_id, created_at)
```

### Feed Cache (Redis)

```redis
# User's pre-computed feed (list of post IDs, sorted by time)
# Key: feed:{user_id}
# Value: Sorted set with post_id and score (timestamp)

ZADD feed:user123 1705334400 post_abc
ZADD feed:user123 1705334500 post_def

# Keep only recent 1000 posts
ZREMRANGEBYRANK feed:user123 0 -1001

# Celebrity posts (separate tracking)
ZADD celebrity_posts:celeb456 1705334400 post_xyz
```

### Feed Retrieval

```python
class FeedService:
    async def get_feed(self, user_id, count=20, cursor=None):
        # 1. Get pre-computed feed from cache
        cached_posts = await self.feed_cache.get_feed(user_id, count * 2)

        # 2. Get celebrities user follows
        followed_celebrities = await self.social_graph.get_followed_celebrities(user_id)

        # 3. Fetch recent posts from celebrities
        celebrity_posts = await self.get_celebrity_posts(followed_celebrities)

        # 4. Merge feeds
        all_posts = merge_by_time(cached_posts, celebrity_posts)

        # 5. Fetch full post data
        posts = await self.post_store.get_posts(all_posts[:count * 2])

        # 6. Apply ranking
        ranked = await self.ranking_service.rank(user_id, posts)

        # 7. Return top N
        return ranked[:count]
```

---

## Step 7: Ranking Algorithm

"Chronological feeds are simple but not engaging. Ranking improves relevance.

### Ranking Factors

```python
class RankingFeatures:
    # Post features
    post_age: float              # Decay function over time
    post_type: str               # Video, photo, text
    engagement_rate: float       # Likes + comments / impressions

    # Author features
    author_affinity: float       # How often user interacts with author
    author_is_close_friend: bool
    author_activity_level: float

    # User features
    user_interest_categories: List[str]
    user_online_patterns: Dict
    user_device: str

    # Context features
    time_of_day: int
    day_of_week: int
    user_session_length: float
```

### Simple Scoring Function

```python
def calculate_score(post, user, features):
    score = 0.0

    # Base score from engagement
    score += features.engagement_rate * 100

    # Affinity with author
    score += features.author_affinity * 50

    # Recency decay
    hours_old = (now - post.created_at).total_seconds() / 3600
    recency_decay = 1.0 / (1 + hours_old * 0.1)  # Half-life ~10 hours
    score *= recency_decay

    # Content type preferences
    if post.type == 'video' and user.prefers_video:
        score *= 1.2

    # Close friends boost
    if features.author_is_close_friend:
        score *= 1.5

    return score
```

### ML Ranking (Production)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ML Ranking Pipeline                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Candidate Generation (1000 posts)                               │
│     └─ From feed cache + celebrity posts + ads                      │
│                                                                      │
│  2. Feature Extraction                                               │
│     └─ User features, post features, context features               │
│                                                                      │
│  3. First-Pass Ranking (Lightweight Model)                          │
│     └─ Score all 1000, keep top 200                                 │
│                                                                      │
│  4. Second-Pass Ranking (Heavy Model)                               │
│     └─ Deep neural network on 200 candidates                        │
│     └─ Predicts: P(like), P(comment), P(share), P(hide)            │
│                                                                      │
│  5. Diversity Injection                                              │
│     └─ Don't show 10 posts from same author                         │
│     └─ Mix content types                                            │
│                                                                      │
│  6. Policy Enforcement                                               │
│     └─ Misinformation labels                                        │
│     └─ Sensitive content warnings                                   │
│                                                                      │
│  7. Return top 20                                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step 8: Real-Time Feed Updates

### Approaches

**1. Polling (Simple)**
```javascript
setInterval(() => {
    fetch('/api/feed/updates?since=' + lastTimestamp)
}, 30000);  // Every 30 seconds
```

**2. Long Polling (Better)**
```python
async def get_feed_updates(user_id, last_seen):
    while True:
        updates = await check_for_updates(user_id, last_seen)
        if updates:
            return updates
        await asyncio.sleep(1)  # Check every second
```

**3. Server-Sent Events (Even Better)**
```python
async def feed_stream(user_id):
    async for update in subscribe_to_feed(user_id):
        yield f"data: {json.dumps(update)}\n\n"
```

**4. WebSocket (Best for Bidirectional)**
```python
class FeedWebSocket:
    async def handle(self, websocket, user_id):
        # Subscribe to user's feed updates
        pubsub = redis.pubsub()
        await pubsub.subscribe(f'feed_updates:{user_id}')

        async for message in pubsub.listen():
            await websocket.send(message['data'])
```

### Update Propagation

```
Post Created
     │
     ▼
Fan-out Service
     │
     ├─── Update feed caches
     │
     └─── Publish to notification channel
                │
                ▼
         Redis Pub/Sub
                │
         ┌──────┼──────┐
         ▼      ▼      ▼
      Online users' WebSocket connections
```

---

## Step 9: Engagement Aggregation

### Like/Comment Counts

```python
class EngagementService:
    async def like_post(self, user_id, post_id):
        # 1. Check if already liked
        if await self.redis.sismember(f'likes:{post_id}', user_id):
            return False

        # 2. Add to likes set
        await self.redis.sadd(f'likes:{post_id}', user_id)

        # 3. Increment counter
        await self.redis.incr(f'like_count:{post_id}')

        # 4. Queue for persistence
        await self.engagement_queue.enqueue({
            'type': 'like',
            'user_id': user_id,
            'post_id': post_id,
            'timestamp': time.time()
        })

        return True
```

### Counter Caching

```redis
# Approximate counters (HyperLogLog for unique counts)
PFADD post_viewers:post123 user456
PFCOUNT post_viewers:post123

# Exact counters (for likes, comments)
INCR like_count:post123
GET like_count:post123

# Persistence to database happens async
```

---

## Step 10: Social Graph Integration

### Graph Storage

```python
class SocialGraphService:
    # Get friends for feed generation
    async def get_friends(self, user_id):
        return await self.graph_db.query(
            "MATCH (u:User {id: $user_id})-[:FRIENDS]->(friend) "
            "RETURN friend.id",
            user_id=user_id
        )

    # Get followed celebrities
    async def get_followed_celebrities(self, user_id):
        return await self.graph_db.query(
            "MATCH (u:User {id: $user_id})-[:FOLLOWS]->(celeb:User) "
            "WHERE celeb.follower_count > 10000 "
            "RETURN celeb.id",
            user_id=user_id
        )

    # Calculate affinity score
    async def get_affinity(self, user_id, friend_id):
        interactions = await self.get_interactions(user_id, friend_id)
        return self.calculate_affinity_score(interactions)
```

### Affinity Scoring

```python
def calculate_affinity_score(interactions):
    score = 0.0

    # Recent interactions weighted higher
    for interaction in interactions:
        days_ago = (now - interaction.timestamp).days
        weight = 1.0 / (1 + days_ago * 0.1)

        if interaction.type == 'message':
            score += 10 * weight
        elif interaction.type == 'comment':
            score += 5 * weight
        elif interaction.type == 'like':
            score += 2 * weight
        elif interaction.type == 'view_profile':
            score += 1 * weight

    return min(score, 100)  # Cap at 100
```

---

## Step 11: Feed Caching Strategy

### Multi-Level Cache

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Caching Layers                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  L1: CDN Cache (Static Assets)                                      │
│  └─ Images, videos (hours-days TTL)                                 │
│                                                                      │
│  L2: Application Cache (Local Memory)                                │
│  └─ Hot posts, user sessions (minutes TTL)                          │
│                                                                      │
│  L3: Distributed Cache (Redis Cluster)                              │
│  └─ Pre-computed feeds, post metadata (hours TTL)                   │
│  └─ Engagement counters (real-time)                                 │
│                                                                      │
│  L4: Database (Cassandra)                                           │
│  └─ Source of truth for posts                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Cache Warming

```python
class FeedCacheWarmer:
    async def warm_user_feed(self, user_id):
        """Pre-compute feed when user logs in"""
        # Get friends
        friends = await self.social_graph.get_friends(user_id)

        # Fetch recent posts from each friend
        posts = []
        for friend_id in friends:
            friend_posts = await self.post_store.get_recent(friend_id, limit=10)
            posts.extend(friend_posts)

        # Get celebrity posts
        celebrities = await self.social_graph.get_followed_celebrities(user_id)
        for celeb_id in celebrities:
            celeb_posts = await self.post_store.get_recent(celeb_id, limit=5)
            posts.extend(celeb_posts)

        # Sort and cache
        sorted_posts = sorted(posts, key=lambda p: p.created_at, reverse=True)
        await self.feed_cache.set(user_id, sorted_posts[:500])
```

---

## Step 12: Handling Edge Cases

### New User (Cold Start)

```python
async def get_feed_new_user(user_id):
    # No friends yet, show:
    # 1. Popular public posts
    popular = await get_popular_posts(limit=10)

    # 2. Posts from suggested friends
    suggestions = await get_friend_suggestions(user_id)
    suggested_posts = await get_posts_from_users(suggestions)

    # 3. Content matching profile interests
    interests = await get_user_interests(user_id)
    interest_posts = await get_posts_by_topic(interests)

    return merge_and_rank(popular, suggested_posts, interest_posts)
```

### Inactive User Returning

```python
async def get_feed_returning_user(user_id, last_active):
    # User hasn't logged in for 30 days
    # Their feed cache is stale/empty

    # Show "While you were away" highlights
    highlights = await get_highlights_since(
        user_id, last_active, limit=10
    )

    # Then normal feed
    regular_feed = await get_feed(user_id)

    return {
        'highlights': highlights,
        'feed': regular_feed
    }
```

### Privacy Filtering

```python
async def filter_by_privacy(posts, viewer_id):
    filtered = []
    for post in posts:
        if post.privacy == 'public':
            filtered.append(post)
        elif post.privacy == 'friends':
            if await are_friends(post.author_id, viewer_id):
                filtered.append(post)
        elif post.privacy == 'custom':
            if await check_custom_privacy(post.id, viewer_id):
                filtered.append(post)
    return filtered
```

---

## Step 13: Scalability Considerations

### Database Sharding

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Sharding Strategy                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Posts: Shard by author_id                                          │
│  └─ All posts by a user on same shard                               │
│  └─ Easy to fetch user's timeline                                   │
│                                                                      │
│  Feed Cache: Shard by user_id                                       │
│  └─ User's feed always on same Redis node                           │
│                                                                      │
│  Social Graph: Shard by user_id                                     │
│  └─ User's connections co-located                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Regional Deployment

```
US Region:
  - Full stack for US users
  - Primary for US posts

EU Region:
  - Full stack for EU users
  - Replica of global popular posts
  - GDPR-compliant data handling

Asia Region:
  - Full stack for Asia users
  - Replica with higher latency tolerance
```

---

## Step 14: Trade-offs and Alternatives

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| Fan-out | Hybrid (push + pull) | Pure push or pull | Handles celebrities + fast reads |
| Ranking | ML-based | Chronological | Engagement optimization |
| Storage | Cassandra | PostgreSQL | Write throughput at scale |
| Cache | Redis Cluster | Memcached | Rich data structures |
| Updates | WebSocket | Polling | Real-time experience |

### What Facebook Actually Uses

"Based on public information:
- TAO: Custom graph storage for social data
- MySQL (MyRocks): Posts and user data
- Memcached: Massive caching layer
- Custom ML ranking infrastructure
- Async processing with custom queue system"

---

## Step 15: Monitoring

"Key metrics for news feed:

**User Experience:**
- Feed load latency (p50, p95, p99)
- Time to first meaningful content
- Scroll depth
- Session duration

**System Health:**
- Fan-out lag (time from post to appearing in feeds)
- Cache hit rate
- Ranking model latency
- Database query latency

**Engagement:**
- Click-through rate on posts
- Like/comment/share rates
- Time spent per session
- Return user rate"

---

## Summary

"To summarize my Facebook News Feed design:

1. **Hybrid Fan-out**: Push for regular users (fast reads), pull for celebrities (avoid write amplification)
2. **Feed Cache**: Redis stores pre-computed post IDs, merged with celebrity posts at read time
3. **ML Ranking**: Multi-stage ranking with candidate generation, feature extraction, and neural network scoring
4. **Real-Time Updates**: WebSocket connections with Redis pub/sub for instant updates
5. **Social Graph Integration**: Affinity scoring influences ranking, privacy filtering at read time

The key insights are:
- The celebrity problem requires hybrid approach - can't push to millions
- Ranking transforms chronological feed into engaging experience
- Caching at multiple levels is essential for latency at scale
- Real-time updates need dedicated infrastructure (WebSocket + pub/sub)

What aspects would you like me to elaborate on?"
