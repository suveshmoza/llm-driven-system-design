# Distributed Cache - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

---

## 1. Requirements Clarification (3-4 minutes)

### Frontend-Specific Requirements
- **Admin Dashboard**: Monitor cluster health, node status, key distribution
- **Key Browser**: View, search, and manage cached keys
- **Real-time Updates**: Live stats refresh without page reload
- **Cache Operations**: Manual GET/SET/DELETE through UI
- **Cluster Visualization**: Visual representation of hash ring and distribution
- **Test Interface**: Interactive tool for testing cache operations

### User Experience Goals
- **Instant Feedback**: Optimistic updates for cache operations
- **Clear Status**: Obvious indicators for healthy/unhealthy nodes
- **Responsive**: Works on desktop admin workstations
- **Accessible**: Keyboard navigation, screen reader support

### Non-Functional Requirements
- **Performance**: Dashboard renders 100+ keys without lag
- **Reliability**: Graceful degradation when nodes are down
- **Usability**: Operations require minimal clicks

---

## 2. Frontend Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Admin Dashboard                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               │
│  │   Dashboard   │  │  Key Browser  │  │   Cluster     │               │
│  │   Overview    │  │    & CRUD     │  │   Monitor     │               │
│  └───────────────┘  └───────────────┘  └───────────────┘               │
│           │                 │                   │                       │
│           └─────────────────┼───────────────────┘                       │
│                             │                                           │
│  ┌──────────────────────────▼──────────────────────────┐               │
│  │                    Zustand Store                     │               │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │               │
│  │  │ clusterStore│  │  cacheStore │  │ settingsStore│ │               │
│  │  │ - nodes     │  │ - keys      │  │ - autoRefresh│ │               │
│  │  │ - health    │  │ - values    │  │ - theme      │ │               │
│  │  │ - stats     │  │ - searchQ   │  │ - polling    │ │               │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │               │
│  └──────────────────────────────────────────────────────┘               │
│                             │                                           │
│  ┌──────────────────────────▼──────────────────────────┐               │
│  │                   API Service Layer                  │               │
│  │  - Fetch wrapper with error handling                 │               │
│  │  - Automatic retry with exponential backoff          │               │
│  │  - Response caching for stats                        │               │
│  └──────────────────────────────────────────────────────┘               │
│                             │                                           │
└─────────────────────────────┼───────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Coordinator   │
                    │   API (3000)    │
                    └─────────────────┘
```

### Technology Stack
- **Framework**: React 19 + TypeScript
- **Routing**: TanStack Router (file-based)
- **State**: Zustand for global state
- **Styling**: Tailwind CSS
- **Build**: Vite
- **Charts**: Recharts for stats visualization

---

## 3. Route Structure (4 minutes)

**Route Files:**
- `__root.tsx` - Root layout with navigation
- `index.tsx` - Dashboard overview
- `keys/index.tsx` - Key browser list
- `keys/$key.tsx` - Individual key detail/edit
- `cluster/index.tsx` - Cluster overview
- `cluster/nodes.tsx` - Node management
- `cluster/distribution.tsx` - Hash ring visualization
- `test.tsx` - Interactive test interface

### Root Layout

RootLayout component renders a min-h-screen container with gray background. Navigation bar contains "Cache Admin" title and NavLink components for Dashboard, Keys, Cluster, Test routes. ClusterHealthIndicator displays in the header.

Main content area wraps Outlet with max-width and padding.

NavLink component uses TanStack Router's Link with activeProps for styling the current route with blue background.

ClusterHealthIndicator uses useClusterStore to get healthyNodes and totalNodes. Computes status as 'healthy' (all nodes up), 'degraded' (some up), or 'down' (none up). Displays colored dot (green/yellow/red) with node count fraction.

---

## 4. State Management with Zustand (6 minutes)

### Cluster Store

**State:**
- nodes: NodeHealth[] - array with id, address, healthy, lastCheck, consecutiveFailures
- stats: ClusterStats | null - totalEntries, totalMemory, avgHitRate, totalEvictions
- distribution: Record<string, { count, percentage }> | null
- loading, error, lastUpdated

**Actions:**

fetchClusterStatus() sets loading, fetches /cluster/status, then fetches /node/{id}/stats for each healthy node in parallel. Aggregates stats (sum entries/memory/evictions, average hitRate). Updates state with nodes, aggregated stats, lastUpdated timestamp. Catches errors to set error message.

fetchDistribution() fetches /cluster/distribution, updates distribution state.

refreshAll() calls both fetch methods in parallel.

**Computed Selectors:**
- selectHealthyNodes - filters nodes where healthy is true, returns count
- selectTotalNodes - returns nodes array length

### Cache Store

**State:**
- entries: CacheEntry[] - array with key, value, ttl, size, node
- searchQuery, selectedKey, loading, operationLoading, error

**Actions:**

setSearchQuery(query) and selectKey(key) update respective state.

fetchKey(key) sets loading, fetches /cache/{encodedKey}. Returns CacheEntry or null on 404, sets error for other failures.

setKey(key, value, ttl) implements optimistic update: saves prevEntries, immediately adds new entry to front of list (removing duplicate key). Then fetches PUT /cache/{key} with { value, ttl }. On failure, rolls back to prevEntries and sets error.

deleteKey(key) implements optimistic update: removes key from entries, clears selectedKey. Fetches DELETE /cache/{key}. On failure, rolls back and sets error.

searchKeys(pattern) fetches /cache/search?pattern={encoded}, updates entries with response.keys.

---

## 5. API Service Layer (4 minutes)

**Configuration:**
- baseUrl from VITE_API_URL or 'http://localhost:3000'
- timeout: 10000ms
- retries: 3
- adminKey from VITE_ADMIN_KEY

**ApiError Class:**
Extends Error with status number and optional data. Used for HTTP error responses.

**fetchWithRetry Function:**
Loops from attempt 0 to retries count. Creates AbortController with timeout. Fetches with signal attached. On non-OK response, parses JSON and throws ApiError. On success, clears timeout and returns response.

Catches errors: if ApiError with 4xx status, throws immediately (don't retry client errors). Otherwise, applies exponential backoff (2^attempt * 100ms) before next attempt.

**buildHeaders Function:**
Returns headers with Content-Type: application/json. Adds X-Admin-Key if configured.

**API Object Methods:**
- get(path) - GET request, returns parsed JSON
- put(path, body) - PUT with JSON body, returns parsed JSON
- delete(path) - DELETE request, returns parsed JSON

All methods use fetchWithRetry with configured retries.

---

## 6. Dashboard Overview Component (6 minutes)

Dashboard component uses useClusterStore destructuring: nodes, stats, loading, error, lastUpdated, refreshAll.

**Auto-refresh:** useEffect calls refreshAll on mount and sets 5-second interval, clears on unmount.

**Loading State:** Shows LoadingSpinner if loading and no stats yet.

**Error State:** Shows ErrorMessage with retry button if error and no stats.

**Main Layout:**
Header with "Dashboard" title, relative time since lastUpdated, Refresh button (disabled while loading).

**Stats Grid (4 columns on lg):**
1. Cluster Health - shows healthy/total nodes with status indicator
2. Total Entries - formatted number of cached keys
3. Memory Usage - formatted bytes (B/KB/MB)
4. Hit Rate - percentage with status (good >=90%, warning >=70%, bad <70%)

**Two Column Layout:**
Left: Node Status section with NodeList component.
Right: Hit Rate Chart section with HitRateChart component.

**Helper Components:**

LoadingSpinner - centered flex container with spinning border animation, role="status".

ErrorMessage - red alert box with message text and Retry button calling onRetry.

**Helper Functions:**
- formatNumber() - Intl.NumberFormat for thousands separators
- formatBytes() - converts bytes to B/KB/MB with one decimal
- formatRelativeTime() - shows "just now", "Xm ago", or "Xh ago"

### Stats Card Component

StatsCard accepts title, value, subtitle, optional status ('good' | 'warning' | 'bad').

Renders white rounded shadow card with:
- dt: title in small gray text
- dd: value in large text, colored by status (green/yellow/red) or gray
- dd: subtitle in small gray text

---

## 7. Key Browser Component (6 minutes)

KeyBrowser component uses useCacheStore for entries, searchQuery, setSearchQuery, searchKeys, deleteKey, loading, operationLoading.

Local state: showAddModal boolean.

**Debounced Search:** useDebounce hook with 300ms delay. useEffect triggers searchKeys when debouncedSearch changes.

**Delete Handler:** Shows confirm dialog, calls deleteKey if confirmed.

**Layout:**
Header with "Key Browser" title and green "Add Key" button.

Search bar with search icon, input for pattern (placeholder: "user:*, session:123"), loading spinner on right when fetching.

**Results Table:**
- Headers: Key, Value Preview, Node, Actions
- KeyRow component for each entry
- Empty state: "No keys match" if searchQuery exists, else "Enter a search pattern"

AddKeyModal shown when showAddModal is true.

### KeyRow Component

Receives entry, onDelete callback, disabled boolean.

valuePreview computed via useMemo: if string, truncate at 50 chars with ellipsis. If object, stringify and truncate.

Renders table row with:
- Key as Link to /keys/$key with blue monospace text
- Value preview in code block with gray background
- Node name or "Unknown"
- Delete button (red text, disabled during operation)

---

## 8. Hash Ring Visualization (5 minutes)

HashRingVisualization component accepts nodes array, distribution record, virtualNodesPerNode.

**ringData computed via useMemo:**
- nodeColors array: blue, green, amber, red, purple
- Maps nodes to objects with color, percentage from distribution, arcDegrees (360/nodes.length), startAngle

**SVG Dimensions:**
size=300, center=150, radius=120, innerRadius=80

**SVG Structure:**
Role="img" with aria-label describing hash ring visualization.

**Ring Segments:**
For each node, calculates start/end angles (offset by -90 degrees for top start).

Computes x1,y1 outer arc start, x2,y2 outer arc end, inner arc points.

Builds path data: M to start, A arc to end, L to inner end, A reverse inner arc, Z close.

Path fill uses node color if healthy, gray if not. Opacity 0.5 for unhealthy. White stroke separates segments.

Title element shows "{node.id}: {percentage}" on hover.

**Center Text:**
Two text elements: healthy/total count (bold), "nodes healthy" label (small gray).

**Legend:**
Flex wrap container with colored circles and node labels. Gray with reduced opacity for unhealthy nodes.

---

## 9. Test Interface Component (4 minutes)

TestInterface uses useCacheStore for fetchKey, setKey, deleteKey, operationLoading.

**Local State:**
- operation: 'get' | 'set' | 'delete' (default 'get')
- key, value, ttl input strings
- result: string | null
- resultType: 'success' | 'error' | null

**handleSubmit:**
Validates key is not empty.

For 'get': calls fetchKey, shows JSON.stringify(value, null, 2) or "Key not found".

For 'set': tries JSON.parse on value, falls back to string. Converts ttl to milliseconds. Calls setKey, shows success/failure message.

For 'delete': calls deleteKey, shows "Key deleted" or "Key not found".

Catches errors and sets result with error message.

**Form Layout:**

Operation Selector - radio group with GET/SET/DELETE buttons. Selected shows blue styling.

Key Input - required text field with placeholder "user:123".

Value Input (only for SET) - textarea for JSON or string with placeholder showing JSON example.

TTL Input (only for SET) - number input for seconds with min=1.

Submit Button - full width, shows "Processing..." while loading.

**Result Display:**
Conditional render when result exists. Green background for success, red for error. Shows "Result" heading and pre-formatted result text.

---

## 10. Custom Hooks (3 minutes)

### useDebounce Hook

Generic hook accepting value of type T and delay in milliseconds.

Uses useState to track debouncedValue.

useEffect sets timeout to update debouncedValue after delay. Clears timeout on value or delay change.

Returns debouncedValue.

### usePolling Hook

Accepts callback (async function), interval in milliseconds, enabled boolean (default true).

Uses useRef to store savedCallback (updated on callback change).

useRef for timeoutRef to track setTimeout ID.

poll function (useCallback): awaits savedCallback.current, catches errors to console, schedules next poll if enabled.

useEffect: if enabled, starts polling. Cleanup clears timeout.

---

## 11. Accessibility Considerations

### Keyboard Navigation

All interactive elements are keyboard accessible. Tab order follows logical flow. Focus indicators are visible.

NodeList example: ul with role="list", each li has focus-within styling for ring. Button inside is full-width with focus:outline-none, uses aria-label with node id and health status. Status badge uses role="status".

### Screen Reader Support

Live regions for dynamic updates using role="alert" and aria-live="polite".

ClusterAlerts example: sr-only div announces "Warning: X node(s) unhealthy" when unhealthyCount > 0.

---

## 12. Key Frontend Trade-offs

| Decision | Trade-off |
|----------|-----------|
| Polling vs WebSocket | Polling simpler, WebSocket more real-time |
| Optimistic updates | Better UX, risk of showing incorrect state briefly |
| Local search filtering | Faster for small datasets, needs server for large |
| SVG for visualization | Flexible, but complex; could use D3 for larger visualizations |
| Zustand vs Redux | Lighter, less boilerplate; Redux has better dev tools |

---

## Summary

This frontend design for a distributed cache admin dashboard demonstrates:

1. **File-based Routing**: TanStack Router with clear URL structure
2. **State Management**: Zustand stores for cluster and cache state
3. **API Layer**: Fetch wrapper with retry and error handling
4. **Real-time Updates**: Polling with configurable intervals
5. **Visualizations**: Hash ring SVG and stats charts
6. **Testing Interface**: Interactive GET/SET/DELETE tool
7. **Accessibility**: Keyboard navigation, ARIA labels, live regions
8. **Performance**: Debounced search, optimistic updates

The dashboard provides operators with visibility into cache health, key distribution, and the ability to manually manage cache entries for debugging and operations.
