# Yelp - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## 📋 Opening Statement

"I'll be designing a local business review and discovery platform like Yelp. As a full-stack engineer, I'll focus on how the frontend and backend integrate for geo-spatial search, the end-to-end review submission flow with optimistic updates, and the search experience from autocomplete to results rendering. Let me start by clarifying what we need to build."

---

## 🎯 1. Requirements Clarification (3-4 minutes)

### Functional Requirements

1. **Search Experience (End-to-End)** - Autocomplete suggestions, geo-spatial search with filters, paginated results with faceted navigation, URL state synchronization
2. **Business Detail Pages** - Business info fetched from API, reviews with infinite scroll, rating display and aggregation
3. **Review System** - Star rating and text submission, photo upload, optimistic UI updates with rollback, idempotent submission handling
4. **User Flows** - Session-based authentication, role-based access (user, business_owner, admin), business owner management dashboard

### Non-Functional Requirements

- **Latency**: API p95 < 300ms, FCP < 2s
- **Consistency**: Strong for reviews, eventual for search index
- **Reliability**: Idempotent mutations, retry-safe
- **Type Safety**: Shared types between frontend and backend

---

## 🏗️ 2. Full-Stack Architecture Overview (5-6 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ SearchBar   │  │ FilterPanel │  │ MapView     │  │ ReviewForm  │         │
│  │ (debounce)  │  │ (URL sync)  │  │ (Mapbox)    │  │ (optimistic)│         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                │                 │
│         └────────────────┴────────────────┴────────────────┘                 │
│                                   │                                          │
│                          ┌────────▼────────┐                                 │
│                          │   API Service   │  (Axios + types)                │
│                          └────────┬────────┘                                 │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │ HTTP/REST
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                              BACKEND                                         │
│                          ┌────────▼────────┐                                 │
│                          │   API Routes    │  (Express + Zod validation)     │
│                          └────────┬────────┘                                 │
│                                   │                                          │
│         ┌─────────────────────────┼─────────────────────────┐               │
│         │                         │                         │               │
│  ┌──────▼──────┐          ┌───────▼───────┐         ┌───────▼───────┐       │
│  │   Search    │          │   Business    │         │    Review     │       │
│  │   Service   │          │    Service    │         │   Service     │       │
│  └──────┬──────┘          └───────┬───────┘         └───────┬───────┘       │
│         │                         │                         │               │
│         ▼                         ▼                         ▼               │
│  ┌─────────────┐          ┌─────────────┐           ┌─────────────┐         │
│  │Elasticsearch│          │ PostgreSQL  │           │  RabbitMQ   │         │
│  └─────────────┘          │  + PostGIS  │           └──────┬──────┘         │
│                           └─────────────┘                  │                │
│                                   │                        ▼                │
│                           ┌───────▼───────┐         ┌─────────────┐         │
│                           │    Redis      │         │Index Worker │         │
│                           │   (Cache)     │         └─────────────┘         │
│                           └───────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Frontend | Backend |
|-------|----------|---------|
| Language | TypeScript | TypeScript |
| Framework | React 19 + TanStack Router | Express.js |
| Styling | Tailwind CSS | - |
| State | Zustand | - |
| Validation | Zod | Zod |
| HTTP | Axios | - |
| Database | - | PostgreSQL + PostGIS |
| Search | - | Elasticsearch |
| Cache | - | Redis |
| Queue | - | RabbitMQ |

---

## 🔍 3. Deep Dive: Shared Type System (4-5 minutes)

"I'm choosing a shared types package that both frontend and backend import. This ensures the API contract is enforced at compile time. We define Business, Review, SearchRequest, and SearchResponse types once, along with Zod schemas for runtime validation."

### Key Shared Types

**Business**: id, name, description, address, city, state, zipCode, phone, website, location (Coordinates), categories, hours, amenities, averageRating, reviewCount, priceLevel, photoUrls, isActive, createdAt, updatedAt

**Review**: id, userId, businessId, rating, title, content, photoUrls, helpfulCount, isVerified, createdAt, updatedAt, user (optional nested)

**SearchRequest**: q (optional), lat, lng, radius (default 10km), category, minRating, priceLevel, openNow, sort (relevance/rating/distance/reviews), page, limit

**SearchResponse**: businesses (BusinessSummary[]), facets (categories, priceLevels), pagination, meta (tookMs, cacheHit)

### Zod Validation Schemas

Shared Zod schemas validate coordinates (lat -90 to 90, lng -180 to 180), search parameters (radius 0.1-50km, page/limit constraints), and review creation (rating 1-5, title 3-200 chars, content 50-5000 chars, max 5 photos). Both frontend forms and backend routes use these same schemas.

---

## 🔍 4. Deep Dive: Search Flow End-to-End (8-10 minutes)

### Frontend: SearchBar with Autocomplete

The SearchBar component uses a debounced query (200ms delay) to fetch autocomplete suggestions. It maintains local state for the input value and suggestions list. An AbortController cancels in-flight requests when the user types more. Suggestions display business names with categories, and clicking navigates to /search with query params.

### Backend: Autocomplete Endpoint

The autocomplete endpoint validates input with Zod (min 2, max 50 chars), checks Redis cache first (key: autocomplete:{query}), then queries Elasticsearch using multi_match with bool_prefix type on name.autocomplete, categories, and description fields. Results are cached for 5 minutes.

### Backend: Search Endpoint with Geo-Distance

The main search endpoint builds an Elasticsearch query with geo_distance filter (using lat/lng/radius), text matching with fuzziness, and optional filters for category, minRating, and priceLevel. Sort options include distance (using _geo_distance), rating (desc), reviews count (desc), or relevance (score + distance). Aggregations provide facets for categories and price levels. Results are cached for 2 minutes with a cache key built from normalized query parameters.

### Frontend: Search Results Page

The SearchPage component syncs filters with URL search params, fetches user geolocation if not provided, and displays results in list or map view. FilterPanel updates URL params on change (replacing history to avoid back button pollution). Pagination controls navigate pages. The results count shows cache hit status for transparency.

---

## 🔍 5. Deep Dive: Review Submission Flow (8-10 minutes)

### Frontend: Review Form with Optimistic Updates

"I'm implementing optimistic updates because reviews should feel instant. The form generates a UUID idempotency key, creates a temporary review with a temp-{key} id, adds it to the UI immediately, then sends the POST request. On success, we swap the temp review for the real one. On failure, we remove the temp review and show an error."

The ReviewForm component uses react-hook-form with zodResolver for validation. It tracks submission state and handles three scenarios: success (replace temp with real review, update business rating), conflict (user already reviewed this business), and rate limit (show retry message).

### Backend: Review Creation with Idempotency

The backend review route first checks if the idempotency key exists in Redis (cached for 24 hours). If found, it returns the cached response. Otherwise, it starts a PostgreSQL transaction:

1. Check for existing review (unique constraint also catches this)
2. Insert review (database trigger updates business rating_sum and review_count)
3. Get updated business rating
4. Commit transaction
5. Publish index.update event to RabbitMQ for async Elasticsearch sync
6. Invalidate Redis caches (business:{id} and search:* keys)
7. Cache response with idempotency key
8. Return review with user info and updated business rating

### Frontend: Business Page with Optimistic Reviews

The BusinessDetailPage maintains state for business and reviews. The handleOptimisticAdd function adds the temp review and calculates a new average rating. The handleOptimisticRemove function removes the temp review and refetches business data to restore correct rating. The handleReviewCreated function swaps temp for real review and updates the rating from the server response.

---

## 🔍 6. Deep Dive: API Client with Type Safety (4-5 minutes)

"I'm using a typed API client wrapper around Axios. Each endpoint has a specific function with typed parameters and return values. This catches API mismatches at compile time rather than runtime."

### Typed API Client

The api module exports domain-specific clients:

**searchApi**: search(params: SearchRequest) returns SearchResponse, autocomplete(q: string) returns suggestions array

**businessApi**: getById(id) returns Business, getReviews(id, page, limit) returns reviews with hasMore, createReview(businessId, data, idempotencyKey) returns CreateReviewResponse

**authApi**: login, register, logout, me endpoints for session management

The base Axios instance includes credentials (for session cookies) and a response interceptor that redirects to /login on 401 errors.

---

## 🔍 7. Deep Dive: Rate Limiting Integration (3-4 minutes)

### Backend: Rate Limit Middleware

The rateLimit middleware uses a Redis Lua script for atomic check-and-increment. It tracks request count per key (e.g., user ID or IP) within a sliding window. Response headers include X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset. When exceeded, returns 429 with Retry-After header.

Configuration example for reviews: limit 10, windowSeconds 3600 (10 reviews per hour per user).

### Frontend: Handling Rate Limit Errors

The Axios response interceptor catches 429 errors, extracts the retryAfter value from the response, and shows a user-friendly toast message like "Too many requests. Please try again in X minute(s)."

---

## 🔍 8. Deep Dive: Error Handling (3-4 minutes)

### Backend: Error Middleware

The error handler middleware handles multiple error types:
- **ZodError**: Returns 400 with validation details (path and message for each issue)
- **AppError**: Custom errors with statusCode, message, and optional code
- **Database constraint violations** (code 23505): Returns 409 "Resource already exists"
- **Unknown errors**: Returns 500 "Internal server error" and logs full stack trace

### Frontend: Error Boundary

A React ErrorBoundary component catches rendering errors, logs them (with error reporting in production), and displays a fallback UI with a reload button. This prevents the entire app from crashing due to component errors.

---

## ⚖️ 9. Trade-offs and Alternatives (3-4 minutes)

### API Design

| Option | Decision |
|--------|----------|
| ✅ REST | Simple, cacheable, familiar - fits CRUD well |
| ❌ GraphQL | Flexible queries but adds complexity, harder caching |
| ❌ tRPC | Full type safety but tight coupling, learning curve |

### State Management

| Option | Decision |
|--------|----------|
| ✅ Zustand | Lightweight, simple - right-sized for this app |
| ❌ TanStack Query | Great for server state but overkill for simple cases |
| ❌ Redux | Predictable with DevTools but too much boilerplate |

### Validation

| Option | Decision |
|--------|----------|
| ✅ Zod (shared) | Type inference + runtime validation - single source of truth |
| ❌ Yup | Mature and expressive but no TypeScript type inference |
| ❌ io-ts | Functional style but steep learning curve |

---

## 📊 10. Monitoring and Observability (2-3 minutes)

### Frontend Performance Metrics

Web Vitals collection (CLS, FID, FCP, LCP, TTFB) using the web-vitals library. Metrics are sent to the backend via navigator.sendBeacon to avoid blocking page unload. Each metric includes the page path and timestamp.

### Backend Request Tracing

A tracing middleware generates/propagates request IDs (X-Request-ID header), logs method, path, status, duration, and userId on response finish. Prometheus metrics track HTTP request duration histograms with labels for method, path, and status code.

---

## 🚀 Summary

The key full-stack insights for Yelp's design are:

1. **Shared Type System**: TypeScript types and Zod schemas shared between frontend and backend ensure contract consistency and catch mismatches at compile time

2. **End-to-End Search Flow**: Debounced autocomplete with abort controllers, geo-aware search with Elasticsearch, and URL-synchronized filters provide seamless UX

3. **Optimistic Updates with Rollback**: Review form adds temp review immediately, updates on success or rolls back on failure - keeps UI responsive while maintaining consistency

4. **Idempotency for Mutations**: UUID-based idempotency keys prevent duplicate reviews on network retries, with Redis-cached responses for repeat requests

5. **Rate Limiting Integration**: Backend enforces limits with clear headers; frontend handles 429 errors gracefully with user-friendly retry messages

6. **Type-Safe API Client**: Axios wrapper with typed methods ensures request/response types match backend contracts

7. **Error Handling at All Layers**: Zod validation errors, database constraints, and application errors are handled with appropriate status codes and user-friendly messages

This architecture delivers a cohesive experience where frontend and backend work together to provide fast, reliable, and user-friendly business search and review functionality.
