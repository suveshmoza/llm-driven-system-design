# Google Calendar - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design a calendar application that allows users to:
- View their schedule in Month, Week, and Day views
- Create, edit, and delete events
- Detect scheduling conflicts
- Manage multiple calendars

This answer covers the end-to-end architecture, emphasizing the integration between frontend and backend components.

## Requirements Clarification

### Functional Requirements
1. **User authentication** with session management
2. **Three calendar views**: Month (grid), Week (time columns), Day (hourly slots)
3. **Event CRUD** with optimistic UI updates
4. **Conflict detection** displayed as warnings in the UI
5. **Multiple calendars** per user with visibility toggles

### Non-Functional Requirements
1. **Low latency**: View switches < 200ms, event creation < 500ms
2. **Consistency**: No lost events, accurate conflict detection
3. **Responsive UI**: Desktop and tablet layouts
4. **Offline resilience**: Show cached data when offline

### Scale Estimates
- 100K users, avg 50 events/user = 5M events
- Read-heavy: 50:1 read:write ratio
- Peak: 10K reads/sec, 200 writes/sec

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Browser (React Application)                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Views: MonthView | WeekView | DayView                             │  │
│  │  Components: EventModal, CalendarSidebar, DateNavigator            │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  Zustand Store: currentDate, view, events[], calendars[]           │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  API Service: fetch wrapper with auth, error handling              │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │ REST API (JSON)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Express API Server                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Middleware: cors, session, auth, errorHandler                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │  auth.ts       │  │  calendars.ts     │  │  events.ts            │   │
│  │  - login       │  │  - list           │  │  - list (range query) │   │
│  │  - logout      │  │  - create         │  │  - create + conflicts │   │
│  │  - register    │  │  - update         │  │  - update + conflicts │   │
│  │  - me          │  │  - delete         │  │  - delete             │   │
│  └────────────────┘  └──────────────────┘  └───────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Conflict Service: checkConflicts(userId, start, end, excludeId)   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PostgreSQL                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │    users     │  │  calendars   │  │    events    │  │   sessions   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Database Schema

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

CREATE INDEX idx_events_calendar_time ON events(calendar_id, start_time, end_time);
```

### TypeScript Interfaces (Shared Types)

```typescript
// shared/types.ts - Used by both frontend and backend

interface User {
  id: number;
  username: string;
  email: string;
  timezone: string;
}

interface Calendar {
  id: number;
  user_id: number;
  name: string;
  color: string;
  is_primary: boolean;
}

interface CalendarEvent {
  id: number;
  calendar_id: number;
  title: string;
  description?: string;
  location?: string;
  start_time: string;  // ISO 8601
  end_time: string;
  all_day: boolean;
  color?: string;
}

interface Conflict {
  id: number;
  title: string;
  start_time: string;
  end_time: string;
  calendar_name: string;
  color: string;
}

interface EventCreateRequest {
  calendar_id: number;
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  location?: string;
  all_day?: boolean;
}

interface EventCreateResponse {
  event: CalendarEvent;
  conflicts: Conflict[];
}
```

## Deep Dive: API Design

### RESTful Endpoints

```
POST   /api/auth/login        - Create session
POST   /api/auth/logout       - Destroy session
GET    /api/auth/me           - Get current user

GET    /api/calendars         - List user's calendars
POST   /api/calendars         - Create calendar
PUT    /api/calendars/:id     - Update calendar
DELETE /api/calendars/:id     - Delete calendar (cascade events)

GET    /api/events?start=&end= - Get events in date range
POST   /api/events             - Create event (returns conflicts)
PUT    /api/events/:id         - Update event (returns conflicts)
DELETE /api/events/:id         - Delete event
```

### API Integration Pattern

```typescript
// Frontend: services/api.ts
const api = {
  async getEvents(params: { start: string; end: string }): Promise<CalendarEvent[]> {
    const res = await fetch(`/api/events?start=${params.start}&end=${params.end}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new ApiError(res);
    return res.json();
  },

  async createEvent(data: EventCreateRequest): Promise<EventCreateResponse> {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new ApiError(res);
    return res.json();
  },

  async checkConflicts(data: { start: string; end: string; exclude_id?: number }): Promise<Conflict[]> {
    const params = new URLSearchParams({
      start: data.start,
      end: data.end,
      ...(data.exclude_id && { exclude_id: data.exclude_id.toString() }),
    });
    const res = await fetch(`/api/events/conflicts?${params}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new ApiError(res);
    return res.json();
  },
};
```

```typescript
// Backend: routes/events.ts
router.post('/', async (req, res) => {
  const userId = req.session.userId!;
  const { calendar_id, title, start_time, end_time, description, location, all_day } = req.body;

  // Verify calendar ownership
  const calendarResult = await pool.query(
    'SELECT id FROM calendars WHERE id = $1 AND user_id = $2',
    [calendar_id, userId]
  );
  if (calendarResult.rows.length === 0) {
    return res.status(403).json({ error: 'Not authorized to add to this calendar' });
  }

  // Check for conflicts
  const conflicts = await checkConflicts(userId, new Date(start_time), new Date(end_time));

  // Create event regardless of conflicts (non-blocking)
  const eventResult = await pool.query(
    `INSERT INTO events (calendar_id, title, start_time, end_time, description, location, all_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [calendar_id, title, start_time, end_time, description, location, all_day || false]
  );

  res.status(201).json({
    event: eventResult.rows[0],
    conflicts,
  });
});
```

## Deep Dive: Conflict Detection (Full Stack Flow)

### Backend: SQL Query

```sql
SELECT e.id, e.title, e.start_time, e.end_time, c.name as calendar_name, c.color
FROM events e
JOIN calendars c ON e.calendar_id = c.id
WHERE c.user_id = $1
  AND e.id != COALESCE($4, 0)  -- Exclude current event when editing
  AND e.start_time < $3         -- Existing event starts before new ends
  AND e.end_time > $2           -- Existing event ends after new starts
ORDER BY e.start_time;
```

### Frontend: Real-time Conflict Display

```tsx
// components/calendar/EventModal.tsx
function EventModal() {
  const [formData, setFormData] = useState<EventFormData>(initialData);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);

  // Debounced conflict check when times change
  useEffect(() => {
    if (!formData.start_time || !formData.end_time) return;

    const timer = setTimeout(async () => {
      setIsCheckingConflicts(true);
      try {
        const result = await api.checkConflicts({
          start: formData.start_time,
          end: formData.end_time,
          exclude_id: selectedEvent?.id,
        });
        setConflicts(result);
      } catch (err) {
        console.error('Failed to check conflicts:', err);
      } finally {
        setIsCheckingConflicts(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [formData.start_time, formData.end_time]);

  return (
    <div className="modal">
      {/* Form fields */}

      {/* Conflict Warning */}
      {isCheckingConflicts ? (
        <div className="text-gray-500">Checking for conflicts...</div>
      ) : conflicts.length > 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded p-3">
          <div className="flex items-center gap-2 text-amber-800 font-medium">
            <AlertTriangle className="w-4 h-4" />
            {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''} found
          </div>
          <ul className="mt-2 text-sm text-amber-700">
            {conflicts.map(c => (
              <li key={c.id}>
                <strong>{c.title}</strong> ({c.calendar_name})
                <span className="text-amber-600 ml-2">
                  {formatTimeRange(c.start_time, c.end_time)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Submit button - always enabled, conflicts are warnings */}
      <button type="submit">Save Event</button>
    </div>
  );
}
```

## Deep Dive: View State Synchronization

### Frontend State (Zustand)

```typescript
// stores/calendarStore.ts
interface CalendarState {
  currentDate: Date;
  view: 'month' | 'week' | 'day';
  events: CalendarEvent[];
  calendars: Calendar[];
  visibleCalendarIds: Set<number>;
  isLoading: boolean;

  // Actions
  setView: (view: View) => void;
  goToToday: () => void;
  goToPrevious: () => void;
  goToNext: () => void;
  toggleCalendarVisibility: (id: number) => void;
  fetchEvents: () => Promise<void>;

  // Computed
  getViewDateRange: () => { start: Date; end: Date };
  getVisibleEvents: () => CalendarEvent[];
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  // Initial state
  currentDate: new Date(),
  view: 'month',
  events: [],
  calendars: [],
  visibleCalendarIds: new Set(),
  isLoading: false,

  getViewDateRange: () => {
    const { currentDate, view } = get();
    switch (view) {
      case 'month':
        return {
          start: startOfWeek(startOfMonth(currentDate)),
          end: endOfWeek(endOfMonth(currentDate)),
        };
      case 'week':
        return { start: startOfWeek(currentDate), end: endOfWeek(currentDate) };
      case 'day':
        return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
    }
  },

  fetchEvents: async () => {
    const { getViewDateRange } = get();
    const { start, end } = getViewDateRange();

    set({ isLoading: true });
    try {
      const events = await api.getEvents({
        start: start.toISOString(),
        end: end.toISOString(),
      });
      set({ events });
    } finally {
      set({ isLoading: false });
    }
  },

  getVisibleEvents: () => {
    const { events, visibleCalendarIds } = get();
    return events.filter(e => visibleCalendarIds.has(e.calendar_id));
  },
}));
```

### Data Flow: View Change → API Fetch

```tsx
// hooks/useEventSync.ts
function useEventSync() {
  const { currentDate, view, fetchEvents } = useCalendarStore();

  // Refetch when date range changes
  useEffect(() => {
    fetchEvents();
  }, [currentDate, view]);
}

// App.tsx
function App() {
  useEventSync();

  return (
    <div className="flex h-screen">
      <CalendarSidebar />
      <main className="flex-1 flex flex-col">
        <Header />
        <CalendarView />
      </main>
      <EventModal />
    </div>
  );
}
```

## Deep Dive: Calendar View Rendering

### Week View Event Positioning

```typescript
// utils/dateUtils.ts
export function calculateEventPosition(event: CalendarEvent, dayStart: Date) {
  const MINUTES_IN_DAY = 24 * 60;
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);

  const startMinutes = differenceInMinutes(start, dayStart);
  const endMinutes = differenceInMinutes(end, dayStart);

  // Clamp to day boundaries
  const clampedStart = Math.max(0, Math.min(MINUTES_IN_DAY, startMinutes));
  const clampedEnd = Math.max(0, Math.min(MINUTES_IN_DAY, endMinutes));

  return {
    top: (clampedStart / MINUTES_IN_DAY) * 100,
    height: Math.max(2, ((clampedEnd - clampedStart) / MINUTES_IN_DAY) * 100),
  };
}
```

```tsx
// components/calendar/WeekView.tsx
function WeekView() {
  const events = useCalendarStore(state => state.getVisibleEvents());
  const currentDate = useCalendarStore(state => state.currentDate);

  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="flex flex-1">
      {/* Time gutter */}
      <div className="w-16">
        {hours.map(hour => (
          <div key={hour} className="h-[60px] text-xs text-gray-500 text-right pr-2">
            {format(setHours(new Date(), hour), 'h a')}
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div className="flex-1 grid grid-cols-7">
        {days.map(day => {
          const dayEvents = events.filter(e => eventOverlapsDay(e, day));

          return (
            <div key={day.toISOString()} className="relative border-r">
              {/* Hour grid lines */}
              {hours.map(h => (
                <div key={h} className="h-[60px] border-b" />
              ))}

              {/* Events */}
              {dayEvents.map(event => {
                const pos = calculateEventPosition(event, startOfDay(day));
                return (
                  <div
                    key={event.id}
                    className="absolute left-1 right-1 rounded px-1 text-xs text-white overflow-hidden cursor-pointer hover:opacity-90"
                    style={{
                      top: `${pos.top}%`,
                      height: `${pos.height}%`,
                      backgroundColor: event.color || '#3B82F6',
                    }}
                    onClick={() => openEditModal(event)}
                  >
                    <div className="font-medium truncate">{event.title}</div>
                    <div className="opacity-80">
                      {format(new Date(event.start_time), 'h:mm a')}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

## Session Management

### Backend Configuration

```typescript
// Backend: app.ts
import session from 'express-session';
import PgSession from 'connect-pg-simple';

const PgStore = PgSession(session);

app.use(session({
  store: new PgStore({
    pool,
    tableName: 'sessions',
    pruneSessionInterval: 60 * 15,  // Clean expired sessions every 15 min
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));
```

### Frontend Auth State

```typescript
// stores/authStore.ts
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  checkAuth: async () => {
    try {
      const user = await api.getCurrentUser();
      set({ user, isAuthenticated: true });
    } catch {
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (username, password) => {
    const user = await api.login(username, password);
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    await api.logout();
    set({ user: null, isAuthenticated: false });
  },
}));
```

## Optimistic Updates

### Event Creation Flow

```tsx
async function handleCreateEvent(data: EventFormData) {
  const { events } = useCalendarStore.getState();

  // Optimistic: Add event with temporary ID
  const tempId = -Date.now();
  const optimisticEvent: CalendarEvent = {
    id: tempId,
    ...data,
    calendar_id: data.calendar_id,
  };

  useCalendarStore.setState({
    events: [...events, optimisticEvent],
    isModalOpen: false,
  });

  try {
    // Actual API call
    const { event, conflicts } = await api.createEvent(data);

    // Replace optimistic with real event
    useCalendarStore.setState(state => ({
      events: state.events.map(e => e.id === tempId ? event : e),
    }));

    // Show conflict toast if any
    if (conflicts.length > 0) {
      showToast(`Created with ${conflicts.length} conflicts`);
    }
  } catch (err) {
    // Rollback on failure
    useCalendarStore.setState(state => ({
      events: state.events.filter(e => e.id !== tempId),
    }));
    showToast('Failed to create event');
  }
}
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| PostgreSQL sessions | Transactional with user data | Slower than Redis |
| Non-blocking conflicts | Flexible, matches real calendars | Users may miss conflicts |
| Zustand over Context | Less boilerplate, selective updates | Extra dependency |
| Percentage positioning | Responsive, simple math | Overlapping events stack |
| Debounced conflict check | Reduces API calls | 500ms feedback delay |
| Optimistic updates | Instant UI feedback | Rollback complexity |

## Scalability Path

### Current: Single Server

```
Browser → Express (Node.js) → PostgreSQL
```

### Future: Scaled

```
Browser → CDN (static) → Load Balancer → Express (3 nodes) → Read Replicas
                                    ↓
                              Valkey (cache + sessions)
                                    ↓
                              PostgreSQL Primary
```

1. **Move sessions to Valkey**: Enables stateless API servers
2. **Add read replicas**: Scale read-heavy event queries
3. **CDN for frontend**: Offload static assets
4. **Event caching**: Cache frequently accessed date ranges

## Future Enhancements

1. **Recurring Events**: Parse RRULE, expand instances on read
2. **Drag & Drop**: React DnD for moving events
3. **Real-time Sync**: WebSocket for multi-device updates
4. **Event Sharing**: Invite system with RSVP
5. **Offline Support**: Service worker + IndexedDB
