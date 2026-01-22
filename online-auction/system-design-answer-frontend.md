# Online Auction System - Frontend System Design Interview Answer

## Introduction (2 minutes)

"Thanks for this problem. I'll be designing the frontend for an online auction platform similar to eBay. I'll focus on the UI components, real-time bid updates, state management, and ensuring a responsive user experience during high-activity auction periods."

---

## 1. Requirements Clarification (5 minutes)

### Frontend Functional Requirements

1. **Auction Browsing** - Grid/list views with search, filtering, and category navigation
2. **Auction Detail View** - Images, description, current bid, countdown timer, bid history
3. **Bid Placement** - Form with validation, optimistic updates, error handling
4. **Auto-Bid Setup** - Set maximum bid with clear UI explaining proxy bidding
5. **Real-Time Updates** - Live bid updates, countdown timers, sniping extension alerts
6. **Watchlist** - Track favorite auctions with notification indicators
7. **User Dashboard** - My bids, my auctions (seller), won/lost history
8. **Admin Panel** - Auction management, user management, analytics

### Non-Functional Requirements

- **Responsiveness** - Bid form interactions under 100ms perceived latency
- **Real-Time** - Bid updates within 500ms of occurrence
- **Accessibility** - WCAG 2.1 AA compliance, screen reader support for bidding
- **Mobile-First** - Touch-friendly bid controls, responsive layouts

---

## 2. Component Architecture (8 minutes)

### Core Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                              App                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                         Header                                   ││
│  │  Logo │ SearchBar │ CategoryNav │ UserMenu (auth state)         ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Main Content (Route-based)                    ││
│  │                                                                  ││
│  │   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  ││
│  │   │ Auction    │ │  Auction   │ │  Create    │ │   User     │  ││
│  │   │   Grid     │ │   Detail   │ │  Auction   │ │ Dashboard  │  ││
│  │   │  (browse)  │ │ (view/bid) │ │  (seller)  │ │            │  ││
│  │   └────────────┘ └────────────┘ └────────────┘ └────────────┘  ││
│  │                                                                  ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                          Footer                                  ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Auction Detail Page Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│                       AuctionDetailPage                              │
├──────────────────────────────┬──────────────────────────────────────┤
│                              │                                       │
│  ┌────────────────────────┐  │  ┌─────────────────────────────────┐ │
│  │     ImageGallery       │  │  │          BidSection             │ │
│  │  ┌──────────────────┐  │  │  │                                 │ │
│  │  │    MainImage     │  │  │  │  ┌───────────────────────────┐  │ │
│  │  └──────────────────┘  │  │  │  │   CurrentBidDisplay       │  │ │
│  │  ┌──────────────────┐  │  │  │  │   $1,250.00 (5 bids)      │  │ │
│  │  │  ThumbnailStrip  │  │  │  │  │   [You're winning!]       │  │ │
│  │  └──────────────────┘  │  │  │  └───────────────────────────┘  │ │
│  │  ┌──────────────────┐  │  │  │  ┌───────────────────────────┐  │ │
│  │  │    ZoomModal     │  │  │  │  │    CountdownTimer         │  │ │
│  │  └──────────────────┘  │  │  │  │    02:15:33 remaining     │  │ │
│  └────────────────────────┘  │  │  │    [Extended! +2min]      │  │ │
│                              │  │  └───────────────────────────┘  │ │
│  ┌────────────────────────┐  │  │  ┌───────────────────────────┐  │ │
│  │      AuctionInfo       │  │  │  │        BidForm            │  │ │
│  │  Title                 │  │  │  │  $[____] [+1][+5][+10]    │  │ │
│  │  SellerInfo            │  │  │  │  [  Place Bid: $1,260  ]  │  │ │
│  │  Description           │  │  │  └───────────────────────────┘  │ │
│  │  CategoryBreadcrumb    │  │  │  ┌───────────────────────────┐  │ │
│  └────────────────────────┘  │  │  │      AutoBidSetup         │  │ │
│                              │  │  │  Max: $[____] [Enable]    │  │ │
│  ┌────────────────────────┐  │  │  └───────────────────────────┘  │ │
│  │      BidHistory        │  │  └─────────────────────────────────┘ │
│  │  (virtualized list)    │  │                                       │
│  │  LoadMoreButton        │  │  ┌─────────────────────────────────┐ │
│  └────────────────────────┘  │  │       WatchlistButton           │ │
│                              │  └─────────────────────────────────┘ │
└──────────────────────────────┴──────────────────────────────────────┘
```

---

## 3. Deep Dive: Real-Time Bid Updates (10 minutes)

"Real-time updates are critical for auction UX. Users must see competing bids immediately to make informed decisions."

### WebSocket Connection Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WebSocket Connection Flow                        │
│                                                                      │
│  ┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
│  │   Browser   │────▶│  WebSocket URL  │────▶│  Auction Room   │   │
│  │  Component  │     │/auctions/{id}   │     │   (Backend)     │   │
│  └─────────────┘     └─────────────────┘     └─────────────────┘   │
│        │                                              │              │
│        │ onmessage                                    │ broadcast    │
│        ▼                                              ▼              │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Message Types                                 ││
│  │  ┌─────────────┐  ┌─────────────────┐  ┌──────────────────┐    ││
│  │  │  bid_update │  │ auction_extended│  │   auction_ended  │    ││
│  │  │  - amount   │  │ - newEndTime    │  │   - reserveMet   │    ││
│  │  │  - bidderId │  │ - reason        │  │   - winnerId     │    ││
│  │  │  - bidCount │  │                 │  │                  │    ││
│  │  └─────────────┘  └─────────────────┘  └──────────────────┘    ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Reconnection: Exponential backoff on disconnect (2s, 4s, 8s...)    │
└─────────────────────────────────────────────────────────────────────┘
```

### WebSocket Connection Management

The `useAuctionSocket` hook handles:
- Connect to `/auctions/{auctionId}` WebSocket endpoint
- Parse incoming messages by type
- Route to appropriate store actions:
  - bid_update -> updateCurrentBid()
  - auction_extended -> extendAuction()
  - auction_ended -> markEnded()
- Auto-reconnect on unclean close with timeout
- Cleanup on unmount

### Current Bid Display with Animation

The CurrentBidDisplay component features:
- Amount displayed in large font (text-4xl)
- Animation on bid change: green color + scale-110 for 600ms
- aria-live="polite" for screen reader announcements
- Bidder info with bid count
- "You are the highest bidder" badge when leading

### Countdown Timer with Anti-Sniping

CountdownTimer component behavior:
- Updates every 1 second normally
- Switches to 100ms updates when under 1 minute remaining
- Displays days/hours/minutes/seconds
- Shows milliseconds in final minute (urgent mode)
- "Auction extended due to last-minute bid" alert
- Urgent styling: red text, pulse animation
- aria-label with full time description

---

## 4. Deep Dive: Bid Form UX (8 minutes)

"The bid form must be fast, forgiving, and clear about outcomes."

### Bid Form Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Bid Form Component                           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  Minimum bid: $1,260.00                                          ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  ┌─────────────────────────────────────────────┐                ││
│  │  │ $  [  1,300.00  ]                           │                ││
│  │  └─────────────────────────────────────────────┘                ││
│  │                                                                  ││
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                    ││
│  │  │  +$1   │ │  +$5   │ │  +$10  │ │  +$25  │   Quick increment  ││
│  │  └────────┘ └────────┘ └────────┘ └────────┘                    ││
│  │                                                                  ││
│  │  ┌─────────────────────────────────────────────────────────────┐││
│  │  │                  Place Bid: $1,300.00                        │││
│  │  └─────────────────────────────────────────────────────────────┘││
│  │                                                                  ││
│  │  [Error: Bid must be at least $1,260.00]         (if invalid)   ││
│  │  [Bid placed successfully!]                      (on success)   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### BidForm Component Features

- Minimum bid calculated as currentBid + bidIncrement
- Amount input with $ prefix, number type, step=0.01
- Quick increment buttons (+$1, +$5, +$10, +$25)
- Auto-update minimum when outbid (via useMemo)
- Validation error display with aria-describedby
- Loading state with spinner during submission
- Success/error feedback animation
- Disabled state when auction ended

### Optimistic Bid Updates

The `usePlaceBid` hook implements optimistic updates:

1. **onMutate:**
   - Cancel outgoing queries for this auction
   - Snapshot previous auction state
   - Call optimisticBid() on store (increment immediately)

2. **onError:**
   - Rollback to snapshot state
   - Show error message

3. **onSuccess:**
   - Confirm optimistic update with server response
   - Update with actual final amount

4. **onSettled:**
   - Invalidate queries to ensure consistency

Idempotency key (UUID) generated per request to prevent duplicate bids.

---

## 5. State Management (5 minutes)

### Auction Store Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Zustand Auction Store                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  State:                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ auctions: Record<string, Auction>                                ││
│  │   └─ { id, title, currentBid, currentBidderId, bidCount,        ││
│  │        endTime, status, isWatching }                             ││
│  │                                                                  ││
│  │ activeAuctionId: string | null                                   ││
│  │ optimisticBids: Record<string, number>                           ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Actions:                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ setAuction(auction)         - Store auction data                 ││
│  │ updateCurrentBid(id, update) - Apply WebSocket bid update        ││
│  │ extendAuction(id, extension) - Update endTime on snipe-extend   ││
│  │ markEnded(id, end)          - Set status to 'sold' or 'unsold'  ││
│  │ optimisticBid(id, amount)   - Immediate UI update               ││
│  │ rollbackBid(id, previous)   - Revert on error                   ││
│  │ confirmBid(id, confirmed)   - Apply server response             ││
│  │ toggleWatchlist(id)         - Add/remove from watchlist         ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  (Uses immer middleware for immutable updates)                       │
└─────────────────────────────────────────────────────────────────────┘
```

### User Store Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Zustand User Store                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  State:                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ user: { id, email, displayName, role } | null                    ││
│  │ isAuthenticated: boolean                                         ││
│  │ watchlistIds: string[]                                           ││
│  │ myBidAuctionIds: string[]                                        ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Actions:                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ setUser(user)               - Login                              ││
│  │ clearUser()                 - Logout                             ││
│  │ addToWatchlist(auctionId)   - Track auction                     ││
│  │ removeFromWatchlist(id)     - Untrack auction                   ││
│  │ addMyBid(auctionId)         - Track participated auctions       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  (Persisted: watchlistIds to localStorage)                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Auction Grid with Virtualization (5 minutes)

### Virtualized Grid Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Virtualized Auction Grid                          │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                      Scroll Container                            ││
│  │  height: calc(100vh - 200px)                                     ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               ││
│  │  │         │ │         │ │         │ │         │  ◄─ Row 0     ││
│  │  │  Card   │ │  Card   │ │  Card   │ │  Card   │    (visible)  ││
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘               ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               ││
│  │  │         │ │         │ │         │ │         │  ◄─ Row 1     ││
│  │  │  Card   │ │  Card   │ │  Card   │ │  Card   │    (visible)  ││
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘               ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               ││
│  │  │         │ │         │ │         │ │         │  ◄─ Row 2     ││
│  │  │  Card   │ │  Card   │ │  Card   │ │  Card   │    (overscan) ││
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘               ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Total: 1000+ auctions, grouped into rows of 4                       │
│  estimateSize: 360px per row (card height + gap)                     │
│  overscan: 2 rows                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### AuctionGrid Implementation

Uses @tanstack/react-virtual with row-based grouping:
- Group auctions into rows (configurable columns, default 4)
- Virtualize rows, not individual cards
- Each virtual row contains grid of AuctionCards
- Absolute positioning with translateY

### AuctionCard Component

Card features:
- Aspect-square thumbnail with lazy loading
- Watchlist heart icon (top-right if watching)
- "Ending Soon" badge when urgent
- Title (truncated)
- Current bid with label
- Time remaining (formatted)
- Bid count
- Hover: shadow-xl transition
- Image: scale-105 on group hover

---

## 7. Auto-Bid Setup UI (3 minutes)

### Auto-Bid (Proxy Bidding) Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Auto-Bid Setup Component                        │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  Auto-Bid (Proxy Bidding)                              [▼]      ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  (Expanded state:)                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  ┌───────────────────────────────────────────────────────────┐  ││
│  │  │ ℹ️ Set your maximum bid. We will automatically bid on     │  ││
│  │  │    your behalf (in minimum increments) to keep you as     │  ││
│  │  │    the highest bidder, up to your maximum amount.         │  ││
│  │  └───────────────────────────────────────────────────────────┘  ││
│  │                                                                  ││
│  │  Active auto-bid: up to $2,500.00           (if existing)       ││
│  │                                                                  ││
│  │  ┌────────────────────────────┐  ┌─────────────┐                ││
│  │  │ $  [  2,500.00  ]          │  │   Enable    │                ││
│  │  └────────────────────────────┘  └─────────────┘                ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

Component features:
- Collapsible section (auto-expanded if existing auto-bid)
- Info box explaining proxy bidding behavior
- Shows current active auto-bid if set
- Max amount input with minimum validation
- Enable/Update button based on existing state

---

## 8. Image Gallery with Zoom (3 minutes)

### Gallery Component Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Image Gallery Component                          │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                                                                  ││
│  │                       Main Image                                 ││
│  │                    (click to zoom)                               ││
│  │                   aspect-square                                  ││
│  │                                                                  ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                                │
│  │ 1  │ │ 2  │ │ 3  │ │ 4  │ │ 5  │   ◄─ Thumbnail Strip           │
│  │    │ │[x] │ │    │ │    │ │    │      (selected: ring-2)        │
│  └────┘ └────┘ └────┘ └────┘ └────┘                                │
└─────────────────────────────────────────────────────────────────────┘
```

Features:
- Main image (aspect-square, cursor-zoom-in)
- Thumbnail strip (overflow-x-auto, 80x80px each)
- Selected thumbnail has ring-2 ring-blue-500
- Keyboard navigation: ArrowLeft/Right to change selection
- Click main image opens ZoomModal

**ZoomModal:**
- Full-screen black overlay (bg-black/90)
- Centered max-w/max-h image
- Close button (top-right X icon)
- Navigation arrows (left/right chevrons)
- Focus trap for accessibility

---

## 9. Trade-offs and Alternatives (3 minutes)

| Decision | Chosen Approach | Trade-off | Alternative |
|----------|----------------|-----------|-------------|
| Real-time updates | WebSocket per auction | Connection overhead for many watchers | Server-Sent Events (simpler, one-way only) |
| Bid submission | Optimistic update + rollback | Brief inconsistent state | Wait for server confirmation (slower UX) |
| Countdown precision | 100ms updates in final minute | Higher CPU usage | 1s always (less precise ending) |
| Image loading | Lazy load thumbnails | Initial layout shift | Eager load all (slower initial paint) |
| State management | Zustand with immer | Additional dependency | Plain React context (less performant) |
| Virtualization | Row-based grid virtual | Complex implementation | Paginated grid (simpler, worse UX) |

---

## 10. Future Enhancements

1. **Push Notifications** - Browser notifications for outbid events when tab is background
2. **Offline Support** - Service worker caching for auction browsing, queue bids when offline
3. **Bid Sound Effects** - Audio feedback for successful bids, outbid alerts
4. **AR Preview** - Camera integration for visualizing items in space
5. **Accessibility Audit** - Full screen reader testing, keyboard navigation improvements
6. **Performance Monitoring** - Real User Monitoring (RUM) for bid latency tracking

---

## Summary

"I've designed the frontend for an online auction platform with:

1. **Real-time WebSocket updates** - Instant bid notifications with reconnection handling
2. **Optimistic bid placement** - Immediate UI feedback with automatic rollback on failure
3. **Dynamic countdown timer** - High-precision timing with anti-sniping extension alerts
4. **Virtualized auction grid** - Efficient rendering for thousands of listings
5. **Zustand state management** - Clean separation of auction and user state
6. **Accessible bid forms** - ARIA labels, keyboard navigation, clear error states

The key insight is treating the bid experience as a real-time competitive interaction. Every millisecond matters during auction endings, so the UI must feel responsive while maintaining correctness through optimistic updates and server reconciliation."
