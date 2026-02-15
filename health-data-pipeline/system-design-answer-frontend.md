# Health Data Pipeline - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

---

## 📋 Opening Statement (1 minute)

"I'll design the frontend for a health data pipeline like Apple Health, which displays metrics from multiple devices, visualizes health trends over time, and allows users to share data with healthcare providers. The key frontend challenges are rendering large amounts of time-series data efficiently, building responsive chart visualizations that work across date ranges, and creating intuitive interfaces for managing privacy and sharing settings.

The core technical challenges are implementing performant chart rendering with Recharts, managing complex health data state with Zustand, building accessible date range selectors for historical queries, and creating a dashboard that surfaces AI-generated insights prominently while showing real-time device sync status."

---

## 🎯 Requirements Clarification (3 minutes)

### User-Facing Features
- **Dashboard**: Daily summary with key health metrics across activity, vitals, body, and sleep
- **Trends**: Historical charts for each metric type with configurable date ranges
- **Insights**: AI-generated health recommendations sorted by severity
- **Devices**: Manage connected devices and monitor sync status
- **Sharing**: Create and manage time-limited share tokens for providers

### Non-Functional Requirements
- **Performance**: Charts render in under 100ms with weeks of data
- **Responsiveness**: Dashboard adapts from mobile to desktop breakpoints
- **Accessibility**: WCAG 2.1 AA for health-critical information display
- **Offline**: Display cached data when the device loses connectivity

### UI Scale Estimates
- 16 health metric types across 4 categories (activity, vitals, body, sleep)
- Charts can show 7 to 365 days of data
- Up to 1,440 data points per day for heart rate at one-minute granularity
- Real-time sync status updates via SSE connection

---

## 🏗️ High-Level Architecture (5 minutes)

```
┌──────────────────────────────────────────────────────────────┐
│                     React Application                         │
│                                                               │
│  ┌─────────────────────┐   ┌───────────────────────────────┐ │
│  │    Layout Shell      │   │       Route Components        │ │
│  │  - Navigation        │   │  - Dashboard (/)              │ │
│  │  - Header            │   │  - Trends (/trends/:type)     │ │
│  │  - SyncStatusBar     │   │  - Insights (/insights)       │ │
│  └─────────────────────┘   │  - Devices (/devices)          │ │
│                             │  - Sharing (/sharing)          │ │
│  ┌─────────────────────┐   └───────────────────────────────┘ │
│  │   Zustand Stores     │                                     │
│  │  - healthStore       │   ┌───────────────────────────────┐ │
│  │  - uiStore           │   │      Chart Components         │ │
│  │  - syncStore         │   │  - LineChart (trends)         │ │
│  └─────────────────────┘   │  - BarChart (daily totals)    │ │
│                             │  - AreaChart (ranges)          │ │
│                             └───────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                       API Layer                               │
│  /api/v1/users/me/summary  │  /api/v1/users/me/aggregates    │
│  /api/v1/users/me/insights │  /api/v1/devices/:id/sync       │
└──────────────────────────────────────────────────────────────┘
```

> "I'm using TanStack Router for file-based routing, Zustand for global state, and Recharts for chart rendering. The layout shell persists across routes and includes the sync status indicator, so users always know whether their data is fresh. Chart components are shared between the Dashboard (mini sparklines) and Trends page (full interactive charts)."

---

## 📊 Deep Dive: Health Dashboard Layout (8 minutes)

The dashboard is the primary surface. It shows a daily snapshot organized by health category.

```
┌──────────────────────────────────────────────────────────────┐
│            INSIGHTS BANNER (full width, if any)               │
│  ⚠️  Your resting heart rate has increased 5% this month     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│    ACTIVITY       │  │     VITALS        │  │      SLEEP       │
├──────────────────┤  ├──────────────────┤  ├──────────────────┤
│ Steps             │  │ Heart Rate        │  │ 7h 23m           │
│   8,234 / 10,000  │  │   72 bpm avg      │  │   ████████░░     │
│   ████████░░      │  │                   │  │   Goal: 8h       │
│                   │  │ Resting HR        │  └──────────────────┘
│ Calories          │  │   58 bpm          │
│   423 / 500       │  │                   │  ┌──────────────────┐
│   ████████░       │  │ Blood O2          │  │     WEIGHT       │
└──────────────────┘  │   98%             │  ├──────────────────┤
                      └──────────────────┘  │ 72.5 kg           │
                                            │ 22.1% body fat    │
                                            └──────────────────┘
```

### Responsive Grid Strategy

| Breakpoint | Grid Layout | Description |
|------------|-------------|-------------|
| Mobile (< 768px) | 1 column | Cards stack vertically, insights banner collapses |
| Tablet (768-1024px) | 2 columns | Activity + Vitals side by side, Sleep + Weight below |
| Desktop (> 1024px) | 3 columns | All category cards visible simultaneously |

> "I use a CSS Grid with Tailwind's responsive utilities. Each card is self-contained with its own loading state. On mobile, the insights banner becomes a dismissible notification to save vertical space. The grid reflows naturally without JavaScript layout calculations."

### Daily Summary Card Anatomy

Each card follows a consistent structure: icon and category title at the top, then a list of metrics with progress bars for goal-tracked values and plain readings for vitals.

```
┌──────────────────────────────┐
│  [icon]  ACTIVITY             │
├──────────────────────────────┤
│                               │
│  Steps              8,234     │
│  ████████░░░░░░░░    steps    │
│  (82% of 10,000 goal)        │
│                               │
│  Distance            5.2 km   │
│                               │
│  Active Calories      423     │
│  ████████░░░░░░░░    kcal     │
│  (85% of 500 goal)           │
│                               │
└──────────────────────────────┘
```

Progress bars use role="progressbar" with aria-valuenow, aria-valuemax, and a descriptive aria-label like "8,234 of 10,000 steps". This ensures screen readers announce meaningful context rather than just a percentage.

### Metric Configuration

| Metric | Display Name | Unit | Color | Goal |
|--------|--------------|------|-------|------|
| STEPS | Steps | steps | #22c55e (green) | 10,000 |
| HEART_RATE | Heart Rate | bpm | #ef4444 (red) | - |
| RESTING_HEART_RATE | Resting HR | bpm | #f97316 (orange) | - |
| SLEEP_ANALYSIS | Sleep | hours | #8b5cf6 (purple) | 8 |
| WEIGHT | Weight | kg | #3b82f6 (blue) | - |
| DISTANCE | Distance | km | #06b6d4 (cyan) | - |
| ACTIVE_ENERGY | Calories | kcal | #eab308 (yellow) | 500 |
| OXYGEN_SATURATION | Blood O2 | % | #0ea5e9 (sky) | - |

---

## 📈 Deep Dive: Trend Charts with Recharts (8 minutes)

The Trends page shows a full interactive chart for a selected health metric over a configurable date range. This is the most complex frontend component.

```
┌──────────────────────────────────────────────────────────────┐
│                  TrendChart Component                          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  ResponsiveContainer (100% width, 320px height)          │ │
│  │  ┌──────────────────────────────────────────────────────┐│ │
│  │  │    120 ─┤                   .                        ││ │
│  │  │         │                  . .    Goal line           ││ │
│  │  │    100 ─┤ ─ ─ ─ ─ ─ ─ .─.─.─.─.─.─.─.─.─ ─ ─ ─ ─  ││ │
│  │  │         │           .         .                      ││ │
│  │  │     80 ─┤        .             .                     ││ │
│  │  │         │      .                 .    Trend line      ││ │
│  │  │     60 ─┤ . . . . . . . . . . . . . . . . .         ││ │
│  │  │         │                                            ││ │
│  │  │     40 ─┤                                            ││ │
│  │  │         └──┬────┬────┬────┬────┬────┬────┬──         ││ │
│  │  │           Mon  Tue  Wed  Thu  Fri  Sat  Sun          ││ │
│  │  └──────────────────────────────────────────────────────┘│ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Date Formatting by Range

| Date Range | X-Axis Format | Example | Tick Count |
|------------|---------------|---------|------------|
| 7 days | Day name | Mon, Tue, Wed | 7 |
| 30 days | Month Day | Jan 5, Jan 12 | ~8 |
| 90 days | Month | Jan, Feb, Mar | ~6 |
| 1 year | Month | Jan, Apr, Jul, Oct | ~12 |

### Tooltip Design

When the user hovers or taps a data point, a tooltip appears showing the formatted date and the metric value with its unit. The tooltip follows the cursor and is positioned to avoid clipping at chart edges.

```
┌─────────────────────────┐
│ Saturday, January 15     │
│                          │
│ 8,234 steps              │
└─────────────────────────┘
```

### Trend Line Calculation

The trend line uses linear regression over the visible data points. The slope is calculated as (n * SumXY - SumX * SumY) / (n * SumX^2 - (SumX)^2), where X is the day index and Y is the metric value. The trend line only renders when the data set contains at least 7 points, preventing misleading conclusions from sparse data.

> "I chose to compute the trend line on the frontend because it's a pure function of the displayed data points. When the user switches date ranges, the trend line recalculates instantly without an API call. The calculation is O(n) and operates on at most 365 pre-aggregated points, so performance is never a concern."

---

## 🔧 Deep Dive: Trade-off -- SVG vs Canvas for Chart Rendering

**Decision**: Use SVG-based rendering via Recharts.

**Why SVG works for this problem**: Health dashboards display at most 365 data points for a one-year view, well within SVG's performance ceiling. SVG gives us native DOM events for tooltips and hover interactions, crisp rendering at any display density (critical for retina displays where health professionals might read charts), and built-in accessibility through ARIA attributes on chart elements.

**Why Canvas fails here**: Canvas rendering would require us to implement our own hit-testing for tooltip interactions -- effectively rebuilding DOM event handling in JavaScript. It also produces rasterized output that blurs on high-DPI displays unless we manually handle device pixel ratio scaling. For a data visualization where users need to hover individual data points to see exact values, canvas creates unnecessary complexity.

**What we give up**: SVG degrades when rendering more than approximately 1,000 DOM nodes. If a user requests minute-level heart rate data for a full day (1,440 points), we would hit this threshold. We mitigate this by requesting server-side aggregation -- the API accepts a period parameter (hour, day, week) so the frontend never receives more than 365 data points regardless of the date range selected.

---

## 🗄️ Deep Dive: Zustand Health Store (8 minutes)

### Store Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        healthStore                            │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────┐   ┌────────────────────────────────┐ │
│  │  Date Selection     │   │  Cached Data                   │ │
│  ├────────────────────┤   ├────────────────────────────────┤ │
│  │  selectedDate       │   │  dailySummary: {type: value}   │ │
│  │  dateRange:         │   │  aggregates: {type: points[]}  │ │
│  │    { start, end }   │   │  insights: Insight[]           │ │
│  │  dateRangePreset:   │   └────────────────────────────────┘ │
│  │    7d | 30d | 90d   │                                      │
│  └────────────────────┘                                      │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Actions                                                │  │
│  │  setSelectedDate(date) ──▶ triggers fetchDailySummary   │  │
│  │  setDateRangePreset(p) ──▶ updates range, refetches     │  │
│  │  fetchDailySummary(date) ──▶ GET /api/v1/users/me/summary│  │
│  │  fetchAggregates(types[], range) ──▶ GET /aggregates    │  │
│  │  fetchInsights() ──▶ GET /api/v1/users/me/insights      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Persistence Strategy

The store uses Zustand's persist middleware, but only persists user preferences (dateRangePreset), never health data. Health data is always fetched fresh on app load to ensure accuracy.

> "Persisting stale health data would create a dangerous UX for a health application -- a user might see yesterday's heart rate reading and mistake it for current. By only persisting the user's preferred date range, we restore their view preferences while guaranteeing data freshness."

### Sync Status Store

```
┌──────────────────────────────────────────────────────────────┐
│                        syncStore                              │
├──────────────────────────────────────────────────────────────┤
│  devices: Array of {                                          │
│    id, name, type, lastSync, isSyncing                        │
│  }                                                            │
│                                                               │
│  overallStatus: synced | syncing | error | offline            │
│                                                               │
│  Status indicator mapping:                                    │
│  ┌──────────┬───────────┬──────────────────────────────────┐ │
│  │  Status   │  Icon     │  Label                           │ │
│  ├──────────┼───────────┼──────────────────────────────────┤ │
│  │  synced   │  ● green  │  "All devices synced"            │ │
│  │  syncing  │  ◐ blue   │  "Syncing..." (animated)         │ │
│  │  error    │  ● red    │  "Sync error - tap to retry"     │ │
│  │  offline  │  ○ gray   │  "Offline - cached data"         │ │
│  └──────────┴───────────┴──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

The sync status indicator lives in the layout header, visible on every route. It connects to an SSE endpoint at /sync-status that pushes real-time updates as devices complete their sync cycles.

---

## 📅 Deep Dive: Date Range Selector (5 minutes)

### Selector Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ┌───────┬───────┬───────┬───────┐     Jan 8 - Jan 15, 2024  │
│  │  7D   │  30D  │  90D  │  1Y   │                            │
│  └───────┴───────┴───────┴───────┘                            │
│     ↑                                                         │
│   selected (white bg, ring shadow)                            │
└──────────────────────────────────────────────────────────────┘
```

### Interaction Flow

```
    User clicks "30D"
         │
         ▼
┌──────────────────────┐
│ setDateRangePreset   │
│ ('30d')              │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Calculate range:      │
│ start = today - 30    │
│ end = today           │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Store updates:        │
│ dateRangePreset, range│
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Charts re-render with │
│ new data window       │
└──────────────────────┘
```

Each button uses aria-pressed to indicate the active selection. The button group is wrapped in a role="group" with an aria-label of "Date range selection" so screen readers announce context. Keyboard navigation moves between buttons with arrow keys.

---

## 💡 Deep Dive: Insights Display (5 minutes)

### Insight Card Design

Insights are sorted by severity (high first) and capped at 3 on the dashboard preview. The full list is available on the Insights page.

```
┌──────────────────────────────────────────────────────────────┐
│ HIGH SEVERITY (red left border)                               │
├──────────────────────────────────────────────────────────────┤
│ ⚠️  Your resting heart rate has increased over the past month │
│                                                               │
│   Consider scheduling a check-up with your doctor if          │
│   this trend continues.                                       │
│                                                         [X]   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ MEDIUM SEVERITY (yellow left border)                          │
├──────────────────────────────────────────────────────────────┤
│ 😴  You've averaged 5.8 hours of sleep over the past 2 weeks │
│                                                               │
│   Try setting a consistent bedtime to improve sleep quality.  │
│                                                         [X]   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ LOW SEVERITY (blue left border)                               │
├──────────────────────────────────────────────────────────────┤
│ 📈  Great job! You're 23% more active than your 4-week avg   │
│                                                         [X]   │
└──────────────────────────────────────────────────────────────┘
```

### Insight Types and Triggers

| Insight Type | Icon | Condition | Severity |
|--------------|------|-----------|----------|
| Heart Rate Trend (up) | 📈 | slope > 0.5 BPM/day over 30 days | medium |
| Heart Rate Trend (down) | 📉 | slope < -0.5 BPM/day over 30 days | low |
| Sleep Deficit | 😴 | avg < 6 hours over 14 days | high |
| Activity Change (up) | 🏃 | > +20% vs 4-week average | low |
| Activity Change (down) | ⚠️ | < -20% vs 4-week average | medium |
| Weight Change | ⚖️ | > 3% change over 30 days | medium |

### Severity Styling

| Severity | Background | Border | Text |
|----------|------------|--------|------|
| high | bg-red-50 | border-l-4 border-red-500 | text-red-800 |
| medium | bg-yellow-50 | border-l-4 border-yellow-500 | text-yellow-800 |
| low | bg-blue-50 | border-l-4 border-blue-500 | text-blue-800 |

High-severity insights use role="alert" with aria-live="polite" so screen readers announce them when the page loads, without interrupting current navigation.

---

## 🔧 Deep Dive: Trade-off -- Server-Side vs Client-Side Aggregation

**Decision**: Request pre-aggregated data from the server.

**Why server-side aggregation works**: The backend already computes hourly and daily aggregates during the ingestion pipeline. Sending raw samples to the frontend would mean transmitting 1,440 heart rate readings per day -- for a 30-day chart view, that is 43,200 data points. At roughly 50 bytes per sample, that is over 2MB per chart load, which is unacceptable on mobile networks. Pre-aggregated daily data for the same view is 30 data points at about 1.5KB total.

**Why client-side aggregation fails at scale**: Beyond the payload size problem, client-side aggregation would require the browser to run the deduplication algorithm. Two devices might report overlapping step counts for the same time window, and the frontend would need to understand device priority rankings to resolve conflicts. This is domain logic that belongs on the server -- if the priority algorithm changes, we would need to push a client update rather than simply reprocessing on the backend.

**What we give up**: Flexibility. When a user is viewing a 7-day chart and wants to drill down to hourly resolution for a specific day, we need an additional API call with a different period parameter. This adds latency to the drill-down interaction (approximately 200ms for a cached response). For a health dashboard where users primarily view daily summaries, this trade-off favors smaller payloads and consistent deduplication over interactive drill-down speed.

---

## 🔧 Deep Dive: Trade-off -- Zustand vs React Query for Data Management

**Decision**: Use Zustand for state management with custom fetch actions.

**Why Zustand works for this application**: Health data has a natural structure -- a selected date drives the daily summary, and a date range drives chart data. Zustand's flat store model makes it easy to derive views from these two pieces of state. The persist middleware handles saving user preferences (preferred date range) without additional configuration. Unlike Redux, there is no boilerplate of action creators, reducers, and middleware setup.

**Why React Query would create problems**: React Query excels when each component independently fetches its own data. But on the health dashboard, multiple cards share the same summary response -- steps, heart rate, sleep, and weight all come from a single GET /summary call. With React Query, we would either make redundant requests from each card or extract the query to a parent component and prop-drill the results. Zustand's shared store gives every card access to the same fetched data without coordination overhead.

**What we give up**: React Query provides automatic background refetching, stale-while-revalidate, and cache invalidation out of the box. With Zustand, we implement these manually -- a 5-minute refetch interval via setInterval, and explicit cache clearing when the user navigates away. This is approximately 30 lines of custom code that React Query would handle for free. For this application, the simpler mental model of a flat store outweighs the convenience of automatic cache management.

---

## ♿ Accessibility Considerations (2 minutes)

### Chart Accessibility

Charts are inherently visual. For screen reader users, each chart includes a hidden data table alternative that presents the same information in tabular form. The chart container uses an aria-label describing the chart purpose and data range, for example "Steps trend chart showing 7 days of data."

### Color Accessibility

Each metric uses both color and line pattern to distinguish from others when multiple metrics are overlaid.

| Metric | Color | Pattern |
|--------|-------|---------|
| Steps | Green (#22c55e) | Solid line |
| Heart Rate | Red (#ef4444) | Dashed line |
| Sleep | Purple (#8b5cf6) | Dotted line |

All color combinations meet WCAG 2.1 AA contrast requirements with a minimum 4.5:1 ratio against the white chart background.

### Keyboard Navigation

- Date range selector buttons support arrow key navigation within the group
- Dashboard cards are focusable and expand details on Enter
- Insight dismiss buttons are keyboard accessible with visible focus rings

---

## ⚖️ Trade-offs Summary (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Chart Library | ✅ Recharts | ❌ D3.js | React-native declarative API, good TypeScript support, built-in responsiveness |
| State Management | ✅ Zustand | ❌ React Query | Flat shared store for multi-card dashboard, built-in persistence |
| Rendering | ✅ SVG | ❌ Canvas | Crisp at any resolution, native DOM events for tooltips, accessible |
| Date Library | ✅ date-fns | ❌ Moment.js | Tree-shakeable, immutable, no global mutation |
| Aggregation | ✅ Server-side | ❌ Client-side | Smaller payloads, consistent deduplication logic on server |
| Styling | ✅ Tailwind CSS | ❌ CSS Modules | Utility-first for rapid iteration, consistent spacing system |

---

## 🚀 Closing Summary (1 minute)

"The health data pipeline frontend is built around three principles:

1. **Dashboard-first design** -- The daily summary provides an at-a-glance view of key health metrics with progress indicators toward goals. Insights are prominently displayed with severity-based ordering so critical health alerts are never buried.

2. **Responsive chart visualizations** -- Recharts provides declarative SVG-based charts for trend analysis. Date range presets (7D, 30D, 90D, 1Y) enable quick navigation through historical data with server-side aggregation keeping payloads small regardless of the time window.

3. **Zustand for coordinated state** -- A single store manages date selection, cached aggregates, and insights with persist middleware for user preferences. This enables consistent state across the dashboard, trends, and insights views without prop-drilling or redundant API calls.

The main trade-off is simplicity versus flexibility. Server-side aggregation means smaller payloads and consistent deduplication, but requires additional API calls when users want different time granularities. For a health dashboard where users typically view daily aggregates, this trade-off favors simpler client code and faster initial loads."
