# Hotel Booking System - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Opening Statement

"Today I'll design a hotel booking system like Booking.com or Expedia. The core frontend challenges are building a responsive search interface with real-time filtering, implementing an intuitive date-range picker with availability calendar, creating a smooth booking flow with guest details and payment, and managing complex state across search, cart, and user sessions. I'll focus on component architecture, state management with Zustand, and creating an admin dashboard for hotel owners."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Search interface** - Location autocomplete, date picker, guest count, real-time filtering
2. **Hotel browsing** - Card grid with photos, ratings, prices, amenities badges
3. **Hotel detail page** - Photo gallery, room type cards with availability calendar
4. **Booking flow** - Guest details form, price summary, confirmation
5. **User dashboard** - My bookings with status, cancellation, review submission
6. **Admin dashboard** - Hotel management, room types, pricing overrides, booking list

### Non-Functional Requirements

- **Performance**: First Contentful Paint < 1.5s, search results in < 500ms
- **Responsiveness**: Mobile-first design, tablet and desktop breakpoints
- **Accessibility**: WCAG 2.1 AA compliance, keyboard navigation, screen reader support
- **Offline**: Service worker for static assets, graceful degradation

### Frontend Focus Areas

- Component architecture with single responsibility principle
- Zustand stores for auth, search, and booking state
- TanStack Router for type-safe file-based routing
- Tailwind CSS for utility-first responsive design
- Form validation with optimistic UI updates

---

## Step 2: User Interface Design (5 minutes)

### Page Structure

```
/                           -> Home page with search hero
/search                     -> Search results with filters sidebar
/hotels/:hotelId            -> Hotel detail with room types
/hotels/:hotelId/book       -> Booking flow (guest details, payment)
/bookings                   -> User's booking list
/bookings/:bookingId        -> Booking detail with review option
/login                      -> Authentication
/admin                      -> Admin dashboard (hotel selector)
/admin/hotels/:hotelId      -> Hotel management page
```

### Layout Components

```
┌─────────────────────────────────────────────────────────────────┐
│  Header (Logo, Search Bar, User Menu)                          │
├────────────────────────────────┬────────────────────────────────┤
│                                │                                │
│  Filters Sidebar               │  Hotel Cards Grid              │
│  ┌──────────────────┐          │  ┌───────┐  ┌───────┐          │
│  │ Price Range      │          │  │       │  │       │          │
│  │ [==========]     │          │  │ Hotel │  │ Hotel │          │
│  │                  │          │  │ Card  │  │ Card  │          │
│  │ Star Rating      │          │  │       │  │       │          │
│  │ [*][*][*][*][*]  │          │  └───────┘  └───────┘          │
│  │                  │          │  ┌───────┐  ┌───────┐          │
│  │ Amenities        │          │  │       │  │       │          │
│  │ [ ] WiFi         │          │  │ Hotel │  │ Hotel │          │
│  │ [ ] Pool         │          │  │ Card  │  │ Card  │          │
│  │ [ ] Parking      │          │  │       │  │       │          │
│  └──────────────────┘          │  └───────┘  └───────┘          │
│                                │                                │
├────────────────────────────────┴────────────────────────────────┤
│  Footer                                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Component Architecture (10 minutes)

### Component Organization

```
┌─────────────────────────────────────────────────────────────────┐
│                       components/                                │
├─────────────────┬─────────────────┬─────────────────────────────┤
│     admin/      │    booking/     │         hotel/              │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ AdminRoomCard   │ BookingCard     │ HotelCard                   │
│ BookingsTable   │ BookingConfirm  │ HotelGallery                │
│ CreateHotelMod  │ GuestDetailsForm│ RoomTypeCard                │
│ HotelHeader     │ PriceSummary    │ AvailabilityCalendar        │
│ HotelSelector   │                 │                             │
│ PricingModal    │                 │                             │
│ RoomTypeModal   │                 │                             │
│ StatsGrid       │                 │                             │
├─────────────────┴─────────────────┴─────────────────────────────┤
│     search/           │        ui/          │      icons/       │
├───────────────────────┼─────────────────────┼───────────────────┤
│ SearchBar             │ Button              │ StarIcon          │
│ DateRangePicker       │ Modal               │ WifiIcon          │
│ GuestSelector         │ Card                │ ChevronLeftIcon   │
│ FiltersPanel          │ Badge               │ ChevronRightIcon  │
│ LocationAutocomplete  │                     │ MapPinIcon        │
└───────────────────────┴─────────────────────┴───────────────────┘
```

### Core Component: SearchBar

**Purpose**: Main search bar component for hotel search with location, date range, and guest count inputs.

```
┌─────────────────────────────────────────────────────────────────┐
│                         SearchBar                                │
├─────────────────┬─────────────────┬──────────┬──────────────────┤
│  Destination    │  Check-in/out   │  Guests  │     Search       │
│ ┌─────────────┐ │ ┌─────────────┐ │ ┌──────┐ │ ┌──────────────┐ │
│ │ Location    │ │ │ DateRange   │ │ │  2   │ │ │   [Search]   │ │
│ │ Autocomplete│ │ │ Picker      │ │ │      │ │ │              │ │
│ └─────────────┘ │ └─────────────┘ │ └──────┘ │ └──────────────┘ │
└─────────────────┴─────────────────┴──────────┴──────────────────┘
```

**Key behaviors**:
- Validates location before navigation
- Uses Zustand store for persisting search params
- Supports "hero" and "default" variants for styling
- Navigates to `/search` with query parameters

### Core Component: AvailabilityCalendar

**Purpose**: Interactive calendar showing room availability and prices with check-in/check-out date range selection.

```
┌─────────────────────────────────────────────────────────────────┐
│  [<]              February 2025                           [>]   │
├─────────────────────────────────────────────────────────────────┤
│  Sun   Mon   Tue   Wed   Thu   Fri   Sat                        │
├───────┬─────┬─────┬─────┬─────┬─────┬─────┬─────────────────────┤
│       │     │     │     │     │     │  1  │  Each cell shows:   │
│       │     │     │     │     │     │$120 │  - Day number       │
├───────┼─────┼─────┼─────┼─────┼─────┼─────┤  - Price            │
│   2   │  3  │  4  │  5  │  6  │  7  │  8  │  - Selected state   │
│ $120  │$120 │ N/A │$120 │$150 │$180 │$180 │  - In-range state   │
├───────┼─────┼─────┼─────┼─────┼─────┼─────┤                     │
│   9   │ 10  │ 11  │ 12  │ 13  │ 14  │ 15  │  N/A = Unavailable  │
│ $120  │$120 │$120 │$120 │$120 │$150 │$150 │                     │
└───────┴─────┴─────┴─────┴─────┴─────┴─────┴─────────────────────┘
│  Legend: [Selected] [Unavailable]                               │
└─────────────────────────────────────────────────────────────────┘
```

**Key behaviors**:
- Generates days using date-fns utilities
- Handles click for start/end date selection
- Prevents past date and unavailable date selection
- Displays price per day when available
- Highlights selected range

### Core Component: HotelCard

**Purpose**: Display card for a hotel in search results showing image, rating, price, and amenities.

```
┌─────────────────────────────────────┐
│ ┌─────────────────────────────────┐ │
│ │                                 │ │
│ │         Hotel Image             │ │
│ │                                 │ │
│ │                   [From $150]   │ │
│ └─────────────────────────────────┘ │
│ Grand Hotel Plaza          [4.5*]   │
│ [pin] Paris, France                 │
│ [*][*][*][*][ ] 4-star hotel        │
│ [WiFi] [Pool] [Spa] +2 more         │
└─────────────────────────────────────┘
```

**Key behaviors**:
- Links to hotel detail page with search params
- Lazy loads images for performance
- Truncates long names and locations
- Shows up to 4 amenity badges with overflow count

---

## Step 4: State Management with Zustand (8 minutes)

### Store Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Zustand Stores                           │
├─────────────────────┬───────────────────┬───────────────────────┤
│    authStore        │   searchStore     │    bookingStore       │
├─────────────────────┼───────────────────┼───────────────────────┤
│ State:              │ State:            │ State:                │
│ - user              │ - searchParams    │ - hotel               │
│ - isAuthenticated   │ - results         │ - roomType            │
│ - isLoading         │ - isLoading       │ - checkIn/checkOut    │
│                     │ - error           │ - roomCount           │
│ Actions:            │                   │ - guestDetails        │
│ - login()           │ Actions:          │ - step                │
│ - logout()          │ - setSearchParams │ - isProcessing        │
│ - checkAuth()       │ - resetFilters    │ - confirmationNumber  │
│                     │ - setResults      │                       │
│ Middleware:         │ - setLoading      │ Actions:              │
│ - persist           │ - setError        │ - setHotel/RoomType   │
│ (partial: user)     │                   │ - setDates            │
│                     │ Middleware:       │ - setGuestDetails     │
│                     │ - persist         │ - getTotalPrice()     │
│                     │ (partial: prefs)  │ - getNightCount()     │
│                     │                   │ - reset()             │
└─────────────────────┴───────────────────┴───────────────────────┘
```

### Search Store Details

**Default Parameters**:
- location: empty string
- checkIn/checkOut: today + 2 days
- guests: 2, rooms: 1
- priceMin/priceMax: null
- starRating: [], amenities: []

**Persistence Strategy**:
- Only persist location, guests, rooms (user preferences)
- Do not persist results or loading states

### Booking Store Details

**Booking Flow Steps**: select -> details -> payment -> confirmation

**Computed Values**:
- getTotalPrice(): roomType.basePrice * roomCount * nightCount
- getNightCount(): difference in days between checkIn and checkOut

**Reset Behavior**: Clears all state when booking is complete or abandoned

### Auth Store Details

**User Object**:
- id, email, name
- role: 'guest' | 'hotel_admin' | 'system_admin'

**Session Handling**:
- checkAuth() on app mount to restore session
- Persists user to localStorage for quick UI render
- Server validation on protected routes

---

## Step 5: Admin Dashboard Components (8 minutes)

### Admin Hotel Management Page

```
┌─────────────────────────────────────────────────────────────────┐
│  HotelHeader                                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [Image] Grand Hotel Plaza        [Edit Hotel] [Settings]   ││
│  │         Paris, France | 4-star                              ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  StatsGrid                                                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐        │
│  │ Bookings  │ │ Revenue   │ │ Occupancy │ │ Rating    │        │
│  │    127    │ │  $45,230  │ │    78%    │ │   4.5*    │        │
│  │  +12% MTD │ │  +8% MTD  │ │  +5% MTD  │ │  from 89  │        │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘        │
├─────────────────────────────────────────────────────────────────┤
│  Room Types                                    [+ Add Room Type]│
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐    │
│  │ Standard Room   │ │ Deluxe Suite    │ │ Family Room     │    │
│  │ $120/night      │ │ $250/night      │ │ $180/night      │    │
│  │ 15 available    │ │ 8 available     │ │ 10 available    │    │
│  │ [Edit] [Price]  │ │ [Edit] [Price]  │ │ [Edit] [Price]  │    │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  Recent Bookings                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ID     Guest        Room        Check-in    Status         ││
│  │ #1234  John Doe     Deluxe      Feb 15      Confirmed      ││
│  │ #1233  Jane Smith   Standard    Feb 14      Pending        ││
│  │ #1232  Bob Wilson   Family      Feb 13      Checked-in     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Data Loading Pattern**:
- Parallel fetch: hotel, roomTypes, bookings, stats
- Uses Promise.all for optimal loading
- Each section has independent loading state

### Pricing Override Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  Pricing - Deluxe Suite                                    [X]  │
├─────────────────────────────────────────────────────────────────┤
│  Base price: $250/night. Enter custom prices for specific dates │
├─────────────────────────────────────────────────────────────────┤
│  Date              Day      Price         Status                │
├─────────────────────────────────────────────────────────────────┤
│  Feb 14, 2025      Fri      [$350]        Custom                │
│  Feb 15, 2025      Sat      [$350]        Custom                │
│  Feb 16, 2025      Sun      [    ] $250   Base                  │
│  Feb 17, 2025      Mon      [    ] $250   Base                  │
│  ...                                                            │
├─────────────────────────────────────────────────────────────────┤
│                                    [Cancel]  [Save Pricing]     │
└─────────────────────────────────────────────────────────────────┘
```

**Key behaviors**:
- Generates next 90 days for pricing grid
- Loads existing overrides on mount
- Empty input removes override (reverts to base)
- Highlights custom-priced dates
- Batch saves all changes

---

## Step 6: Booking Flow Components (5 minutes)

### Guest Details Form

```
┌─────────────────────────────────────────────────────────────────┐
│  Guest Details                                                  │
├───────────────────────────────┬─────────────────────────────────┤
│  First Name *                 │  Last Name *                    │
│  ┌───────────────────────────┐│  ┌─────────────────────────────┐│
│  │ John                      ││  │ Doe                         ││
│  └───────────────────────────┘│  └─────────────────────────────┘│
├───────────────────────────────┴─────────────────────────────────┤
│  Email *                                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ john.doe@email.com                                          ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  Phone *                                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ +1 555-123-4567                                             ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│  Special Requests                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Late check-in, around 10pm                                  ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│            [        Continue to Payment        ]                │
└─────────────────────────────────────────────────────────────────┘
```

**Validation Rules**:
- firstName/lastName: required, trimmed
- email: required, valid format (regex check)
- phone: required
- specialRequests: optional

**Form Behavior**:
- Pre-fills from existing guestDetails in store
- Shows inline error messages per field
- Saves to bookingStore on submit
- Advances to payment step

---

## Step 7: Trade-offs Discussion (3 minutes)

### Frontend Trade-offs Table

| Decision | Approach | Trade-off | Rationale |
|----------|----------|-----------|-----------|
| State management | Zustand with persist | Simpler than Redux, less boilerplate | Search/booking state benefits from persistence |
| Routing | TanStack Router | Learning curve vs. type safety | File-based routes with full TypeScript support |
| Calendar component | Custom implementation | Development time vs. flexibility | Full control over availability display |
| Admin dashboard | Component extraction | More files vs. maintainability | Each component < 200 lines, clear responsibility |
| Form validation | Manual validation | Bundle size vs. control | Avoid Zod/Yup dependency for simple forms |
| Date handling | date-fns | Bundle size vs. DX | Tree-shakeable, immutable operations |

### Accessibility Considerations

- Keyboard navigation for date picker and modals
- ARIA labels on interactive elements
- Focus management when modals open/close
- Color contrast meeting WCAG AA standards
- Screen reader announcements for dynamic content

---

## Closing Summary

"I've designed a hotel booking frontend with:

1. **Component architecture** with single responsibility - admin components extracted into dedicated modules
2. **State management** using Zustand with persistence for search, booking, and auth
3. **AvailabilityCalendar** showing prices and availability with intuitive date selection
4. **Admin dashboard** with hotel management, room types, and dynamic pricing modals
5. **Booking flow** with guest details form and price summary

The key insight is separating the search experience (browsing, filtering) from the booking experience (selection, payment) with clear state boundaries. The admin interface mirrors the guest experience while adding management controls. Happy to dive deeper into any component."

---

## Potential Follow-up Questions

1. **How would you handle real-time availability updates?**
   - WebSocket connection for active search pages
   - Optimistic updates with rollback on conflict
   - Toast notification when prices change during booking

2. **How would you optimize for mobile?**
   - Bottom sheet for date picker on mobile
   - Swipeable image gallery
   - Sticky booking summary at bottom

3. **How would you implement offline support?**
   - Service worker for static assets
   - IndexedDB for recent searches
   - Queue booking requests when offline
