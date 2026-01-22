# Google Calendar - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a calendar application that allows users to:
- Switch between Month, Week, and Day views seamlessly
- Create, edit, and delete events with real-time feedback
- Visualize scheduling conflicts
- Navigate dates efficiently

## Requirements Clarification

### Functional Requirements
1. **Three Calendar Views**: Month (grid), Week (time columns), Day (single column)
2. **Event Visualization**: Display events at correct positions based on time
3. **Event CRUD Modal**: Form for creating/editing with conflict warnings
4. **Date Navigation**: Previous/Next/Today buttons, mini calendar picker
5. **Multi-Calendar Support**: Toggle visibility of different calendars

### Non-Functional Requirements
1. **Responsive**: Desktop and tablet layouts
2. **Performance**: View switches < 100ms, smooth scrolling
3. **Accessibility**: Keyboard navigation, screen reader support
4. **Offline Resilience**: Show cached data when offline

### UI/UX Requirements
- Consistent design language across views
- Visual feedback for all interactions
- Conflict events highlighted with warning colors
- Drag-and-drop event repositioning (stretch goal)

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          React Application                               │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        TanStack Router                               ││
│  │    /               → Calendar View (default: Month)                  ││
│  │    /event/:id      → Event Detail Modal (overlay)                   ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐   │
│  │    Sidebar           │  │          Main Calendar Area             │   │
│  │  ┌────────────────┐  │  │  ┌──────────────────────────────────┐  │   │
│  │  │ Mini Calendar  │  │  │  │        View Switcher             │  │   │
│  │  └────────────────┘  │  │  │  [Month] [Week] [Day] | Today ◄► │  │   │
│  │  ┌────────────────┐  │  │  └──────────────────────────────────┘  │   │
│  │  │ Calendar List  │  │  │  ┌──────────────────────────────────┐  │   │
│  │  │ ☑ Work         │  │  │  │                                  │  │   │
│  │  │ ☑ Personal     │  │  │  │    MonthView / WeekView /        │  │   │
│  │  │ ☐ Holidays     │  │  │  │    DayView (conditional)         │  │   │
│  │  └────────────────┘  │  │  │                                  │  │   │
│  └──────────────────────┘  │  └──────────────────────────────────┘  │   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Zustand Store                                    ││
│  │  currentDate | view | events[] | calendars[] | visibleIds | modal   ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: State Management with Zustand

### Store Design

```typescript
// stores/calendarStore.ts
import { create } from 'zustand';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';

interface CalendarState {
  // Navigation state
  currentDate: Date;
  view: 'month' | 'week' | 'day';

  // Data
  events: CalendarEvent[];
  calendars: Calendar[];
  visibleCalendarIds: Set<number>;

  // Modal state
  isModalOpen: boolean;
  modalMode: 'create' | 'edit';
  selectedEvent: CalendarEvent | null;
  conflicts: Conflict[];

  // Actions
  setView: (view: 'month' | 'week' | 'day') => void;
  goToToday: () => void;
  goToPrevious: () => void;
  goToNext: () => void;
  toggleCalendarVisibility: (id: number) => void;
  openCreateModal: (date?: Date) => void;
  openEditModal: (event: CalendarEvent) => void;
  closeModal: () => void;

  // Computed
  getViewDateRange: () => { start: Date; end: Date };
  getVisibleEvents: () => CalendarEvent[];
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  currentDate: new Date(),
  view: 'month',
  events: [],
  calendars: [],
  visibleCalendarIds: new Set(),
  isModalOpen: false,
  modalMode: 'create',
  selectedEvent: null,
  conflicts: [],

  setView: (view) => set({ view }),

  goToToday: () => set({ currentDate: new Date() }),

  goToPrevious: () => {
    const { currentDate, view } = get();
    const newDate = {
      month: () => subMonths(currentDate, 1),
      week: () => subWeeks(currentDate, 1),
      day: () => subDays(currentDate, 1),
    }[view]();
    set({ currentDate: newDate });
  },

  goToNext: () => {
    const { currentDate, view } = get();
    const newDate = {
      month: () => addMonths(currentDate, 1),
      week: () => addWeeks(currentDate, 1),
      day: () => addDays(currentDate, 1),
    }[view]();
    set({ currentDate: newDate });
  },

  getViewDateRange: () => {
    const { currentDate, view } = get();
    switch (view) {
      case 'month':
        // Include visible days from adjacent months
        return {
          start: startOfWeek(startOfMonth(currentDate)),
          end: endOfWeek(endOfMonth(currentDate)),
        };
      case 'week':
        return {
          start: startOfWeek(currentDate),
          end: endOfWeek(currentDate),
        };
      case 'day':
        return {
          start: startOfDay(currentDate),
          end: endOfDay(currentDate),
        };
    }
  },

  getVisibleEvents: () => {
    const { events, visibleCalendarIds } = get();
    return events.filter(e => visibleCalendarIds.has(e.calendar_id));
  },

  // ... modal actions
}));
```

### Why Zustand Over Context?

| Factor | Zustand | React Context |
|--------|---------|---------------|
| Boilerplate | Minimal | Significant |
| Re-renders | Selective via selectors | All consumers |
| Devtools | Built-in | Requires setup |
| Persistence | Plugin available | Manual |
| Testing | Easy to mock | Context wrapper needed |

**Decision**: Zustand reduces boilerplate and provides better performance through selective subscriptions.

## Deep Dive: Calendar View Components

### Month View (CSS Grid)

```tsx
// components/calendar/MonthView.tsx
function MonthView() {
  const { currentDate, getVisibleEvents } = useCalendarStore();
  const events = getVisibleEvents();

  // Generate 6 weeks × 7 days grid
  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="grid grid-cols-7 border-t border-l">
      {/* Header row */}
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
        <div key={day} className="p-2 text-center font-medium border-r border-b">
          {day}
        </div>
      ))}

      {/* Day cells */}
      {days.map(day => (
        <DayCell
          key={day.toISOString()}
          date={day}
          events={getEventsForDay(events, day)}
          isCurrentMonth={isSameMonth(day, currentDate)}
          isToday={isToday(day)}
        />
      ))}
    </div>
  );
}

function DayCell({ date, events, isCurrentMonth, isToday }: DayCellProps) {
  const MAX_VISIBLE = 3;
  const visibleEvents = events.slice(0, MAX_VISIBLE);
  const overflowCount = events.length - MAX_VISIBLE;

  return (
    <div
      className={cn(
        'min-h-[100px] p-1 border-r border-b cursor-pointer hover:bg-gray-50',
        !isCurrentMonth && 'bg-gray-100 text-gray-400',
        isToday && 'bg-blue-50'
      )}
      onClick={() => openCreateModal(date)}
    >
      <div className={cn(
        'text-sm font-medium mb-1',
        isToday && 'bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center'
      )}>
        {format(date, 'd')}
      </div>

      <div className="space-y-1">
        {visibleEvents.map(event => (
          <EventPill key={event.id} event={event} />
        ))}

        {overflowCount > 0 && (
          <button className="text-xs text-blue-600 hover:underline">
            +{overflowCount} more
          </button>
        )}
      </div>
    </div>
  );
}
```

### Week View (Time Grid with Absolute Positioning)

```tsx
// components/calendar/WeekView.tsx
function WeekView() {
  const { currentDate, getVisibleEvents } = useCalendarStore();
  const events = getVisibleEvents();

  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex flex-1 overflow-auto">
      {/* Time gutter */}
      <div className="w-16 flex-shrink-0">
        {hours.map(hour => (
          <div key={hour} className="h-[60px] text-xs text-gray-500 text-right pr-2">
            {format(setHours(new Date(), hour), 'h a')}
          </div>
        ))}
      </div>

      {/* Day columns */}
      <div className="flex-1 grid grid-cols-7">
        {days.map(day => (
          <DayColumn
            key={day.toISOString()}
            date={day}
            events={getEventsForDay(events, day)}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ date, events }: DayColumnProps) {
  const dayStart = startOfDay(date);

  return (
    <div className="relative border-r">
      {/* Hour lines */}
      {Array.from({ length: 24 }, (_, i) => (
        <div key={i} className="h-[60px] border-b border-gray-200" />
      ))}

      {/* Event overlays */}
      {events.map(event => {
        const position = calculateEventPosition(event, dayStart);
        return (
          <div
            key={event.id}
            className="absolute left-1 right-1 rounded px-1 text-xs overflow-hidden"
            style={{
              top: `${position.top}%`,
              height: `${position.height}%`,
              backgroundColor: event.color || '#3B82F6',
              minHeight: '20px',
            }}
          >
            <div className="font-medium truncate text-white">
              {event.title}
            </div>
            <div className="text-white/80 truncate">
              {format(new Date(event.start_time), 'h:mm a')}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### Event Position Calculation

```typescript
// utils/dateUtils.ts
export function calculateEventPosition(
  event: CalendarEvent,
  dayStart: Date
): { top: number; height: number } {
  const MINUTES_IN_DAY = 24 * 60;

  const startMinutes = differenceInMinutes(
    new Date(event.start_time),
    dayStart
  );
  const endMinutes = differenceInMinutes(
    new Date(event.end_time),
    dayStart
  );

  // Clamp to day boundaries
  const clampedStart = Math.max(0, startMinutes);
  const clampedEnd = Math.min(MINUTES_IN_DAY, endMinutes);

  return {
    top: (clampedStart / MINUTES_IN_DAY) * 100,
    height: ((clampedEnd - clampedStart) / MINUTES_IN_DAY) * 100,
  };
}
```

### Why Percentage-Based Positioning?

| Approach | Pros | Cons |
|----------|------|------|
| **Percentage** | Responsive, no measurements | Requires fixed container |
| Pixel-based | Precise control | Needs resize handlers |
| Virtual scrolling | Handles many events | Complex implementation |

**Decision**: Percentage positioning is simpler and responsive. The container height is fixed (24 hours × 60px = 1440px), making percentage calculations reliable.

## Deep Dive: Event Modal with Conflict Detection

### Modal Component

```tsx
// components/calendar/EventModal.tsx
function EventModal() {
  const {
    isModalOpen,
    modalMode,
    selectedEvent,
    conflicts,
    closeModal,
  } = useCalendarStore();

  const [formData, setFormData] = useState<EventFormData>({
    title: '',
    start_time: '',
    end_time: '',
    description: '',
    location: '',
    calendar_id: 0,
    all_day: false,
  });

  // Initialize form when modal opens
  useEffect(() => {
    if (selectedEvent && modalMode === 'edit') {
      setFormData({
        title: selectedEvent.title,
        start_time: formatDateTimeLocal(selectedEvent.start_time),
        end_time: formatDateTimeLocal(selectedEvent.end_time),
        description: selectedEvent.description || '',
        location: selectedEvent.location || '',
        calendar_id: selectedEvent.calendar_id,
        all_day: selectedEvent.all_day,
      });
    }
  }, [selectedEvent, modalMode]);

  // Check conflicts when times change (debounced)
  useEffect(() => {
    if (!formData.start_time || !formData.end_time) return;

    const timer = setTimeout(async () => {
      const conflicts = await api.checkConflicts({
        start_time: formData.start_time,
        end_time: formData.end_time,
        exclude_id: selectedEvent?.id,
      });
      setConflicts(conflicts);
    }, 500);

    return () => clearTimeout(timer);
  }, [formData.start_time, formData.end_time]);

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">
            {modalMode === 'create' ? 'Create Event' : 'Edit Event'}
          </h2>
          <button onClick={closeModal}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <input
            type="text"
            placeholder="Add title"
            value={formData.title}
            onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
            className="w-full text-xl font-medium border-0 border-b-2 focus:border-blue-500 outline-none"
            autoFocus
          />

          {/* Date/Time inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Start</label>
              <input
                type="datetime-local"
                value={formData.start_time}
                onChange={e => setFormData(f => ({ ...f, start_time: e.target.value }))}
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">End</label>
              <input
                type="datetime-local"
                value={formData.end_time}
                onChange={e => setFormData(f => ({ ...f, end_time: e.target.value }))}
                className="w-full p-2 border rounded"
              />
            </div>
          </div>

          {/* Conflict Warning */}
          {conflicts.length > 0 && (
            <ConflictWarning conflicts={conflicts} />
          )}

          {/* Other fields... */}

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### Conflict Warning Component

```tsx
function ConflictWarning({ conflicts }: { conflicts: Conflict[] }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <div className="flex items-center gap-2 text-amber-800 font-medium mb-2">
        <AlertTriangle className="w-4 h-4" />
        Scheduling Conflict
      </div>
      <ul className="text-sm text-amber-700 space-y-1">
        {conflicts.map(conflict => (
          <li key={conflict.id} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: conflict.color }}
            />
            <span className="font-medium">{conflict.title}</span>
            <span className="text-amber-600">
              {formatTimeRange(conflict.start_time, conflict.end_time)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Deep Dive: Date Navigation

### Navigation Controls

```tsx
function DateNavigator() {
  const { currentDate, view, goToToday, goToPrevious, goToNext } = useCalendarStore();

  const getHeaderText = () => {
    switch (view) {
      case 'month':
        return format(currentDate, 'MMMM yyyy');
      case 'week':
        const weekStart = startOfWeek(currentDate);
        const weekEnd = endOfWeek(currentDate);
        return isSameMonth(weekStart, weekEnd)
          ? format(weekStart, 'MMMM yyyy')
          : `${format(weekStart, 'MMM')} - ${format(weekEnd, 'MMM yyyy')}`;
      case 'day':
        return format(currentDate, 'EEEE, MMMM d, yyyy');
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={goToToday}
        className="px-3 py-1 border rounded hover:bg-gray-50"
      >
        Today
      </button>

      <div className="flex items-center">
        <button
          onClick={goToPrevious}
          className="p-1 hover:bg-gray-100 rounded"
          aria-label="Previous"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={goToNext}
          className="p-1 hover:bg-gray-100 rounded"
          aria-label="Next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <h2 className="text-xl font-semibold">
        {getHeaderText()}
      </h2>
    </div>
  );
}
```

### Keyboard Navigation

```tsx
// hooks/useKeyboardNavigation.ts
function useKeyboardNavigation() {
  const { view, goToPrevious, goToNext, goToToday, setView } = useCalendarStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          goToPrevious();
          break;
        case 'ArrowRight':
          goToNext();
          break;
        case 't':
          goToToday();
          break;
        case 'm':
          setView('month');
          break;
        case 'w':
          setView('week');
          break;
        case 'd':
          setView('day');
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
```

## Performance Optimizations

### 1. Event Filtering Memoization

```tsx
// Only recompute when dependencies change
const visibleEvents = useMemo(() => {
  const { start, end } = getViewDateRange();
  return events.filter(event =>
    visibleCalendarIds.has(event.calendar_id) &&
    eventOverlapsRange(event, start, end)
  );
}, [events, visibleCalendarIds, currentDate, view]);
```

### 2. Selective Store Subscriptions

```tsx
// Subscribe only to needed state slices
function ViewSwitcher() {
  // Only re-renders when view changes, not on every state change
  const view = useCalendarStore(state => state.view);
  const setView = useCalendarStore(state => state.setView);

  return (
    <div className="flex rounded-lg border">
      {['month', 'week', 'day'].map(v => (
        <button
          key={v}
          onClick={() => setView(v as View)}
          className={cn(
            'px-4 py-2 capitalize',
            view === v ? 'bg-blue-500 text-white' : 'hover:bg-gray-50'
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
```

### 3. Event Data Fetching Strategy

```tsx
// Fetch events when view date range changes
function useEventSync() {
  const { getViewDateRange } = useCalendarStore();
  const { start, end } = getViewDateRange();

  useEffect(() => {
    const controller = new AbortController();

    api.getEvents({
      start: start.toISOString(),
      end: end.toISOString(),
    }, { signal: controller.signal })
      .then(events => useCalendarStore.setState({ events }))
      .catch(err => {
        if (err.name !== 'AbortError') console.error(err);
      });

    return () => controller.abort();
  }, [start.toISOString(), end.toISOString()]);
}
```

## Accessibility (a11y)

### Semantic Structure

```tsx
<main role="application" aria-label="Calendar">
  <nav aria-label="Calendar navigation">
    {/* Date navigator */}
  </nav>

  <div role="grid" aria-label="Month view">
    <div role="row" aria-label="Days of week">
      {/* Day headers */}
    </div>
    <div role="row">
      <div role="gridcell" aria-label="January 21, 3 events">
        {/* Day cell content */}
      </div>
    </div>
  </div>
</main>
```

### Focus Management

```tsx
// Return focus to trigger after modal closes
function EventModal() {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isModalOpen) {
      triggerRef.current = document.activeElement as HTMLElement;
    } else {
      triggerRef.current?.focus();
    }
  }, [isModalOpen]);

  // Trap focus inside modal
  // ...
}
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand over Context | Less boilerplate, better perf | Additional dependency |
| CSS Grid for Month | Native, responsive | Limited IE support |
| Absolute positioning for events | Simple calculation | Overlapping events stack |
| Debounced conflict check | Reduces API calls | Slight delay in feedback |
| Client-side filtering | Instant visibility toggle | More data in memory |

## Future Frontend Enhancements

1. **Drag & Drop Events**: React DnD for moving events between time slots
2. **Event Resize**: Drag event edges to change duration
3. **Virtual Scrolling**: For views with many events
4. **Offline Support**: Service worker + IndexedDB for offline-first
5. **Mobile Touch Gestures**: Swipe for navigation, long-press for create
