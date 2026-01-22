# Bitly (URL Shortener) - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a URL shortening service that:
- Provides instant feedback when shortening URLs
- Displays real-time analytics with interactive charts
- Supports custom short codes with live validation
- Works seamlessly across desktop and mobile devices

## Requirements Clarification

### Functional Requirements
1. **URL Shortener Component**: Input field with instant validation and shortening
2. **Link Management Dashboard**: List, search, filter, and manage user's URLs
3. **Analytics Visualization**: Charts for clicks, referrers, devices, geography
4. **Custom Code Input**: Live availability checking as user types
5. **Admin Dashboard**: System stats, user management, key pool monitoring
6. **Authentication UI**: Login, register, session management

### Non-Functional Requirements
1. **Performance**: < 100ms interaction response, < 3s initial load
2. **Accessibility**: WCAG 2.1 AA compliant
3. **Responsiveness**: Mobile-first design, works on all screen sizes
4. **Offline Support**: Show cached URLs when offline
5. **Bundle Size**: < 200KB gzipped for initial load

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           React Application                              │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Routes    │  │   Stores    │  │    Hooks    │  │   Services  │    │
│  │  (TanStack) │  │  (Zustand)  │  │  (Custom)   │  │  (API/WS)   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Component Library                          │    │
│  │  URLShortener │ URLList │ Analytics │ AdminDashboard │ Auth     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      UI Primitives                              │    │
│  │  Button │ Input │ Modal │ Toast │ Tooltip │ Chart │ Table       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: State Management with Zustand

### Auth Store

**State:**
- user: { id, email, role } | null
- isLoading: boolean
- error: string | null

**Actions:**
- login(email, password): POST /auth/login, set user on success
- logout(): POST /auth/logout, clear user
- checkSession(): GET /auth/me, restore session
- clearError(): Reset error state

**Persistence:** Uses Zustand persist middleware, stores only user in localStorage

### URL Store

**State:**
- urls: ShortenedUrl[]
- selectedUrl: ShortenedUrl | null
- filters: { search, sortBy, sortOrder }
- isLoading, isShortening: boolean
- error: string | null
- pendingDeletions: Set<string> (for optimistic updates)

**ShortenedUrl Type:**
- id, shortCode, shortUrl, longUrl
- clickCount, isCustom, expiresAt, createdAt

**Actions:**
- fetchUrls(): GET /user/urls
- shortenUrl(longUrl, options?): POST /shorten with optional customCode/expiresAt
- deleteUrl(shortCode): Optimistic delete with rollback on failure
- selectUrl(url): Set selected for analytics modal
- setFilters(filters): Update filter state

**Selector: useFilteredUrls()**
- Filters out pending deletions
- Applies search filter (matches longUrl or shortCode)
- Sorts by selected field and order
- Memoized with useMemo

### Analytics Store

**State:**
- data: { totalClicks, uniqueVisitors, clicksByDay[], topReferrers[], devices, countries[] }
- dateRange: { start, end }
- isLoading, error

**Actions:**
- fetchAnalytics(shortCode): GET /urls/:shortCode/stats with date range params
- setDateRange(start, end): Update range, triggers refetch

## Deep Dive: URL Shortener Component

### Main Shortener Form

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        URL Shortener Flow                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User Input                                                             │
│   ├─ onChange: setLongUrl + debouncedSetQuery(300ms)                     │
│   └─ Validate URL format (HTTP/HTTPS, max 2048 chars)                    │
│                                                                          │
│   Advanced Options (expandable)                                          │
│   ├─ CustomCodeInput: 4-20 chars, alphanumeric + dash/underscore         │
│   │   └─ Debounced availability check: GET /urls/:code/available         │
│   └─ ExpirationPicker: Optional expiry date                              │
│                                                                          │
│   Submit                                                                 │
│   ├─ Disabled if: shortening, URL invalid, custom code taken             │
│   ├─ Call shortenUrl(longUrl, { customCode?, expiresAt? })               │
│   ├─ On success: Show ShortenedResult, clear form                        │
│   └─ On error: Display error from store                                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Custom Code Input with Live Validation

**Input Behavior:**
- Sanitizes input: only alphanumeric, dash, underscore
- Max length: 20 characters
- Displays prefix: "bit.ly/"

**Availability Check:**
- Uses debounced value (300ms delay)
- Skips check if < 4 characters
- GET /urls/:code/available
- Status icons: Spinner (checking), Check (available), X (taken)

**Error Display:**
- "This code is already taken" when unavailable

### Shortened Result with Copy Animation

**Component: ShortenedResult**
- Animates in with Framer Motion (opacity, y translation)
- Displays short URL as clickable link
- Shows "Redirects to: {longUrl}" truncated

**Copy Button:**
- Uses navigator.clipboard.writeText()
- State toggle: "Copy" -> "Copied!" (2s timeout)
- Animated transition between states

**Dismiss:**
- Close button to hide result
- Calls onDismiss callback

## Deep Dive: URL List Component

### Virtualized URL List with Search

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        URL List Architecture                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Toolbar                                                                │
│   ├─ Search input with icon                                              │
│   │   └─ Updates filters.search on change                                │
│   └─ Sort dropdown (createdAt/clickCount, asc/desc)                      │
│                                                                          │
│   Virtualized List (@tanstack/react-virtual)                             │
│   ├─ Parent container with overflow: auto                                │
│   ├─ Virtual items with absolute positioning                             │
│   ├─ estimateSize: 80px per row                                          │
│   ├─ overscan: 5 items above/below viewport                              │
│   └─ Each item: URLListItem component                                    │
│                                                                          │
│   Empty State                                                            │
│   └─ "No URLs yet" with call-to-action                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### URL List Item

**Content:**
- Short code link (clickable, opens new tab)
- Badges: "Custom" (purple), "Expired" (red)
- Long URL (truncated with title tooltip)
- Stats: click count, relative time, expiration date

**Actions:**
- View analytics (chart icon) -> selectUrl
- Copy button -> clipboard
- Delete with confirmation:
  - First click: show confirm/cancel
  - Confirm: call deleteUrl (optimistic)
  - Cancel: hide confirmation

**Visual States:**
- Deleting: opacity-50
- Hover: bg-gray-50

## Deep Dive: Analytics Dashboard

### Analytics Modal

**Structure:**
- Dialog component with max-w-4xl
- Header: shortCode and shortUrl link
- DateRangePicker: Updates store dateRange
- Loading: Skeleton component
- Error: Red alert box

**Content (when data loaded):**
1. Summary Cards (3-column grid):
   - Total Clicks (with icon)
   - Unique Visitors (with icon)
   - Click Rate percentage (with icon)

2. Clicks Over Time Chart

3. Breakdown Charts (2-column grid):
   - Referrers chart
   - Devices pie chart

4. Geography Map

### Clicks Over Time Chart

**Chart.js Line Chart:**
- Labels: Formatted dates
- Single dataset: Clicks
- Style: orange-600 border, 10% opacity fill, 0.3 tension
- Options: No legend, index-based tooltip, y-axis starts at zero

### Devices Pie Chart

**Chart.js Doughnut:**
- Labels: Mobile, Desktop, Tablet
- Colors: green, blue, purple
- No border (borderWidth: 0)
- Legend at bottom

## Deep Dive: Custom Hooks

### useDebounce Hook

**Parameters:** value: T, delay: number
**Returns:** debouncedValue: T
**Behavior:** Updates debouncedValue after delay ms of no changes

### useCopyToClipboard Hook

**Parameters:** resetDelay (default 2000ms)
**Returns:** { copied: boolean, copy: (text) => Promise<boolean> }
**Behavior:**
- copy() writes to clipboard
- Sets copied=true, resets after delay
- Returns success boolean

### useUrlValidation Hook

**Parameters:** url: string
**Returns:** { isValid: boolean, error: string | null }
**Validations:**
- Empty string: valid (no error)
- Invalid URL format: "Please enter a valid URL"
- Non-HTTP(S) protocol: "Only HTTP and HTTPS URLs are supported"
- Length > 2048: "URL is too long (max 2048 characters)"

## Deep Dive: Accessibility

### Focus Management

**URLShortener Component:**
- Auto-focus input on mount (inputRef.current?.focus())
- On success: Move focus to result (resultRef)
- Screen reader announcement via live region

**announceToScreenReader Function:**
- Creates div with aria-live="polite", aria-atomic="true"
- Adds message text
- Removes after 1 second

### Keyboard Navigation

**URLList Component:**
- Container: role="listbox", tabIndex={0}
- Tracks focusedIndex state
- Arrow keys: Navigate up/down
- Enter: Select focused URL
- Each item: role="option", aria-selected based on focus

## Responsive Design

### Mobile-First Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Dashboard Layout                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Mobile (< lg breakpoint)                                               │
│   ├─ Sticky header at top (MobileHeader)                                 │
│   ├─ Main content (full width, p-4)                                      │
│   └─ Fixed bottom navigation (MobileNav)                                 │
│                                                                          │
│   Desktop (>= lg breakpoint)                                             │
│   ├─ Sidebar (w-64, sticky, border-right)                                │
│   │   └─ DesktopSidebar with navigation                                  │
│   └─ Main content (flex-1, p-8)                                          │
│       └─ max-w-4xl centered content                                      │
│                                                                          │
│   Tailwind Classes:                                                      │
│   ├─ lg:hidden - Mobile only                                             │
│   ├─ hidden lg:block - Desktop only                                      │
│   └─ p-4 lg:p-8 - Responsive padding                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand over Redux | Simpler API, less boilerplate | Fewer dev tools |
| Optimistic updates | Instant feedback | Rollback complexity |
| Chart.js | Lightweight, simple API | Less customization than D3 |
| CSS-in-Tailwind | Consistent design system | Class verbosity |
| Virtualized lists | Handles large datasets | Setup complexity |
| Debounced validation | Reduces API calls | Slight delay in feedback |

## Future Frontend Enhancements

1. **Offline Support**: Service worker for cached URL access
2. **QR Code Generation**: Generate and download QR codes for short URLs
3. **Bulk Import**: CSV upload for multiple URLs
4. **Link Previews**: OG image generation for social sharing
5. **Dark Mode**: Theme switching with system preference
6. **Keyboard Shortcuts**: Power user navigation
7. **Export Analytics**: Download CSV/PDF reports
8. **Real-time Updates**: WebSocket for live click counts
