# Facebook News Feed - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

---

## Introduction

"Today I'll design a personalized news feed system similar to Facebook's, focusing on the frontend architecture. The core challenges are rendering a performant infinite-scroll feed with variable-height content, managing complex state for posts and engagement, handling real-time updates without disrupting the user experience, and building an intuitive post composer with rich media support."

---

## 📋 Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm the frontend-specific requirements:

1. **Feed Display**: Render personalized posts with infinite scroll
2. **Post Composer**: Create posts with text, images, and privacy controls
3. **Engagement UI**: Like, comment, and share with optimistic updates
4. **Real-time Updates**: New posts and engagement appear live
5. **Profile Views**: User profiles with post history and follow/unfollow
6. **Search**: Find users to follow with typeahead suggestions
7. **Responsive Design**: Works on desktop, tablet, and mobile"

### Non-Functional Requirements

"For the frontend:

- **Performance**: First Contentful Paint < 1.5s, feed scrolling at 60fps
- **Interactivity**: Time to Interactive < 3s
- **Bundle Size**: Initial JS bundle < 200KB gzipped
- **Accessibility**: WCAG 2.1 AA compliance
- **Offline Support**: View cached feed when offline"

---

## 🏗️ Step 2: Component Architecture

### High-Level Structure

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                App Shell                                       │
├───────────────────────────────────────────────────────────────────────────────┤
│  Navigation Bar: [Logo] [Search] [Home] [Friends] [Notifications] [Profile]  │
├─────────────┬─────────────────────────────────────────────┬───────────────────┤
│   Left      │              Main Feed Area                  │     Right        │
│  Sidebar    │                                              │    Sidebar       │
│             │  ┌──────────────────────────────────────┐   │                  │
│  - Profile  │  │         Post Composer                │   │  - Contacts      │
│  - Friends  │  └──────────────────────────────────────┘   │  - Suggestions   │
│  - Groups   │                                              │  - Trending      │
│  - Pages    │  ┌──────────────────────────────────────┐   │                  │
│             │  │          Post Card                   │   │                  │
│             │  │  - Header (author, time)             │   │                  │
│             │  │  - Content (text, media)             │   │                  │
│             │  │  - Actions (like, comment, share)    │   │                  │
│             │  │  - Comments section                  │   │                  │
│             │  └──────────────────────────────────────┘   │                  │
│             │                                              │                  │
│             │  [Virtualized Post List...]                 │                  │
└─────────────┴─────────────────────────────────────────────┴───────────────────┘
```

### Component Tree

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ App                                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ ├── AppShell                                                                 │
│ │   ├── NavigationBar                                                        │
│ │   │   ├── Logo, SearchBar (typeahead), NavLinks                           │
│ │   │   ├── NotificationBell, ProfileMenu                                   │
│ │   ├── LeftSidebar                                                          │
│ │   │   ├── ProfileCard, FriendsShortcut, GroupsList, PagesShortcut         │
│ │   ├── MainContent                                                          │
│ │   │   ├── PostComposer                                                     │
│ │   │   │   ├── ComposerInput, MediaUploader                                │
│ │   │   │   ├── PrivacySelector, SubmitButton                               │
│ │   │   └── Feed (virtualized)                                               │
│ │   │       └── PostCard (repeated)                                          │
│ │   │           ├── PostHeader, PostContent, PostMedia                      │
│ │   │           ├── EngagementBar, ActionBar                                │
│ │   │           └── CommentsSection                                          │
│ │   └── RightSidebar                                                         │
│ │       ├── ContactsList, FriendSuggestions, TrendingTopics                 │
│ ├── ProfilePage                                                              │
│ │   ├── CoverPhoto, ProfileInfo, ActionButtons, ProfileTabs, PostsGrid      │
│ └── Modals                                                                   │
│     ├── PostDetailModal, ImageLightbox, ShareModal                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Step 3: State Management with Zustand

"I'm choosing Zustand with immer middleware for state management. It provides a simpler API than Redux with less boilerplate, built-in devtools support, and excellent TypeScript integration. The immer middleware enables immutable updates with mutable syntax."

### Feed Store Structure

The feed store manages:
- **Feed data**: Posts array, posts by ID map, cursor, hasMore, isLoading
- **Comments**: Comments by post ID, expanded comments set
- **Composer state**: Content, image, privacy, open/closed status
- **Real-time updates**: New posts count, pending updates queue

Key patterns:
- **Optimistic updates** for likes/unlikes with automatic rollback on failure
- **Pending updates queue** for real-time posts that appear while user is scrolling
- **Persist middleware** to save composer draft and privacy preference

### User Store Structure

The user store manages:
- Current user and authentication state
- Followed users set (for optimistic follow/unfollow)
- Blocked users set
- Login/logout actions with token persistence

---

## 🎯 Step 4: Virtualized Feed Implementation

"I'm choosing @tanstack/react-virtual for virtualization. It has better dynamic height support than react-window and is maintained by Tanner Linsley, who has a strong track record with React libraries."

### Feed Component Design

The Feed component uses:
- **useVirtualizer** with dynamic height measurement via measureElement
- **estimateSize** of 400px for initial layout (average post height)
- **overscan** of 3 items above/below viewport for smooth scrolling
- **Absolute positioning** with transform translateY for each item

### Infinite Scroll Pattern

- Attach scroll listener with passive: true for performance
- Trigger fetch when scrollHeight - scrollTop - clientHeight < 500px threshold
- Check isLoading and hasMore before fetching
- Initial fetch on mount if posts array is empty

### New Posts Banner

When new posts arrive via WebSocket and user has scrolled down (scrollY > 200):
- Queue posts in pendingUpdates array
- Increment newPostsCount
- Show fixed banner: "X new posts" with click handler
- On click: insert pending posts at top, scroll to top smoothly

---

## 📊 Step 5: Post Card Component

### Component Structure

PostCard is wrapped in memo() to prevent re-renders when other posts change.

Key sections:
- **Header**: Avatar, author name link, relative timestamp, privacy icon, options menu
- **Content**: Text with whitespace-pre-wrap for line breaks
- **Media**: Lazy-loaded image with skeleton placeholder, click for lightbox
- **Engagement counts**: Like count with icon, comment count (clickable), share count
- **Action bar**: Like (toggle), Comment (expand), Share (modal) buttons
- **Comments section**: Expandable, loads on demand

### Action Button Behavior

- Uses aria-pressed for accessibility
- Shows active state (color, scale animation) when pressed
- Like button triggers optimistic update immediately

---

## 🚀 Step 6: Post Composer Component

### Features

- **Auto-resizing textarea** using react-textarea-autosize
- **Image preview** with remove button, validates file type and 10MB max size
- **Privacy selector** dropdown (Public/Friends)
- **Keyboard shortcut**: Cmd/Ctrl + Enter to submit
- **Submit button** disabled when empty and shows loading state

### Focus Management

- Container shows ring when focused
- Expands from 1 row to 3 rows on focus
- Collapses back when blurred and empty

---

## 📡 Step 7: Real-time Updates with WebSocket

### WebSocket Hook Design

The useRealtimeFeed hook manages:
- WebSocket connection lifecycle
- Automatic reconnection with exponential backoff (max 30s, 10 attempts)
- Message parsing and routing to appropriate store actions

### Message Types Handled

| Event Type | Action |
|------------|--------|
| new_post | Add to pending queue or insert directly |
| engagement_update | Update likeCount and commentCount |

### Connection Status Indicator

When disconnected, shows fixed banner at bottom-left with:
- Wifi-off icon
- "Reconnecting..." text
- Loading spinner

---

## 💬 Step 8: Comments Section

### Expandable Comments Design

- Loads comments on first expand (lazy loading)
- Comment input with avatar and send button
- Individual Comment component with:
  - Avatar, username link, content in rounded bubble
  - Like/Reply/Time actions below

### Load More Pattern

When comments.length >= 10, show "View more comments" button that loads next page with offset.

---

## 🔎 Step 9: Search with Typeahead

### SearchBar Component Features

- **Debounced input** (300ms) to reduce API calls
- **Keyboard navigation**: Arrow keys to select, Enter to navigate, Escape to close
- **Click outside** detection to close dropdown
- **Loading state** with spinner in input
- **ARIA attributes**: aria-expanded, aria-controls, role="listbox", role="option"

### Results Display

- User avatar, display name, username
- Highlighted row on keyboard selection
- "No users found" message when empty

---

## 📱 Step 10: Responsive Layout

### CSS Grid Layout

Desktop (default):
- Three columns: 280px | 1fr | 280px
- Sidebars sticky with overflow-y: auto

Tablet (max-width: 1100px):
- Two columns: 280px | 1fr
- Right sidebar hidden

Mobile (max-width: 768px):
- Single column
- Both sidebars hidden
- Reduced padding on main content

### Post Card Responsive

Desktop: Rounded corners with shadow
Mobile: No rounded corners, no shadow, border-bottom only

### Responsive Images

Uses picture element with:
- WebP source for modern browsers
- JPEG fallback
- srcSet with 480w, 680w, 1360w sizes
- sizes attribute for viewport-based selection

---

## 🌐 Step 11: Accessibility Implementation

### Post Actions Accessibility

- role="group" with aria-label="Post actions"
- aria-pressed on like button for toggle state
- aria-label describes action: "Unlike this post" / "Like this post"
- Icons have aria-hidden="true"

### Skip Navigation

Skip link at top of page:
- sr-only by default
- Visible on focus with absolute positioning
- Links to #main-content

### Focus Trap for Modals

useFocusTrap hook:
- Queries all focusable elements in container
- Traps Tab/Shift+Tab between first and last element
- Auto-focuses first element on activation

---

## ⚖️ Trade-offs and Alternatives

| Decision | ✅ Chosen | ❌ Alternative | Reasoning |
|----------|-----------|----------------|-----------|
| State Management | Zustand with immer | Redux Toolkit | Simpler API, less boilerplate, built-in devtools |
| Virtualization | @tanstack/react-virtual | react-window | Better dynamic height support, maintained by Tanner Linsley |
| Styling | Tailwind CSS | CSS Modules | Rapid prototyping, consistent design system |
| Routing | TanStack Router | React Router | File-based routing, type-safe params |
| Optimistic Updates | Custom with rollback | React Query mutations | More control over UI state during updates |
| WebSocket | Native WebSocket | Socket.io | Smaller bundle, sufficient for our needs |
| Form Handling | Controlled components | React Hook Form | Simpler for small forms, direct state access |

---

## 🚀 Performance Optimizations

1. **Virtualization**: Only render visible posts (reduces DOM from 1000+ to ~60 nodes)
2. **Memoization**: memo() on PostCard prevents re-renders when other posts change
3. **Image lazy loading**: Native loading="lazy" defers offscreen images
4. **Debounced search**: 300ms debounce prevents excessive API calls
5. **Code splitting**: Route-based splitting with dynamic imports
6. **Optimistic updates**: Immediate UI feedback before server confirmation

---

## 📝 Future Enhancements

1. **Service Worker**: Offline feed viewing and background sync
2. **Skeleton Loading**: Content placeholders during initial load
3. **Intersection Observer**: Replace scroll listener for infinite scroll
4. **React Suspense**: Streaming SSR for faster initial paint
5. **Image Optimization**: Next-gen formats (AVIF) with fallbacks
6. **Animation Library**: Framer Motion for rich micro-interactions
7. **Virtual Keyboard**: Better mobile input handling

---

## Summary

"For the Facebook News Feed frontend:

1. **Virtualized Feed**: @tanstack/react-virtual renders only visible posts, maintaining 60fps scrolling even with hundreds of items
2. **Zustand State**: Centralized store with immer for immutable updates and optimistic UI patterns
3. **Real-time WebSocket**: Live updates queued when scrolling, shown via banner to avoid disruption
4. **Post Composer**: Rich text input with media preview and privacy controls
5. **Responsive Design**: Three-column layout collapses gracefully to single column on mobile
6. **Accessibility**: ARIA labels, keyboard navigation, focus management in modals

The key frontend insight is handling variable-height content in an infinite list - you must measure elements dynamically and update the virtualizer as content loads. Combined with optimistic updates and real-time sync, this creates a responsive, engaging user experience."
