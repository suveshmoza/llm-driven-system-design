# System Design Interview: GitHub - Code Hosting Platform (Full-Stack Focus)

## Role Focus

> This answer emphasizes **full-stack integration**: shared type definitions with Zod, API contract design, TanStack Query data fetching patterns, optimistic updates for PR workflows, real-time synchronization, and end-to-end feature implementation.

---

## Opening Statement

"Today I'll design a code hosting platform like GitHub with a focus on full-stack integration. The key challenges are maintaining type safety between frontend and backend, designing APIs that support efficient UI patterns, implementing optimistic updates for responsive PR workflows, and synchronizing real-time state across multiple clients."

---

## Step 1: Requirements Clarification (3 minutes)

### Functional Requirements

1. **Repositories**: Browse files, view commits, manage branches
2. **Pull Requests**: Create, review with inline comments, merge
3. **Code Search**: Full-text search with filters
4. **Real-time**: Notifications, PR status updates, typing indicators
5. **Webhooks**: Configurable event delivery to external systems

### Non-Functional Requirements

- **Type Safety**: End-to-end type validation
- **Responsiveness**: Optimistic updates for common actions
- **Consistency**: Real-time sync without conflicts
- **Developer Experience**: Clear API contracts, good error messages

### Full-Stack Integration Goals

| Layer | Goal |
|-------|------|
| Types | Single source of truth with Zod |
| API | RESTful with consistent patterns |
| State | Server state in TanStack Query, UI state in Zustand |
| Real-time | WebSocket for live updates, automatic refetch |

---

## Step 2: Shared Type System (7 minutes)

### Zod Schema Definitions

"I'm choosing Zod for shared schemas because it provides both TypeScript types via `z.infer<>` and runtime validation. This ensures the same validation logic runs on frontend forms and backend APIs."

**Repository Schema:**
- id, ownerId, orgId, name (1-100 chars, alphanumeric with dots/underscores/hyphens)
- description, isPrivate, defaultBranch, language
- starsCount, forksCount, createdAt, updatedAt

**CreateRepository Input:**
- name (required, validated regex), description (max 500)
- isPrivate, autoInit, gitignoreTemplate, licenseTemplate

**Tree and File Schemas:**
- TreeNode: path, name, type (file/directory), size, sha
- FileContent: path, content, encoding (utf-8/base64), size, sha, language

### Pull Request Schemas

**PullRequest:**
- id, repoId, number, title, body, state (open/closed/merged)
- headBranch, headSha, baseBranch, baseSha
- authorId, mergedBy, mergedAt
- additions, deletions, changedFiles, isDraft

**CreatePullRequest Input:**
- title (required, max 500), body (max 65535)
- headBranch, baseBranch, isDraft

**MergePullRequest Input:**
- strategy (merge/squash/rebase)
- commitTitle (max 250), commitMessage (max 65535)
- deleteSourceBranch

**Review Schemas:**
- ReviewState: approved, changes_requested, commented, pending
- ReviewComment: id, reviewId, prId, userId, path, line, side (LEFT/RIGHT), body
- CreateReview: state, body, comments array with path/line/side/body

### API Response Schemas

- Paginated wrapper with items, pagination (page, limit, total, totalPages)
- ApiError with code, message, details (field-level errors)
- Success wrapper with success flag and data payload

---

## Step 3: Backend API Implementation (10 minutes)

### Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                           Backend Services                                     │
├───────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐              │
│  │  Express API    │──▶│  Git Service    │──▶│  Elasticsearch  │              │
│  │  (Routes)       │   │  (simple-git)   │   │  (Code Search)  │              │
│  └────────┬────────┘   └────────┬────────┘   └─────────────────┘              │
│           │                     │                                              │
│  ┌────────▼────────┐   ┌────────▼────────┐   ┌─────────────────┐              │
│  │  Validation     │   │  PostgreSQL     │   │  WebSocket      │              │
│  │  Middleware     │   │  (Metadata)     │   │  Server         │              │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘              │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Validation Middleware

"I'm implementing reusable middleware that parses request body/query with Zod schemas and returns structured validation errors."

**validateBody(schema):**
- Parse req.body with schema
- On ZodError: return 400 with code VALIDATION_ERROR, message, and field-level details
- On success: replace req.body with parsed value, call next()

**validateQuery(schema):**
- Same pattern for query parameters
- Coerces string values to appropriate types

### Pull Request Routes

**GET /:owner/:repo/pulls**
- Query params: state (open/closed/merged/all), page, limit
- Joins repositories with users to validate ownership
- Returns paginated PR list sorted by created_at DESC

**POST /:owner/:repo/pulls**
- Validates branches exist via gitService.getRef()
- Computes diff stats (additions, deletions, filesChanged)
- Generates next PR number atomically
- Creates PR record, emits pull_request.opened webhook

**GET /:owner/:repo/pulls/:number**
- Returns PR with diff files, reviews, and comments
- Diff computed via gitService.diff(baseSha, headSha)

**POST /:owner/:repo/pulls/:number/merge**
- Validates PR is open state
- Checks mergeability, returns 409 with conflicts if not mergeable
- Executes merge/squash/rebase based on strategy
- Updates PR state to merged, optionally deletes source branch
- Emits pull_request.merged webhook

**POST /:owner/:repo/pulls/:number/reviews**
- Creates review and comments in transaction
- Returns created review with all comments

---

## Step 4: Frontend API Layer (8 minutes)

### TanStack Query Hooks

"I'm using TanStack Query with query key factories for organized cache management and optimistic updates for responsive UX."

**Query Keys Factory:**
- prKeys.all(owner, repo) - base key
- prKeys.list(owner, repo, filters) - list with state filter
- prKeys.detail(owner, repo, number) - single PR
- prKeys.diff(owner, repo, number) - PR diff

**usePullRequests Hook:**
- useInfiniteQuery for paginated list
- getNextPageParam checks if more pages available
- Returns pages with items and pagination

**usePullRequest Hook:**
- useQuery for single PR detail
- Returns PR, diff, reviews, comments

**useCreatePullRequest Hook:**
- useMutation with onSuccess cache update
- Prepends new PR to list cache first page

**useMergePullRequest Hook (Optimistic Updates):**
- onMutate: cancel queries, snapshot previous, update to merged state
- onError: rollback to snapshot
- onSettled: invalidate detail and list queries

**useSubmitReview Hook:**
- onSuccess: append review and comments to detail cache

### Repository and File Hooks

**repoKeys Factory:**
- detail, tree, file, branches

**useRepository:** Fetches repo metadata
**useTree:** Fetches directory listing with 5-minute stale time
**useFileContent:** Fetches file content with 1-hour stale time (immutable by SHA)
**useBranches:** Fetches branches with 1-minute stale time

---

## Step 5: Real-Time Synchronization (8 minutes)

### WebSocket Integration

"I'm implementing WebSocket for real-time updates with automatic query invalidation rather than pushing full data, keeping the cache as single source of truth."

**Message Types:**
- pr.updated, pr.merged
- review.submitted, comment.added
- ci.status

**useWebSocketSync Hook:**
- Maintains WebSocket connection with reconnection (exponential backoff)
- subscribe(resource) / unsubscribe(resource) for specific resources
- handleMessage invalidates relevant query keys based on message type

**Message Handling:**
- pr.updated/pr.merged: invalidate detail and list queries
- review.submitted/comment.added: invalidate detail query
- ci.status: invalidate PRs matching the SHA

### PR Detail Page with Real-Time Updates

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        PR Detail Page                                          │
├───────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Header: Title #number, Status Badge, Branch info                       │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Tabs: Conversation | Commits | Files Changed                           │  │
│  ├─────────────────────────────────────────────────────────────────────────┤  │
│  │  Tab Content (ConversationView, DiffViewer)                             │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Merge Panel (when open): Strategy selector, Merge button               │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Review Form: Pending comments, Body, Submit (Comment/Approve/Request)  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Subscription Pattern:**
- useEffect subscribes to `{owner}/{repo}/pull/{number}` on mount
- Cleanup unsubscribes on unmount
- Real-time updates trigger query invalidation

### Optimistic Review Comment Workflow

**Pending Comments State:**
- Local state tracks comments added via inline forms (with temp client IDs)
- Displayed in summary with remove option
- Submitted as batch with review

**Review Submission:**
- Uses react-hook-form with zodResolver
- Three submit buttons: Comment, Approve, Request Changes
- All pending comments included in mutation

---

## Step 6: Code Search Integration (7 minutes)

### Search API with Elasticsearch

"I'm implementing Elasticsearch-based code search with highlighting and filters for language, repo, and path."

**Search Query Schema:**
- q (required), language, repo, path
- page, limit

**Elasticsearch Query:**
- bool query with must (content match) and filter (language term, repo term, path wildcard)
- Highlight with fragment_size 150, 5 fragments, mark tags

**Response Processing:**
- Parse highlight fragments into content with match ranges
- Return items with repoId, repoFullName, path, language, highlights

### Frontend Search Implementation

**useCodeSearch Hook:**
- useInfiniteQuery with debounced query (300ms)
- enabled only when query >= 3 chars
- Filters passed as additional params

**Search Page:**
- Search header with result count
- Language and repo filter dropdowns
- Results list with SearchResultCard
- Load more button for pagination

---

## Step 7: Error Handling and Loading States (5 minutes)

### Centralized Error Boundary

**RouteErrorBoundary:**
- isRouteErrorResponse for 404/403 handling
- GenericErrorPage for unknown errors
- Reload page button for recovery

### API Error Handler

**Axios Client:**
- Base URL from environment
- Request interceptor adds X-Session-Id from localStorage
- Response interceptor handles 401 (redirect to login)
- Enhances errors with code and details from API response

### Loading Skeletons

**PRDetailSkeleton:**
- Header placeholder (title, status)
- Tabs placeholder
- Diff file skeletons (header bar, line placeholders)
- Animate with pulse effect

---

## Step 8: Key Design Decisions and Trade-offs (3 minutes)

| Decision | ✅ Chosen | ❌ Alternative | Rationale |
|----------|-----------|----------------|-----------|
| Type sharing | Zod schemas | TypeScript interfaces | Runtime validation + types |
| Data fetching | TanStack Query | SWR, Redux Toolkit Query | Infinite queries, optimistic updates |
| Real-time | WebSocket + invalidation | SSE, polling | Bi-directional, efficient |
| Forms | React Hook Form + Zod | Formik, uncontrolled | Type-safe validation |
| API client | Axios | Fetch | Interceptors, timeout config |

### Full-Stack Type Safety Chain

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Type Safety Flow                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Zod Schema (shared/)                                                        │
│       │                                                                      │
│       ├──► Frontend Types (z.infer)                                          │
│       │         │                                                            │
│       │         ├──► Form Validation (zodResolver)                           │
│       │         └──► API Response Parsing                                    │
│       │                                                                      │
│       └──► Backend Validation (validateBody/validateQuery)                   │
│                 │                                                            │
│                 ├──► Runtime Validation Errors                               │
│                 └──► Type-Safe Request Handlers                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Cache Invalidation Strategy

| Event | Invalidated Queries |
|-------|-------------------|
| PR created | prKeys.list |
| PR merged | prKeys.detail, prKeys.list |
| Review submitted | prKeys.detail |
| Push event (WS) | repoKeys.tree, repoKeys.file |
| CI status (WS) | PRs with matching SHA |

---

## Closing Summary

I've designed a full-stack code hosting platform with four core integration patterns:

1. **Shared Type System**: Zod schemas providing single source of truth for types and validation, used by both frontend forms and backend route handlers

2. **API Layer**: RESTful endpoints with consistent validation middleware, TanStack Query hooks with proper cache key factories, and optimistic updates for merge operations

3. **Real-Time Sync**: WebSocket connection subscribing to specific resources, automatic query invalidation on server events, and reconnection with exponential backoff

4. **Error Handling**: Centralized error boundary with route-aware handling, Axios interceptors for auth and error enhancement, and typed API errors with validation details

**Key full-stack trade-offs:**
- Zod over pure TypeScript (runtime validation overhead vs. safety)
- Query invalidation over WebSocket data push (simpler sync vs. bandwidth)
- Optimistic updates selectively (merge operations vs. all mutations)

**Future enhancements:**
- GraphQL for complex nested queries (PR with reviews, comments, CI status)
- Offline-first with service workers and IndexedDB caching
- Collaborative editing with Yjs or operational transforms
- End-to-end testing with Playwright covering full user flows
