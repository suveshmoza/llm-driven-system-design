# Ticketmaster - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Introduction (2 minutes)

"Thanks for this challenge. I'll be designing an event ticketing platform like Ticketmaster, with a focus on the frontend experience. The key challenges are building an interactive seat selection map, handling real-time availability updates, creating a stress-free waiting room experience, and managing the countdown-driven checkout flow. Let me clarify requirements."

---

## 1. Requirements Clarification (5 minutes)

### Functional Requirements

1. **Event Discovery** - Browse, search, and filter events by location, date, and artist
2. **Interactive Seat Map** - Visual venue layout with clickable seats showing availability and pricing
3. **Virtual Waiting Room UI** - Queue position display with estimated wait time
4. **Checkout Flow** - Countdown timer, seat summary, payment form
5. **Order Management** - View purchase history, ticket details, and digital tickets

### Non-Functional Requirements

- **Responsiveness**: Seat map must work on mobile devices
- **Performance**: Seat map with 10,000+ seats must render smoothly
- **Real-Time Feel**: Availability updates should feel instant
- **Accessibility**: Full keyboard navigation and screen reader support
- **Resilience**: Handle network issues gracefully during checkout

### Frontend Focus Areas

- Canvas/SVG rendering for large seat maps
- State management for seat selection and availability
- Polling strategies for queue position and seat updates
- Countdown timer with visual urgency indicators
- Optimistic UI updates with conflict resolution
- Mobile-first responsive design

---

## 2. Component Architecture (8 minutes)

### Application Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        Routes                                    │
├─────────────────────────────────────────────────────────────────┤
│  /              → Event Discovery Grid                          │
│  /events/:id    → Seat Map + Selection                          │
│  /queue/:id     → Waiting Room                                  │
│  /checkout      → Timer + Payment                               │
│  /orders        → Order History                                 │
│  /orders/:id    → Digital Ticket                                │
├─────────────────────────────────────────────────────────────────┤
│                       Components                                 │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│   events/    │    seats/    │   queue/     │    checkout/       │
├──────────────┼──────────────┼──────────────┼────────────────────┤
│ EventCard    │ SeatMap      │ QueueStatus  │ CheckoutTimer      │
│ EventFilters │ SeatMapCanvas│ QueueProgress│ SeatSummary        │
│ EventList    │ SeatMapSVG   │ QueueAnimat. │ PaymentForm        │
│              │ SectionView  │              │ OrderConfirmation  │
│              │ SeatTooltip  │              │                    │
│              │ SeatLegend   │              │                    │
├──────────────┴──────────────┴──────────────┴────────────────────┤
│                        Stores                                    │
├─────────────────────────────────────────────────────────────────┤
│ authStore │ eventStore │ seatSelectionStore │ checkoutStore     │
├─────────────────────────────────────────────────────────────────┤
│                        Hooks                                     │
├─────────────────────────────────────────────────────────────────┤
│ useSeatMap │ useQueuePolling │ useCheckoutTimer │ useAvailabil. │
└─────────────────────────────────────────────────────────────────┘
```

### Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Header: Logo | Search | Events | My Tickets | Profile          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     Main Content Area                            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Dynamic Routes                        │    │
│  │                                                          │    │
│  │  /              → Event Discovery Grid                   │    │
│  │  /events/:id    → Seat Map + Selection                   │    │
│  │  /queue/:id     → Waiting Room                           │    │
│  │  /checkout      → Timer + Payment                        │    │
│  │  /orders        → Order History                          │    │
│  │  /orders/:id    → Digital Ticket                         │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Footer: Help | Terms | Privacy                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Deep Dive: Interactive Seat Map (12 minutes)

### Rendering Strategy

For venues with 10,000+ seats, we need efficient rendering:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Seat Map Architecture                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────┐      ┌───────────────┐                       │
│  │ Venue Overview│ ───► │ Section Zoom  │  (zoom level < 2)     │
│  │ (sections)    │      │ (individual   │                       │
│  │               │      │  seats)       │  (zoom level >= 2)    │
│  └───────────────┘      └───────────────┘                       │
│                                                                  │
│  Rendering Modes:                                                │
│  ├── Canvas (default) → Fast, 10K+ seats, custom hit detection  │
│  └── SVG (fallback)   → Accessibility, simpler interaction      │
│                                                                  │
│  Virtual Rendering:                                              │
│  Only render seats visible in viewport based on zoom/pan        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Canvas-Based Rendering

**Key Implementation Details:**
- Canvas 2D context for drawing seats as circles
- Transform matrix for zoom/pan operations
- Hit detection: Calculate clicked seat by inverse transform + distance check
- Color coding by status: available (green), held (yellow), sold (gray), selected (blue)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Seat Color Scheme                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ● Available   #4CAF50 (Green)                                  │
│  ● Held        #FFC107 (Yellow/Amber)                           │
│  ● Sold        #9E9E9E (Gray)                                   │
│  ● Selected    #2196F3 (Blue) with #1565C0 border               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Seat Selection State Management

**Zustand Store Structure:**
- `eventId`: Current event
- `selectedSeats`: Array of seat IDs (max 6)
- `maxSeats`: Limit (typically 6)
- `reservation`: Current reservation object

**Key Actions:**
- `addSeat(seatId)`: Add if under max, show toast if at limit
- `removeSeat(seatId)`: Remove from selection
- `clearSelection()`: Reset all
- `reserveSeats()`: API call to hold seats, returns reservation

### Real-Time Availability Polling

```
┌─────────────────────────────────────────────────────────────────┐
│              Availability Polling Strategy                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Poll Frequency:                                                 │
│  ├── During active sale:  5 seconds                             │
│  └── Normal browsing:     30 seconds                            │
│                                                                  │
│  Flow:                                                           │
│  ┌─────────┐    ┌─────────────┐    ┌──────────────────┐        │
│  │ Mount   │───►│ Fetch       │───►│ Update State     │        │
│  │         │    │ Availability│    │ setAvailability()│        │
│  └─────────┘    └─────────────┘    └──────────────────┘        │
│       ▲                                     │                    │
│       └────────── setInterval ◄─────────────┘                   │
│                                                                  │
│  Cleanup: Clear interval on unmount                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Optimistic Selection with Conflict Resolution

**Flow:**
1. User clicks seat → Optimistic add to selection
2. API call to verify availability
3. If unavailable: Remove from selection, show toast "Sorry, this seat was just taken"
4. Refresh availability map

---

## 4. Deep Dive: Virtual Waiting Room UI (8 minutes)

### Waiting Room Page

```
┌─────────────────────────────────────────────────────────────────┐
│              Waiting Room Layout                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Background: gradient purple-900 to indigo-900                   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │           ┌────────────────────┐                        │    │
│  │           │   🎫 (animated)    │  ← Spinning ring       │    │
│  │           │   Pulsing icon     │    + pulsing center    │    │
│  │           └────────────────────┘                        │    │
│  │                                                          │    │
│  │              You're in the Queue                         │    │
│  │                                                          │    │
│  │                   1,234                                  │    │
│  │             people ahead of you                          │    │
│  │                                                          │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │  Estimated wait: About 5 minutes                  │   │    │
│  │  │  ███████████████████░░░░░░░░░░░░░░░░░░           │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  │                                                          │    │
│  │          Don't refresh this page.                        │    │
│  │       We'll let you in automatically.                    │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Queue Position Display

**Animated Counter:**
- Current position animates down smoothly (50ms per step)
- Uses `tabular-nums` for stable width during animation
- Large, bold typography (text-6xl)

### Estimated Wait Time

**Time Formatting:**
- < 60 seconds: "Less than a minute"
- 1 minute: "About 1 minute"
- < 60 minutes: "About X minutes"
- >= 60 minutes: "About Xh Ym"

**Progress Bar:**
- Visual representation of queue progress
- Width based on position (minimum 5%)

### Queue Polling Hook

**States:**
- `loading`: Initial join
- `queued`: In queue, polling for updates
- `active`: Admitted, redirect to seat selection
- `error`: Something went wrong

**Polling:**
- Poll every 3 seconds for position updates
- Auto-redirect when status becomes "active"
- Toast notification: "You're in! Redirecting to seat selection..."

---

## 5. Deep Dive: Checkout with Countdown Timer (8 minutes)

### Checkout Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                    Checkout Layout                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ⏱️ Complete your purchase within:           8:45         │    │
│  │ (Sticky at top, blue or red when urgent)                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────┐  ┌───────────────────────────────┐   │
│  │                      │  │                                │   │
│  │    Seat Summary      │  │        Payment Form            │   │
│  │                      │  │                                │   │
│  │  Section A, Row 5    │  │  Card Number                   │   │
│  │  Seats: 12, 13, 14   │  │  ┌───────────────────────────┐ │   │
│  │                      │  │  │ 1234 5678 9012 3456       │ │   │
│  │  ──────────────────  │  │  └───────────────────────────┘ │   │
│  │                      │  │                                │   │
│  │    Price Summary     │  │  Expiry        CVC             │   │
│  │                      │  │  ┌─────────┐   ┌─────────┐    │   │
│  │  Tickets: $150.00    │  │  │ MM/YY   │   │ 123     │    │   │
│  │  Fees:     $25.00    │  │  └─────────┘   └─────────┘    │   │
│  │  ──────────────────  │  │                                │   │
│  │  Total:   $175.00    │  │  ┌───────────────────────────┐ │   │
│  │                      │  │  │      Pay $175.00          │ │   │
│  │                      │  │  └───────────────────────────┘ │   │
│  │                      │  │                                │   │
│  └──────────────────────┘  └───────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Countdown Timer Component

**Visual States:**
- Normal (> 2 min): Blue background, blue text
- Urgent (< 2 min): Red background, red text, pulsing animation

**Time Format:**
- Display as `M:SS` (e.g., "8:45")
- Use `tabular-nums` for stable width

### Checkout Timer Hook

**Logic:**
- Calculate remaining seconds from `expiresAt` timestamp
- Update every second via `setInterval`
- Return: `timeRemaining`, `isExpired`, `isUrgent`
- Clear interval when expired or unmounted

### Payment Form with Validation

**Input Formatting:**
- Card number: Auto-format as "1234 5678 9012 3456"
- Expiry: Auto-format as "MM/YY"
- CVC: Limit to 3-4 digits

**Validation:**
- Card: Must be 16 digits
- Expiry: Valid month (01-12), not expired
- CVC: 3-4 digits

**Error Display:**
- Inline error messages below each field
- Red border on invalid fields

---

## 6. Mobile Responsive Design (4 minutes)

### Seat Map on Mobile

```
┌─────────────────────────────────────────────────────────────────┐
│              Mobile Seat Selection Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Step 1: Section Overview (grid of sections)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │ Section A│ │ Section B│ │ Section C│                        │
│  │ 45 avail │ │ 23 avail │ │ SOLD OUT │                        │
│  │ from $50 │ │ from $75 │ │          │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
│       ↓ tap                                                      │
│                                                                  │
│  Step 2: Section Detail (pinch-zoom, pan)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ← Back                                                   │    │
│  │                                                          │    │
│  │     ● ● ● ● ● ● ● ● ● ●  (individual seats)              │    │
│  │     ● ● ● ● ● ● ● ● ● ●                                  │    │
│  │     ● ● ● ● ● ● ● ● ● ●                                  │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Responsive Breakpoints

**Tailwind Classes:**
- Seat map: `h-[400px] md:h-[500px] lg:h-[600px]`
- Checkout: `grid grid-cols-1 lg:grid-cols-2 gap-4`
- Timer: `fixed bottom-0 left-0 right-0 lg:static lg:sticky lg:top-0`
- Touch targets: `min-w-[44px] min-h-[44px]` (Apple HIG)

---

## 7. Accessibility (3 minutes)

### Keyboard Navigation for Seat Map

**Implementation:**
- Single `tabIndex={0}` on map container with `role="application"`
- Arrow keys navigate between available seats
- Enter/Space to select/deselect
- Screen reader summary: "{N} seats available. Use arrow keys to navigate, Enter to select."

**Focus Indicator:**
- Visible focus ring on currently focused seat
- Canvas renders focus indicator during paint

### Queue Announcements

**Screen Reader Updates:**
- Announce position changes via `aria-live="polite"`
- Only announce when position decreases (progress)
- Message: "Queue position updated. {N} people ahead of you."

---

## 8. Error Handling and Edge Cases (2 minutes)

### Reservation Expired State

```
┌─────────────────────────────────────────────────────────────────┐
│              Reservation Expired Screen                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                       ⏰ (gray icon)                             │
│                                                                  │
│                       Time's Up                                  │
│                                                                  │
│           Your seat reservation has expired.                     │
│     The seats have been released for other customers.            │
│                                                                  │
│                    ┌──────────────┐                             │
│                    │  Start Over  │                             │
│                    └──────────────┘                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Network Error Recovery

**Error Boundary Features:**
- Catch payment errors with retry button
- Track retry count
- After 3 retries: "Having trouble? Contact support or try a different payment method."
- Red background styling for error state

---

## Summary

"I've designed a frontend for an event ticketing platform with:

1. **Canvas-based seat map** with virtual rendering for 10,000+ seat venues, zoom/pan controls, and optimistic seat selection
2. **Virtual waiting room UI** with animated queue position, estimated wait time, and automatic admission detection
3. **Countdown-driven checkout** with visual urgency indicators and robust form validation
4. **Mobile-first responsive design** with section drill-down for seat selection on small screens
5. **Full accessibility support** including keyboard navigation for seat maps and screen reader announcements

The key insight is managing user anxiety during high-stakes ticket purchases through clear visual feedback, optimistic updates, and graceful error handling when seats become unavailable."
