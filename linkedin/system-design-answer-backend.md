# LinkedIn - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design LinkedIn, a professional social network where users build career profiles, connect with colleagues, and discover job opportunities. The core challenge is efficiently managing a social graph at massive scale while computing recommendations like "People You May Know" and job-candidate matching.

## Requirements Clarification

### Functional Requirements
- **Profiles**: Create and edit professional history, skills, education
- **Connections**: Send requests, accept, view 1st/2nd/3rd degree network
- **Feed**: Posts from connections ranked by relevance
- **Jobs**: Companies post listings, users apply, matching algorithm
- **Search**: Find people, companies, and jobs
- **PYMK**: "People You May Know" recommendations

### Non-Functional Requirements
- **Latency**: < 200ms for feed, < 500ms for PYMK
- **Scale**: 900M users, 100B+ connections
- **Availability**: 99.9% uptime
- **Consistency**: Eventual for feed, strong for connection state

### Scale Estimates
- **Daily Active Users**: 300M+
- **New connections/day**: 100M+
- **Job applications/day**: 10M+
- **Profile views/day**: 1B+

## High-Level Architecture

```
+-----------------------------------------------------------+
|                     API Gateway                            |
|              (Rate Limiting, Auth, Routing)                |
+-----------------------------------------------------------+
                            |
        +-------------------+-------------------+
        v                   v                   v
+---------------+   +---------------+   +---------------+
|Profile Service|   | Graph Service |   |  Job Service  |
|               |   |               |   |               |
| - CRUD profile|   | - Connections |   | - Listings    |
| - Skills      |   | - Degrees     |   | - Matching    |
| - Experience  |   | - PYMK        |   | - Applications|
+---------------+   +---------------+   +---------------+
        |                   |                   |
        v                   v                   v
+-----------------------------------------------------------+
|                      Data Layer                            |
+-------------------+-------------------+-------------------+
|   PostgreSQL      |   Valkey/Redis    |   Elasticsearch   |
|   - Users         |   - Connections   |   - Profile search|
|   - Profiles      |   - 2nd degree    |   - Job search    |
|   - Jobs          |   - Sessions      |   - Skill match   |
+-------------------+-------------------+-------------------+
```

## Deep Dives

### 1. Database Schema Design

The PostgreSQL schema is designed for efficient graph queries and professional data modeling:

**Core Tables:**

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (PK), email (unique), password_hash, first_name, last_name, headline, location, industry, connection_count, role, created_at | Primary key on id, unique on email | Denormalized connection_count avoids COUNT queries; role defaults to 'user' |
| **connections** | user_id (FK→users), connected_to (FK→users), connected_at | Composite PK (user_id, connected_to) | CHECK constraint: user_id < connected_to ensures each connection stored once |
| **skills** | id (PK), name (unique) | Primary key on id, unique on name | Normalized skill catalog for standardized matching |
| **user_skills** | user_id (FK→users), skill_id (FK→skills), endorsement_count | Composite PK (user_id, skill_id) | Junction table with endorsement tracking |

**Why CHECK Constraint for Connections?**

The `CHECK (user_id < connected_to)` ensures each bidirectional connection is stored exactly once:
- 50% storage reduction
- No duplicate entries possible
- Consistent queries require checking both directions

**Indexes for Performance:**

| Index | Target Column(s) | Purpose |
|-------|-------------------|---------|
| idx_connections_user | connections(user_id) | Fast lookup of a user's outgoing connections |
| idx_connections_connected | connections(connected_to) | Fast lookup of incoming connections |
| idx_posts_user_created | posts(user_id, created_at DESC) | Feed generation queries |
| idx_jobs_status_created | jobs(status, created_at DESC) | Job search filtering |
| idx_job_applications_user | job_applications(user_id) | User's application history |

### 2. Connection Degree Calculation

**1st Degree** - Direct lookup: query the connections table for all rows where user_id or connected_to matches the target user, then union the results to get the complete set of direct connections.

**2nd Degree** - Friends of friends: first compute the 1st-degree set, then for each connection, find their connections. Exclude the original user and anyone already in the 1st-degree set. Group by candidate and count mutual connections to rank results. Limit to top 1000 candidates ordered by mutual count descending.

**At Scale Problem**: A user with 500 connections, each with 500 connections = 250,000 rows to process.

**Precomputed Approach (Production):**

A nightly batch job computes the 2nd-degree network for each user:

1. Retrieve the user's 1st-degree connections
2. For each friend, retrieve their connections
3. For each candidate (friend-of-friend), skip the original user and anyone already a 1st-degree connection
4. Accumulate a mutual connection count for each candidate in a map
5. Select the top 1,000 candidates by mutual count
6. Store the result in Valkey with a 24-hour TTL under the key `2nd-degree:{userId}`

> "Pre-computing the 2nd-degree set avoids the fan-out problem at read time. A user with 500 connections, each having 500 connections, would require processing 250,000 rows in real-time. By shifting this to a batch job, we keep the API response under 200ms."

### 3. PYMK Scoring Algorithm

Multi-factor scoring for connection recommendations:

The PYMK scoring function computes a weighted score for each candidate by evaluating several signals:

| Signal | Points | Rationale |
|--------|--------|-----------|
| Mutual connections | 10 pts each | Strongest social signal |
| Same current company | 8 pts | Professional proximity |
| Same past company | 5 pts | Shared history |
| Same school | 5 pts | Educational overlap |
| Shared skills | 2 pts each | Professional interest alignment |
| Same industry | 3 pts | Sector relevance |
| Same location | 2 pts | Geographic proximity |

The function retrieves each signal for the (user, candidate) pair, applies the corresponding weight, and returns the cumulative score. These weights are tuned based on A/B testing -- connection accept rates determine the optimal scoring.

**Caching Strategy:**

```
Valkey Structure:
- connections:{userId}         = SET of connection IDs
- pymk:{userId}                = SORTED SET of candidate IDs by score
- mutuals:{userId}:{candidateId} = CACHED count (TTL: 1 hour)
```

### 4. Job-Candidate Matching

Two-sided matching: jobs need candidates, candidates need jobs.

The job-candidate matching function computes a normalized score (0-100) based on five weighted factors:

1. **Required skills match (40% weight)**: Compute the intersection of required job skills and candidate skills, divide by total required skills, and multiply by 40
2. **Experience level (25% weight)**: Start at 25 and subtract 5 for each year of experience gap (floored at 0)
3. **Location compatibility (15% weight)**: Award full 15 points if the job is remote or the candidate is in the same location
4. **Education match (10% weight)**: Award 10 points if the candidate meets the minimum education requirement
5. **Network connection (10% weight)**: Award 10 points if the candidate has a connection at the hiring company (referral potential)

> "The skills weight at 40% dominates because skill-job fit is the strongest predictor of application success. Network connection at 10% may seem low, but it's a binary signal -- the mere existence of a referral path significantly boosts the candidate's visibility."

**Elasticsearch Index for Jobs:**

Jobs are indexed in Elasticsearch with boosted title field (3x), text description, keyword array for required_skills, geo_point for location, integer_range for salary, boolean for remote flag, and date for posted_at. This enables compound queries combining full-text search, geo-distance filtering, salary range matching, and skill-based filtering in a single request.

### 5. Message Queue Architecture

RabbitMQ handles async operations with well-defined delivery semantics:

```
+------------+     +---------------------------------------------+
| API Server |---->|                  RabbitMQ                   |
+------------+     +---------------------------------------------+
                   |  Queues:                                     |
                   |  - pymk.compute (PYMK batch jobs)            |
                   |  - feed.generate (feed building)             |
                   |  - notifications (email/push)                |
                   |  - search.index (Elasticsearch sync)         |
                   |  - jobs.match (candidate matching)           |
                   +---------------------------------------------+
                                        |
                   +--------------------+--------------------+
                   v                    v                    v
            +------------+       +------------+       +------------+
            |PYMK Worker |       |Feed Worker |       |Index Worker|
            +------------+       +------------+       +------------+
```

**Message Schema with Idempotency:**

Each connection event message contains: type (connection.created or connection.removed), userId, connectedUserId, timestamp, and an idempotencyKey (UUID for deduplication).

**Idempotent Processing:**

The message consumer follows a check-then-process pattern:

1. Construct a cache key from the message's idempotency key: `processed:{idempotencyKey}`
2. Check Valkey for this key -- if it exists, the message was already processed, so skip it
3. Process the message (e.g., recalculate PYMK for the affected user)
4. Write the key to Valkey with a 24-hour TTL to prevent reprocessing

### 6. Authentication and Rate Limiting

**Session-Based Auth with Valkey:**

Each session stores: userId, email, role (user/recruiter/admin), permissions array, createdAt, lastAccessedAt, and ipAddress. Sessions have a 7-day TTL with sliding expiration -- each access resets the timer.

**Rate Limiting with Token Bucket:**

| Endpoint Category | Rate Limit | Rationale |
|-------------------|------------|-----------|
| Public (login) | 10 req/min | Mitigate credential stuffing |
| Authenticated reads | 100 req/min | Normal usage |
| Authenticated writes | 30 req/min | Prevent spam |
| Connection requests | 20 req/min | Prevent mass-adding |
| Search | 20 req/min | Protect Elasticsearch |

The rate limiter uses a simple counter in Valkey with a 60-second TTL window. For each request, it increments the counter at key `ratelimit:{category}:{userId}`. On the first request (counter = 1), it sets the expiry to 60 seconds. If the counter exceeds the configured limit for that category, the request is rejected with a 429 response.

### 7. Observability

**Key Prometheus Metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total requests by method, path, status |
| `http_request_duration_seconds` | Histogram | Request latency |
| `pymk_computation_duration_seconds` | Histogram | PYMK batch job time |
| `queue_depth` | Gauge | Messages waiting per queue |
| `cache_hits_total` / `cache_misses_total` | Counter | Valkey cache performance |

**SLIs/SLOs:**

| SLI | Target (SLO) |
|-----|--------------|
| Feed API latency (p99) | < 200ms |
| PYMK API latency (p99) | < 500ms |
| API availability | 99.9% |
| Cache hit ratio | > 80% |

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Graph storage | PostgreSQL + Valkey cache | Neo4j | Simpler ops, 1-2 hop queries efficient |
| PYMK computation | Batch precompute daily | Real-time | Cost efficiency, consistent latency |
| Search | Elasticsearch | PostgreSQL FTS | Better relevance, faceting, geo |
| Skills | Normalized table | JSON array | Queryable, standardized matching |
| Message queue | RabbitMQ | Kafka | Simpler ops for batch jobs |
| Auth | Session + Valkey | JWT | Simpler revocation |
| Connections storage | Single row with CHECK | Two rows per connection | 50% storage reduction |

## Future Enhancements

1. **Real-time PYMK updates**: Hybrid approach with batch base + real-time adjustments for recent connections
2. **ML-based ranking**: Replace weighted scoring with learned models for feed and job matching
3. **Graph database for deep traversals**: Add Neo4j for 3+ hop queries if needed
4. **Event sourcing**: Track all connection events for audit and analytics
5. **Sharding strategy**: Shard by user_id with cross-shard query optimization for mutual connections
