# Dashboarding System (Metrics Monitoring) - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

---

## Introduction

"Today I'll design a metrics monitoring and visualization system similar to Datadog or Grafana. This system provides real-time dashboards for visualizing time-series metrics from thousands of servers. As a frontend engineer, I'll focus on the dashboard builder, chart rendering, responsive layouts, time range selection, and real-time data updates."

---

## Step 1: Requirements Clarification

### Functional Requirements

"Let me confirm the core frontend functionality:

1. **Dashboard Builder**: Drag-and-drop panel layout with grid system
2. **Multiple Chart Types**: Line, area, bar, gauge, and stat panels
3. **Time Range Selector**: Preset ranges and custom date picker
4. **Real-Time Updates**: Auto-refresh with configurable intervals
5. **Metrics Explorer**: Browse and search available metrics
6. **Alert Management**: Create, edit, and monitor alert rules
7. **Responsive Design**: Usable on desktop and tablet"

### Non-Functional Requirements

"For a monitoring dashboard frontend:

- **Performance**: Render 20+ panels per dashboard smoothly
- **Responsiveness**: Sub-100ms interaction feedback
- **Update Rate**: 10-second auto-refresh without flicker
- **Large Datasets**: Handle 10,000+ data points per chart
- **Accessibility**: WCAG 2.1 AA compliance for critical functions"

---

## Step 2: Component Architecture

### High-Level Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              App Shell                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Navbar                                                                │  │
│  │  - Logo, Navigation (Dashboards, Alerts, Metrics, Settings)           │  │
│  │  - Time Range Selector, User Menu                                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Main Content (TanStack Router Outlet)                                 │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Dashboard Page                                                  │  │  │
│  │  │  ┌───────────────────────────────────────────────────────────┐  │  │  │
│  │  │  │  Dashboard Header (title, edit mode toggle, refresh btn)  │  │  │  │
│  │  │  └───────────────────────────────────────────────────────────┘  │  │  │
│  │  │  ┌───────────────────────────────────────────────────────────┐  │  │  │
│  │  │  │  Dashboard Grid (react-grid-layout)                       │  │  │  │
│  │  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐                     │  │  │  │
│  │  │  │  │ Panel 1 │ │ Panel 2 │ │ Panel 3 │                     │  │  │  │
│  │  │  │  │ (Line)  │ │ (Gauge) │ │ (Stat)  │                     │  │  │  │
│  │  │  │  └─────────┘ └─────────┘ └─────────┘                     │  │  │  │
│  │  │  │  ┌──────────────────────┐ ┌─────────┐                    │  │  │  │
│  │  │  │  │      Panel 4         │ │ Panel 5 │                    │  │  │  │
│  │  │  │  │      (Area)          │ │ (Bar)   │                    │  │  │  │
│  │  │  │  └──────────────────────┘ └─────────┘                    │  │  │  │
│  │  │  └───────────────────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Organization

**charts/** - Chart components
- LineChart (line/area), BarChart, GaugeChart, StatDisplay, chartUtils

**dashboard/** - Dashboard components
- DashboardGrid (layout wrapper), DashboardPanel (container), PanelEditor (config modal), DashboardHeader

**alerts/** - Alert components
- AlertRuleForm, AlertRuleCard, AlertRuleList, AlertHistoryTable

**layout/** - Layout components
- Navbar, Sidebar, PageContainer

**common/** - Shared components
- TimeRangeSelector, MetricPicker, LoadingSpinner, ErrorBoundary

**hooks/** - Custom React hooks
- useQuery (data fetching with polling), useDashboard, useAlerts, useTimeRange

**stores/** - Zustand state stores
- dashboardStore, timeRangeStore, alertStore

**routes/** - TanStack Router pages
- index (dashboard list), dashboard.$id (view), alerts, metrics

---

## Step 3: Core Components

### Dashboard Grid with Drag-and-Drop

"I'm choosing react-grid-layout for the dashboard grid because it provides built-in drag-and-drop, resize handles, and responsive breakpoints. It integrates well with React's component model."

**DashboardGrid Component:**
- Wraps ResponsiveGridLayout with WidthProvider
- Converts panels to layout format (i, x, y, w, h, minW, minH)
- Breakpoints: lg (1200), md (996), sm (768)
- Columns: lg (12), md (10), sm (6)
- rowHeight: 80px, margin: 16px
- isDraggable/isResizable tied to isEditing mode
- draggableHandle: ".panel-drag-handle"

### Dashboard Panel Container

**DashboardPanel Component:**
- Fetches data using custom useQuery hook with 10s refetch interval
- Memoized chart component selection based on panel.type
- Header with drag handle (edit mode), title, settings/delete buttons
- Content area with loading spinner, error state, or chart
- Routes to LineChart, BarChart, GaugeChart, or StatDisplay

### Line Chart with Recharts

"I'm implementing time-series charts with Recharts because it's React-native, has good performance with large datasets, and provides built-in responsive container."

**LineChart Component:**
- Formats data: converts timestamps to numeric, extracts values
- Calculates Y-axis domain with 10% padding
- Uses ResponsiveContainer for automatic sizing
- CartesianGrid with dashed lines
- XAxis: numeric type, dataMin/dataMax domain, formatted timestamps
- YAxis: calculated domain, formatted values with units
- Tooltip with dark theme styling
- Line/Area element with monotone curve, no dots, active dot on hover

### Gauge Chart

**GaugeChart Component:**
- Takes min, max, thresholds (warning, critical)
- Gets latest value from data array
- Calculates percentage within range
- Determines color: green (< warning), amber (< critical), red (>= critical)
- Renders as semicircular PieChart (180 to 0 degrees)
- Displays current value, label, min/max indicators

### Stat Panel

**StatDisplay Component:**
- Calculation options: last, avg, min, max, sum
- Displays calculated value with formatting
- Optional trend indicator comparing first half to second half of data
- Shows arrow up/down/flat with percent change
- Color coded: green (up), red (down), muted (flat)

---

## Step 4: Time Range Selector

"I'm implementing a dropdown selector with preset ranges and custom date picker. The selection is stored in Zustand for global access across all panels."

**Preset Ranges:**
- 5m, 15m, 1h, 3h, 6h, 12h, 24h, 7d, 30d

**TimeRangeSelector Component:**
- Trigger button showing current selection with clock icon
- Dropdown with tabs: Presets | Custom
- Preset tab: List of range buttons, highlighted when selected
- Custom tab: Start date/time and end date/time inputs, Apply button
- Closes on outside click or Escape key
- Updates Zustand store on selection

**CustomDatePicker:**
- Date input (type="date") and time input (type="time") for start/end
- Validates start < end before applying
- Calls onApply with Date objects

---

## Step 5: State Management with Zustand

### Time Range Store

"I'm using Zustand with persist middleware to maintain time range across sessions. The store provides computed start/end dates from either preset or custom range."

**State:**
- preset (string or null)
- customStart, customEnd (Date or null)
- refreshInterval (seconds)

**Computed:**
- start: derived from preset or customStart
- end: derived from preset or customEnd

**Actions:**
- setPreset(preset): clears custom, sets preset
- setCustomRange(start, end): clears preset, sets custom
- setRefreshInterval(interval)
- getDisplayLabel(): returns human-readable label

**parsePreset Function:**
- Parses "5m", "1h", "7d" format
- Returns { start, end } Date objects
- Calculates milliseconds offset from now

### Dashboard Store

**State:**
- dashboards (list), currentDashboard, isEditing, isLoading, error

**Actions:**
- fetchDashboards(): loads list
- fetchDashboard(id): loads single with panels
- createDashboard(name, description): creates and adds to list
- updateDashboard(id, updates): updates in API and state
- deleteDashboard(id): removes from API and state
- addPanel(dashboardId, panel): adds to current dashboard
- updatePanel(panelId, updates): updates panel config
- deletePanel(panelId): removes from current dashboard
- updateLayout(layout): updates panel positions from grid
- setEditing(isEditing): toggles edit mode

---

## Step 6: Data Fetching Hook with Polling

"I'm implementing a custom useQuery hook that supports automatic polling. This keeps charts updated without manual intervention."

**useQuery Hook:**
- Parameters: queryKey, queryFn, refetchInterval, enabled, onError
- Returns: data, isLoading, error, refetch

**Implementation:**
- useState for data, isLoading (initial true), error
- useRef for interval and key tracking
- fetchData callback with try/catch, updates state
- useEffect for initial fetch and key change detection
- useEffect for polling interval setup/cleanup
- JSON.stringify queryKey for comparison

---

## Step 7: Alert Management UI

### Alerts Page

**AlertsPage Component:**
- Page header with title, description, Create Rule button
- Error banner when error present
- Create form modal (triggered by button)
- Tab navigation: Alert Rules | History
- Content switches between AlertRuleList and AlertHistoryTable

### Alert Rule Card

**AlertRuleCard Component:**
- Border opacity reduced when disabled
- Header: severity badge, rule name, action buttons (toggle, evaluate, delete)
- Body: query expression, condition display, duration
- Icons: Bell/BellOff for enabled state, Play for test, Trash for delete
- Color-coded severity badges

---

## Step 8: Responsive Design and Accessibility

### Tailwind Configuration

**Custom Colors:**
- dashboard-bg: #0f1419
- dashboard-card: #1a1f2e
- dashboard-accent: #2d3748
- dashboard-text: #e2e8f0
- dashboard-muted: #718096
- dashboard-highlight: #3b82f6

**Custom Breakpoint:**
- xs: 475px

### Responsive Panel Grid

**Breakpoints and Columns:**
- lg (1200): 12 columns
- md (996): 10 columns
- sm (768): 6 columns
- xs (480): 4 columns

**Layout Adaptation:**
- lg: full layout
- md: constrain width to 10
- sm: stack vertically (x=0, w=6)
- xs: stack vertically (x=0, w=4)

### Accessibility Features

**Keyboard Navigation:**
- ArrowDown/ArrowUp: focus next/prev option
- Escape: close dropdown
- Tab for focus management

**ARIA Attributes:**
- role="listbox" for time range options
- role="option" with aria-selected for each option
- aria-haspopup, aria-expanded for dropdowns
- aria-label for icon buttons

**Screen Reader Support:**
- aria-live="polite" on panel container
- Hidden text with sr-only class for current values
- aria-hidden on decorative chart content

---

## Step 9: Performance Optimizations

### Chart Rendering Optimization

**Memoization:**
- React.memo on chart components with deep comparison
- Only re-render when data or options actually change

**Data Downsampling:**
- When data.length > maxPoints, sample with factor
- Min/max preservation: keep both min and max from each chunk
- Maintains visual accuracy while reducing render load

### Lazy Loading and Code Splitting

- React.lazy for heavy chart components
- Suspense wrapper with LoadingSpinner fallback
- Conditional rendering based on panel type

### Debounced Layout Updates

- useDebouncedCallback for layout saves (500ms, trailing)
- Immediate local state update for responsive feel
- Debounced API call to prevent overload during drag

---

## Step 10: Error Handling and Loading States

### Error Boundary

**ErrorBoundary Class Component:**
- getDerivedStateFromError captures error
- componentDidCatch logs to console (could send to tracking)
- Render fallback with AlertTriangle icon, message, retry button
- handleRetry clears error state

### Skeleton Loading States

**Skeleton Component:**
- Animated pulse effect
- Configurable className for sizing

**PanelSkeleton:**
- Header placeholder (1/3 width)
- Chart area with random-height bars (12 bars)

**DashboardSkeleton:**
- 12-column grid with 6 PanelSkeleton components
- Each spans 4 columns

---

## Trade-offs and Alternatives

| Decision | ✅ Chosen | ❌ Alternative | Reasoning |
|----------|-----------|----------------|-----------|
| State Management | Zustand | Redux, Context | Lightweight, no boilerplate, TypeScript support |
| Routing | TanStack Router | React Router | Type-safe routes, better dev experience |
| Charts | Recharts | Chart.js, D3.js | React-native, good time-series support |
| Grid Layout | react-grid-layout | CSS Grid, Masonry | Built-in drag-and-drop, resize handles |
| Styling | Tailwind CSS | styled-components, CSS Modules | Rapid prototyping, consistent design |
| Data Fetching | Custom hook | TanStack Query | Simpler for this use case, learning opportunity |

---

## Summary

"To summarize the frontend architecture for this dashboarding system:

1. **Component Architecture**: Feature-based organization with barrel exports, clear separation between container and presentational components

2. **Dashboard Builder**: react-grid-layout for drag-and-drop, responsive breakpoints, memoized chart rendering

3. **State Management**: Zustand for global state (time range, dashboard), local state for UI, custom hooks for data fetching

4. **Performance**: Lazy loading charts, debounced layout saves, data downsampling for large datasets

5. **Accessibility**: ARIA roles, keyboard navigation, screen reader announcements for data updates

Key frontend insights:
- Memoization is critical when rendering 20+ charts
- Debounced saves prevent API overload during drag operations
- Skeleton loading states improve perceived performance
- Custom hooks encapsulate polling and error handling logic

What aspect would you like me to elaborate on?"
