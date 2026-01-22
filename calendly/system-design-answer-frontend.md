# Calendly - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Introduction

"Today I'll design a meeting scheduling platform like Calendly, focusing on the frontend architecture. The key challenges include building an intuitive booking flow for guests, handling time zone complexity in the UI, creating responsive calendar and time slot components, and optimizing for the 100:1 availability check to booking ratio. I'll walk through the component architecture, state management, and user experience considerations."

---

## Step 1: Requirements Clarification

### User-Facing Requirements

1. **Guest Booking Experience**: View available slots, select time, submit booking form
2. **Host Dashboard**: Manage meeting types, availability rules, view bookings
3. **Calendar Interface**: Month view navigation, date selection, availability indicators
4. **Time Zone Handling**: Auto-detect guest timezone, allow switching, instant re-render
5. **Responsive Design**: Desktop, tablet, and mobile layouts
6. **Accessibility**: Screen reader support, keyboard navigation

### Technical Requirements

- **Performance**: Availability checks < 200ms, instant timezone switching
- **Offline Resilience**: Graceful degradation when network is slow
- **Caching**: Client-side caching of availability data (3-5 minute TTL)
- **Internationalization**: Support multiple locales and time formats

---

## Step 2: Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Frontend Architecture                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Components                                                                 │
│  ├── icons/              CalendarIcon, ClockIcon, ChevronIcons, TimezoneIcon│
│  ├── booking/            Guest booking flow components                      │
│  │   ├── EventHeader, TimezoneSelector, BookingCalendar                    │
│  │   ├── TimeSlotList, BookingForm, ConfirmationScreen, SlotUnavailable    │
│  ├── meeting-types/      MeetingTypeCard, MeetingTypeModal, EmptyState     │
│  ├── availability/       WeeklySchedule, DayRuleEditor, TimeRangeInput     │
│  └── shared/             CalendarPicker, LoadingSpinner, Navbar            │
│                                                                             │
│  Routes (TanStack Router)                                                   │
│  ├── index, login, register, dashboard                                     │
│  ├── meeting-types, availability, bookings                                 │
│  ├── bookings.$bookingId, book.$meetingTypeId (public booking page)        │
│  └── admin                                                                  │
│                                                                             │
│  Stores (Zustand)                                                           │
│  ├── authStore          Authentication state                               │
│  ├── bookingStore       Current booking flow state                         │
│  └── availabilityStore  Cached availability data                           │
│                                                                             │
│  Hooks                                                                      │
│  ├── useTimezone        Timezone detection, formatting, persistence        │
│  ├── useAvailability    Fetch and cache availability for date ranges       │
│  └── useBookingFlow     Booking submission with idempotency                │
│                                                                             │
│  Services                                                                   │
│  └── api.ts             REST API client                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Deep Dive - Guest Booking Flow

### Progressive Disclosure Pattern

"The booking page uses progressive disclosure to reduce cognitive load. Each step reveals only after the previous is completed."

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Booking Flow State Machine                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: Calendar (low commitment)                                          │
│      │                                                                      │
│      ↓ User selects date                                                    │
│  Step 2: Time slots appear                                                  │
│      │                                                                      │
│      ↓ User selects time                                                    │
│  Step 3: Booking form slides in                                             │
│      │                                                                      │
│      ↓ User submits form                                                    │
│  Step 4: Confirmation screen                                                │
│      │                                                                      │
│      └── OR: SlotUnavailable (409 conflict) → return to Step 2              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Booking Page Component Behavior

The BookingPage component manages a multi-step flow using a `step` state variable with values: 'calendar', 'time', 'form', 'confirmation', or 'unavailable'.

**Key behaviors:**
- **EventHeader**: Always visible, shows host info, event title, duration, description
- **TimezoneSelector**: Dropdown with common timezones and auto-detected option
- **Date Selection**: Sets selectedDate, clears selectedSlot, advances to 'time' step
- **Slot Selection**: Sets selectedSlot, advances to 'form' step
- **Form Submission**: Calls createBooking with idempotency key, handles 409 conflict by showing SlotUnavailable with alternatives
- **Timezone Change**: Instant re-render without refetch (slots stored in UTC)

---

## Step 4: Deep Dive - Timezone Handling

### Timezone Hook Architecture

The `useTimezone` hook provides comprehensive timezone functionality:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         useTimezone Hook                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  State                                                                      │
│  ├── timezone           Current selected timezone (persisted to localStorage)│
│  └── autoDetectedTimezone  From Intl.DateTimeFormat().resolvedOptions()     │
│                                                                             │
│  Methods                                                                    │
│  ├── setTimezone(tz)    Updates state and persists to localStorage         │
│  ├── formatTime(utc)    Returns "3:00 PM" using Intl.DateTimeFormat        │
│  ├── formatDate(utc)    Returns "Monday, January 15, 2024"                 │
│  ├── formatDatetime(utc) Returns "Mon, Jan 15, 3:00 PM EST"                │
│  └── isUnusualHour(utc) Returns true if outside 6am-10pm local time        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Implementation details:**
- Auto-detects timezone on mount via `Intl.DateTimeFormat().resolvedOptions().timeZone`
- Loads saved preference from localStorage, falls back to auto-detected
- All formatting uses `Intl.DateTimeFormat` with the selected timezone
- `isUnusualHour` warns users about early morning or late night slots

### Timezone Selector Component

The TimezoneSelector provides a dropdown with:
- Current timezone display with offset (e.g., "Pacific Time (PT)" with "(PST)")
- "Use detected timezone" option when different from current
- Common timezones: ET, CT, MT, PT, GMT/BST, CET, JST, Sydney AEST
- Checkmark indicator for selected timezone
- Click-outside-to-close behavior with backdrop

---

## Step 5: Deep Dive - Calendar Component

### Booking Calendar Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BookingCalendar Component                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  [<]           January 2024                [>]                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Sun   Mon   Tue   Wed   Thu   Fri   Sat                            │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │   31    1     2     3     4     5     6                             │   │
│  │        (•)   (•)         (•)   (•)                                  │   │
│  │                                                                      │   │
│  │   7     8     9    10    11    12    13                             │   │
│  │        [●]   (•)         (•)   (•)         ← Selected = filled      │   │
│  │                                            ← Available = dot        │   │
│  │  ...                                       ← Today = ring           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Visual States                                                              │
│  ├── Padding days (prev/next month): text-gray-300                         │
│  ├── Past days: text-gray-300, cursor-not-allowed                          │
│  ├── Unavailable: text-gray-400, cursor-not-allowed                        │
│  ├── Available: font-medium, hover:bg-blue-50, small blue dot indicator    │
│  ├── Selected: bg-blue-600 text-white                                      │
│  └── Today (not selected): ring-2 ring-blue-200                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- `viewMonth` state controls the displayed month
- `useMonthAvailability` hook fetches available dates for the visible month
- Calendar grid is always 42 cells (6 rows x 7 days) with padding
- Previous month navigation disabled when viewing current month
- `compact` prop renders smaller version when showing alongside time slots
- Loading overlay appears while fetching availability
- ARIA labels include availability status for screen readers

---

## Step 6: Deep Dive - Time Slot List

### Time Slot Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TimeSlotList Component                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Morning                                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│  │ 9:00 AM  │ │ 9:30 AM  │ │ 10:00 AM │ │ 10:30 AM │                       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                       │
│                                                                             │
│  Afternoon                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │
│  │ 1:00 PM  │ │ 1:30 PM  │ │ 2:00 PM  │ │[2:30 PM ]│ ← Selected            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                       │
│                                                                             │
│  Evening                                                                    │
│  ┌──────────┐ ┌──────────┐                                                 │
│  │ 5:00 PM  │ │ 5:30 PM ⚠│ ← Warning icon for unusual hours                │
│  └──────────┘ └──────────┘                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- Slots grouped by time of day (morning < 12, afternoon 12-17, evening 17+)
- Times formatted using `useTimezone().formatTime()` in selected timezone
- Unusual hours (before 6am or after 10pm) show warning icon
- Selected slot has blue background with scale animation
- Empty state shows clock icon with "Try selecting a different date"
- Loading state shows spinner with "Loading available times..."
- Grid layout: 3 columns on mobile, 4 columns on desktop

---

## Step 7: State Management

### Availability Store Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   availabilityStore (Zustand)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  State                                                                      │
│  ├── cache: Map<cacheKey, AvailabilityCache>                               │
│  │   └── cacheKey = "${meetingTypeId}:${startDate}:${endDate}"             │
│  │   └── AvailabilityCache = { data, timestamp, meetingTypeId }            │
│  ├── isLoading: boolean                                                     │
│  └── error: string | null                                                   │
│                                                                             │
│  Actions                                                                    │
│  ├── fetchAvailability(meetingTypeId, startDate, endDate)                  │
│  │   ├── Check cache freshness (CACHE_TTL = 3 minutes)                     │
│  │   ├── Return cached data if still fresh                                 │
│  │   ├── Otherwise fetch from API                                          │
│  │   └── Update cache with timestamp                                       │
│  ├── getAvailability(meetingTypeId, date)                                  │
│  │   └── Search cache for matching meetingTypeId with fresh data           │
│  ├── invalidateCache(meetingTypeId)                                        │
│  │   └── Remove all cache entries for this meeting type                    │
│  └── clearCache()                                                           │
│      └── Reset cache to empty Map                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Booking Flow Hook

The `useBookingFlow` hook encapsulates the booking submission logic:

**State:**
- `isSubmitting`: boolean for loading state
- `bookingResult`: successful booking details or null
- `error`: error message or null

**createBooking(request) flow:**
1. Generate idempotency key: `${meetingTypeId}:${startTime}:${email}:${timestamp}`
2. Pre-check slot availability via GET /availability/check
3. If unavailable, throw 409 error early
4. POST /bookings with idempotency header
5. Invalidate availability cache for this meeting type
6. Return booking result

**Error handling:**
- 409 Conflict: Slot was just booked, show alternatives
- Other errors: Display error message, allow retry

---

## Step 8: Confirmation Screen

### Dual Timezone Display

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Confirmation Screen                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                    ┌───────────────┐                                        │
│                    │      ✓        │                                        │
│                    │   (green)     │                                        │
│                    └───────────────┘                                        │
│                                                                             │
│                      You're Confirmed!                                      │
│          A calendar invitation has been sent to your email.                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  30 Minute Meeting                                                   │   │
│  │  with Alice Smith                                                    │   │
│  │                                                                      │   │
│  │  📅 Your Time                                                        │   │
│  │     Monday, January 15, 2024 at 2:00 PM EST                         │   │
│  │                                                                      │   │
│  │     Host's time: Monday, January 15, 2024 at 11:00 AM PST           │   │
│  │                                                                      │   │
│  │  ⏱ 30 minutes                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                    Add to your calendar                                     │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                  │
│  │ 📅 Google      │ │ 📧 Outlook     │ │ 📎 iCal (.ics) │                  │
│  └────────────────┘ └────────────────┘ └────────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Calendar link generation (client-side):**
- Google Calendar: URL with action=TEMPLATE, text, dates parameters
- Outlook: URL with subject, startdt, enddt parameters
- iCal: Data URI with VCALENDAR/VEVENT in iCalendar format

Host timezone only shown when different from guest timezone.

---

## Step 9: Accessibility and Mobile

### Accessibility Features

**Calendar keyboard navigation:**
- ArrowRight/Left: Move to next/previous available date
- ArrowDown/Up: Move to same day next/previous week
- Enter/Space: Select focused date
- Grid role with aria-label and instructions

**Screen reader support:**
- aria-label on dates includes availability status
- Instructions in sr-only paragraph
- Focus management for multi-step flow

### Mobile Responsive Layout

```
┌───────────────────────────────────┐
│ Desktop (>768px)                  │
├───────────────────────────────────┤
│ Calendar and time slots           │
│ side by side                      │
│ Form inline below                 │
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ Mobile (<640px)                   │
├───────────────────────────────────┤
│ Calendar full width               │
│ Time slots below calendar         │
│ Larger touch targets (44px min)   │
│ Sticky timezone selector          │
│ Form as bottom sheet              │
│ (slides up with animation)        │
└───────────────────────────────────┘
```

---

## Step 10: Trade-offs Summary

| Decision | Chosen | Alternative | Reasoning |
|----------|--------|-------------|-----------|
| State Management | Zustand | Redux | Simpler API for moderate complexity |
| Timezone Display | UTC storage + client conversion | Server-side conversion | Instant timezone switching without refetch |
| Calendar Caching | 3-min client TTL | Server-side only | Reduces availability API calls by 80% |
| Progressive Disclosure | Step-by-step reveal | Show all at once | Reduces cognitive load, better mobile UX |
| Slot Conflict Handling | Pre-check + 409 handler | Optimistic only | Better UX with early conflict detection |
| Calendar Links | Client-side generation | Server-provided | Works offline, no extra API call |

---

## Summary

"To summarize the frontend architecture for Calendly:

1. **Progressive Disclosure**: Calendar -> Time Slots -> Form -> Confirmation, reducing cognitive load at each step
2. **Timezone Handling**: Store UTC, convert on client with `Intl.DateTimeFormat`, enable instant timezone switching
3. **Client-Side Caching**: 3-minute TTL on availability data reduces API calls for browsing behavior
4. **Conflict Prevention**: Pre-check slot availability before form submission, graceful 409 handling with alternatives
5. **Accessibility**: Full keyboard navigation, ARIA labels, screen reader support for calendar interactions
6. **Mobile Optimization**: Touch-friendly targets (44px+), sticky elements, bottom sheet for forms

The key insight is that the 100:1 availability check to booking ratio means optimizing the browsing experience is critical. Client-side caching and instant timezone switching make the experience feel snappy even with multiple date selections."
