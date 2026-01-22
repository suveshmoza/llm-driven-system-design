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

```sql
-- Users table with denormalized connection count
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  headline VARCHAR(200),
  location VARCHAR(100),
  industry VARCHAR(100),
  connection_count INTEGER DEFAULT 0,
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Connections with CHECK constraint for single storage
CREATE TABLE connections (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  connected_to INTEGER REFERENCES users(id) ON DELETE CASCADE,
  connected_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, connected_to),
  CHECK (user_id < connected_to)
);

-- Normalized skills for matching
CREATE TABLE skills (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE user_skills (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
  endorsement_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, skill_id)
);
```

**Why CHECK Constraint for Connections?**

The `CHECK (user_id < connected_to)` ensures each bidirectional connection is stored exactly once:
- 50% storage reduction
- No duplicate entries possible
- Consistent queries require checking both directions

**Indexes for Performance:**

```sql
-- Connection queries
CREATE INDEX idx_connections_user ON connections(user_id);
CREATE INDEX idx_connections_connected ON connections(connected_to);

-- Feed queries
CREATE INDEX idx_posts_user_created ON posts(user_id, created_at DESC);

-- Job search
CREATE INDEX idx_jobs_status_created ON jobs(status, created_at DESC);
CREATE INDEX idx_job_applications_user ON job_applications(user_id);
```

### 2. Connection Degree Calculation

**1st Degree** - Direct SQL lookup:

```sql
SELECT connected_to FROM connections WHERE user_id = $1
UNION
SELECT user_id FROM connections WHERE connected_to = $1
```

**2nd Degree** - Friends of friends:

```sql
WITH first_degree AS (
  SELECT connected_to AS conn_id FROM connections WHERE user_id = $1
  UNION
  SELECT user_id AS conn_id FROM connections WHERE connected_to = $1
)
SELECT DISTINCT c2.connected_to AS user_id, COUNT(*) as mutual_count
FROM first_degree fd
JOIN connections c2 ON (
  (c2.user_id = fd.conn_id AND c2.connected_to != $1)
  OR (c2.connected_to = fd.conn_id AND c2.user_id != $1)
)
WHERE c2.connected_to NOT IN (SELECT conn_id FROM first_degree)
  AND c2.user_id NOT IN (SELECT conn_id FROM first_degree)
GROUP BY c2.connected_to
ORDER BY mutual_count DESC
LIMIT 1000;
```

**At Scale Problem**: A user with 500 connections, each with 500 connections = 250,000 rows to process.

**Precomputed Approach (Production):**

```javascript
// Nightly batch job computes 2nd-degree for all users
async function computeSecondDegree(userId) {
  const firstDegree = await getConnections(userId);
  const secondDegree = new Map(); // candidateId -> mutual count

  for (const friendId of firstDegree) {
    const friendConnections = await getConnections(friendId);
    for (const candidate of friendConnections) {
      if (candidate === userId) continue;
      if (firstDegree.has(candidate)) continue;
      secondDegree.set(candidate, (secondDegree.get(candidate) || 0) + 1);
    }
  }

  // Store top 1000 with mutual counts in Valkey
  await valkey.set(`2nd-degree:${userId}`, topK(secondDegree, 1000), 'EX', 86400);
}
```

### 3. PYMK Scoring Algorithm

Multi-factor scoring for connection recommendations:

```javascript
async function pymkScore(userId, candidateId) {
  let score = 0;

  // Mutual connections (strongest signal - 10 pts each)
  const mutuals = await getMutualConnections(userId, candidateId);
  score += mutuals.length * 10;

  // Same current company (8 pts)
  if (await sameCurrentCompany(userId, candidateId)) score += 8;

  // Same past company (5 pts)
  if (await samePastCompany(userId, candidateId)) score += 5;

  // Same school (5 pts)
  if (await sameSchool(userId, candidateId)) score += 5;

  // Shared skills (2 pts each)
  const sharedSkills = await getSharedSkills(userId, candidateId);
  score += sharedSkills.length * 2;

  // Same industry (3 pts)
  if (await sameIndustry(userId, candidateId)) score += 3;

  // Same location (2 pts)
  if (await sameLocation(userId, candidateId)) score += 2;

  return score;
}
```

**Weights are tuned based on A/B testing** - connection accept rates determine optimal scoring.

**Caching Strategy:**

```
Valkey Structure:
- connections:{userId}         = SET of connection IDs
- pymk:{userId}                = SORTED SET of candidate IDs by score
- mutuals:{userId}:{candidateId} = CACHED count (TTL: 1 hour)
```

### 4. Job-Candidate Matching

Two-sided matching: jobs need candidates, candidates need jobs.

```javascript
function jobMatchScore(job, candidate) {
  let score = 0;

  // Required skills match (40% weight)
  const requiredSkills = job.requiredSkills;
  const candidateSkills = candidate.skills;
  const skillMatch = intersection(requiredSkills, candidateSkills).length;
  score += (skillMatch / requiredSkills.length) * 40;

  // Experience level (25% weight)
  const expMatch = Math.abs(job.yearsRequired - candidate.yearsExperience);
  score += Math.max(0, 25 - expMatch * 5);

  // Location compatibility (15% weight)
  if (job.remote || sameLocation(job, candidate)) score += 15;

  // Education match (10% weight)
  if (educationMeets(job.education, candidate.education)) score += 10;

  // Network connection - referral potential (10% weight)
  if (await hasConnectionAtCompany(candidate, job.companyId)) score += 10;

  return score;
}
```

**Elasticsearch Mapping for Jobs:**

```json
{
  "mappings": {
    "properties": {
      "title": { "type": "text", "boost": 3 },
      "description": { "type": "text" },
      "required_skills": { "type": "keyword" },
      "location": { "type": "geo_point" },
      "salary_range": { "type": "integer_range" },
      "remote": { "type": "boolean" },
      "posted_at": { "type": "date" }
    }
  }
}
```

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

```typescript
interface ConnectionEvent {
  type: 'connection.created' | 'connection.removed';
  userId: string;
  connectedUserId: string;
  timestamp: string;
  idempotencyKey: string; // UUID for deduplication
}
```

**Idempotent Processing:**

```typescript
async function processMessage(message: ConnectionEvent) {
  const key = `processed:${message.idempotencyKey}`;

  // Check if already processed
  const alreadyProcessed = await valkey.get(key);
  if (alreadyProcessed) return;

  // Process the message
  await recalculatePYMK(message.userId);

  // Mark as processed (24-hour TTL)
  await valkey.setex(key, 86400, 'true');
}
```

### 6. Authentication and Rate Limiting

**Session-Based Auth with Valkey:**

```typescript
interface Session {
  userId: string;
  email: string;
  role: 'user' | 'recruiter' | 'admin';
  permissions: string[];
  createdAt: string;
  lastAccessedAt: string;
  ipAddress: string;
}
// TTL: 7 days with sliding expiration
```

**Rate Limiting with Token Bucket:**

| Endpoint Category | Rate Limit | Rationale |
|-------------------|------------|-----------|
| Public (login) | 10 req/min | Mitigate credential stuffing |
| Authenticated reads | 100 req/min | Normal usage |
| Authenticated writes | 30 req/min | Prevent spam |
| Connection requests | 20 req/min | Prevent mass-adding |
| Search | 20 req/min | Protect Elasticsearch |

```typescript
async function checkRateLimit(userId: string, category: string): Promise<boolean> {
  const key = `ratelimit:${category}:${userId}`;
  const limit = RATE_LIMITS[category];

  const current = await valkey.incr(key);
  if (current === 1) {
    await valkey.expire(key, 60);
  }

  return current <= limit.requestsPerMinute;
}
```

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
