# LinkedIn - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design LinkedIn, a professional social network where users build career profiles, connect with colleagues, and discover job opportunities. The frontend challenge involves building a professional UI that efficiently displays complex profile data, handles social graph visualization, and provides responsive feed interactions.

## Requirements Clarification

### Functional Requirements
- **Profiles**: Rich profile pages with experience, education, skills, activity
- **Connections**: Request handling, network visualization, PYMK display
- **Feed**: Algorithmic post ranking with engagement actions
- **Jobs**: Job listings with search, filtering, and application flow
- **Search**: Global search across people, companies, and jobs
- **Notifications**: Real-time updates for connection requests and engagement

### Non-Functional Requirements
- **Performance**: < 200ms first contentful paint for feed
- **Accessibility**: WCAG 2.1 AA compliance for professional platform
- **Responsiveness**: Desktop-first with mobile support
- **Offline**: Graceful degradation for poor connectivity

### User Experience Goals
- Professional, trustworthy aesthetic
- Clear hierarchy in complex profile layouts
- Seamless connection request flow
- Efficient job application process

## High-Level Architecture

```
+-----------------------------------------------------------+
|                     React Application                      |
|                   (TypeScript + Vite)                      |
+-----------------------------------------------------------+
         |                    |                    |
         v                    v                    v
+---------------+    +---------------+    +---------------+
| TanStack       |    |   Zustand     |    | Services/API  |
| Router         |    |   Store       |    | Layer         |
| - File-based   |    | - Auth state  |    | - REST calls  |
| - Type-safe    |    | - User data   |    | - Error handling|
| - Dynamic      |    | - UI state    |    | - Caching     |
+---------------+    +---------------+    +---------------+
         |                    |                    |
         v                    v                    v
+-----------------------------------------------------------+
|                    Component Layer                         |
| Profile | Feed | Network | Jobs | Search | Navbar         |
+-----------------------------------------------------------+
         |
         v
+-----------------------------------------------------------+
|                    Tailwind CSS                            |
|          (Utility-first, Professional Design)              |
+-----------------------------------------------------------+
```

## Deep Dives

### 1. Component Architecture

The application uses a hierarchical component structure with feature-based organization:

```
frontend/src/
├── components/
│   ├── profile/           # Profile page sub-components
│   │   ├── index.ts       # Barrel export
│   │   ├── ProfileHeader.tsx
│   │   ├── EditProfileModal.tsx
│   │   ├── ExperienceSection.tsx
│   │   ├── EducationSection.tsx
│   │   ├── SkillsSection.tsx
│   │   └── ActivitySection.tsx
│   ├── ConnectionCard.tsx
│   ├── JobCard.tsx
│   ├── PostCard.tsx
│   └── Navbar.tsx
├── routes/
│   ├── __root.tsx         # Layout with navbar
│   ├── index.tsx          # Feed
│   ├── profile.$userId.tsx
│   ├── network.tsx
│   ├── jobs.tsx
│   └── search.tsx
├── services/
│   └── api.ts             # API client
├── stores/
│   └── authStore.ts       # Auth state
└── types/
    └── index.ts           # Shared types
```

**Profile Page Refactoring Example:**

The profile page was refactored from a single 534-line component to focused sub-components:

| Component | Lines | Responsibility |
|-----------|-------|----------------|
| `ProfileHeader` | ~150 | Banner, avatar, name, connection actions |
| `EditProfileModal` | ~160 | Profile editing form |
| `ExperienceSection` | ~115 | Work history with add action |
| `EducationSection` | ~110 | Education list with add action |
| `SkillsSection` | ~195 | Skills with endorse/add/remove |
| `ActivitySection` | ~40 | User's posts feed |

**Barrel Export Pattern:**

Each feature folder uses a barrel export file (index.ts) that re-exports all sub-components: ProfileHeader, EditProfileModal, ProfileAbout, ExperienceSection, EducationSection, SkillsSection, and ActivitySection. Consuming routes import the components they need from a single path (e.g., `from '../components/profile'`), keeping imports clean and decoupled from the internal folder structure.

### 2. State Management with Zustand

**Auth Store:**

The auth store manages global authentication state using Zustand. It holds the current user object, authentication status flags (isAuthenticated, isLoading), and exposes four actions:

- **login(email, password)**: Posts credentials to the API, then sets the user and marks isAuthenticated as true
- **logout()**: Posts to the logout endpoint, then clears user and isAuthenticated
- **updateUser(updates)**: Merges partial user updates into the current user object (used after profile edits)
- **checkSession()**: Calls the `/auth/me` endpoint on app load to restore the session; sets isLoading to false regardless of success or failure

> "Zustand keeps the auth store under 30 lines -- no reducers, no action types, no dispatch. The store is a single function call that returns state and actions, which any component can consume with a selector hook."

**Local State for UI:**

Page-level UI state (profile data, connection degree, mutual connections, modal visibility, loading flag) is managed with local React useState hooks since it does not need to be shared across routes.

### 3. Profile Page Layout

**ProfileHeader Component:**

The ProfileHeader component receives the profile data, ownership flag, connection degree, mutual connections list, and callback handlers for connect/edit actions. It renders:

- A **banner area** with a gradient background (LinkedIn blue to dark)
- A **circular avatar** overlapping the banner, 128px with a white border
- **Name and headline** as prominent text, followed by location and connection count in smaller gray text
- A **mutual connections badge** that appears only for 2nd-degree connections, showing the count in LinkedIn blue
- **Action buttons**: If the viewer is the profile owner, an "Edit Profile" outlined button is shown. Otherwise, a "Connect" button appears (disabled and reading "Connected" if already a 1st-degree connection)

> "The negative margin on the avatar (-mt-16) creates the overlapping effect seen on LinkedIn profiles. The connection degree drives both the CTA button state and whether the mutual connections badge is visible -- a single data point controlling two UI elements."

### 4. Skills Section with Endorsements

The SkillsSection component displays a user's skills as a vertical list. Each skill row shows the skill name, endorsement count (if any), and contextual action buttons:

- **For profile visitors**: An "Endorse" button appears next to each skill
- **For the profile owner**: A remove button (X icon) appears next to each skill, plus a "+" button in the section header to add new skills
- **Add skill form**: When the owner clicks "+", an inline form appears with a text input and "Add" submit button. On submit, the form calls the onAddSkill callback, clears the input, and hides itself

Each skill row uses a light gray background with rounded corners. The section is wrapped in a white card with padding and shadow, following the same visual pattern as other profile sections.

> "Keeping the add-skill form inline rather than in a modal reduces friction -- the user stays in context and can add multiple skills without repeated open/close actions."

### 5. Feed with Ranking Display

The PostCard component renders a single feed post as a white card with shadow. Its layout consists of four sections:

1. **Author header**: Circular avatar linked to the author's profile, with name (bold, linked), headline (gray), and relative timestamp ("3 hours ago")
2. **Content body**: Whitespace-preserving text block, followed by an optional full-width image
3. **Engagement stats bar**: Like count and comment count separated by a dot, with the comment count acting as a toggle button for the comments section
4. **Action buttons row**: Like (thumbs-up icon), Comment (message icon), and Share (share icon) -- evenly spaced horizontally

When the comments section is visible, it shows:
- An **inline comment form** with a rounded text input and a "Post" submit button (disabled when empty)
- A **comment list** where each comment displays a small avatar, author name (linked), and comment text inside a gray rounded container

> "The post card is intentionally kept flat (no nesting beyond the comment list) to minimize re-renders. Likes and comments use callback props from the parent feed, which can batch API calls and apply optimistic updates at the list level."

### 6. PYMK (People You May Know) Display

**PYMKCard Component:**

Each PYMK card is a centered white card with shadow showing: a circular avatar (80px, linked to profile), the user's full name (bold, linked), their headline (gray, clamped to 2 lines), mutual connection count (small gray text), and a full-width "Connect" outlined button in LinkedIn blue.

**Network Page Layout:**

The network page is split into two sections:

1. **Invitations section** (conditional): Only renders when there are pending connection requests. Shows a heading with the count and a vertical list of ConnectionRequestCard components, each with Accept and Decline buttons.

2. **PYMK section**: A heading "People you may know" followed by a responsive grid of PYMKCard components -- 2 columns on mobile, 4 on medium+ screens.

> "The grid layout for PYMK cards mirrors LinkedIn's actual UI. Four columns on desktop provide enough density to encourage browsing without overwhelming the user. The card design prioritizes the avatar and mutual connection count since those are the two strongest signals driving connect decisions."

### 7. Accessibility Considerations

**Key Accessibility Patterns:**

- **Icon-only buttons** always include an `aria-label` (e.g., "Edit profile") so screen readers can announce the action
- **Form inputs** are paired with visible `<label>` elements using matching `htmlFor`/`id` attributes
- **Focus management in modals**: When a modal opens, the previously focused element is saved and focus moves to the first input. On close, focus returns to the saved element
- **Skill list** uses semantic `role="list"` and `role="listitem"` with an `aria-label` on the container ("Skills") for screen reader navigation

### 8. Loading and Error States

The profile page follows a standard loading/error/empty/content pattern:

1. **On mount**, the page sets loading=true and error=null, then fetches the profile by userId from the URL params
2. **Loading state**: Renders a ProfileSkeleton component -- an animated pulse layout with gray placeholder shapes mimicking the banner (h-48), avatar (w-32 h-32 circle), and three text lines of decreasing width (1/3, 1/2, 1/4)
3. **Error state**: Displays the error message in red centered text with a "Retry" button that reloads the page
4. **Empty state**: Shows "Profile not found" in gray centered text if the API returned successfully but with no data
5. **Success state**: Renders the full ProfileContent component with the loaded profile data

> "The skeleton matches the actual profile layout dimensions so there's no layout shift when content loads. Using CSS animate-pulse on gray blocks is the standard approach -- it signals that content is loading without introducing a spinner that would feel out of place in a card-based layout."

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State management | Zustand | Redux, Context | Simpler API, less boilerplate |
| Routing | TanStack Router | React Router | Type-safe, file-based |
| Styling | Tailwind CSS | CSS Modules, Styled Components | Rapid development, consistency |
| Component size | Max 200 lines | Larger components | Maintainability, testability |
| Form handling | Controlled inputs | React Hook Form | Simpler for moderate forms |
| Data fetching | useEffect + fetch | TanStack Query | Sufficient for current scope |
| Icons | Lucide React | Custom SVGs, FontAwesome | Tree-shakeable, consistent |

## Future Enhancements

1. **TanStack Query**: Add for caching, background refetch, and optimistic updates
2. **Virtual scrolling**: Implement for long connection lists and feed
3. **Real-time updates**: WebSocket for live notifications and feed updates
4. **Rich text editor**: For post creation with formatting
5. **Profile completeness indicator**: Visual progress for incomplete profiles
6. **Keyboard shortcuts**: Power user navigation (j/k for feed, n for new post)
7. **Dark mode**: Professional dark theme option
8. **Offline support**: Service worker for offline profile viewing
