# Google Calendar - System Design Answer

*45-minute system design interview format*

## Problem Statement

Design a calendar application that allows users to:
- View their schedule in Month, Week, and Day views
- Create, edit, and delete events
- Detect scheduling conflicts
- Manage multiple calendars

## Requirements Clarification

### Functional Requirements
1. User authentication
2. Multiple calendar views (Month, Week, Day)
3. Event CRUD operations
4. Conflict detection when creating/editing events
5. Multiple calendars per user with visibility toggles

### Non-Functional Requirements
1. Low latency for view rendering (< 200ms)
2. Consistent event data across views
3. Support for timezone-aware events
4. Mobile-responsive UI

### Out of Scope
- Recurring events
- Event sharing/invitations
- Real-time sync across devices
- Calendar sharing with other users

## High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Browser)                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   React Frontend                         ││
│  │  ┌───────────┐  ┌──────────┐  ┌─────────┐              ││
│  │  │ MonthView │  │ WeekView │  │ DayView │              ││
│  │  └───────────┘  └──────────┘  └─────────┘              ││
│  │              ↓                                          ││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │           Zustand State Management                   │││
│  │  │   events[], calendars[], currentDate, view          │││
│  │  └─────────────────────────────────────────────────────┘││
│  └──────────────────────────┬──────────────────────────────┘│
└─────────────────────────────┼───────────────────────────────┘
                              │ REST API
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     API Server (Express)                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Routes: /auth, /calendars, /events                      │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Conflict Detection Service                              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────┬───────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                       │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  ┌────────┐ │
│  │  users   │  │  calendars  │  │   events   │  │sessions│ │
│  └──────────┘  └─────────────┘  └────────────┘  └────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Detailed Design

### Data Model

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE calendars (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#3B82F6',
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    calendar_id INTEGER REFERENCES calendars(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    all_day BOOLEAN DEFAULT FALSE,
    color VARCHAR(7),
    recurrence_rule TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Index for efficient range queries
CREATE INDEX idx_events_calendar_time
    ON events(calendar_id, start_time, end_time);
```

### API Design

```
POST   /api/auth/login          - Login user
POST   /api/auth/logout         - Logout user
GET    /api/auth/me             - Get current user

GET    /api/calendars           - List user's calendars
POST   /api/calendars           - Create calendar
PUT    /api/calendars/:id       - Update calendar
DELETE /api/calendars/:id       - Delete calendar

GET    /api/events?start=&end=  - Get events in date range
GET    /api/events/:id          - Get single event
POST   /api/events              - Create event
PUT    /api/events/:id          - Update event
DELETE /api/events/:id          - Delete event
```

### Conflict Detection Algorithm

When creating or updating an event, check for overlaps:

```sql
SELECT e.id, e.title, e.start_time, e.end_time, c.name as calendar_name
FROM events e
JOIN calendars c ON e.calendar_id = c.id
WHERE c.user_id = $1
  AND e.id != COALESCE($4, 0)  -- Exclude current event if editing
  AND e.start_time < $3         -- Existing event starts before new ends
  AND e.end_time > $2           -- Existing event ends after new starts
```

This condition detects all overlap cases:
- Partial overlap (start or end within existing event)
- Complete overlap (new event contains or is contained by existing)

### View Rendering Strategy

**Month View:**
- 7×6 CSS Grid for days
- Fetch events from first visible day to last visible day
- Display max 3 events per day with "+N more" overflow

**Week View:**
- 7 columns for days, 24 rows for hours
- Events positioned absolutely using percentage of day height
- Position calculation: `top = (startMinutes / 1440) * 100%`

**Day View:**
- Single column with 24 hour slots
- Full event details visible
- Same positioning calculation as week view

### State Management

```typescript
interface CalendarState {
  currentDate: Date;
  view: 'month' | 'week' | 'day';
  events: CalendarEvent[];
  calendars: Calendar[];
  visibleCalendarIds: Set<number>;

  // Navigation
  goToToday: () => void;
  goToPrevious: () => void;
  goToNext: () => void;

  // Date range for API queries
  getViewDateRange: () => { start: Date; end: Date };
}
```

## Scalability Considerations

### Database

1. **Indexing**: Composite index on `(calendar_id, start_time, end_time)` for efficient range queries
2. **Partitioning**: Could partition events table by year if data grows large
3. **Read Replicas**: Route read queries to replicas for heavy read workloads

### Caching

1. **Event Cache**: Cache frequently accessed date ranges in Redis/Valkey
2. **Cache Invalidation**: Invalidate on event create/update/delete
3. **User Calendar List**: Cache user's calendars (rarely changes)

### API Optimization

1. **Pagination**: For event lists, though calendar views typically have bounded results
2. **Compression**: Enable gzip for API responses
3. **ETags**: Cache validation for unchanged event data

## Trade-offs

| Decision | Pros | Cons |
|----------|------|------|
| PostgreSQL for sessions | Transactional with user data, simpler infra | Slower than Redis |
| Client-side filtering | Reduces API calls | More data transferred |
| Percentage positioning | Responsive, no DOM measurements | Requires consistent container height |
| Non-blocking conflicts | Flexible for users | May lead to overlapping events |

## Future Enhancements

1. **Recurring Events**: Parse RRULE format for daily/weekly/monthly patterns
2. **Real-time Sync**: WebSocket for multi-device updates
3. **Event Sharing**: Invite system with accept/decline
4. **Timezone Support**: Store in UTC, display in user's timezone
5. **Mobile App**: React Native with shared business logic
