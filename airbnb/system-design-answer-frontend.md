# Airbnb - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

---

## 📋 Problem Statement

Design the frontend architecture for a property rental marketplace like Airbnb.

**Key Frontend Challenges:**
- Complex search interface with maps, filters, and date pickers
- Responsive listing gallery with image optimization
- Interactive calendar components for date selection
- Two-sided user experience (guest and host dashboards)

---

## 🎯 Requirements Clarification

### Functional Requirements

| Feature | Description |
|---------|-------------|
| Search | Location search with map, date pickers, filters |
| Listing View | Photo galleries, amenities, reviews, booking widget |
| Booking Flow | Date selection, guest count, pricing breakdown |
| Host Dashboard | Listing management, calendar, reservations |
| Messaging | Real-time host-guest communication |

### Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Performance | First Contentful Paint < 1.5s |
| Responsiveness | Mobile-first with desktop optimization |
| Accessibility | WCAG 2.1 AA compliance |
| Offline | Service worker for saved listings |

### Scale Estimates

- Monthly visitors: 50M unique
- Peak concurrent users: 200K
- Average session: 8 minutes
- Mobile traffic: 60%

---

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Application                            │
│              TanStack Router + Zustand + TailwindCSS            │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│    Routes     │    │   Components  │    │    Stores     │
│               │    │               │    │               │
│ Search        │    │ SearchBar     │    │ authStore     │
│ Listing       │    │ Calendar      │    │ searchStore   │
│ Host/*        │    │ ListingCard   │    │ bookingStore  │
│ Trips         │    │ BookingWidget │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Services Layer                             │
│              API Client + WebSocket + LocalStorage              │
└─────────────────────────────────────────────────────────────────┘
```

> "I'm choosing a layered architecture where routes define page-level concerns, components handle UI, and stores manage shared state. This separation makes the codebase navigable and testable."

---

## 🔍 Deep Dive: Search Interface

### SearchBar Component Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                         SearchBar                               │
├───────────────┬─────────────┬─────────────┬─────────────┬───────┤
│    Where      │  Check in   │  Check out  │    Who      │  🔍   │
│ destinations  │  Add dates  │  Add dates  │  Add guests │Search │
└───────────────┴─────────────┴─────────────┴─────────────┴───────┘
        │               │             │             │
        ▼               └──────┬──────┘             ▼
┌───────────────┐    ┌─────────────────┐    ┌───────────────┐
│ Location      │    │ Calendar Modal  │    │ Guest Picker  │
│ Autocomplete  │    │ (2-month view)  │    │ (+/- buttons) │
└───────────────┘    └─────────────────┘    └───────────────┘
```

> "Each segment of the search bar opens its own popover. I debounce location searches at 300ms to avoid hammering the API while the user types."

### Search Results Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                        FilterBar                                │
│ [Price ▼] [Property Type ▼] [Bedrooms ▼] [Amenities ▼] [+More]  │
└─────────────────────────────────────────────────────────────────┘
┌────────────────────────────┬────────────────────────────────────┐
│       Listing Grid         │              Map                   │
│         (50%)              │             (50%)                  │
├────────────────────────────┤                                    │
│ ┌──────────┐ ┌──────────┐  │    ┌─────────────────────────┐     │
│ │ Listing  │ │ Listing  │  │    │         $150            │     │
│ │   Card   │ │   Card   │  │    │           •             │     │
│ │  $150/nt │ │  $95/nt  │  │    │      $95    $120        │     │
│ │  ★ 4.8   │ │  ★ 4.2   │  │    │       •      •          │     │
│ └──────────┘ └──────────┘  │    └─────────────────────────┘     │
│                            │                                    │
│     [Load More...]         │    Markers show prices             │
└────────────────────────────┴────────────────────────────────────┘
```

### Map-List Synchronization

```
Hover on ListingCard ──────────────────▶ Highlight map marker
Click on Map Marker  ──────────────────▶ Navigate to listing
Pan/zoom map         ──────────────────▶ Update search bounds
```

> "The split view creates a strong mental model: the list is for comparison, the map is for location context. Synchronizing hover states between them reinforces that they represent the same data."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Split view (list + map) | Both comparison and spatial context | Complex state sync |
| ❌ Map-only with popups | Immersive, spatial-first | Hard to compare properties |
| ❌ List-only | Simple implementation | Lose geographic context |

---

## 📅 Deep Dive: Calendar Component

### Date Range Selection States

```
State 1: No selection
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│  1  │  2  │  3  │  4  │  5  │  6  │  7  │
│  8  │  9  │ 10  │ 11  │ 12  │ 13  │ 14  │
│ 15  │ 16  │ 17  │ 18  │ 19  │ 20  │ 21  │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┘
All dates clickable (except past + blocked)

State 2: Check-in selected (15th)
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│ 15  │ 16  │ 17  │ 18  │ 19  │ 20  │ 21  │
│[██] │     │     │     │     │     │     │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┘
Dark circle on 15th, waiting for checkout

State 3: Range selected (15-20)
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│ 15  │ 16  │ 17  │ 18  │ 19  │ 20  │ 21  │
│[██──│─────│─────│─────│─────│──██]│     │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┘
Dark circles on endpoints, light fill between
```

### Blocked Date Handling

```
Scenario: Days 18-19 are blocked (booked by someone else)

┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│ 15  │ 16  │ 17  │ 18  │ 19  │ 20  │ 21  │
│[██] │     │     │ ╳╳  │ ╳╳  │     │     │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┘
             ▲           ▲
        available    blocked

User tries to click 20:
→ BLOCKED! Range 15-20 contains blocked dates
→ Reset selection, user must pick 15-17 OR 20+
```

> "Calendar state management is trickier than it looks. I track two pieces of local state: which month we're viewing and the tentative start date. The parent component owns the final checkIn/checkOut values."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Custom calendar | Full control, lightweight | More dev effort |
| ❌ react-dates | Battle-tested, accessible | Heavy bundle, styling fights |
| ❌ date-picker library | Fast to implement | Limited customization |

---

## 🛒 Deep Dive: Booking Widget

### Booking Widget Layout

```
┌─────────────────────────────────────────┐
│  $150 /night                    ★ 4.92  │
│                           (127 reviews) │
├─────────────────────────────────────────┤
│ ┌─────────────┬─────────────┐           │
│ │ CHECK-IN    │ CHECKOUT    │           │
│ │ 06/15/2025  │ 06/20/2025  │           │
│ └─────────────┴─────────────┘           │
│ ┌───────────────────────────┐           │
│ │ GUESTS              2 ▼   │           │
│ └───────────────────────────┘           │
├─────────────────────────────────────────┤
│ ┌───────────────────────────────────┐   │
│ │         Reserve                   │   │
│ └───────────────────────────────────┘   │
│         You won't be charged yet        │
├─────────────────────────────────────────┤
│ $150 x 5 nights              $750       │
│ Cleaning fee                  $75       │
│ Service fee                   $98       │
├─────────────────────────────────────────┤
│ Total                        $923       │
└─────────────────────────────────────────┘
```

### Booking Flow State Machine

```
┌─────────────────┐
│ Initial State   │
│ (no dates)      │
└────────┬────────┘
         │ User clicks date picker
         ▼
┌─────────────────┐
│ Selecting Dates │
│ (calendar open) │
└────────┬────────┘
         │ Dates selected
         ▼
┌─────────────────┐
│ Ready to Book   │◄──────────────────┐
│ (show pricing)  │                   │
└────────┬────────┘                   │
         │ Click Reserve              │
         ▼                            │
┌─────────────────┐                   │
│ Check Auth      │                   │
└────────┬────────┘                   │
    ┌────┴────┐                       │
    ▼         ▼                       │
Not logged   Logged in                │
    │         │                       │
    ▼         ▼                       │
┌───────┐  ┌─────────────────┐        │
│Login  │  │ Submit Booking  │        │
│Modal  │  │ API call        │        │
└───┬───┘  └────────┬────────┘        │
    │          ┌────┴────┐            │
    │       Success    Error          │
    │          │         │            │
    │          ▼         └────────────┘
    │    ┌─────────┐
    │    │Redirect │
    │    │to trips │
    │    └─────────┘
    │
    └──▶ Redirect back after login
```

### Instant Book vs Request

```
                    Booking Submission
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────┐
│ instant_book = true │         │ instant_book = false│
├─────────────────────┤         ├─────────────────────┤
│ Button: "Reserve"   │         │ Button: "Request    │
│                     │         │          to book"   │
│ → Confirmed booking │         │ → Pending booking   │
│ → Payment processed │         │ → Host has 24h      │
└─────────────────────┘         └─────────────────────┘
```

> "The booking widget is deceptively complex. It needs to handle auth interruption gracefully—if the user isn't logged in, we store their booking intent, show the login modal, then resume where they left off."

---

## 📷 Deep Dive: Photo Gallery

### Gallery Grid Layout

```
┌─────────────────────────────┬───────────────────────────────────┐
│                             │ ┌───────────────┬───────────────┐ │
│                             │ │   Photo 2     │   Photo 3     │ │
│       Primary Photo         │ │               │               │ │
│           (50%)             │ ├───────────────┼───────────────┤ │
│                             │ │   Photo 4     │   Photo 5     │ │
│                             │ │               │               │ │
└─────────────────────────────┴─┴───────────────┴───────────────┴─┘
                                            ┌───────────────────┐
                                            │ Show all photos   │
                                            └───────────────────┘
```

### Image Loading Strategy

```
Page Load Priority:

1. Primary photo       → loading="eager"  (load immediately)
2. Photos 2-5          → loading="lazy"   (load when visible)
3. Remaining photos    → loaded in lightbox only

Progressive Loading:

1. Show gray placeholder (aspect ratio preserved)
2. Load image in background
3. Fade in when loaded (opacity transition)
```

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Native lazy loading | Simple, good browser support | Less control |
| ❌ Intersection Observer | Fine-grained control | More code, same result |
| ❌ Eager load all | Simpler logic | Terrible performance |

> "Image optimization is critical for Airbnb—listings are sold by their photos. I use srcset for retina displays and server-side resizing to serve appropriately sized images."

---

## 🏠 Deep Dive: Host Calendar Management

### Availability Calendar Editor

```
┌─────────────────────────────────────────────────────────────────┐
│                    Manage Availability                          │
├─────────────────────────────────────┬───────────────────────────┤
│                                     │                           │
│        Calendar View                │     Selection Panel       │
│                                     │                           │
│    ◄ June 2025 ►                    │  3 dates selected         │
│                                     │                           │
│  Su Mo Tu We Th Fr Sa               │  ┌─────────────────────┐  │
│      1  2  3  4  5  6               │  │  Block dates        │  │
│   7  8  9 10 11 12 13               │  └─────────────────────┘  │
│  14 15[██ ██ ██]19 20               │  ┌─────────────────────┐  │
│  21 22 23 24 25 26 27               │  │  Unblock dates      │  │
│  28 29 30                           │  └─────────────────────┘  │
│                                     │                           │
│  Legend:                            │  Custom price:            │
│  [██] Selected                      │  ┌──────────────┬─────┐  │
│  [//] Booked                        │  │ $175         │ Set │  │
│  [XX] Blocked                       │  └──────────────┴─────┘  │
└─────────────────────────────────────┴───────────────────────────┘
```

### Bulk Date Selection Methods

```
1. Click individual dates: Toggle each date
2. Click and drag: Select range
3. Shift-click: Select from last clicked to current
```

> "Hosts need efficient bulk operations. A single shift-click should select a month of blocked dates, not 30 individual clicks. The backend groups consecutive dates into ranges to minimize API payload."

---

## 🗃️ State Management Strategy

### Store Responsibilities

```
┌─────────────────────────────────────────────────────────────────┐
│                        authStore                                │
│  User session, login/logout, profile                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       searchStore                               │
│  Location, dates, guests, filters, results, loading state       │
│  URL sync: filters ↔ query params                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       bookingStore                              │
│  Current listing, selected dates, guest count, pricing          │
│  Cleared when navigating away from listing                      │
└─────────────────────────────────────────────────────────────────┘
```

> "I keep stores focused on specific domains. The search store syncs with URL params so users can share search links. The booking store holds ephemeral state for the current booking attempt."

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Zustand | Minimal boilerplate, hooks-based | Smaller ecosystem |
| ❌ Redux Toolkit | Mature, devtools | More setup, more concepts |
| ❌ React Context | Built-in, no deps | Re-render performance issues |

---

## ⚡ Performance Optimizations

### Image Loading

| Load Stage | Images | Method |
|------------|--------|--------|
| Initial | Primary photo | Eager loading |
| Above fold | Photos 2-5 | Lazy loading |
| Lightbox | All remaining | On-demand |

### Skeleton Loading

```
Loading State:                    Loaded State:

┌──────────────────────┐         ┌──────────────────────┐
│ ████████████████████ │         │ [Actual Image]       │
│ ████████████████████ │  ───▶   │                      │
├──────────────────────┤         ├──────────────────────┤
│ ████████████   ████  │         │ Cozy Apartment ★4.8  │
│ ███████████          │         │ San Francisco        │
│ ████████             │         │ $150 / night         │
└──────────────────────┘         └──────────────────────┘

Gray animated pulse               Actual content fades in
```

### Debouncing

```
Without debounce:                 With debounce (300ms):

User types "S-a-n F-r-a"          User types "S-a-n F-r-a"
      │                                 │
      ▼                                 ▼
7 API calls                       1 API call after 300ms pause
```

> "Every keystroke triggering an API call would overwhelm both the user's network and our servers. A 300ms debounce feels responsive while preventing request spam."

---

## 📈 Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Routing | ✅ TanStack Router | ❌ React Router | Type-safe routes, file-based |
| State | ✅ Zustand | ❌ Redux | Simpler API, less boilerplate |
| Styling | ✅ TailwindCSS | ❌ styled-components | Faster dev, smaller bundle |
| Dates | ✅ date-fns | ❌ Moment.js | Tree-shakeable, smaller |
| Maps | ✅ Mapbox GL | ❌ Google Maps | Better customization, pricing |
| Calendar | ✅ Custom | ❌ react-dates | Full control, lighter weight |

---

## ♿ Accessibility Considerations

| Feature | Implementation |
|---------|----------------|
| Keyboard nav | Arrow keys for calendar, Escape closes modals |
| Focus management | Focus trap in modals, restore on close |
| Screen readers | ARIA labels on interactive elements |
| Color contrast | WCAG AA compliant colors |
| Reduced motion | Respects prefers-reduced-motion |
| Skip links | Skip to main content link |

> "The calendar is particularly tricky for accessibility. Arrow keys should move between days, and we announce selected ranges to screen readers as users navigate."

---

## 🚀 Scaling Considerations

### Client-Side Bottlenecks

| Bottleneck | Solution |
|------------|----------|
| Large search results | Virtual scrolling for 100+ listings |
| Dense map markers | Clustering at low zoom levels |
| Image bandwidth | Responsive images with srcset |
| Memory on mobile | Unload off-screen listing cards |

### Future Enhancements

| Enhancement | Benefit |
|-------------|---------|
| Offline support | Service worker for saved listings |
| Real-time updates | WebSocket for live availability |
| Animation library | Framer Motion for micro-interactions |
| i18n support | Multi-language with react-i18next |

> "With 60% mobile traffic, memory management matters. Virtual scrolling ensures we don't hold hundreds of listing cards in the DOM—only what's visible plus a buffer."
