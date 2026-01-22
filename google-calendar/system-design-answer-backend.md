# Google Calendar - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a calendar application that allows users to:
- Manage events across multiple calendars
- Detect scheduling conflicts in real-time
- Handle efficient date range queries
- Scale to millions of users

## Requirements Clarification

### Functional Requirements
1. **User Management**: Authentication, session handling, user preferences (timezone)
2. **Calendar CRUD**: Users can create/manage multiple calendars with metadata
3. **Event CRUD**: Create, read, update, delete events with time ranges
4. **Conflict Detection**: Identify overlapping events across all user calendars
5. **Date Range Queries**: Efficiently fetch events for any time window

### Non-Functional Requirements
1. **Low Latency**: Event queries < 50ms at p99
2. **Consistency**: Strong consistency for event operations (no double-booking)
3. **Availability**: 99.9% uptime for read operations
4. **Scalability**: Support 10M+ users with 100+ events each

### Scale Estimates
- 10M users, avg 100 events/user = 1B events
- Avg event size: 500 bytes → 500GB raw data
- Read-heavy: 100:1 read:write ratio
- Peak: 100K reads/sec, 1K writes/sec

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Load Balancer (nginx)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ API Server  │ │ API Server  │ │ API Server  │
            │   (Node)    │ │   (Node)    │ │   (Node)    │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   └───────────────┼───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │    Valkey    │      │  PostgreSQL  │      │  PostgreSQL  │
    │   (Cache +   │      │   Primary    │      │   Replica    │
    │   Sessions)  │      │              │      │              │
    └──────────────┘      └──────────────┘      └──────────────┘
```

## Deep Dive: Data Model Design

### Database Schema

```sql
-- Users table with timezone preference
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calendars support multiple per user
CREATE TABLE calendars (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#3B82F6',
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure only one primary per user
    CONSTRAINT unique_primary_per_user
        UNIQUE (user_id, is_primary) WHERE is_primary = TRUE
);

-- Events with time range validation
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN DEFAULT FALSE,
    color VARCHAR(7),
    recurrence_rule TEXT,  -- iCal RRULE format for future use
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Database-level time validation
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Sessions for authentication (alternative to Redis)
CREATE TABLE sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
```

### Index Strategy

```sql
-- Primary index for date range queries
-- Supports: "Get all events for calendar X between date A and B"
CREATE INDEX idx_events_calendar_time
    ON events(calendar_id, start_time, end_time);

-- Index for conflict detection across all user calendars
-- Supports: "Find overlapping events for user Y"
CREATE INDEX idx_events_user_time
    ON events(calendar_id, start_time, end_time)
    INCLUDE (title);

-- Session cleanup
CREATE INDEX idx_sessions_expire ON sessions(expire);

-- Fast user lookup by email
CREATE INDEX idx_users_email ON users(email);
```

### Why PostgreSQL Over Alternatives?

| Consideration | PostgreSQL | Cassandra | MongoDB |
|---------------|------------|-----------|---------|
| Time range queries | Excellent (B-tree indexes) | Poor (requires partition key) | Good |
| Conflict detection | Excellent (single query) | Poor (requires scatter-gather) | Moderate |
| Transactions | Full ACID | Limited | Limited |
| Schema flexibility | Good (JSONB if needed) | Good | Excellent |
| Operational complexity | Low | High | Moderate |

**Decision**: PostgreSQL is ideal for calendar data because:
1. Time range queries are core to calendar functionality
2. Conflict detection requires cross-record queries
3. Strong consistency prevents double-booking
4. Mature tooling and read replica support

## Deep Dive: Conflict Detection Algorithm

### The Time Overlap Problem

Two events overlap if and only if:
- Event A starts before Event B ends, AND
- Event A ends after Event B starts

```
Case 1: Partial overlap (A starts during B)
    B: |---------|
    A:      |---------|

Case 2: Partial overlap (A ends during B)
    B:      |---------|
    A: |---------|

Case 3: A contains B
    B:    |---|
    A: |---------|

Case 4: B contains A
    B: |---------|
    A:    |---|
```

### SQL Implementation

```sql
-- Find all events that conflict with a proposed time range
SELECT
    e.id,
    e.title,
    e.start_time,
    e.end_time,
    c.name AS calendar_name,
    c.color
FROM events e
JOIN calendars c ON e.calendar_id = c.id
WHERE c.user_id = $1
  AND e.id != COALESCE($4, 0)  -- Exclude self when editing
  AND e.start_time < $3         -- Existing starts before proposed ends
  AND e.end_time > $2           -- Existing ends after proposed starts
ORDER BY e.start_time;
```

### Performance Analysis

With the composite index `(calendar_id, start_time, end_time)`:
- Index range scan on `start_time < $3`
- Filter on `end_time > $2`
- Expected time: O(log N) + O(conflicts)

For a user with 1000 events, worst case scans ~30 index pages.

### Service Layer Implementation

```typescript
// services/conflictService.ts
export async function checkConflicts(
    userId: number,
    startTime: Date,
    endTime: Date,
    excludeEventId?: number
): Promise<Conflict[]> {
    const result = await pool.query(`
        SELECT e.id, e.title, e.start_time, e.end_time, c.name, c.color
        FROM events e
        JOIN calendars c ON e.calendar_id = c.id
        WHERE c.user_id = $1
          AND e.id != COALESCE($4, 0)
          AND e.start_time < $3
          AND e.end_time > $2
        ORDER BY e.start_time
    `, [userId, startTime, endTime, excludeEventId]);

    return result.rows;
}
```

### Design Decision: Non-Blocking Conflicts

**Decision**: Return conflicts as warnings, don't block event creation.

**Rationale**:
- Real calendars allow overlapping events (e.g., "maybe" meetings)
- Users may intentionally create overlapping events
- Better UX to inform than to block

**Alternative considered**: Database constraint preventing overlaps
- Rejected: Too restrictive, complex to implement correctly

## Deep Dive: Session Management

### Architecture Choice

```
┌────────────────┐         ┌────────────────┐
│   API Server   │◄───────►│   PostgreSQL   │
│                │  store   │   (sessions    │
│  express-      │  sessions│    table)      │
│  session       │         │                │
└────────────────┘         └────────────────┘
```

### Why PostgreSQL Over Redis for Sessions?

| Factor | PostgreSQL | Redis/Valkey |
|--------|-----------|--------------|
| Latency | ~5ms | ~1ms |
| Durability | Yes | Optional (AOF) |
| Infrastructure | Already have | Additional service |
| Transactions | With user data | Separate |
| Cost | Lower | Higher |

For this scale (<1K writes/sec), PostgreSQL session storage is acceptable.

### Implementation

```typescript
// Session configuration
import session from 'express-session';
import PgSession from 'connect-pg-simple';

const PgStore = PgSession(session);

app.use(session({
    store: new PgStore({
        pool,
        tableName: 'sessions',
        pruneSessionInterval: 60 * 15  // 15 min cleanup
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));
```

### Session Security Measures

1. **HttpOnly cookies**: Prevents XSS token theft
2. **Secure flag in production**: HTTPS only
3. **SameSite=Lax**: CSRF protection
4. **Session rotation on login**: Prevent fixation attacks
5. **Automatic expiration cleanup**: Prevents table bloat

## API Design

### RESTful Endpoints

```
Authentication:
POST   /api/auth/register     Create new account
POST   /api/auth/login        Authenticate and create session
POST   /api/auth/logout       Destroy session
GET    /api/auth/me           Get current user

Calendars:
GET    /api/calendars         List user's calendars
POST   /api/calendars         Create calendar
PUT    /api/calendars/:id     Update calendar (name, color)
DELETE /api/calendars/:id     Delete calendar and all events

Events:
GET    /api/events?start=&end=  Fetch events in date range
GET    /api/events/:id          Get single event
POST   /api/events              Create event (returns conflicts)
PUT    /api/events/:id          Update event (returns conflicts)
DELETE /api/events/:id          Delete event
```

### Request/Response Examples

**Create Event with Conflict Check**:

```http
POST /api/events
Content-Type: application/json

{
    "calendar_id": 1,
    "title": "Team Standup",
    "start_time": "2025-01-21T09:00:00Z",
    "end_time": "2025-01-21T09:30:00Z",
    "location": "Conference Room A"
}
```

Response (201 Created):
```json
{
    "event": {
        "id": 42,
        "calendar_id": 1,
        "title": "Team Standup",
        "start_time": "2025-01-21T09:00:00Z",
        "end_time": "2025-01-21T09:30:00Z"
    },
    "conflicts": [
        {
            "id": 15,
            "title": "1:1 with Manager",
            "start_time": "2025-01-21T09:00:00Z",
            "end_time": "2025-01-21T09:30:00Z",
            "calendar_name": "Work"
        }
    ]
}
```

## Caching Strategy

### Cache Layers

```
┌──────────────────────────────────────────────────────────┐
│                      Application                          │
│   ┌────────────────────────────────────────────────────┐ │
│   │  Request: GET /api/events?start=X&end=Y            │ │
│   └───────────────────────┬────────────────────────────┘ │
│                           ▼                               │
│   ┌─────────────────────────────────────────────────────┐│
│   │  1. Check Valkey cache: events:{userId}:{range}     ││
│   │     Hit? → Return cached data                        ││
│   │     Miss? → Query PostgreSQL                         ││
│   │           → Store in cache (TTL: 5 min)             ││
│   └─────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### Cache Key Design

```typescript
// Cache key patterns
const CACHE_KEYS = {
    // User's calendars (rarely changes)
    userCalendars: (userId: number) => `calendars:${userId}`,

    // Events for a date range (TTL: 5 min)
    events: (userId: number, start: string, end: string) =>
        `events:${userId}:${start}:${end}`,

    // Single event (for detail views)
    event: (eventId: number) => `event:${eventId}`
};
```

### Cache Invalidation

```typescript
async function invalidateUserEventCache(userId: number) {
    // Pattern-based deletion
    const keys = await valkey.keys(`events:${userId}:*`);
    if (keys.length > 0) {
        await valkey.del(...keys);
    }
}

// Called on event create/update/delete
router.post('/events', async (req, res) => {
    const event = await createEvent(req.body);
    await invalidateUserEventCache(req.session.userId);
    res.json({ event });
});
```

## Scalability Considerations

### Read Scaling

1. **Read Replicas**: Route read queries to replicas
   ```typescript
   const readPool = new Pool({ host: 'pg-replica.internal' });
   const writePool = new Pool({ host: 'pg-primary.internal' });
   ```

2. **Connection Pooling**: PgBouncer for connection management
   ```
   App → PgBouncer → PostgreSQL (with 100s of connections)
   ```

3. **Query Result Caching**: Valkey for frequently accessed date ranges

### Write Scaling

1. **Partitioning by user_id**: Shard events table across databases
   ```sql
   -- Partition by user_id hash
   CREATE TABLE events_p0 PARTITION OF events
       FOR VALUES WITH (MODULUS 4, REMAINDER 0);
   ```

2. **Batch operations**: Allow bulk event creation
   ```sql
   INSERT INTO events (calendar_id, title, start_time, end_time)
   VALUES
       ($1, $2, $3, $4),
       ($5, $6, $7, $8),
       ...
   ON CONFLICT DO NOTHING;
   ```

### Estimated Capacity

| Component | Single Node | Scaled (4x) |
|-----------|-------------|-------------|
| PostgreSQL writes | 1K/sec | 4K/sec |
| PostgreSQL reads | 10K/sec | 40K/sec (replicas) |
| Valkey cache | 100K/sec | 100K/sec |
| API servers | 5K req/sec | 20K req/sec |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| PostgreSQL for sessions | Simpler infra, transactional | Slower than Redis |
| Non-blocking conflicts | Flexible, matches real calendars | May have overlaps |
| Composite index | Fast range queries | Larger index size |
| Per-user event cache | Reduces DB load | Invalidation complexity |
| Sync conflict check | Simple, consistent | Adds latency to writes |

## Future Backend Enhancements

1. **Recurring Events**: Expand RRULE into instances on read
2. **Event Sharing**: Add `event_invites` table with RSVP status
3. **Webhooks**: Notify external systems on event changes
4. **Audit Log**: Track all event modifications for compliance
5. **Rate Limiting**: Per-user quotas on API calls
