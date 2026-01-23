# App Store - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Problem Statement

Design the App Store, Apple's digital marketplace serving 2M+ apps to billions of users. As a fullstack engineer, the key challenges span:
- End-to-end search flow from UI to Elasticsearch and back
- Review submission pipeline with frontend validation through backend integrity analysis
- Purchase flow with secure checkout and real-time receipt delivery
- Developer dashboard connecting analytics data to visualization
- Real-time ranking updates displayed in charts

## Requirements Clarification

### Functional Requirements
1. **Search & Discovery**: Full-text search with filters, category browsing, rankings
2. **App Details**: View metadata, screenshots, reviews with ratings
3. **Review System**: Submit reviews, view responses, integrity indicators
4. **Purchases**: Secure checkout, receipt validation, subscription management
5. **Developer Portal**: App management, analytics, review responses

### Non-Functional Requirements
1. **Latency**: < 100ms for search, < 200ms for app details
2. **Consistency**: Strong for purchases, eventual for rankings
3. **Availability**: 99.99% for purchase endpoints
4. **Security**: Secure payment flows, receipt validation

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend                                │
├─────────────────────────────────────────────────────────────────┤
│  Consumer Views          │         Developer Views              │
│  - Home (Charts)         │         - Dashboard                  │
│  - Search                │         - App Management             │
│  - App Details           │         - Analytics                  │
│  - Checkout              │         - Review Responses           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express Backend                               │
├─────────────────────────────────────────────────────────────────┤
│  /api/v1/search          │  /api/v1/developer/*                 │
│  /api/v1/apps            │  /api/v1/purchases                   │
│  /api/v1/reviews         │  /api/v1/admin/*                     │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  PostgreSQL   │    │ Elasticsearch │    │    Redis      │
│  - Apps       │    │ - Search      │    │ - Sessions    │
│  - Purchases  │    │ - Suggestions │    │ - Cache       │
│  - Reviews    │    │               │    │ - Idempotency │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Deep Dive: End-to-End Search Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Search Flow Sequence                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User Types "photo editor"                                              │
│            │                                                             │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │   SearchBar     │ ← Debounce 150ms                                   │
│   │   Component     │                                                    │
│   └────────┬────────┘                                                    │
│            │ GET /api/v1/search?q=photo+editor                           │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │   API Gateway   │ ← Rate limit check                                 │
│   └────────┬────────┘                                                    │
│            │                                                             │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │ Search Service  │ ← Build Elasticsearch query                        │
│   └────────┬────────┘                                                    │
│            │ multi_match query                                           │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │ Elasticsearch   │ ← Fuzzy match, scoring                             │
│   └────────┬────────┘                                                    │
│            │ hits with _score                                            │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │ Rerank Service  │ ← Quality signals applied                          │
│   └────────┬────────┘                                                    │
│            │ Final sorted results                                        │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │   SearchBar     │ ← Display results                                  │
│   │   Component     │                                                    │
│   └─────────────────┘                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Debounced Search Input

> "I'm debouncing user input at 150ms with a 2-character minimum before API calls. This balances responsiveness with API efficiency. React Query handles caching with a 60-second stale time, so repeated searches are instant."

The SearchBar component maintains both immediate query state (for the input) and a debounced query (for API calls). Search suggestions are typed by category (app/developer/category) with optional icons for visual distinction.

### Backend: Search with Quality Re-ranking

> "I'm fetching 2x the requested results from Elasticsearch to create headroom for re-ranking. This lets us balance text relevance (60%) with quality signals (40%) before returning the final set."

**GET /api/v1/search** accepts query, category, price, rating filters with pagination. The flow checks Redis cache first, builds a multi_match Elasticsearch query (boosting name 3×, developer 2×), applies fuzzy matching, then re-ranks results combining text score with quality metrics (rating, review count, downloads, engagement). First-page results are cached for 5 minutes.

## Deep Dive: Review Submission Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Review Submission Pipeline                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User Submits Review                                                    │
│            │                                                             │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  ReviewForm     │ ← Client validation (Zod)                          │
│   │  Component      │   - rating: 1-5 required                           │
│   │                 │   - title: 5-100 chars                             │
│   │                 │   - body: 20-2000 chars                            │
│   └────────┬────────┘                                                    │
│            │ POST /api/v1/reviews                                        │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  Review API     │ ← Server validation                                │
│   │                 │   - Verified purchase check                        │
│   │                 │   - Duplicate review check                         │
│   └────────┬────────┘                                                    │
│            │ Insert with status='pending'                                │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  PostgreSQL     │                                                    │
│   └────────┬────────┘                                                    │
│            │ Publish review.created event                                │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  RabbitMQ       │                                                    │
│   └────────┬────────┘                                                    │
│            │ Async processing                                            │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │ Integrity       │ ← Multi-signal analysis                            │
│   │ Worker          │                                                    │
│   └────────┬────────┘                                                    │
│            │ UPDATE status based on score                                │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  PostgreSQL     │ ← status: approved/rejected/manual_review          │
│   └─────────────────┘                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Review Form

> "I'm validating on both ends with Zod - same schema shared between frontend and backend. This gives users immediate feedback while maintaining server-side security."

The ReviewForm validates rating (1-5), title (5-100 chars), and body (20-2000 chars). Error states handle 409 (already reviewed) and 403 (must download first). The UI includes a star rating input, text fields with inline errors, and a submit button with loading state.

### Backend: Review Submission

> "Reviews start in 'pending' status and process asynchronously. This keeps the API responsive while integrity analysis runs in the background."

**POST /api/v1/reviews** validates the request, verifies the user has downloaded the app, checks for duplicate reviews, then inserts with status='pending'. A review.created event publishes to RabbitMQ, and app rating aggregates update in the same transaction.

### Backend: Integrity Worker

> "The worker uses Redis for deduplication - if we've already processed an event, we skip it. This makes the queue consumer idempotent and safe for retries."

The worker consumes review.created events, runs multi-signal integrity analysis (velocity, content quality, account age, coordination detection), calculates a weighted score, and updates the review status. Scores below 0.3 are rejected, 0.3-0.6 require manual review, and above 0.6 are approved.

## Deep Dive: Purchase Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Purchase Flow Sequence                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User Clicks "Buy"                                                      │
│            │                                                             │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  Checkout Modal │ ← Confirm payment method                           │
│   │                 │   Generate idempotency key (UUID)                  │
│   └────────┬────────┘                                                    │
│            │ POST /api/v1/purchases                                      │
│            │ Header: Idempotency-Key                                     │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  Purchase API   │ ← Layer 1: Check cached result                     │
│   │                 │   Layer 2: Acquire lock (30s)                      │
│   └────────┬────────┘                                                    │
│            │                                                             │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  Payment        │ ← Process payment                                  │
│   │  Provider       │                                                    │
│   └────────┬────────┘                                                    │
│            │ Transaction                                                 │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  PostgreSQL     │ ← Insert purchase                                  │
│   │                 │   Insert user_apps                                 │
│   │                 │   Update download_count                            │
│   └────────┬────────┘                                                    │
│            │ Generate receipt                                            │
│            ▼                                                             │
│   ┌─────────────────┐                                                    │
│   │  Checkout Modal │ ← Show success, download button                    │
│   └─────────────────┘                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Frontend: Checkout Modal

> "The idempotency key is generated once when the modal opens and reused for retries. This ensures duplicate clicks or network retries don't result in double charges."

The modal displays app details with price confirmation. A UUID idempotency key is generated via useState on mount. The mutation includes this key as a header and enables retry: 3 since the operation is safe to retry. Error display shows payment failures while Cancel and Confirm buttons handle user actions.

### Backend: Idempotent Purchase API

> "I'm using three layers of protection: Redis cache check, distributed lock, then database verification. The lock prevents concurrent requests from the same user while the cache makes retries instant."

**POST /api/v1/purchases** first checks Redis for a cached result (instant for retries), then acquires a 30-second lock. The purchase flow validates the request, processes payment, creates database records in a transaction (purchase, user_apps, download count), generates a receipt, caches the result for 24 hours, publishes purchase.completed, and releases the lock.

## Deep Dive: Developer Analytics Dashboard

### Frontend: Analytics Component

> "Analytics data has 1-minute staleness which balances real-time feel with API efficiency. The dashboard shows summary cards for quick KPIs and a time-series chart for trend analysis."

The AppAnalytics component fetches downloads and revenue over time plus summary totals. The UI presents three summary cards (downloads, revenue, rating) above a Recharts line chart showing downloads over the last 30 days with formatted axes and tooltips.

### Backend: Analytics API

> "I'm caching analytics for 5 minutes since developers don't need real-time data - they're looking at trends, not individual transactions."

**GET /api/v1/developer/apps/:id/analytics** verifies app ownership, checks Redis cache, then queries the last 30 days of download and revenue trends grouped by date. Summary metrics aggregate totals in a single query. Results cache for 5 minutes to reduce database load.

## Deep Dive: Developer Review Response

### Frontend: Response Form

> "Developers can respond to reviews which shows users their feedback is heard. The form is collapsed by default to reduce visual clutter, expanding only when the developer wants to engage."

The ResponseForm component toggles between collapsed/expanded states and handles both new responses and edits to existing ones. Mutation invalidates the reviews query to show updated responses immediately.

### Backend: Response API

> "I'm verifying ownership through a JOIN rather than separate queries - this ensures atomic authorization checking."

**POST /api/v1/developer/reviews/:id/respond** validates the response text (10-1000 chars), verifies the review belongs to the developer's app via a single JOIN query, then updates the review with the response and timestamp.

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Search debouncing | ✅ 150ms client-side | ❌ Server throttle | Better UX, reduces latency |
| Review processing | ✅ Async with queue | ❌ Sync in request | Non-blocking, scales integrity analysis |
| Purchase idempotency | ✅ Redis + header key | ❌ DB constraint only | Handles concurrent retries |
| Analytics caching | ✅ 5 min Redis TTL | ❌ Real-time queries | Balance freshness with DB load |
| Review validation | ✅ Zod on both ends | ❌ Backend only | Fast feedback, security defense |
| Chart rendering | ✅ Recharts | ❌ Custom Canvas | Development speed, accessibility |

## Future Fullstack Enhancements

1. **Real-time Updates**: WebSocket for live ranking changes
2. **Optimistic UI**: Show review immediately, reconcile after processing
3. **GraphQL**: Efficient data fetching for mobile clients
4. **Server Components**: Next.js RSC for faster initial load
5. **Edge Caching**: CDN-cached API responses for popular apps
6. **A/B Testing**: Feature flags for search algorithm experiments
