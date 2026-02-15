# Twitter -- System Design Answer (Frontend Focus)

*45-minute system design interview -- Frontend Engineer Position*

## 📋 Opening Statement

"I will design the frontend for Twitter, a real-time microblogging platform where users post 280-character tweets that appear in their followers' timelines. The defining frontend challenge is rendering a potentially infinite, dynamically-sized feed with instant engagement feedback. A user scrolling through hundreds of tweets must experience no jank, and actions like liking or retweeting must feel instantaneous even before the server confirms them.

I will focus on three areas: virtualized timeline rendering for performance at scale, optimistic update patterns for engagement actions, and a responsive three-column layout that adapts from desktop to mobile."

---

## 🎯 Requirements

### Functional Requirements
- **Timeline**: Infinite-scroll feed of tweets from followed users, rendered efficiently regardless of list size
- **Tweet Composition**: 280-character limit with real-time character counter, media attachment buttons, auto-resizing textarea
- **Engagement**: Like, retweet, and reply with optimistic updates and rollback on failure
- **Profile**: User page displaying tweets, follower count, following count, and bio
- **Trending Sidebar**: Real-time popular topics, refreshed periodically
- **Search**: Hashtag and user search with autocomplete

### Non-Functional Requirements
- **Performance**: Sub-100ms perceived timeline load; 60fps scrolling through thousands of tweets
- **Responsiveness**: Mobile-first design scaling to three-column desktop layout
- **Accessibility**: Screen reader support with ARIA landmarks, keyboard navigation with vim-style shortcuts (j/k for next/previous tweet)
- **Real-time Feel**: Engagement actions reflect instantly in the UI before server confirmation

### UI/UX Priorities
1. Content-first timeline with minimal chrome
2. Compose tweet always accessible (sticky button or modal)
3. Engagement actions visible but not intrusive
4. Trending topics contextually available on desktop, hidden on mobile

---

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser / Client                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  TanStack     │  │   Zustand    │  │  React Query │               │
│  │  Router       │  │   Stores     │  │  Cache       │               │
│  │              │  │              │  │              │               │
│  │ File-based   │  │ Auth, UI,    │  │ Server state │               │
│  │ type-safe    │  │ Engagement   │  │ Timeline,    │               │
│  │ routing      │  │ local state  │  │ Trends       │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                           │                                          │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │              Virtualized Rendering Layer                   │       │
│  │         @tanstack/react-virtual (Timeline)                │       │
│  │         Only ~80 DOM nodes regardless of list size         │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                      │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                          REST API + SSE
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Backend API (Express)                             │
│         Timeline, Tweets, Social Graph, Trends                       │
└─────────────────────────────────────────────────────────────────────┘
```

> "I separate client-side concerns into three layers: TanStack Router for navigation, Zustand for local/UI state, and React Query for server-state caching. This prevents the common anti-pattern of mixing server cache with UI state in a single store."

---

## 🧩 Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  App (Root Layout)                                                   │
│  ├── Header                                                         │
│  │   ├── Logo                                                       │
│  │   ├── SearchBar (autocomplete, debounced)                        │
│  │   └── UserMenu (compose shortcut, profile, settings)             │
│  │                                                                   │
│  ├── ThreeColumnLayout                                              │
│  │   ├── LeftSidebar (sticky)                                       │
│  │   │   ├── NavLinks (Home, Explore, Notifications, Profile)       │
│  │   │   └── ComposeButton                                          │
│  │   │                                                               │
│  │   ├── MainContent                                                │
│  │   │   └── Route Outlet                                           │
│  │   │       ├── HomeTimeline (virtualized feed)                    │
│  │   │       ├── ExplorePage (trending + search)                    │
│  │   │       ├── ProfilePage (user tweets + stats)                  │
│  │   │       └── TweetDetail (thread view)                          │
│  │   │                                                               │
│  │   └── RightSidebar (hidden on mobile/tablet)                     │
│  │       ├── TrendingTopics (auto-refresh every 60s)                │
│  │       └── WhoToFollow (suggested users)                          │
│  │                                                                   │
│  └── ComposeModal (global overlay)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### State Management Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Zustand Stores                             │
├────────────────┬────────────────────┬────────────────────────────┤
│  AuthStore     │  EngagementStore   │  UIStore                   │
│                │                    │                            │
│  user          │  likes: Set        │  composeModalOpen          │
│  isAuthenticated│  retweets: Set     │  activeNavTab              │
│  login()       │  pendingLikes: Set │  theme (light/dark)        │
│  logout()      │  toggleLike()      │  focusedTweetIndex         │
│                │  toggleRetweet()   │                            │
├────────────────┴────────────────────┴────────────────────────────┤
│                     React Query Cache                             │
│                                                                   │
│  ['timeline', 'home']     Server-fetched timeline pages          │
│  ['timeline', 'user', id] User profile tweets                    │
│  ['trends']               Trending topics (stale: 30s)           │
│  ['user', id]             User profile data                      │
└──────────────────────────────────────────────────────────────────┘
```

> "I use Zustand for truly local state -- auth session, engagement toggles, UI flags -- and React Query for anything fetched from the server. The engagement store uses Sets for O(1) like/retweet lookups, so checking whether the current user liked a tweet is instant."

---

## 🔌 API Contract

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/timeline/home?cursor=X&limit=20 | Home timeline with cursor pagination |
| GET | /api/timeline/user/:id?cursor=X | User profile tweets |
| POST | /api/tweets | Create tweet (with Idempotency-Key header) |
| DELETE | /api/tweets/:id | Soft-delete own tweet |
| POST | /api/tweets/:id/like | Like a tweet |
| DELETE | /api/tweets/:id/like | Unlike a tweet |
| POST | /api/tweets/:id/retweet | Retweet |
| DELETE | /api/tweets/:id/retweet | Undo retweet |
| GET | /api/trends | Get top 10 trending hashtags |
| POST | /api/users/:id/follow | Follow user |
| DELETE | /api/users/:id/follow | Unfollow user |
| GET | /api/users/:id/followers | List followers |
| GET | /api/users/:id/following | List following |

> "All timeline endpoints use cursor-based pagination instead of offset-based. Cursors are opaque strings encoding the last tweet's timestamp, which avoids the problem of items shifting between pages when new tweets arrive."

---

## 💾 Client-Side Data Model

**Tweet shape received from API:**

| Field | Type | Notes |
|-------|------|-------|
| id | string | Unique tweet identifier |
| authorId | string | Author's user ID |
| content | string | Up to 280 characters |
| hashtags | string[] | Extracted at creation time |
| mediaUrls | string[] | Up to 4 media attachments |
| likeCount | number | Denormalized count |
| retweetCount | number | Denormalized count |
| replyCount | number | Denormalized count |
| createdAt | ISO string | Creation timestamp |
| author | object | Nested: username, displayName, avatarUrl, isCelebrity |
| viewerHasLiked | boolean | Whether current user liked this |
| viewerHasRetweeted | boolean | Whether current user retweeted this |

**Engagement state (client-side, Zustand):**

| Field | Type | Purpose |
|-------|------|---------|
| likes | Set of string | Tweet IDs the current user has liked |
| retweets | Set of string | Tweet IDs the current user has retweeted |
| pendingLikes | Set of string | Tweet IDs with in-flight like requests |
| pendingRetweets | Set of string | Tweet IDs with in-flight retweet requests |

The engagement store is initialized from the server response (viewerHasLiked/viewerHasRetweeted fields) and then maintained locally for instant UI feedback.

---

## 🔧 Deep Dive: Virtualized Timeline Rendering

### The Problem

A Twitter timeline can contain thousands of tweets. Each tweet renders an avatar, variable-length text with parsed hashtags and mentions, engagement counters, and action buttons. Without virtualization, 200 tweets produce 1,200+ DOM nodes, consuming 150MB+ of memory and causing visible scroll jank after about 50 tweets.

### The Solution

The Timeline component uses a virtualizer that only renders tweets visible in the viewport plus a small overscan buffer. Regardless of how many tweets exist in the list, the DOM contains approximately 80 nodes.

```
┌─────────────────────────────────────────────────────┐
│  Scroll Container (ref tracked by virtualizer)       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Spacer div (height = total virtual size)        │ │
│  │                                                  │ │
│  │  ── invisible above (not rendered) ──            │ │
│  │                                                  │ │
│  │  ┌──────────────────────────────────────┐       │ │
│  │  │ Tweet (positioned absolutely)         │       │ │
│  │  │ measured dynamically after render     │       │ │
│  │  └──────────────────────────────────────┘       │ │
│  │  ┌──────────────────────────────────────┐       │ │
│  │  │ Tweet (visible in viewport)           │       │ │
│  │  └──────────────────────────────────────┘       │ │
│  │  ┌──────────────────────────────────────┐       │ │
│  │  │ Tweet (overscan buffer)               │       │ │
│  │  └──────────────────────────────────────┘       │ │
│  │                                                  │ │
│  │  ── invisible below (not rendered) ──            │ │
│  │                                                  │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Virtualizer configuration:**

| Setting | Value | Rationale |
|---------|-------|-----------|
| estimateSize | 150px | Average tweet height without media |
| overscan | 5 | Extra items above/below viewport for smooth fast scrolling |
| measureElement | Dynamic via getBoundingClientRect | Tweet heights vary with text length and media |

**Infinite scroll trigger:** The component watches the last virtual item. When its index reaches within 5 items of the end of the data and more data is available, it calls the load-more callback. This prefetches the next page before the user reaches the bottom.

**Memoization:** Each Tweet component is wrapped in React.memo with an ID-only comparator. Engagement state (liked, retweeted) comes from the Zustand store via a hook, not from props, so the tweet only re-renders when the store subscription fires -- not on every parent render.

### Performance Impact

| Metric | Without Virtualization | With Virtualization |
|--------|------------------------|---------------------|
| DOM nodes (200 tweets) | 1,200+ | ~80 |
| Memory usage | 150MB+ | ~60MB |
| Scroll jank threshold | 50 tweets | None observed |
| Initial render time | 400ms | 80ms |

### Trade-off: Virtualization Complexity vs. Simple List

> "I chose virtualization despite the added complexity because Twitter's core experience is scrolling through a long feed. A simple list breaks down past 50-100 tweets -- users on slower devices would experience frame drops and increasing memory pressure. The alternative of pagination (load 20 tweets, click 'next') breaks the infinite-scroll mental model that social media users expect.

> The trade-off is implementation complexity: dynamic height measurement requires careful handling. If a tweet's height changes after initial measurement (for example, a lazy-loaded image expanding the card), the virtualizer must be notified to re-measure. We handle this by observing resize events on each measured element. This adds about 100 lines of coordination code, but it is justified because timeline scrolling is the single most common user interaction."

---

## 🔧 Deep Dive: Optimistic Engagement Updates

### The Problem

Users expect engagement actions to feel instant. If clicking the heart icon requires waiting 200ms for a server round-trip before the UI updates, the interaction feels sluggish. Users may double-tap, creating duplicate requests. But if we update the UI immediately, we must handle the case where the server rejects the action.

### The Solution

The EngagementStore implements a toggle-rollback pattern with a pending set to prevent duplicate in-flight requests.

**Toggle-like flow:**

```
┌──────────────┐                          ┌──────────────┐
│   User taps  │                          │   Backend    │
│   heart icon │                          │   API       │
└──────┬───────┘                          └──────┬───────┘
       │                                         │
       │ 1. Check pendingLikes                   │
       │    If tweet already pending ──▶ return   │
       │                                         │
       │ 2. Read current state                   │
       │    wasLiked = likes.has(tweetId)         │
       │                                         │
       │ 3. Optimistic toggle                    │
       │    wasLiked ? likes.delete : likes.add  │
       │    pendingLikes.add(tweetId)             │
       │    UI updates immediately               │
       │                                         │
       │ 4. API call ───────────────────────────▶│
       │                                         │
       │    ┌─── Success ◀───────────────────────│
       │    │   pendingLikes.delete(tweetId)      │
       │    │   State already correct, done       │
       │    │                                     │
       │    └─── Failure ◀───────────────────────│
       │        Rollback: reverse the toggle      │
       │        pendingLikes.delete(tweetId)      │
       │        Show toast: "Couldn't like tweet" │
       ▼                                         ▼
```

> "I track pending requests in a separate Set so that rapid taps on the same tweet are debounced. Without this, a user could toggle the like state multiple times before the first request resolves, creating race conditions where the final UI state does not match the server state."

### Why Optimistic Updates Over Server Confirmation

> "I chose optimistic updates with rollback over waiting for server confirmation because engagement actions are the most frequent interaction in a social media app -- a user might like dozens of tweets per session. Making each like feel like a 200ms round-trip would make the app feel unresponsive compared to native mobile apps.

> The alternative -- waiting for the server -- is simpler to implement (no rollback logic, no pending tracking), but it fails the user experience test. Social media apps train users to expect instant feedback on taps. When you tap a heart and nothing happens for 200ms, it feels broken.

> The trade-off is rollback complexity. If the server rejects a like (for example, the tweet was deleted between the user seeing it and tapping like), we must reverse the optimistic state change and show an error. This creates a brief flash where the heart goes from pink back to gray. In practice, server rejections are rare (<0.1% of engagement actions), so the trade-off is heavily in favor of optimism."

### Animation Details

Engagement buttons use a pop animation on toggle: the icon scales to 1.3x over 150ms, then returns to 1.0x. The like button additionally transitions from an outline heart (gray) to a filled heart (pink, brand color #F91880). Retweet uses green (#00BA7C). These animations provide haptic-like visual feedback that reinforces the optimistic state change.

Count formatting follows abbreviation conventions: numbers above 1,000 display as "1.5K", above 1,000,000 as "1.5M". This keeps action bars compact even for viral tweets.

---

## 🔧 Deep Dive: Responsive Three-Column Layout

### Layout Strategy

Twitter's desktop layout uses three columns: left navigation, center content, and right sidebar. This must collapse gracefully to a single column on mobile.

```
┌───── Desktop (>= 1024px) ────────────────────────────────────────┐
│ ┌─────────────┐ ┌────────────────────────┐ ┌──────────────────┐  │
│ │ Left Nav    │ │ Main Content            │ │ Right Sidebar    │  │
│ │             │ │                         │ │                  │  │
│ │ Home        │ │ ┌─────────────────────┐ │ │ Trends for you   │  │
│ │ Explore     │ │ │ Tweet               │ │ │ #JavaScript      │  │
│ │ Notify      │ │ └─────────────────────┘ │ │ #TypeScript      │  │
│ │ Profile     │ │ ┌─────────────────────┐ │ │                  │  │
│ │             │ │ │ Tweet               │ │ │ Who to follow    │  │
│ │ [Tweet]     │ │ └─────────────────────┘ │ │ @user1           │  │
│ │             │ │ ┌─────────────────────┐ │ │ @user2           │  │
│ │             │ │ │ Tweet               │ │ │                  │  │
│ │             │ │ └─────────────────────┘ │ │                  │  │
│ └─────────────┘ └────────────────────────┘ └──────────────────┘  │
│   275px fixed     600px center               350px fixed          │
└──────────────────────────────────────────────────────────────────┘

┌───── Tablet (640-1023px) ──────────────────┐
│ ┌────┐ ┌────────────────────────────────┐  │
│ │Nav │ │ Main Content                    │  │
│ │    │ │                                 │  │
│ │ 🏠 │ │ (full width, no right sidebar)  │  │
│ │ 🔍 │ │                                 │  │
│ │ 🔔 │ │                                 │  │
│ │ 👤 │ │                                 │  │
│ └────┘ └────────────────────────────────┘  │
│ 88px     1fr                                │
└────────────────────────────────────────────┘

┌───── Mobile (< 640px) ───┐
│ ┌──────────────────────┐ │
│ │ Main Content          │ │
│ │ (single column)       │ │
│ │                       │ │
│ │ Left nav: hidden      │ │
│ │ Right sidebar: hidden │ │
│ │                       │ │
│ │ Bottom tab bar for    │ │
│ │ navigation instead    │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

**Breakpoint summary:**

| Breakpoint | Grid Columns | Left Sidebar | Right Sidebar |
|------------|-------------|--------------|---------------|
| < 640px (mobile) | 1fr | Hidden (bottom tab bar) | Hidden |
| 640-1023px (tablet) | 88px 1fr | Sticky, icon-only | Hidden |
| >= 1024px (desktop) | 275px 600px 350px | Full nav with labels | Visible |
| >= 1280px (large) | 275px 600px 1fr | Full nav | Max-width 350px |

The main content column has left and right borders that create the signature Twitter "feed column" appearance. Content never exceeds 600px width, ensuring comfortable line lengths for reading tweets.

### Compose Tweet Component

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌────────┐  ┌──────────────────────────────────────────────┐    │
│  │ Avatar │  │ What's happening?                             │    │
│  │        │  │ (auto-resizing textarea)                      │    │
│  │        │  ├──────────────────────────────────────────────┤    │
│  │        │  │ [Image] [GIF] [Emoji]     ○ 257  [Tweet]     │    │
│  └────────┘  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

The character counter appears as a circular SVG progress indicator when within 20 characters of the limit. Below 0, it displays the negative count in red. The tweet button is disabled when content is empty, over the limit, or when a submission is in flight. The textarea auto-resizes by measuring scrollHeight on each input event.

### Tweet Card Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────┐  ┌──────────────────────────────────────────────────┐  │
│  │Avatar│  │ Display Name  @username  ·  2h                   │  │
│  │ 48px │  ├──────────────────────────────────────────────────┤  │
│  │      │  │ Tweet content with #hashtags and @mentions       │  │
│  │      │  │ parsed into interactive links                    │  │
│  │      │  ├──────────────────────────────────────────────────┤  │
│  │      │  │ 💬 12    🔁 45    ♥ 892    ⬆ Share               │  │
│  └──────┘  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Content parsing uses a regex to identify hashtags, @mentions, and URLs within tweet text. Each match is replaced with a navigable link component: hashtags link to /hashtag/:tag, mentions link to /profile/:username, and URLs open in a new tab with the domain displayed as link text.

---

## ♿ Accessibility

### Keyboard Navigation

| Key | Action |
|-----|--------|
| ArrowDown / j | Focus next tweet in timeline |
| ArrowUp / k | Focus previous tweet |
| l | Like focused tweet |
| r | Open reply to focused tweet |
| Enter | Navigate to focused tweet detail |

The timeline uses a roving tabIndex pattern: only the currently focused tweet has tabIndex=0, all others have tabIndex=-1. This means pressing Tab moves focus out of the timeline entirely, while j/k navigate within it. An "aria-label" on each tweet article reads "Tweet by {displayName}" for screen readers.

### ARIA Structure

The timeline container has role="feed" and aria-label="Timeline". Each tweet is an article element with an accessible label. Action buttons include aria-pressed state for like and retweet toggles. The character counter announces remaining characters to screen readers via aria-live="polite".

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| ✅ Virtualization | @tanstack/react-virtual | ❌ Simple list rendering | Thousands of tweets require constant ~80 DOM nodes |
| ✅ Optimistic updates | Immediate UI + rollback | ❌ Wait for server | Engagement actions must feel instant (<50ms) |
| ✅ State separation | Zustand + React Query | ❌ Single Redux store | Clean separation of server cache vs UI state |
| ✅ Cursor pagination | Opaque cursor tokens | ❌ Offset pagination | Stable pagination when new tweets arrive |
| ✅ CSS Grid layout | Three-column CSS Grid | ❌ Flexbox | Cleaner responsive breakpoints with grid-template-columns |
| ✅ Memo by ID | React.memo with ID comparator | ❌ Deep comparison | Engagement state comes from store, not props |

### Deep Trade-off: Zustand + React Query vs. Single Redux Store

> "I chose separating client state (Zustand) from server state (React Query) over a unified Redux store because the two types of state have fundamentally different lifecycles. Server state needs cache invalidation, background refetching, stale-while-revalidate semantics, and cursor-based pagination -- all of which React Query handles out of the box. Client state like 'is the compose modal open' or 'which tweet is focused' has none of these needs.

> A single Redux store with RTK Query could technically handle both, but it introduces unnecessary coupling. When a timeline refetch occurs, you do not want it to clobber UI state like the focused tweet index or the compose modal's draft text. With separate stores, a React Query cache invalidation triggers a background refetch and seamlessly updates the timeline data without disturbing any Zustand state.

> The trade-off is developer onboarding: new team members must learn two state management APIs instead of one. In practice, the boundaries are clear enough that this has not been a source of confusion -- timeline data goes through React Query hooks, everything else goes through Zustand."

---

## 🚀 Future Improvements

1. **Server-Sent Events for live timeline updates**: Push new tweets into the feed without requiring the user to pull-to-refresh, with a "New tweets available" banner that scrolls to top on tap
2. **Service Worker for offline access**: Cache the most recent timeline page and compose queue so users can draft tweets offline and send when connectivity returns
3. **Media CDN with progressive loading**: Show blur-hash placeholders while images load, lazy-load media only when tweets scroll into the viewport
4. **Dark mode theming**: Toggle between light (#FFFFFF background) and dark (#15202B background) modes using CSS custom properties, with system preference detection
5. **Internationalization**: RTL text support for Arabic and Hebrew, locale-aware relative timestamps ("2h ago" vs. "il y a 2h")
6. **Web Vitals monitoring**: Track LCP, FID, and CLS in production to detect rendering regressions before users report them
