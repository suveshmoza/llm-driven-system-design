# Web Crawler - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## 📋 Introduction (2 minutes)

"I'll design a distributed web crawler with end-to-end integration. The full-stack challenge is connecting a high-throughput backend crawling system with a reactive monitoring dashboard. This requires:

1. **Backend complexity** - URL frontier, distributed workers, politeness enforcement
2. **Real-time frontend** - Live statistics and management controls
3. **Data flow** - URL discovery through processing to visualization
4. **Shared contracts** - Type safety across the entire system

Let me clarify requirements first."

---

## 🎯 Requirements Clarification (5 minutes)

### Functional Requirements

"For the distributed crawler with monitoring dashboard:

1. **URL Discovery** - Extract links from pages, queue for crawling
2. **Distributed Crawling** - Workers fetch pages while respecting politeness
3. **Deduplication** - Avoid re-crawling duplicate URLs or content
4. **Admin Dashboard** - Real-time stats, domain management, seed URL control
5. **Worker Monitoring** - Health status and throughput visualization

I'll focus on end-to-end data flow, API contracts, and real-time communication."

### Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Scale | 10,000 pages/second | Distributed worker fleet |
| Dashboard Latency | < 2 seconds | Real-time monitoring |
| Worker Recovery | Graceful resume | Reliability |
| Operator Control | Full dashboard management | Usability |

---

## 🏗️ High-Level Design (8 minutes)

### End-to-End Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Admin Dashboard (React)                          │
│   Real-time stats │ URL frontier │ Domain mgmt │ Worker monitoring      │
└─────────────────────────────────────────────────────────────────────────┘
                    │                           │
                    │ REST API                  │ WebSocket
                    ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          API Server (Express)                            │
│   Routes: /api/urls, /api/domains, /api/workers, /api/stats             │
│   WebSocket: /ws/stats (real-time updates)                              │
└─────────────────────────────────────────────────────────────────────────┘
                    │                           │
        ┌───────────┴───────────┐               │
        ▼                       ▼               ▼
┌───────────────┐      ┌───────────────┐  ┌──────────────┐
│  Coordinator  │      │    Workers    │  │ Stats Agg    │
│               │◄────►│   (1...N)     │  │              │
│ - Assignment  │      │ - Fetch pages │  │ - Metrics    │
│ - Scheduling  │      │ - Extract     │  │ - Broadcast  │
└───────────────┘      └───────────────┘  └──────────────┘
        │                       │                 │
        └───────────────────────┴─────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│  PostgreSQL   │      │     Redis     │      │ Object Store  │
│               │      │               │      │               │
│ - URL frontier│      │ - Bloom filter│      │ - Page content│
│ - Crawl state │      │ - Rate limits │      │ - robots.txt  │
│ - Domain meta │      │ - Pub/Sub     │      │               │
└───────────────┘      └───────────────┘      └───────────────┘
```

### Key Integration Points

| Flow | Path | Purpose |
|------|------|---------|
| URL Submission | Dashboard → API → Frontier → Worker → Dashboard | Full lifecycle |
| Stats Streaming | Worker → Redis Pub/Sub → Stats Agg → WebSocket → Dashboard | Real-time metrics |
| Domain Control | Dashboard → API → Redis + PostgreSQL | Rate limit updates |

---

## 🔍 Deep Dive: Shared Type Definitions (6 minutes)

### API Contract Types

Both frontend and backend share common type definitions for type safety.

**URL Frontier Entity:**

| Field | Type | Description |
|-------|------|-------------|
| id | number | Database primary key |
| url | string | Full URL to crawl |
| urlHash | string | SHA-256 for dedup |
| domain | string | Extracted hostname |
| priority | high/medium/low | Crawl priority |
| depth | number | Hops from seed |
| status | pending/processing/completed/failed | Current state |
| discoveredAt | timestamp | When found |
| scheduledAt | timestamp | When assigned |
| workerId | string | Assigned worker |

**Domain Entity:**

| Field | Type | Description |
|-------|------|-------------|
| id | number | Primary key |
| domain | string | Hostname |
| robotsTxt | string | Cached robots.txt |
| robotsFetchedAt | timestamp | Cache time |
| crawlDelayMs | number | Rate limit (ms) |
| lastCrawlAt | timestamp | Last fetch |
| totalPages | number | Pages crawled |
| avgResponseMs | number | Avg latency |
| isBlocked | boolean | Admin blocked |

**Worker Entity:**

| Field | Type | Description |
|-------|------|-------------|
| id | string | Worker UUID |
| status | active/idle/error | Current state |
| urlsProcessed | number | Total count |
| currentDomain | string | Active domain |
| uptimeSeconds | number | Time running |
| lastHeartbeat | timestamp | Health check |

**Real-Time Stats:**

| Field | Type | Description |
|-------|------|-------------|
| urlsPerSecond | number | Throughput |
| queueDepth | number | Pending URLs |
| activeWorkers | number | Active count |
| failedToday | number | Error count |
| totalCrawled | number | Total pages |
| byPriority | object | High/medium/low counts |

### Validation Rules

| Field | Validation | Error Code |
|-------|-----------|------------|
| urls (seed) | Array of valid URLs, 1-1000 items | VALIDATION_ERROR |
| priority | Enum: high, medium, low | VALIDATION_ERROR |
| crawlDelayMs | Number 500-60000 | VALIDATION_ERROR |
| isBlocked | Boolean | VALIDATION_ERROR |
| page | Number >= 1 | VALIDATION_ERROR |
| pageSize | Number 10-100 | VALIDATION_ERROR |

---

## 🏗️ Deep Dive: End-to-End URL Submission Flow (10 minutes)

### URL Submission Sequence

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Dashboard│     │   API    │     │  Bloom   │     │ Frontier │     │ WebSocket│
│          │     │  Server  │     │  Filter  │     │    DB    │     │  Clients │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │                │
     │ POST /urls/seed│                │                │                │
     │ [url1, url2...]│                │                │                │
     │───────────────►│                │                │                │
     │                │                │                │                │
     │                │  Validate with │                │                │
     │                │  Zod schema    │                │                │
     │                │────────┐       │                │                │
     │                │        │       │                │                │
     │                │◄───────┘       │                │                │
     │                │                │                │                │
     │                │ Check each URL │                │                │
     │                │───────────────►│                │                │
     │                │                │                │                │
     │                │ not seen (new) │                │                │
     │                │◄───────────────│                │                │
     │                │                │                │                │
     │                │                │ INSERT batch   │                │
     │                │                │ ON CONFLICT    │                │
     │                │─────────────────────────────────►                │
     │                │                │                │                │
     │                │                │ Mark URLs seen │                │
     │                │───────────────►│                │                │
     │                │                │                │                │
     │                │                │                │ Broadcast      │
     │                │                │                │ frontier-update│
     │                │─────────────────────────────────────────────────►│
     │                │                │                │                │
     │ 200 OK         │                │                │                │
     │ {added: N}     │                │                │                │
     │◄───────────────│                │                │                │
```

### URL Normalization Steps

1. Parse URL with standard URL parser
2. Remove hash fragments
3. Normalize trailing slashes (remove except root)
4. Lowercase the entire URL
5. Compute SHA-256 hash for deduplication

### Seed URL Modal Flow

```
┌─────────────────────────────────────────────┐
│           Add Seed URLs Modal               │
├─────────────────────────────────────────────┤
│                                             │
│  URLs (one per line):                       │
│  ┌─────────────────────────────────────┐   │
│  │ https://example.com                  │   │
│  │ https://example.com/page             │   │
│  │ https://other-site.com               │   │
│  │                                      │   │
│  │                                      │   │
│  └─────────────────────────────────────┘   │
│  3 URLs entered                             │
│                                             │
│  Priority:                                  │
│  ○ High   ● Medium   ○ Low                 │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ ✓ Added 2 URLs (1 duplicate skipped)│   │
│  └─────────────────────────────────────┘   │
│                                             │
│           [Cancel]  [Add URLs]              │
└─────────────────────────────────────────────┘
```

### API Client Design

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| /urls | GET | URLFilters | PaginatedResponse<FrontierURL> |
| /urls/seed | POST | AddSeedURLsRequest | {added, duplicates, message} |
| /urls/:id | DELETE | - | void |
| /domains | GET | page, pageSize | PaginatedResponse<Domain> |
| /domains/:domain | GET | - | Domain |
| /domains/:domain | PATCH | UpdateDomainRequest | Domain |
| /workers | GET | - | Worker[] |
| /stats | GET | - | CrawlStats |

---

## 📊 Deep Dive: Real-Time Stats with WebSocket (8 minutes)

### WebSocket Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WebSocket Server                              │
│                                                                      │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────┐ │
│  │   Clients   │    │  Subscriber  │    │   Stats Aggregator     │ │
│  │   (Set)     │◄───│   (Redis)    │◄───│                        │ │
│  │             │    │              │    │ - Fetch from Redis     │ │
│  │ - Dashboard │    │ Subscribe:   │    │ - Pipeline queries     │ │
│  │   instances │    │ crawler:stats│    │ - Combine metrics      │ │
│  └─────────────┘    └──────────────┘    └────────────────────────┘ │
│         │                                          │                │
│         │              Broadcast                   │                │
│         │◄─────────────────────────────────────────│                │
│         │                                                           │
│         │         Every 2 seconds (fallback)                       │
│         │◄──────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────────┘
```

### Stats Aggregation from Redis

| Redis Key | Type | Description |
|-----------|------|-------------|
| stats:urls_per_second | STRING | Current throughput |
| stats:queue_depth | STRING | Pending URL count |
| workers:active | SET | Active worker IDs |
| stats:failed_today | STRING | Daily error count |
| stats:total_crawled | STRING | Total pages fetched |
| stats:priority:high | STRING | High priority count |
| stats:priority:medium | STRING | Medium priority count |
| stats:priority:low | STRING | Low priority count |
| stats:throughput | SORTED SET | Sliding window (60s) |

### Worker Stats Publishing Flow

```
┌────────────┐                    ┌────────────┐                    ┌────────────┐
│   Worker   │                    │   Redis    │                    │ WebSocket  │
│            │                    │            │                    │  Clients   │
└─────┬──────┘                    └─────┬──────┘                    └─────┬──────┘
      │                                 │                                 │
      │ On startup:                     │                                 │
      │ SADD workers:active             │                                 │
      │ HSET worker:{id} status, time   │                                 │
      │────────────────────────────────►│                                 │
      │                                 │                                 │
      │ On each crawl:                  │                                 │
      │ INCR stats:total_crawled        │                                 │
      │ INCR stats:failed_today (if err)│                                 │
      │ ZADD stats:throughput timestamp │                                 │
      │────────────────────────────────►│                                 │
      │                                 │                                 │
      │ PUBLISH crawler:stats {...}     │                                 │
      │────────────────────────────────►│                                 │
      │                                 │ Broadcast to                    │
      │                                 │ all clients                     │
      │                                 │────────────────────────────────►│
      │                                 │                                 │
      │ Heartbeat every 5s:             │                                 │
      │ Calculate URLs/sec from window  │                                 │
      │ Update queue depth              │                                 │
      │ EXPIRE worker:{id} 30s          │                                 │
      │────────────────────────────────►│                                 │
```

### Frontend WebSocket Hook

| State | Description |
|-------|-------------|
| wsRef | WebSocket instance reference |
| reconnectTimeoutRef | Auto-reconnect timer |
| connected | Connection status for UI |

| Event | Handler |
|-------|---------|
| onopen | Set connected=true, clear reconnect timer |
| onmessage | Parse JSON, update stats store |
| onclose | Set connected=false, schedule reconnect (3s) |
| onerror | Log error, close connection |

---

## 🏗️ Deep Dive: Domain Management Flow (6 minutes)

### Domain Update Sequence

```
Dashboard                API Server               Redis              PostgreSQL
    │                        │                      │                     │
    │  PATCH /domains/foo    │                      │                     │
    │  {crawlDelayMs: 2000}  │                      │                     │
    │───────────────────────►│                      │                     │
    │                        │                      │                     │
    │                        │  Validate with       │                     │
    │                        │  Zod schema          │                     │
    │                        │                      │                     │
    │                        │  SET crawldelay:foo  │                     │
    │                        │───────────────────►  │                     │
    │                        │                      │                     │
    │                        │  UPDATE domains      │                     │
    │                        │──────────────────────────────────────────► │
    │                        │                      │                     │
    │                        │  PUBLISH domain:update                     │
    │                        │───────────────────►  │                     │
    │                        │                      │                     │
    │  200 OK {domain}       │                      │                     │
    │◄───────────────────────│                      │                     │
    │                        │                      │                     │
    │  WebSocket: domain     │                      │                     │
    │  update notification   │◄──────────────────── │                     │
    │◄───────────────────────│                      │                     │
```

### Dual-Write Strategy

Updates go to both Redis (immediate worker effect) and PostgreSQL (persistence):

| Update Type | Redis Action | PostgreSQL Action |
|-------------|--------------|-------------------|
| crawlDelayMs | SET crawldelay:{domain} | UPDATE domains SET crawl_delay |
| isBlocked=true | SADD blocked_domains | UPDATE domains SET is_blocked |
| isBlocked=false | SREM blocked_domains | UPDATE domains SET is_blocked |

Workers check Redis first for rate limits, ensuring immediate effect of dashboard changes.

---

## ⚠️ Error Handling Across the Stack (4 minutes)

### Backend Error Response Format

| Field | Type | Description |
|-------|------|-------------|
| error | string | Human-readable message |
| code | string | Machine-readable error code |
| details | object | Field-specific errors (validation) |
| stack | string | Stack trace (dev only) |

### Error Code Catalog

| Code | HTTP Status | Scenario |
|------|-------------|----------|
| VALIDATION_ERROR | 400 | Invalid request data |
| NOT_FOUND | 404 | Resource doesn't exist |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Unexpected server error |

### Frontend Error Handling Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Root                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Error Boundary (React)                        │  │
│  │  - Catches render errors                                   │  │
│  │  - Shows fallback UI                                       │  │
│  │  - Logs to error tracking                                  │  │
│  │  - Offers page reload                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Toast Notification System                     │  │
│  │  - API error display                                       │  │
│  │  - Auto-dismiss after 5 seconds                            │  │
│  │  - Success/error/warning variants                          │  │
│  │  - Queue multiple toasts                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              API Client Layer                              │  │
│  │  - Parse error responses                                   │  │
│  │  - Throw typed errors                                      │  │
│  │  - Handle network failures                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## ⚖️ Trade-offs and Alternatives (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Real-time Protocol | ✅ WebSocket | ❌ SSE | Bidirectional for future extensibility |
| Type Sharing | ✅ Shared folder | ❌ OpenAPI codegen | Simpler, no build step |
| Validation | ✅ Zod | ❌ io-ts | Better DX, TypeScript integration |
| State Updates | ✅ Zustand + WebSocket | ❌ React Query | More control over streaming data |
| Error Handling | ✅ Custom classes | ❌ HTTP Problem Details | Simpler implementation |

---

## 🚀 Future Enhancements

With more time, I would add:

1. **OpenAPI spec generation** - Auto-generate from Zod schemas for client codegen
2. **Optimistic updates** - Instant UI feedback for domain management
3. **Request retries** - Exponential backoff in API client
4. **GraphQL subscriptions** - Alternative real-time protocol
5. **End-to-end testing** - Playwright for critical user flows

---

## 📝 Summary

"I've designed a distributed web crawler with full-stack integration:

1. **Shared TypeScript types** - API contract consistency across frontend and backend
2. **End-to-end URL flow** - Dashboard submission through worker processing
3. **Real-time WebSocket** - Streaming crawler stats with 2-second latency
4. **Domain management** - Immediate Redis updates for worker rate limits
5. **Consistent error handling** - Typed errors with toast notifications

The architecture prioritizes type safety and real-time visibility while maintaining clean separation between frontend and backend responsibilities."
