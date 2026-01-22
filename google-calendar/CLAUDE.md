# Google Calendar - CLAUDE.md

## Project Context

This is a full-stack calendar application built as part of a system design learning repository. The focus is on implementing a responsive calendar UI with Month, Week, and Day views, and event conflict detection on the backend.

## Key Learning Goals

1. **Calendar UI Patterns**: Implementing responsive grid layouts for different time views
2. **Date/Time Handling**: Working with timezones, date ranges, and event positioning
3. **Conflict Detection**: Efficient time overlap queries in SQL
4. **State Management**: Managing complex view state with Zustand
5. **Session Auth**: PostgreSQL-backed session management

## Key Challenges Explored

### 1. Event Positioning in Time Grid

Challenge: Positioning events accurately in week/day views based on start/end times.

Solution: Calculate position as percentage of day (1440 minutes):
```typescript
const top = (startMinutes / 1440) * 100
const height = ((endMinutes - startMinutes) / 1440) * 100
```

This approach is responsive and doesn't require DOM measurements.

### 2. Multi-Day Event Display

Challenge: Events can span multiple days and should appear on each day they overlap.

Solution: `eventOverlapsDay` helper checks if an event's time range intersects with a given day:
```typescript
function eventOverlapsDay(start, end, day) {
  return start <= dayEnd && end >= dayStart
}
```

### 3. View Date Range Optimization

Challenge: Only fetch events needed for the current view.

Solution: `getViewDateRange()` returns appropriate date bounds:
- Month view: First visible week to last visible week (includes padding days)
- Week view: Start/end of the week
- Day view: Start/end of the day

### 4. Conflict Detection Query

Challenge: Efficiently find overlapping events in SQL.

Solution: Time range overlap condition:
```sql
WHERE e.start_time < $3 AND e.end_time > $2
```
This single condition catches all four overlap cases.

## Architecture Decisions

### Frontend

1. **Zustand over Context**: Complex interconnected state (view, date, events, modals) benefits from Zustand's simpler API and built-in persistence.

2. **date-fns over native Date**: Comprehensive helpers for date manipulation, immutable operations, tree-shakeable.

3. **Percentage-based positioning**: Events in week/day views use CSS percentages for responsive layouts.

### Backend

1. **PostgreSQL sessions**: Used `connect-pg-simple` instead of Redis for simplicity - one less service to manage.

2. **Non-blocking conflicts**: API returns conflicts but allows event creation. User is warned, not blocked.

3. **Valkey included but not used**: Available in docker-compose for future caching needs.

## Iteration History

### Iteration 1: Initial Implementation
- Created basic project structure with frontend/backend split
- Implemented database schema with users, calendars, events tables
- Built authentication routes with session management
- Created all three calendar views (Month, Week, Day)
- Added event creation/edit modal with conflict detection
- Implemented calendar sidebar with visibility toggles

## File Structure Notes

### Key Frontend Files

- `stores/calendarStore.ts`: Central state for views, events, calendars, modal state
- `utils/dateUtils.ts`: Date manipulation and event positioning calculations
- `components/calendar/MonthView.tsx`: CSS Grid 7×6 layout with event pills
- `components/calendar/WeekView.tsx`: Time grid with absolute event positioning
- `components/calendar/EventModal.tsx`: Form with conflict warning display

### Key Backend Files

- `services/conflictService.ts`: Time overlap detection logic
- `routes/events.ts`: CRUD with conflict checking on create/update
- `db/init.sql`: Schema with CHECK constraint for valid time ranges
- `db/seed.ts`: Demo data with sample events

## Testing Notes

Manual testing workflow:
1. Start docker-compose for PostgreSQL + Valkey
2. Run migrations and seed data
3. Login as alice or bob
4. Navigate between views
5. Create events with overlapping times to test conflict detection
6. Toggle calendar visibility
7. Edit and delete events

## Known Limitations

1. **No recurring events**: RRULE parsing not implemented
2. **No drag & drop**: Can't move events by dragging
3. **Single timezone**: No timezone conversion (uses server time)
4. **No event sharing**: Events belong to one user
5. **Overlapping events in views**: Events at same time appear on top of each other, not side-by-side
