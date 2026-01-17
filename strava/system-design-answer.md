# Strava - Fitness Tracking Platform - System Design Interview Answer

## Introduction (2 minutes)

"Thanks for this problem. I'll be designing a fitness tracking platform like Strava, which records athletic activities, enables social features among athletes, and provides segment-based leaderboards. This combines GPS data processing, social networking, and competitive features. Let me clarify requirements."

---

## 1. Requirements Clarification (5 minutes)

### Functional Requirements

1. **Activity Recording** - Record GPS-based activities (running, cycling, etc.) with metrics
2. **Route Visualization** - Display activities on maps with elevation, pace graphs
3. **Segment Matching** - Detect when activities traverse predefined route segments
4. **Leaderboards** - Rank athletes on segments by time
5. **Social Features** - Follow athletes, activity feed, kudos, comments
6. **Privacy Zones** - Hide activity data near home/work locations

### Non-Functional Requirements

- **Reliability** - Never lose uploaded activity data
- **Latency** - Activity upload and processing under 30 seconds
- **Scalability** - Handle millions of activities uploaded daily
- **Accuracy** - Segment matching must be precise for fair competition

### Out of Scope

"For this discussion, I'll set aside: training plans, paid subscription features, partner integrations (Garmin, Wahoo), and detailed analytics."

---

## 2. Scale Estimation (3 minutes)

### Assumptions
- 100 million registered users
- 10 million weekly active users
- 5 million activities uploaded per day
- Average activity: 1 hour, 3,600 GPS points (1 per second)
- 10 million community-created segments

### Storage Estimates
- GPS point: ~50 bytes (lat, lng, altitude, time, speed, heart_rate)
- Average activity: 3,600 points x 50 bytes = 180 KB
- 5M activities/day x 180 KB = 900 GB/day of GPS data
- **Annual GPS storage**: ~330 TB

### Processing Estimates
- Segment matching: 5M activities x 100 potential segments = 500M comparisons/day
- Feed generation: 10M users x 50 followed athletes = 500M feed entries/day

---

## 3. High-Level Architecture (8 minutes)

```
┌─────────────┐     ┌─────────────┐     ┌───────────────────────────────────┐
│   Mobile    │────▶│   API       │────▶│        Activity Service           │
│    App      │     │   Gateway   │     │   (Upload, Metadata, Privacy)     │
└─────────────┘     └─────────────┘     └─────────────────┬─────────────────┘
                           │                              │
┌─────────────┐            │                    ┌─────────▼─────────┐
│   Web App   │────────────┘                    │    Message Queue  │
│             │                                 │      (Kafka)      │
└─────────────┘                                 └─────────┬─────────┘
                                                          │
                    ┌─────────────────────────────────────┼───────────────────────────┐
                    │                                     │                           │
           ┌────────▼────────┐               ┌────────────▼────────┐      ┌───────────▼────────┐
           │    Segment      │               │      Feed           │      │   Leaderboard      │
           │    Matcher      │               │    Generator        │      │     Service        │
           └────────┬────────┘               └─────────────────────┘      └────────────────────┘
                    │
           ┌────────▼────────┐
           │     Effort      │
           │   Calculator    │
           └─────────────────┘

┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        Data Stores                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ PostgreSQL  │  │  Cassandra  │  │  PostGIS     │  │   Redis     │  │   Object Storage    │ │
│  │ (Users,     │  │  (GPS Data, │  │  (Geo        │  │  (Cache,    │  │   (Activity Files)  │ │
│  │  Segments)  │  │   Efforts)  │  │  Queries)    │  │   Feeds)    │  │                     │ │
│  └─────────────┘  └─────────────┘  └──────────────┘  └─────────────┘  └─────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **Activity Service** - Handles uploads, privacy processing, metadata extraction
2. **Segment Matcher** - Detects segment traversals in activities
3. **Effort Calculator** - Computes times and metrics for matched segments
4. **Leaderboard Service** - Maintains ranked lists of segment efforts
5. **Feed Generator** - Creates personalized activity feeds for users

---

## 4. Data Model (5 minutes)

### Core Entities

```sql
-- Users
CREATE TABLE users (
    id              UUID PRIMARY KEY,
    username        VARCHAR(50) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    profile_photo   VARCHAR(512),
    weight_kg       DECIMAL(5,2),
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Activities
CREATE TABLE activities (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    type            VARCHAR(20) NOT NULL,      -- 'run', 'ride', 'swim', etc.
    name            VARCHAR(255),
    start_time      TIMESTAMP NOT NULL,
    elapsed_time    INTEGER NOT NULL,          -- seconds
    moving_time     INTEGER NOT NULL,
    distance        DECIMAL(12,2),             -- meters
    elevation_gain  DECIMAL(8,2),              -- meters
    calories        INTEGER,
    avg_heart_rate  INTEGER,
    max_heart_rate  INTEGER,
    privacy         VARCHAR(20) DEFAULT 'followers',
    gps_file_url    VARCHAR(512),
    polyline        TEXT,                      -- Encoded polyline for map display
    bounding_box    BOX,                       -- For geo queries
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Segments (user-created routes)
CREATE TABLE segments (
    id              UUID PRIMARY KEY,
    creator_id      UUID NOT NULL,
    name            VARCHAR(255) NOT NULL,
    activity_type   VARCHAR(20) NOT NULL,
    distance        DECIMAL(12,2) NOT NULL,
    elevation_gain  DECIMAL(8,2),
    start_point     GEOGRAPHY(Point, 4326),
    end_point       GEOGRAPHY(Point, 4326),
    polyline        TEXT NOT NULL,
    bounding_box    BOX NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Segment efforts (times on segments)
CREATE TABLE segment_efforts (
    id              UUID PRIMARY KEY,
    segment_id      UUID NOT NULL,
    activity_id     UUID NOT NULL,
    user_id         UUID NOT NULL,
    elapsed_time    INTEGER NOT NULL,          -- seconds
    moving_time     INTEGER NOT NULL,
    start_index     INTEGER,                   -- GPS point index
    end_index       INTEGER,
    pr_rank         INTEGER,                   -- 1, 2, 3 for PRs
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Privacy zones
CREATE TABLE privacy_zones (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    center          GEOGRAPHY(Point, 4326) NOT NULL,
    radius_meters   INTEGER NOT NULL
);
```

### GPS Data in Cassandra

```sql
-- Optimized for write-heavy GPS data
CREATE TABLE gps_points (
    activity_id     UUID,
    point_index     INT,
    timestamp       TIMESTAMP,
    latitude        DOUBLE,
    longitude       DOUBLE,
    altitude        DOUBLE,
    speed           DOUBLE,
    heart_rate      INT,
    cadence         INT,
    power           INT,
    PRIMARY KEY (activity_id, point_index)
) WITH CLUSTERING ORDER BY (point_index ASC);
```

### Leaderboards in Redis

```
# Sorted set for each segment
leaderboard:{segment_id} -> {
    user_id_1: elapsed_time_1,
    user_id_2: elapsed_time_2,
    ...
}

# Personal records per user
pr:{user_id}:{segment_id} -> best_elapsed_time
```

---

## 5. Deep Dive: Activity Upload and Processing (10 minutes)

### Upload Flow

```
Mobile App      API Gateway     Activity         Object          Kafka
   │               │            Service          Storage            │
   │──Upload GPX──▶│              │                │                │
   │               │──Forward────▶│                │                │
   │               │              │──Store file───▶│                │
   │               │              │◀──URL─────────│                │
   │               │              │──Parse GPS────▶│                │
   │               │              │──Apply Privacy─│                │
   │               │              │──Save Activity─│                │
   │               │              │──Publish──────────────────────▶│
   │◀──Activity ID─│◀─────────────│                │                │
```

### Activity Processing Pipeline

```python
async def process_activity_upload(user_id, file_data, file_type):
    # 1. Store raw file
    file_url = await object_storage.upload(file_data)

    # 2. Parse GPS data
    if file_type == 'gpx':
        gps_points = parse_gpx(file_data)
    elif file_type == 'fit':
        gps_points = parse_fit(file_data)

    # 3. Apply privacy zones
    privacy_zones = await db.get_privacy_zones(user_id)
    gps_points = apply_privacy_zones(gps_points, privacy_zones)

    # 4. Calculate metrics
    metrics = calculate_activity_metrics(gps_points)

    # 5. Generate encoded polyline (for efficient map display)
    polyline = encode_polyline(gps_points)

    # 6. Create activity record
    activity = await db.create_activity(
        user_id=user_id,
        gps_file_url=file_url,
        polyline=polyline,
        **metrics
    )

    # 7. Store GPS points in Cassandra
    await cassandra.batch_insert_gps_points(activity.id, gps_points)

    # 8. Publish for async processing
    await kafka.publish('activity.created', {
        'activity_id': activity.id,
        'user_id': user_id,
        'bounding_box': metrics['bounding_box']
    })

    return activity
```

### Privacy Zone Processing

```python
def apply_privacy_zones(gps_points, privacy_zones):
    """Remove GPS points that fall within privacy zones."""
    filtered_points = []
    in_privacy_zone = False

    for point in gps_points:
        inside_any_zone = any(
            haversine_distance(point.lat, point.lng, zone.lat, zone.lng) < zone.radius
            for zone in privacy_zones
        )

        if inside_any_zone:
            if not in_privacy_zone:
                # Entering privacy zone - mark transition
                in_privacy_zone = True
                # Keep last point before entering
                if filtered_points:
                    filtered_points[-1]['privacy_transition'] = True
        else:
            in_privacy_zone = False
            filtered_points.append(point)

    return filtered_points
```

---

## 6. Deep Dive: Segment Matching (8 minutes)

"Segment matching is computationally intensive. We need to find all segments that an activity passes through."

### Two-Phase Matching

```
Phase 1: Coarse Filter (Bounding Box)
┌─────────────────────────────────────────┐
│ Activity Bounding Box                   │
│   ┌───────────┐  ┌────────────────┐    │
│   │ Segment A │  │   Segment B    │    │
│   └───────────┘  └────────────────┘    │
│                         ┌─────────────┐ │
│                         │  Segment C  │ │
│                         └─────────────┘ │
└─────────────────────────────────────────┘

Phase 2: Fine Matching (GPS Point Comparison)
Check if activity GPS points follow segment path closely enough
```

### Coarse Filter with PostGIS

```python
async def find_candidate_segments(activity_bounding_box, activity_type):
    # Find segments whose bounding boxes intersect with activity
    segments = await db.query("""
        SELECT id, polyline, start_point, end_point
        FROM segments
        WHERE activity_type = :type
        AND bounding_box && :bbox
        AND ST_DWithin(start_point, :start_area, 1000)  -- Within 1km of activity start
    """, type=activity_type, bbox=activity_bounding_box,
        start_area=activity_start_point)

    return segments
```

### Fine Matching Algorithm

```python
def match_segment_to_activity(segment_polyline, activity_gps_points):
    """
    Check if activity traverses segment using Frechet distance variant.
    Returns matched effort if successful.
    """
    segment_points = decode_polyline(segment_polyline)
    segment_start = segment_points[0]
    segment_end = segment_points[-1]

    # Find activity points near segment start
    start_candidates = find_points_near(
        activity_gps_points,
        segment_start,
        max_distance=25  # meters
    )

    for start_idx in start_candidates:
        # Try to match segment from this starting point
        match_result = try_match_from_point(
            activity_gps_points[start_idx:],
            segment_points
        )

        if match_result.is_match:
            end_idx = start_idx + match_result.points_used
            return SegmentEffort(
                start_index=start_idx,
                end_index=end_idx,
                elapsed_time=calculate_elapsed_time(
                    activity_gps_points[start_idx:end_idx]
                )
            )

    return None

def try_match_from_point(activity_points, segment_points):
    """
    Match activity points against segment using sliding window.
    Activity must stay within threshold distance of segment.
    """
    DISTANCE_THRESHOLD = 25  # meters
    activity_idx = 0
    segment_idx = 0
    max_deviation = 0

    while segment_idx < len(segment_points) and activity_idx < len(activity_points):
        seg_point = segment_points[segment_idx]
        act_point = activity_points[activity_idx]

        distance = haversine_distance(seg_point, act_point)

        if distance > DISTANCE_THRESHOLD:
            return MatchResult(is_match=False)

        max_deviation = max(max_deviation, distance)

        # Advance pointers based on which is behind
        if should_advance_activity(activity_points, segment_points, activity_idx, segment_idx):
            activity_idx += 1
        else:
            segment_idx += 1

    # Check if we reached segment end
    if segment_idx >= len(segment_points) - 1:
        return MatchResult(is_match=True, points_used=activity_idx)

    return MatchResult(is_match=False)
```

### Segment Matching at Scale

```python
class SegmentMatcher:
    def __init__(self):
        self.segment_cache = {}  # Popular segments cached in memory
        self.segment_index = RTree()  # Spatial index for fast lookup

    async def process_activity(self, activity_id):
        activity = await db.get_activity(activity_id)
        gps_points = await cassandra.get_gps_points(activity_id)

        # Phase 1: Find candidate segments
        candidates = await self.find_candidate_segments(
            activity.bounding_box,
            activity.type
        )

        matched_efforts = []

        # Phase 2: Fine match each candidate
        for segment in candidates:
            effort = match_segment_to_activity(segment.polyline, gps_points)
            if effort:
                effort.segment_id = segment.id
                effort.activity_id = activity_id
                effort.user_id = activity.user_id
                matched_efforts.append(effort)

        # Save efforts and update leaderboards
        for effort in matched_efforts:
            await self.save_effort(effort)
            await self.update_leaderboard(effort)

        return matched_efforts
```

---

## 7. Leaderboard System (4 minutes)

### Leaderboard Updates

```python
async def update_leaderboard(effort):
    segment_id = effort.segment_id
    user_id = effort.user_id
    elapsed_time = effort.elapsed_time

    # Check if this is a personal record
    pr_key = f"pr:{user_id}:{segment_id}"
    current_pr = await redis.get(pr_key)

    if current_pr is None or elapsed_time < int(current_pr):
        # New PR
        await redis.set(pr_key, elapsed_time)

        # Update leaderboard (sorted set, lower time = better)
        lb_key = f"leaderboard:{segment_id}"
        await redis.zadd(lb_key, {user_id: elapsed_time})

        # Determine rank
        rank = await redis.zrank(lb_key, user_id)

        # Mark effort with PR rank if top 3
        if rank < 3:
            await db.update_effort(effort.id, pr_rank=rank + 1)

        # Notify user of PR
        await notify_user(user_id, 'segment_pr', {
            'segment_id': segment_id,
            'rank': rank + 1,
            'time': elapsed_time
        })
```

### Leaderboard Queries

```python
async def get_segment_leaderboard(segment_id, limit=10, filter_type='overall'):
    lb_key = f"leaderboard:{segment_id}"

    if filter_type == 'overall':
        # Overall leaderboard
        results = await redis.zrange(lb_key, 0, limit - 1, withscores=True)
    elif filter_type == 'friends':
        # Get user's following list, intersect with leaderboard
        user_friends = await redis.smembers(f"following:{user_id}")
        # Use ZMSCORE for bulk lookup
        ...
    elif filter_type == 'age_group':
        # Need to join with user data - use database
        ...

    # Enrich with user details
    leaderboard = []
    for user_id, time in results:
        user = await get_cached_user(user_id)
        leaderboard.append({
            'rank': len(leaderboard) + 1,
            'user': user,
            'elapsed_time': int(time),
            'formatted_time': format_duration(int(time))
        })

    return leaderboard
```

---

## 8. Activity Feed (3 minutes)

### Fan-Out on Write

```python
async def generate_feed_entries(activity):
    user_id = activity.user_id

    # Get followers
    followers = await db.get_followers(user_id)

    # Create feed entries for each follower
    for follower_id in followers:
        feed_key = f"feed:{follower_id}"

        # Add to sorted set (score = timestamp)
        await redis.zadd(feed_key, {
            activity.id: activity.start_time.timestamp()
        })

        # Trim to keep last 1000 items
        await redis.zremrangebyrank(feed_key, 0, -1001)
```

### Feed Retrieval

```python
async def get_activity_feed(user_id, before=None, limit=20):
    feed_key = f"feed:{user_id}"

    if before:
        # Pagination
        activity_ids = await redis.zrevrangebyscore(
            feed_key, before, '-inf', start=0, num=limit
        )
    else:
        activity_ids = await redis.zrevrange(feed_key, 0, limit - 1)

    # Batch fetch activities
    activities = await db.get_activities_by_ids(activity_ids)

    # Enrich with user data, kudos counts, comments
    enriched = await enrich_activities(activities, viewer_id=user_id)

    return enriched
```

---

## 9. Trade-offs and Alternatives (3 minutes)

### Trade-off 1: GPS Storage

**Chose**: Cassandra for raw GPS points
**Trade-off**: Excellent write throughput; harder to query for analytics
**Alternative**: TimescaleDB (better querying, but more write overhead)

### Trade-off 2: Segment Matching

**Chose**: Synchronous processing after upload
**Trade-off**: User waits up to 30 seconds; sees segments immediately
**Alternative**: Async processing (faster upload, delayed segment results)

### Trade-off 3: Feed Strategy

**Chose**: Fan-out on write
**Trade-off**: More storage, write amplification; fast reads
**Alternative**: Fan-out on read (less storage, but slow for users following many athletes)

---

## 10. Scalability Considerations (2 minutes)

### Sharding Strategy

- **Activities**: Shard by user_id (keep user's activities together)
- **GPS Points**: Shard by activity_id (keep activity together)
- **Segments**: Shard by geographic region (co-locate nearby segments)

### Caching Strategy

```python
CACHE_TIERS = {
    'hot_segments': TTL(hours=1),      # Most run segments
    'leaderboards': TTL(minutes=5),    # Frequently viewed
    'user_profiles': TTL(minutes=30),  # Profile data
    'activity_details': TTL(hours=24)  # Individual activities
}
```

---

## Summary

"To summarize, I've designed a fitness tracking platform with:

1. **Activity upload pipeline** with privacy zone filtering and metric calculation
2. **Two-phase segment matching** using spatial indexing and GPS point comparison
3. **Redis-based leaderboards** for fast ranking queries
4. **Fan-out on write feeds** for low-latency activity streams
5. **Specialized storage** - PostgreSQL for metadata, Cassandra for GPS data

The key insight is separating the high-volume GPS data storage (Cassandra) from the relational queries (PostgreSQL) while using spatial indexing (PostGIS) to make segment matching tractable."

---

## Questions I'd Expect

**Q: How do you handle users creating fraudulent segments?**
A: We detect anomalies like unrealistic speeds, flag activities uploaded from desktop (vs. real device), and allow community reporting. Extreme outliers require verification.

**Q: What about real-time tracking during activities?**
A: That's a different system - we'd use WebSockets for live location updates, storing waypoints every 5 seconds instead of raw GPS, and a separate "live activity" database for the transient state.

**Q: How accurate is segment matching for cycling vs running?**
A: Cyclists stay on roads and have cleaner GPS, so matching is more reliable. Runners can take shortcuts, so we need looser thresholds and may miss legitimate efforts.
