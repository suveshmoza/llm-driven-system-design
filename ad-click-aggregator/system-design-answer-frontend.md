# Ad Click Aggregator - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

---

## 📋 Problem Statement

Design the frontend dashboard for a real-time ad click analytics system. Key challenges include real-time data visualization, interactive time-series charts, responsive analytics layouts, and efficient state management for complex filter combinations.

---

## 🎯 Requirements Clarification

### Functional Requirements
1. **Real-time Metrics Display**: Live click counts, fraud rates, unique users
2. **Time-Series Charts**: Visualize clicks with zoom/pan capabilities
3. **Campaign Analytics**: Drill-down by campaign, ad, country, device
4. **Test Click Generator**: Development tool for simulating clicks
5. **Filter Controls**: Date range, campaign, country, device type selectors

### Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Update Frequency | 5 seconds | Balance freshness vs. server load |
| Chart Performance | 10,000+ points | Week of minute-level data |
| Viewport Support | Desktop + tablet | Analytics workflows |
| Accessibility | WCAG 2.1 AA | Enterprise compliance |

### Scale Estimates

| Metric | Value |
|--------|-------|
| Dashboard users | 100-1,000 concurrent |
| Data points per chart | Up to 10,000 |
| Refresh interval | 5 seconds |
| Network payload | ~50KB per refresh |

---

## 🏗️ High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         REACT APPLICATION                               │
├────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Dashboard  │  │  Campaign   │  │   Charts    │  │   Filters   │   │
│  │   Layout    │  │   Table     │  │  (Recharts) │  │   Panel     │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
├────────────────────────────────────────────────────────────────────────┤
│                        ZUSTAND STATE STORE                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐     │
│  │  Metrics Data  │  │  Filter State  │  │  UI State            │     │
│  │  - timeSeries  │  │  - timeRange   │  │  - isLoading         │     │
│  │  - byCampaign  │  │  - campaignId  │  │  - lastUpdated       │     │
│  │  - fraudRate   │  │  - country     │  │  - error             │     │
│  └────────────────┘  └────────────────┘  └──────────────────────┘     │
├────────────────────────────────────────────────────────────────────────┤
│                        API SERVICE LAYER                                │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐     │
│  │ /api/analytics │  │  /api/clicks   │  │  Auto-refresh Hook   │     │
│  │ GET aggregate  │  │  POST (test)   │  │  setInterval 5s      │     │
│  └────────────────┘  └────────────────┘  └──────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                       ┌───────────────────┐
                       │   Backend API     │
                       └───────────────────┘
```

---

## 📊 Deep Dive: Real-Time Dashboard State

### State Store Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ANALYTICS STORE                              │
├─────────────────────────────────────────────────────────────────┤
│  DATA SLICE              FILTER SLICE           UI SLICE        │
│  ──────────              ────────────           ────────        │
│  metrics:                timeRange:             isLoading       │
│    totalClicks             start, end           error           │
│    uniqueUsers             granularity          lastUpdated     │
│    fraudRate                                    activeModal     │
│    timeSeries[]          filters:                               │
│    byCampaign[]            campaignId                           │
│    byCountry[]             advertiserId                         │
│                            country                              │
│                            deviceType                           │
├─────────────────────────────────────────────────────────────────┤
│  ACTIONS                                                         │
│  setTimeRange()  setFilters()  fetchMetrics()  startAutoRefresh │
└─────────────────────────────────────────────────────────────────┘
```

### Selective Subscriptions (Key Optimization)

> "The critical insight is that analytics dashboards have many components updating at different rates. A chart showing clicks-over-time doesn't need to re-render when a filter dropdown opens. Zustand's selective subscriptions let each component subscribe only to the state slices it actually displays, preventing cascade re-renders that would destroy chart performance."

```
┌────────────────┐       subscribes to        ┌─────────────────┐
│  MetricCard    │ ──────────────────────────►│ metrics.total   │
│  (Total Clicks)│                            │ isLoading       │
└────────────────┘                            └─────────────────┘
        │
        │ does NOT re-render when:
        │ - filters.campaignId changes
        │ - metrics.byCountry changes
        │ - timeRange changes
        ▼
   (isolated from unrelated state updates)
```

### Auto-Refresh Flow

```
┌──────────────────┐
│  useAutoRefresh  │
└────────┬─────────┘
         ▼
    ┌────────────┐        ┌────────────────────────┐
    │ useEffect  │────────► Initial fetchMetrics() │
    │ on mount   │        └────────────────────────┘
    └────────────┘
         │
         │ if enabled
         ▼
    ┌────────────────────────────────────────┐
    │ setInterval(fetchMetrics, 5000)        │
    │                                         │
    │  Every 5 seconds:                       │
    │  1. Set isLoading = true               │
    │  2. Build query from filters           │
    │  3. GET /api/v1/analytics              │
    │  4. Update metrics + timestamp         │
    │  5. Set isLoading = false              │
    └────────────────────────────────────────┘
         │
         │ on unmount ──► clearInterval()
         ▼
    Filter changes ──────► Immediate refetch
```

---

## 📈 Deep Dive: Time-Series Visualization

### Chart Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   API Response  │────►│  useMemo        │────►│  Recharts       │
│   time_bucket   │     │  Transform      │     │  AreaChart      │
│   click_count   │     │  timestamp      │     │  Gradient fill  │
│   unique_users  │     │  clicks         │     │  Custom tooltip │
│   fraud_count   │     │  uniqueUsers    │     │  Brush zoom     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Chart Component Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ClicksChart                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     ResponsiveContainer                            │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │                       AreaChart                              │  │  │
│  │  │  - CartesianGrid (dashed)                                   │  │  │
│  │  │  - XAxis (formatted time by granularity)                    │  │  │
│  │  │  - YAxis (formatted count)                                  │  │  │
│  │  │  - Area: Total Clicks (blue gradient)                       │  │  │
│  │  │  - Area: Fraud Clicks (red gradient, stacked)              │  │  │
│  │  │  - Tooltip: Date, clicks, fraud count, fraud rate %        │  │  │
│  │  │  - Brush: Zoom/pan control (height: 30px)                  │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Granularity-Based X-Axis Formatting

| Granularity | Format | Example |
|-------------|--------|---------|
| minute | HH:mm | 14:30 |
| hour | HH:mm | 14:00 |
| day | MMM dd | Jan 15 |

### Chart Performance: Downsampling Strategy

> "Rendering 10,000 SVG path points causes browser jank even on modern machines. The solution is downsampling before render—but we must do it correctly. Naive 'take every Nth point' misses peaks and valleys that users care about. We use LTTB (Largest Triangle Three Buckets) for visually accurate downsampling that preserves chart shape."

```
┌─────────────────────────────────────────────────────────────────┐
│                  useChartData Hook                               │
├─────────────────────────────────────────────────────────────────┤
│  INPUT: rawData (10,000 points), maxPoints (500)                │
├─────────────────────────────────────────────────────────────────┤
│  DOWNSAMPLING:                                                   │
│  if rawData.length <= maxPoints: return rawData                 │
│  else: step = ceil(10000 / 500) = 20                            │
│        return evenly-spaced 500 points                          │
├─────────────────────────────────────────────────────────────────┤
│  MEMOIZED STATISTICS:                                            │
│  totalClicks, totalFraud, avgClicksPerBucket, maxClicks         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎨 Deep Dive: Dashboard Layout

### Responsive Grid Structure

```
┌────────────────────────────────────────────────────────────────────────┐
│  HEADER (sticky)                                                        │
│  Ad Click Analytics                    Last Updated: 14:32:05          │
├────────────────────────────────────────────────────────────────────────┤
│  FILTERS BAR                                                            │
│  Time: [Last Hour] [Last 24h] [Last 7d] [Last 30d]                     │
│  Campaign: [Dropdown]   Country: [Dropdown]   Device: [Dropdown]       │
├────────────────────────────────────────────────────────────────────────┤
│  KPI CARDS ROW (grid: 1 col mobile, 2 col sm, 4 col lg)                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │
│  │ Total Clicks│ │Unique Users │ │ Fraud Rate  │ │Clicks/Min   │      │
│  │   1,234,567 │ │     89,432  │ │   2.34%     │ │       856   │      │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │
│                                                                         │
│  CHARTS ROW (grid: 1 col mobile, 2 col lg)                             │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐      │
│  │  Clicks Over Time           │ │  Geographic Distribution     │      │
│  └─────────────────────────────┘ └─────────────────────────────┘      │
│                                                                         │
│  TABLES ROW (grid: 1 col mobile, 2 col lg)                             │
│  ┌─────────────────────────────┐ ┌─────────────────────────────┐      │
│  │  Campaign Performance       │ │  Recent Fraud Detections    │      │
│  └─────────────────────────────┘ └─────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────┘
```

### Metric Card States

| State | Visual | Trigger |
|-------|--------|---------|
| Normal | border-gray, bg-white | fraud rate < 3% |
| Warning | border-yellow, bg-yellow-50 | fraud rate >= 3% |
| Critical | border-red, bg-red-50 | fraud rate >= 5% |
| Loading | animate-pulse skeleton | isLoading = true |

---

## 🔍 Deep Dive: Filter Controls

### Date Range Presets

| Preset | Hours | Granularity | Data Points |
|--------|-------|-------------|-------------|
| Last Hour | 1 | minute | 60 |
| Last 24 Hours | 24 | hour | 24 |
| Last 7 Days | 168 | hour | 168 |
| Last 30 Days | 720 | day | 30 |

### Campaign Filter Implementation

```
┌────────────────────────────────────────┐
│ Campaign: All Campaigns            ▼  │  ◄── Trigger button
└────────────────────────────────────────┘
                    │
                    ▼ (when clicked)
┌────────────────────────────────────┐
│ Search campaigns...                │  ◄── Search input
├────────────────────────────────────┤
│  All Campaigns                     │  ◄── Clear selection
├────────────────────────────────────┤
│  Winter Sale 2024                  │
│  ↳ Acme Corp                       │  ◄── Advertiser subtext
├────────────────────────────────────┤
│  Black Friday Promo  [SELECTED]    │
│  ↳ MegaMart                        │
└────────────────────────────────────┘
```

---

## 🧪 Deep Dive: Test Click Generator

### Developer Tool Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                TEST CLICK GENERATOR                              │
├─────────────────────────────────────────────────────────────────┤
│  Clicks/Second: [slider 1-100, default 50]                      │
│  Duration: [slider 5-60 seconds, default 10]                    │
│                                                                  │
│  [Generate Test Clicks] ──► POST /api/v1/clicks                 │
│                                                                  │
│  Results: Sent (500) | Success (478) | Duplicate (12) | Fraud (10) │
├─────────────────────────────────────────────────────────────────┤
│  GENERATION ALGORITHM:                                           │
│  totalClicks = clicksPerSecond * duration                       │
│  interval = 1000ms / clicksPerSecond                            │
│  For each click: random ad_id, campaign_id, country, device     │
└─────────────────────────────────────────────────────────────────┘
```

---

## ♿ Accessibility Considerations

### Chart Accessibility Pattern

> "SVG charts are inherently inaccessible to screen readers—they see meaningless path data. We wrap each chart in a figure element with aria-describedby pointing to a computed summary that reads naturally: 'Total 1.2 million clicks. Peak of 12,345 clicks at 2:30 PM.' This gives blind users the same insight as the visual chart."

| Element | ARIA Role | Purpose |
|---------|-----------|---------|
| Chart wrapper | role="figure" | Semantic grouping |
| Hidden title | aria-labelledby | "Clicks Over Time" |
| Generated summary | aria-describedby | Peak, total, trend description |
| Data table | details/summary | Accessible tabular alternative |

---

## ⚖️ Trade-offs and Deep Dives

### Trade-off 1: Polling vs WebSocket for Real-Time Updates

| Approach | Chosen |
|----------|--------|
| ✅ Polling (setInterval) | Yes |
| ❌ WebSocket | No |

> "We chose polling over WebSocket for a 5-second refresh interval because the marginal latency gain doesn't justify the complexity. WebSocket requires connection state management—handling disconnects, reconnects, exponential backoff, and heartbeats. With polling, each request is stateless: if one fails, the next succeeds automatically. At 5-second intervals, users can't perceive the 5-second worst-case latency difference. WebSocket would be essential if we needed sub-second updates (like a trading dashboard), but for analytics where users accept 'about now' freshness, polling is simpler and more reliable."

### Trade-off 2: Zustand vs Redux/Context for State Management

| Approach | Chosen |
|----------|--------|
| ✅ Zustand | Yes |
| ❌ Redux | No |
| ❌ Context API | No |

> "Redux requires action types, reducers, middleware, and provider hierarchies—all overhead for a dashboard that's fundamentally 'fetch data, display data.' Context API causes full subtree re-renders when any context value changes, which would make our charts jank every 5 seconds. Zustand gives us selective subscriptions with zero boilerplate: components subscribe to exactly the state they need, and only re-render when that specific slice changes. The trade-off is less ecosystem tooling (no Redux DevTools time-travel), but for analytics dashboards, we don't need to replay state history."

### Trade-off 3: Client-Side Downsampling vs Server-Side Pagination

| Approach | Chosen |
|----------|--------|
| ✅ Client-side downsampling | Yes |
| ❌ Server-side pagination | No |

> "Server-side pagination for charts creates jarring UX—users scroll through paginated data and lose the continuous trend visualization that makes charts valuable. Client-side downsampling fetches all 10,000 points once, then samples them to 500 points for rendering. The trade-off is higher initial payload (50KB vs 5KB per page) and O(n) sampling cost on the client. But modern browsers handle 50KB trivially, and LTTB downsampling runs in <10ms. The result is smooth, interactive charts where users can zoom into any region without waiting for another API call."

---

## 🔮 Future Enhancements

| Enhancement | Value | Complexity |
|-------------|-------|------------|
| WebSocket for sub-second updates | Real-time trading-style | High |
| D3.js custom visualizations | Heatmaps, network graphs | Medium |
| Virtual scrolling for tables | Large campaign lists | Low |
| Dashboard widget drag-and-drop | User customization | High |
| CSV/PDF export | Reporting workflows | Low |

---

## 🎤 Interview Wrap-up

> "We've designed a real-time analytics dashboard that refreshes every 5 seconds using simple polling—chosen over WebSocket because the 5-second latency tolerance doesn't justify connection management complexity. Zustand's selective subscriptions prevent chart re-renders when filters change, keeping SVG animations smooth. For 10,000+ data points, client-side downsampling gives users immediate zoom/pan without pagination delays. The key insight is that analytics dashboards optimize for 'current enough' over 'real-time,' letting us trade complexity for reliability."
