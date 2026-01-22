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

**SearchBar Component:**
- State: query (immediate), debouncedQuery (150ms delayed)
- Uses `useDebouncedCallback` for API call reduction
- React Query for caching and deduplication (staleTime: 60s)
- Minimum 2 characters before triggering search
- Returns SearchSuggestion[] with type (app/developer/category), id, text, icon

**SearchSuggestion Type:**
- type: 'app' | 'developer' | 'category'
- id, text, icon (optional)

### Backend: Search with Quality Re-ranking

**GET /api/v1/search Endpoint:**

**Query Parameters:**
- q: search query
- category, price, rating: filters
- limit (default: 20), offset (default: 0)

**Flow:**
1. Check Redis cache for first page results
2. Build Elasticsearch query with multi_match (fields: name^3, developer^2, description, keywords)
3. Apply fuzzy matching with AUTO fuzziness
4. Fetch 2x limit for re-ranking headroom
5. Re-rank with quality signals
6. Cache first page for 5 minutes

**Re-ranking Algorithm (60% text, 40% quality):**
- Text relevance: Elasticsearch _score
- Quality score composition:
  - averageRating * 0.3
  - log1p(ratingCount) * 0.2
  - log1p(downloads) * 0.3
  - engagementScore * 0.2

**Filter Building:**
- category: term filter
- price='free': isFree=true term filter
- rating: range filter (gte)

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

**ReviewForm Component Props:**
- appId: string
- onSuccess: () => void

**Validation Schema (Zod):**
- rating: number 1-5
- title: string 5-100 chars
- body: string 20-2000 chars

**Error Handling:**
- 409: "You have already reviewed this app"
- 403: "You must download the app before reviewing"
- Default: "Failed to submit review"

**UI Elements:**
- StarRatingInput component
- Title input with error display
- Textarea for review body
- Submit button with loading state

### Backend: Review Submission

**POST /api/v1/reviews (requireAuth):**

**Validation Steps:**
1. Parse body with Zod schema
2. Check user_apps table for download verification
3. Check reviews table for existing review (one per user per app)

**On Success:**
1. Insert review with status='pending'
2. Publish review.created event to RabbitMQ
3. Update app rating aggregates (rating_sum, rating_count)
4. Return 201 with review id, status, message

### Backend: Integrity Worker

**ReviewEvent Message:**
- eventId, reviewId, userId, appId
- review: { rating, title, body }

**Processing Flow:**
1. Deduplication check via Redis (processed:review:{eventId})
2. Multi-signal integrity analysis
3. Calculate weighted score
4. Determine action (approved/rejected/manual_review)
5. Update review status in PostgreSQL
6. Mark as processed in Redis (24h TTL)

**Integrity Signals:**

| Signal | Weight | Scoring |
|--------|--------|---------|
| review_velocity | 0.15 | >5/day: 0.2, >2/day: 0.6, else: 1.0 |
| content_quality | 0.25 | Generic phrases: 0.5, length: min(len/100,1), specifics bonus |
| account_age | 0.10 | min(days/30, 1.0) |
| coordination | 0.20 | >5x daily average: 0.3, else: 1.0 |

**Action Thresholds:**
- score < 0.3: rejected
- score < 0.6: manual_review
- score >= 0.6: approved

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

**CheckoutModalProps:**
- app: App object
- priceId: string
- onSuccess: (receipt: Receipt) => void
- onClose: () => void

**Key Behaviors:**
- Generate idempotency key once per checkout attempt (useState with UUID)
- useMutation with retry: 3 (safe with idempotency key)
- Idempotency-Key header sent with request

**UI Elements:**
- App icon, name, developer display
- Price summary
- Error display for mutation failures
- Cancel and Confirm Purchase buttons

### Backend: Idempotent Purchase API

**POST /api/v1/purchases (requireAuth):**

**Idempotency Implementation:**
1. Layer 1: Check Redis cache (idem:purchase:{userId}:{key})
2. Layer 2: Acquire Redis lock (lock:purchase:{userId}:{key}, NX, EX 30)
3. If lock fails: 409 "Purchase in progress"

**Purchase Flow:**
1. Validate body (appId, priceId as UUIDs)
2. Fetch app with price from PostgreSQL
3. Check for existing purchase
4. Process payment via payment service
5. Create purchase in transaction:
   - Insert into purchases table
   - Insert into user_apps table
   - Increment app download_count
6. Generate receipt
7. Cache result (24h TTL)
8. Publish purchase.completed event
9. Release lock in finally block

**Receipt Structure:**
- id, appId, amount, currency, purchasedAt

## Deep Dive: Developer Analytics Dashboard

### Frontend: Analytics Component

**AppAnalytics Component:**
- Props: appId
- Uses React Query with 1-minute staleTime

**AnalyticsData Type:**
- downloads: { date, count }[]
- revenue: { date, amount }[]
- summary: { totalDownloads, totalRevenue, averageRating }

**UI Structure:**
1. Summary Cards (3-column grid):
   - Total Downloads with icon
   - Total Revenue with dollar formatting
   - Average Rating with star icon

2. Downloads Over Time Chart:
   - Recharts LineChart with ResponsiveContainer
   - CartesianGrid, XAxis (date formatted), YAxis
   - Tooltip with locale formatting
   - Line: monotone, blue stroke, no dots

### Backend: Analytics API

**GET /api/v1/developer/apps/:id/analytics (requireDeveloper):**

**Flow:**
1. Verify app ownership (developer_id match)
2. Check Redis cache (analytics:{id})
3. Query download trend (last 30 days, grouped by date)
4. Query revenue trend (last 30 days, grouped by date)
5. Query summary (total downloads, total revenue, average rating)
6. Cache result for 5 minutes

**SQL Queries:**
- Downloads: COUNT from user_apps grouped by DATE(purchased_at)
- Revenue: SUM(amount) from purchases grouped by DATE(purchased_at)
- Summary: Subqueries for each metric

## Deep Dive: Developer Review Response

### Frontend: Response Form

**ResponseFormProps:**
- reviewId: string
- existingResponse?: string
- appId: string

**Behaviors:**
- Collapsed by default (unless existingResponse exists)
- useMutation for POST /developer/reviews/:id/respond
- Invalidates app-reviews query on success
- Toggle between "Edit Response" and "Respond to Review" buttons

**UI Elements:**
- Textarea (4 rows, placeholder: "Write your response...")
- Cancel and Post Response buttons
- Disabled states during mutation

### Backend: Response API

**POST /api/v1/developer/reviews/:id/respond (requireDeveloper):**

**Validation:**
- response: string 10-1000 chars (Zod)

**Flow:**
1. Verify review belongs to developer's app (JOIN reviews with apps)
2. Update review with developer_response and developer_response_at
3. Return success: true

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Search debouncing | 150ms client-side | Server throttle | Better UX, reduces latency |
| Review processing | Async with queue | Sync in request | Non-blocking, scales integrity analysis |
| Purchase idempotency | Redis + header key | DB constraint only | Handles concurrent retries |
| Analytics caching | 5 min Redis TTL | Real-time queries | Balance freshness with DB load |
| Review validation | Zod on both ends | Backend only | Fast feedback, security defense |
| Chart rendering | Recharts | Custom Canvas | Development speed, accessibility |

## Future Fullstack Enhancements

1. **Real-time Updates**: WebSocket for live ranking changes
2. **Optimistic UI**: Show review immediately, reconcile after processing
3. **GraphQL**: Efficient data fetching for mobile clients
4. **Server Components**: Next.js RSC for faster initial load
5. **Edge Caching**: CDN-cached API responses for popular apps
6. **A/B Testing**: Feature flags for search algorithm experiments
