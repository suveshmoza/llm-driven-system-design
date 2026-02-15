# Reddit - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Introduction (2 minutes)

"Thanks for this problem. I'll be designing Reddit, a community-driven content platform where users submit posts, vote on content, and engage in threaded discussions. As a backend engineer, I'll focus on the voting system that scales under high contention, materialized path implementation for nested comments, ranking algorithms with precomputation, and background workers for eventual consistency. Let me clarify the requirements."

---

## 1. Requirements Clarification (4 minutes)

### Functional Requirements

1. **Subreddits** - Create communities with custom rules
2. **Posts** - Submit text, link, or media posts
3. **Comments** - Nested threaded discussions with arbitrary depth
4. **Voting** - Upvote/downvote posts and comments
5. **Ranking** - Sort by hot, new, top, controversial
6. **Moderation** - Remove content, ban users

### Non-Functional Requirements

- **Availability** - 99.9% uptime
- **Latency** - < 100ms for feed loading
- **Scale** - Millions of posts, billions of votes
- **Consistency** - Eventual consistency acceptable for vote counts (5-30s delay)

### Backend-Specific Considerations

- Atomic vote operations to prevent double-voting
- Background aggregation to eliminate database contention
- Efficient tree queries for nested comments
- Precomputed ranking scores stored in sorted sets

---

## 2. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│                    React + Tanstack Router                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway                              │
│                    Node.js + Express                            │
│   - POST /subreddits, /posts, /comments                         │
│   - POST /vote                                                  │
│   - GET /r/:subreddit/hot, /new, /top                          │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Post Service │    │ Vote Service  │    │Comment Service│
│               │    │               │    │               │
│ - CRUD posts  │    │ - Cast votes  │    │ - Tree mgmt   │
│ - Ranking     │    │ - Aggregation │    │ - Threading   │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────────┬───────────────────────────────────────────┤
│    PostgreSQL       │              Valkey/Redis                 │
│  - Users, posts     │  - Vote counts (cached)                   │
│  - Comments, votes  │  - Hot scores (sorted sets)               │
│  - Subreddits       │  - Session storage                        │
└─────────────────────┴───────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Background       │
                    │  Workers          │
                    │  - Vote aggregator│
                    │  - Ranking calc   │
                    │  - Archiver       │
                    └───────────────────┘
```

### Core Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| Vote Service | Vote casting with deduplication | Express + PostgreSQL |
| Aggregation Worker | Batch vote count updates | Background job |
| Ranking Worker | Precompute hot/controversial scores | Cron + Redis |
| Comment Service | Materialized path tree operations | PostgreSQL LIKE queries |

---

## 3. Deep Dive: Voting System (10 minutes)

### The Contention Problem

Naive approach: directly updating `score = score + 1` on the posts table causes row-level locks under high contention. A viral post could receive 1000 votes/second, causing lock waits and timeouts.

### Solution: Vote Table + Async Aggregation

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **votes** | id (SERIAL PK), user_id (FK users), post_id (FK posts), comment_id (FK comments), direction (SMALLINT: 1 = up, -1 = down), created_at | UNIQUE(user_id, post_id), UNIQUE(user_id, comment_id) | XOR constraint ensures exactly one target: either post_id or comment_id must be non-null, but not both |

### Vote Casting Implementation

Vote casting works as follows:

1. **Remove vote** (direction = 0): Delete the row from votes matching the user and target
2. **Cast or change vote** (direction = 1 or -1): Upsert into votes — insert a new row, or on conflict update the direction and timestamp
3. **Optimistic cache update**: Immediately increment the appropriate counter (up or down) in the Redis hash `{targetType}:{targetId}:votes` for instant UI feedback, even though the authoritative count will be updated by the background worker

### Background Aggregation Worker

The aggregation worker runs every 5-30 seconds and performs these steps:

1. **Find recently voted posts** — query for distinct post IDs from votes created in the last minute
2. **Aggregate votes per post** — count upvotes (direction = 1) and downvotes (direction = -1) using filtered aggregation
3. **Update denormalized counts** — write the computed upvotes, downvotes, and score (upvotes - downvotes) back to the posts table
4. **Refresh cache** — update the Redis hash `post:{id}:votes` with the authoritative counts

### Why This Approach?

| Approach | Pros | Cons |
|----------|------|------|
| Direct UPDATE | Simple, real-time | Row locks, contention |
| Vote table + async | No contention, auditable | 5-30s delay |
| Redis INCR only | Fast, real-time | Memory cost, no persistence |

We get the best of both worlds: no contention + cached real-time display.

---

## 4. Deep Dive: Nested Comments with Materialized Path (8 minutes)

### Tree Storage Approaches

| Method | Query Complexity | Insert Complexity | Move Complexity |
|--------|------------------|-------------------|-----------------|
| Adjacency List | O(n) recursive | O(1) | O(1) |
| Materialized Path | O(1) | O(1) | O(subtree) |
| Nested Sets | O(1) | O(n) | O(n) |
| Closure Table | O(1) | O(depth) | O(subtree) |

### Materialized Path Schema

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **comments** | id (SERIAL PK), post_id (FK posts, CASCADE), author_id (FK users, SET NULL), parent_id (FK comments, CASCADE), path (VARCHAR 255), depth (INT), content (TEXT), score, upvotes, downvotes, created_at | path (varchar_pattern_ops) for LIKE queries; post_id | Path stores dot-separated ancestry like "1.5.23.102" |

### Creating a Comment

Creating a comment:

1. **If replying to a parent**: Look up the parent's path and depth. Generate a unique path segment (using a base-36 timestamp), then set `path = parentPath + "." + segment` and `depth = parentDepth + 1`.
2. **If top-level**: Set path to a base-36 timestamp and depth to 0.
3. **Insert the comment** into the comments table with post_id, parent_id, author_id, path, depth, and content.
4. **Increment the comment count** on the posts table.

### Fetching Comment Trees

**Fetching the full comment tree**: Query all comments for a post, joining with users for the author name. Order depends on the sort mode: "best" sorts by path then score descending, "top" sorts by score descending then path, and "new" sorts by created_at descending then path.

**Fetching a subtree** (for "load more"): Query comments whose path starts with the parent's path using a LIKE pattern (`parentPath.%`), ordered by path, with a limit parameter for pagination.

### Why Materialized Path?

- **Single query** to fetch entire subtree
- **Natural sort order** when ordering by path
- **Depth included** for indentation without parsing
- **Trade-off**: Moving comments requires updating all descendant paths (but moves are extremely rare on Reddit-like platforms)

---

## 5. Deep Dive: Ranking Algorithms (6 minutes)

### Hot Algorithm

Reddit's classic hot algorithm balances recency with popularity:

1. Compute the net score (upvotes - downvotes)
2. Take the log base 10 of the absolute score (minimum 1) to get the "order of magnitude"
3. Determine the sign (+1, -1, or 0)
4. Compute seconds since the Reddit epoch (December 8, 2005)
5. Final formula: `sign * order + seconds / 45000`

The divisor of 45000 (12.5 hours) means an older post needs exponentially more votes to compete.

**Key insight**: A 12-hour-old post with 10 upvotes has the same hot score as a brand new post with 1 upvote.

### Controversial Algorithm

Surfaces content with high engagement but balanced votes:

1. If either upvotes or downvotes is zero, return 0 (no controversy)
2. Compute magnitude as total votes (upvotes + downvotes)
3. Compute balance as the ratio of the smaller count to the larger count
4. Final score: `magnitude * balance`

A post with 100 up / 100 down scores higher than 1000 up / 10 down.

### Precomputation Strategy with Redis Sorted Sets

A background job runs every 5 minutes to precompute hot scores:

1. **Select recent posts** — query posts created in the last 7 days that are not archived
2. **Calculate hot score** for each post using the algorithm above
3. **Store in Redis sorted sets** — add each post ID with its hot score to a subreddit-specific sorted set (`r:{subredditId}:hot`) using a Redis pipeline for efficiency
4. **Persist scores** — also store individual scores in Redis string keys for reference

**Retrieving hot posts** is then an O(log N) operation: use `ZREVRANGE` on the subreddit's sorted set with offset and limit for pagination.

**Cleanup**: Old entries are removed from sorted sets by computing the hot score for a 7-day-old post with zero votes and using `ZREMRANGEBYSCORE` to remove everything below that threshold.

---

## 6. Deep Dive: Karma and User Aggregation (4 minutes)

### Karma Calculation

Karma is calculated per user by summing the direction values of all votes on their posts (post karma) and all votes on their comments (comment karma). These are written to denormalized columns on the users table.

A **batch update job** runs every 5 minutes: it identifies users whose content received votes in the last 5 minutes by joining the votes table with posts and comments, then recalculates their karma from the authoritative vote data.

---

## 7. Trade-offs Summary

| Decision | Choice | Trade-off | Alternative |
|----------|--------|-----------|-------------|
| Vote storage | Async aggregation | 5-30s delay for scores | Direct UPDATE (contention) |
| Comment tree | Materialized path | Move requires subtree update | Closure table (more storage) |
| Hot scores | Precomputed sorted sets | 5min staleness | On-demand calc (CPU intensive) |
| Database | PostgreSQL | Scaling requires sharding | Cassandra (easier sharding) |
| Karma | Background batch | Stale by minutes | Real-time (expensive) |

---

## 8. Database Partitioning Strategy

### Vote Table Partitioning

The votes table is range-partitioned by `created_at` with monthly partitions (e.g., `votes_2024_01` for January 2024, `votes_2024_02` for February). This enables efficient archival: the entire partition can be exported to cold storage (MinIO) as compressed JSON and then dropped, without affecting active partitions.

### Archival Worker

The archival worker handles partitions older than a configurable threshold (default 12 months):

1. Determine the partition name from the cutoff date (e.g., `votes_2024_01`)
2. Export all rows from that partition
3. Compress and upload to MinIO cold storage at `archives/votes/{partitionName}.json.gz`
4. Drop the partition after confirming the upload succeeded

---

## 9. Metrics and Observability

We track four Prometheus metrics:

- **reddit_votes_total** (Counter) — total votes cast, labeled by direction (up/down) and target type (post/comment)
- **reddit_vote_aggregation_lag_seconds** (Gauge) — time since the last vote aggregation completed, for monitoring freshness
- **reddit_hot_score_calculation_duration_seconds** (Histogram) — time to compute hot scores for all recent posts, with buckets from 0.1s to 30s
- **reddit_comment_tree_depth** (Histogram) — observed nesting depth of comments, with buckets from 1 to 50

---

## 10. Future Enhancements

1. **Bloom Filters** - Detect vote duplication at scale without DB lookup
2. **Event Sourcing** - Store vote events for complete audit trail
3. **CQRS** - Separate read/write models for optimized feeds
4. **Elasticsearch** - Full-text search across subreddits
5. **Kafka** - Async event processing for cross-service communication

---

## Summary

"To summarize, I've designed Reddit's backend with:

1. **Async vote aggregation** - Individual votes insert without contention, background workers aggregate every 5-30 seconds. This trades real-time accuracy for scalability under high load.

2. **Materialized path for comments** - Storing the full ancestry path (e.g., '1.5.23') enables single-query subtree fetches and natural sorting, critical for Reddit's deep discussion threads.

3. **Precomputed ranking scores** - Hot, top, and controversial scores are calculated in background jobs and stored in Redis sorted sets, making feed retrieval O(log N).

4. **Partitioned vote storage** - Monthly partitions enable archival of old votes while keeping recent data fast.

The main trade-off is freshness vs. performance. We accept eventually consistent vote counts and ranking scores because the user experience doesn't require real-time precision for these values."
