# Google Calendar - Architecture

## System Overview

This is a calendar application that allows users to manage events across multiple calendars with conflict detection. The system supports three views (Month, Week, Day) and provides a responsive UI.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │MonthView  │  │ WeekView  │  │ DayView   │  │  EventModal     │  │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └────────┬────────┘  │
│        │              │              │                  │          │
│  ┌─────┴──────────────┴──────────────┴──────────────────┴────────┐ │
│  │                     Calendar Store (Zustand)                   │ │
│  │  - currentDate, view, events, calendars, visibleCalendarIds   │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
└──────────────────────────────────┼─────────────────────────────────┘
                                   │ REST API
┌──────────────────────────────────┼─────────────────────────────────┐
│                      Backend (Express)                              │
│  ┌───────────────────────────────┴───────────────────────────────┐ │
│  │                         Routes                                 │ │
│  │  /api/auth/*    /api/calendars/*    /api/events/*             │ │
│  └─────┬──────────────────┬────────────────────┬─────────────────┘ │
│        │                  │                    │                   │
│  ┌─────┴──────────────────┴────────────────────┴─────────────────┐ │
│  │                    Conflict Service                            │ │
│  │  checkConflicts(userId, startTime, endTime, excludeId?)       │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                   │                                 │
│  ┌────────────────────────────────┴────────────────────────────┐   │
│  │                     PostgreSQL                               │   │
│  │  users, calendars, events, sessions                         │   │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Components

### Frontend Architecture

#### View Components

1. **MonthView**: CSS Grid 7×6 layout displaying days with event pills
   - Shows up to 3 events per day with "+N more" overflow indicator
   - Clicking a day switches to Day view

2. **WeekView**: 7-column grid with hourly rows (1440px min-height for 60px/hour)
   - Events positioned absolutely using percentage-based top/height
   - Time labels in left gutter

3. **DayView**: Single column with hourly slots
   - Full event details visible
   - Click time slot to create event

#### State Management (Zustand)

```typescript
interface CalendarState {
  // View state
  currentDate: Date
  view: 'month' | 'week' | 'day'

  // Data
  events: CalendarEvent[]
  calendars: Calendar[]
  visibleCalendarIds: Set<number>

  // Modal state
  isModalOpen: boolean
  modalMode: 'create' | 'edit'
  selectedEvent: CalendarEvent | null

  // Actions
  goToToday: () => void
  goToPrevious: () => void
  goToNext: () => void
  openCreateModal: (date?: Date) => void
  getViewDateRange: () => { start: Date; end: Date }
}
```

### Backend Architecture

#### Routes

- **auth.ts**: Login/logout/register with session management
- **calendars.ts**: CRUD for user calendars
- **events.ts**: CRUD for events with conflict detection

#### Conflict Detection

The conflict service checks for overlapping events using a time range query:

```sql
SELECT e.id, e.title, e.start_time, e.end_time, c.name as calendar_name
FROM events e
JOIN calendars c ON e.calendar_id = c.id
WHERE c.user_id = $1
  AND e.id != COALESCE($4, 0)
  AND e.start_time < $3   -- event starts before new event ends
  AND e.end_time > $2     -- event ends after new event starts
```

This detects all four overlap cases:
- New event starts during existing event
- New event ends during existing event
- New event completely contains existing event
- New event is completely within existing event

#### Session Management

Uses `express-session` with `connect-pg-simple` for PostgreSQL-backed sessions:

```typescript
app.use(session({
  store: new PgSession({ pool, tableName: 'sessions' }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true }
}))
```

## Data Models

### Database Schema

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│      users       │     │    calendars     │     │      events      │
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│ id          PK   │────<│ id          PK   │────<│ id          PK   │
│ username         │     │ user_id     FK   │     │ calendar_id FK   │
│ email            │     │ name             │     │ title            │
│ password_hash    │     │ color            │     │ description      │
│ timezone         │     │ is_primary       │     │ location         │
│ created_at       │     │ created_at       │     │ start_time       │
└──────────────────┘     └──────────────────┘     │ end_time         │
                                                   │ all_day          │
                                                   │ color            │
                                                   │ recurrence_rule  │
                                                   │ created_at       │
                                                   │ updated_at       │
                                                   └──────────────────┘
```

### Indexes

```sql
-- Efficient event range queries by calendar
CREATE INDEX idx_events_calendar_time ON events(calendar_id, start_time, end_time);
```

## Design Decisions

### 1. Conflict Detection Strategy

**Decision**: Show conflicts as warnings, don't block event creation

**Rationale**:
- Real-world calendars allow overlapping events (e.g., two meetings at the same time)
- Users should be informed but not blocked
- The system can still query for conflicts on demand

### 2. View Date Range Fetching

**Decision**: Fetch events based on visible date range, not all events

**Implementation**:
```typescript
getViewDateRange: () => {
  const { currentDate, view } = get()
  if (view === 'month') {
    // Include padding days from adjacent months
    return {
      start: startOfWeek(startOfMonth(currentDate)),
      end: endOfWeek(endOfMonth(currentDate))
    }
  }
  // ... week and day views
}
```

**Rationale**: Minimizes data transfer and keeps queries efficient

### 3. Session Storage

**Decision**: PostgreSQL-backed sessions instead of Redis

**Rationale**:
- Simplifies infrastructure (one less service)
- Sessions are transactional with user data
- Good enough for this scale
- Valkey is available for caching if needed later

### 4. Event Positioning in Week/Day Views

**Decision**: Percentage-based positioning calculated client-side

```typescript
function getEventPosition(start: Date, end: Date, dayStart: Date) {
  const startMinutes = (start.getTime() - dayStart.getTime()) / (1000 * 60)
  const endMinutes = (end.getTime() - dayStart.getTime()) / (1000 * 60)

  return {
    top: (startMinutes / 1440) * 100,      // % of day
    height: ((endMinutes - startMinutes) / 1440) * 100
  }
}
```

**Rationale**:
- Pure computation, no DOM measurement needed
- Works with CSS percentage positioning
- Responsive to container size changes

## Future Enhancements

1. **Recurring Events**: Add RRULE support for daily/weekly/monthly recurrence
2. **Event Drag & Drop**: Allow moving events between time slots
3. **Event Resize**: Drag event edges to change duration
4. **Timezone Support**: Display events in user's local timezone
5. **Event Sharing**: Invite other users to events
6. **Calendar Sharing**: Share calendars with read/write permissions
