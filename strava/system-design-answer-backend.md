# Strava - Fitness Tracking Platform - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Introduction (2 minutes)

"Thanks for this problem. I'll be designing a fitness tracking platform like Strava, focusing on the backend systems that handle GPS data storage, segment matching algorithms, leaderboard calculations, and activity feed generation. This involves geospatial data processing, time-series storage, and real-time ranking systems. Let me clarify requirements."

---

## 1. Requirements Clarification (5 minutes)

### Functional Requirements (Backend Perspective)

1. **Activity Recording** - Ingest and parse GPS-based activities (GPX/FIT files) with metrics calculation
2. **Segment Matching** - Detect when activities traverse predefined route segments using geospatial algorithms
3. **Leaderboards** - Maintain real-time ranked lists with O(1) rank lookups
4. **Activity Feeds** - Generate personalized feeds using fan-out on write
5. **Privacy Zones** - Filter GPS points within user-defined circular zones
6. **Achievements** - Automatically check and award achievements after activities

### Non-Functional Requirements

- **Reliability** - Never lose uploaded activity data; idempotent uploads
- **Latency** - Activity upload and processing under 30 seconds end-to-end
- **Scalability** - Handle millions of GPS points per day
- **Accuracy** - Segment matching within 25m threshold for fair competition

### Backend-Specific Considerations

- GPS data storage optimization (50 bytes per point, thousands per activity)
- Efficient geospatial queries for segment candidate selection
- Redis sorted sets for O(log N) leaderboard updates
- Session-based authentication with Redis backing

---

## 2. Scale Estimation (3 minutes)

### Traffic Estimates

- 10 million weekly active users
- 5 million activities uploaded per day
- Average activity: 3,600 GPS points (1 hour at 1 point/second)
- Peak upload rate: ~100 activities/second

### Storage Estimates

| Data Type | Size per Unit | Daily Volume | Annual Volume |
|-----------|---------------|--------------|---------------|
| GPS points | 50 bytes | 900 GB | 330 TB |
| Activities | 500 bytes | 2.5 GB | 1 TB |
| Segment efforts | 100 bytes | 500 MB | 180 GB |

### Processing Estimates

- Segment matching: 5M activities x 100 candidate segments = 500M comparisons/day
- Feed fan-out: 10M users x 50 followers = 500M feed entries/day
- Leaderboard updates: ~10M new efforts/day

---

## 3. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           API Gateway                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Express   │  │   Auth      │  │  Activity   │  │  Segment    │    │
│  │   Server    │  │   Routes    │  │   Routes    │  │   Routes    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   GPX       │  │  Segment    │  │ Leaderboard │  │   Feed      │    │
│  │  Parser     │  │  Matcher    │  │  Service    │  │  Generator  │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────┬─────────────────────────┬─────────────────────────┘
                      │                         │
          ┌───────────┴───────────┐   ┌─────────┴─────────┐
          ▼                       ▼   ▼                   ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PostgreSQL    │     │    Cassandra    │     │     Redis       │
│   + PostGIS     │     │  (GPS Points)   │     │                 │
│                 │     │                 │     │ - Sessions      │
│ - Users         │     │ - TimeUUID      │     │ - Leaderboards  │
│ - Activities    │     │ - Point Index   │     │ - Feed Cache    │
│ - Segments      │     │                 │     │ - PR Cache      │
│ - Efforts       │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
          │
          ▼
┌─────────────────┐
│  Object Storage │
│  (GPX Files)    │
└─────────────────┘
```

### Core Backend Services

1. **Activity Service** - Upload handling, GPX parsing, privacy zone filtering, metrics calculation
2. **Segment Matcher** - Two-phase matching: bounding box filter + GPS point comparison
3. **Leaderboard Service** - Redis sorted sets for rankings, personal records
4. **Feed Generator** - Fan-out on write for personalized activity feeds
5. **Achievement Service** - Rule-based achievement checking after activities

---

## 4. Database Schema Design (8 minutes)

### PostgreSQL Schema (Relational Data)

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), username (unique), email (unique), password_hash, profile_photo, weight_kg, role, created_at, updated_at | Unique on username and email | Standard auth with role-based access |
| **activities** | id (UUID PK), user_id (FK), type (run/ride/hike), name, start_time, elapsed_time, moving_time, distance (meters), elevation_gain, avg_speed, max_speed, avg_heart_rate, max_heart_rate, privacy, polyline (encoded route), start_lat/lng, end_lat/lng, kudos_count (denormalized), comment_count (denormalized), created_at | See critical indexes below | Polyline stores compressed route for display; denormalized counts avoid joins |
| **segments** | id (UUID PK), creator_id (FK), name, activity_type, distance, elevation_gain, polyline, start_lat/lng, end_lat/lng, min_lat/min_lng/max_lat/max_lng (bounding box), effort_count (denormalized), athlete_count (denormalized), created_at | Bounding box index for spatial queries | Bounding box enables fast Phase 1 filtering |
| **segment_efforts** | id (UUID PK), segment_id (FK), activity_id (FK), user_id (FK), elapsed_time, moving_time, start_index, end_index (GPS point range), pr_rank (1/2/3 for podium), created_at | Composite indexes for leaderboard and PR queries | Links activities to segments with timing data |
| **privacy_zones** | id (UUID PK), user_id (FK), name, center_lat, center_lng, radius_meters (default 500), created_at | By user_id | Circular zones for GPS point filtering |

### Critical Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| idx_gps_points_activity | gps_points | activity_id, point_index | Retrieve GPS points in order for an activity |
| idx_segments_bbox | segments | min_lat, max_lat, min_lng, max_lng | Phase 1 bounding box intersection query |
| idx_segments_type | segments | activity_type | Filter segments by sport type |
| idx_segment_efforts_segment | segment_efforts | segment_id, elapsed_time | Leaderboard queries sorted by time |
| idx_segment_efforts_user | segment_efforts | user_id, segment_id | Personal records lookup |

### Cassandra Schema (GPS Time-Series)

| Table | Partition Key | Clustering Key | Columns | Notes |
|-------|---------------|----------------|---------|-------|
| **gps_points** | activity_id (UUID) | point_index (INT, ASC) | timestamp, latitude (DOUBLE), longitude (DOUBLE), altitude (DOUBLE), speed (DOUBLE), heart_rate (INT), cadence (INT), power (INT) | Optimized for sequential reads of all points in an activity; clustering order ensures points are stored and retrieved in order |

### Redis Data Structures

```
# Leaderboards (sorted sets - lower time = better)
leaderboard:{segment_id} -> ZSET { user_id: elapsed_time }

# Personal Records
pr:{user_id}:{segment_id} -> best_elapsed_time

# Activity Feeds (sorted sets - score = timestamp)
feed:{user_id} -> ZSET { activity_id: timestamp }

# Sessions
sess:{session_id} -> JSON { userId, username, role }

# Idempotency keys
idem:activity:{sha256_hash} -> activity_id (TTL: 24h)
```

---

## 5. Deep Dive: Activity Upload Pipeline (10 minutes)

### Upload Flow Architecture

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Mobile  │───▶│   API    │───▶│  Object  │───▶│  Kafka   │
│   App    │    │  Server  │    │ Storage  │    │  Queue   │
└──────────┘    └────┬─────┘    └──────────┘    └────┬─────┘
                     │                               │
                     ▼                               ▼
              ┌──────────┐    ┌──────────┐    ┌──────────┐
              │   GPX    │───▶│ Privacy  │───▶│ Segment  │
              │  Parser  │    │  Filter  │    │ Matcher  │
              └──────────┘    └──────────┘    └────┬─────┘
                                                   │
                     ┌─────────────────────────────┴──────┐
                     ▼                                    ▼
              ┌──────────┐                         ┌──────────┐
              │   Feed   │                         │Leaderboard│
              │Generator │                         │  Update   │
              └──────────┘                         └──────────┘
```

### GPX Parsing Implementation

The GPX parser extracts trackpoints from XML and computes derived metrics:

1. **Parse each trackpoint** - Extract latitude, longitude, altitude, timestamp, and heart rate from the GPX XML structure
2. **Calculate inter-point metrics** - For each consecutive pair of points, compute the Haversine distance, accumulate total distance and positive elevation gain, and derive instantaneous speed from distance/time
3. **Aggregate activity metrics** - Total distance, total elevation gain, elapsed time (last timestamp minus first), moving time (excluding stopped periods), and average speed

The parser returns both the array of GPS points and the computed summary metrics.

### Privacy Zone Filtering

Privacy zone filtering removes GPS points that fall within user-defined circular zones:

1. For each GPS point, check if it falls within any privacy zone by computing the Haversine distance from the point to each zone's center and comparing against the zone's radius
2. Points inside any zone are omitted from the output
3. When entering a privacy zone, the last visible point is marked with a transition flag so the frontend can indicate a gap in the route
4. When exiting the zone, recording resumes normally

This ensures home/work locations are never exposed in shared activities while maintaining route continuity outside protected areas.

### Idempotent Upload Handling

The upload handler prevents duplicate activities from retry-prone mobile uploads:

1. **Content-based deduplication** - Generate a SHA-256 hash of the user ID concatenated with the GPX content. Use either the client-provided idempotency key or this content hash as the cache key
2. **Check Redis** for an existing activity ID under `idem:activity:{key}`. If found, return the existing activity with a `duplicate: true` flag
3. **Process new upload** - Parse the GPX file, apply privacy zone filtering, create the activity record in PostgreSQL, and batch-insert filtered GPS points to Cassandra
4. **Cache the result** - Store the new activity ID in Redis with a 24-hour TTL
5. **Publish event** - Send an `activity.created` event to Kafka with the activity ID, user ID, and bounding box for async segment matching and feed generation

---

## 6. Deep Dive: Segment Matching Algorithm (8 minutes)

### Two-Phase Matching Strategy

```
Phase 1: Coarse Filter (Bounding Box)
┌─────────────────────────────────────────┐
│ Activity Bounding Box                   │
│   ┌───────────┐  ┌────────────────┐    │
│   │ Segment A │  │   Segment B    │    │   ← Candidates
│   │ (match)   │  │   (match)      │    │
│   └───────────┘  └────────────────┘    │
│                         ┌─────────────┐ │
│                         │  Segment C  │ │   ← Candidate
│                         └─────────────┘ │
└─────────────────────────────────────────┘

Phase 2: Fine Matching (GPS Point Comparison)
Only Segment A and C actually traversed by activity
```

### Phase 1: Bounding Box Query

The first phase uses a spatial query to find candidate segments whose bounding boxes intersect with the activity's bounding box. The query filters by activity type and checks that each segment's min/max latitude and longitude coordinates overlap with the activity's extent. This eliminates approximately 99% of segments, leaving only those geographically near the activity route.

### Phase 2: GPS Point Matching

The fine matching algorithm uses a 25-meter distance threshold and works as follows:

1. **Decode the segment polyline** into GPS points
2. **Find entry candidates** - Scan the activity's GPS points for any that fall within 25 meters of the segment's start point
3. **Attempt matching from each candidate** - Starting from each entry point, walk through both the segment and activity point sequences simultaneously:
   - At each step, compute the Haversine distance between the current segment point and activity point
   - If the distance exceeds 25 meters, the match fails
   - Track maximum deviation for quality reporting
   - Advance whichever pointer (activity or segment) is behind to handle differences in sampling rate
4. **Match succeeds** when all segment points have been traversed within the threshold. The result includes start/end GPS point indexes and elapsed time for the effort.

If no entry candidate produces a complete match, the segment was not traversed by this activity.

### Haversine Distance Calculation

The Haversine formula computes the great-circle distance between two GPS coordinates on Earth's surface (radius = 6,371,000 meters). It converts latitude and longitude differences to radians, applies the Haversine formula (using sin^2 of half-angles and cosine products), and returns the distance in meters. This is the core distance function used throughout segment matching and privacy zone filtering.

---

## 7. Deep Dive: Leaderboard System (5 minutes)

### Redis Sorted Set Operations

The leaderboard update flow for each segment effort:

1. **Check personal record** - Read the current PR from Redis key `pr:{userId}:{segmentId}`
2. **Compare times** - If no existing PR or the new elapsed time is faster, update the PR value
3. **Update leaderboard** - Add or update the user's entry in the sorted set `leaderboard:{segmentId}` with elapsed time as the score (lower = better)
4. **Check rank** - Use ZRANK to get the 0-indexed position. If rank < 3, update the segment effort record with the podium position (1st, 2nd, or 3rd)
5. **Return result** - Indicate whether this was a new PR and the user's current rank

### Leaderboard Query with Filters

Two query modes are supported:

**Overall leaderboard**: Use ZRANGE on `leaderboard:{segmentId}` to get the top N entries with scores. This is O(log N + M) where M is the limit.

**Friends leaderboard**: Retrieve the user's following set from Redis, then use ZMSCORE to batch-fetch scores for all followed users from the segment's sorted set. Filter out users with no score (never attempted the segment), sort by time, and take the top N.

Both modes enrich results with cached user details (id, username, profile photo) and format elapsed times for display.

---

## 8. Activity Feed Generation (4 minutes)

### Fan-Out on Write

When a new activity is created, the feed generator writes it to every follower's feed:

1. **Query followers** - Get all follower_ids from the follows table
2. **Pipeline writes** - Use a Redis pipeline to batch two operations per follower: ZADD the activity_id to `feed:{follower_id}` with the start timestamp as score, then ZREMRANGEBYRANK to trim the feed to the most recent 1000 entries
3. **Execute atomically** - The pipeline executes all operations in a single round trip

### Feed Retrieval with Pagination

Feed retrieval uses cursor-based pagination with Redis sorted sets:

1. **First page**: Use ZREVRANGE to get the most recent N activity IDs from `feed:{userId}`
2. **Subsequent pages**: Use ZREVRANGEBYSCORE with the previous page's last timestamp as the upper bound (exclusive) to fetch the next batch
3. **Batch fetch** - Load all activity records from PostgreSQL in a single query using `WHERE id = ANY(ids)`
4. **Enrich** - Attach user data, kudos status, and comment previews
5. **Cursor** - Return the timestamp of the last activity as the next cursor; return null when fewer than `limit` results indicate the end of the feed

---

## 9. Trade-offs and Alternatives

| Decision | Choice | Trade-off | Alternative |
|----------|--------|-----------|-------------|
| GPS Storage | Cassandra | High write throughput; harder analytics | TimescaleDB (better queries, more write overhead) |
| Leaderboards | Redis Sorted Sets | O(log N) updates, O(1) rank | PostgreSQL (simpler, slower at scale) |
| Feed Strategy | Fan-out on Write | Fast reads; write amplification | Fan-out on Read (less storage, slow reads) |
| Segment Matching | Synchronous | Immediate results; 30s latency | Async queue (faster upload, delayed results) |
| Privacy Zones | Circular (Haversine) | Simple implementation | Polygon zones (more flexible, complex) |
| Session Storage | Redis | Fast, distributed | JWT (stateless, no server-side revocation) |

---

## 10. Future Optimizations

1. **Sharding Strategy**
   - Activities: Shard by user_id (keeps user's activities together)
   - GPS Points: Shard by activity_id (keeps activity together)
   - Segments: Shard by geographic region (co-locate nearby segments)

2. **Caching Layers**
   - Hot segments cache (frequently matched)
   - User profile cache (30-minute TTL)
   - Activity details cache (24-hour TTL)

3. **Background Processing**
   - Kafka consumers for segment matching
   - Separate workers for feed generation
   - Async achievement checking

4. **GPS Data Lifecycle**
   - Full resolution: 1 year
   - Downsampled (1/5 points): 1+ years
   - Polyline preserved indefinitely

---

## Summary

"To summarize the backend architecture:

1. **Multi-database strategy** - PostgreSQL for relational data with PostGIS for geospatial queries, Cassandra for high-volume GPS time-series, Redis for leaderboards and feeds

2. **Two-phase segment matching** - Bounding box filter reduces candidates by 99%, then precise GPS point comparison with 25m Haversine threshold

3. **Redis sorted sets for leaderboards** - O(log N) insertions, O(1) rank lookups, with personal record tracking

4. **Fan-out on write feeds** - Trade write amplification for fast reads, suitable for typical follower counts

5. **Idempotent uploads** - Content-based hashing prevents duplicate activities from retry-prone mobile uploads

The key insight is separating storage by access pattern: PostgreSQL for complex queries, Cassandra for write-heavy GPS data, and Redis for real-time rankings."
