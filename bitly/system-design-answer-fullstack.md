# Bitly (URL Shortener) - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Problem Statement

Design a complete URL shortening service that:
- Provides seamless URL shortening with instant feedback
- Delivers sub-50ms redirect latency at scale
- Tracks and visualizes click analytics in real-time
- Supports custom short codes with live availability checking

## Requirements Clarification

### Functional Requirements
1. **URL Shortening**: Generate 7-character short codes from long URLs
2. **Fast Redirects**: Redirect with < 50ms latency using multi-tier caching
3. **Custom Codes**: User-specified codes with live validation
4. **Analytics**: Click tracking with referrer, device, and geographic data
5. **Link Management**: Dashboard for viewing, searching, and deleting URLs
6. **User Authentication**: Session-based auth with admin capabilities

### Non-Functional Requirements
1. **Performance**: < 50ms redirect latency, < 100ms UI interactions
2. **Scalability**: Handle 100:1 read-to-write ratio
3. **Consistency**: Strong for URL creation, eventual for analytics
4. **Reliability**: 99.99% uptime for redirect service

### Scale Estimates
- 100M URLs/month (40 writes/second)
- 10B redirects/month (4,000 reads/second)
- 100:1 read-to-write ratio

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         React Frontend (Vite)                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ URLShortener│  │  URLList   │  │ Analytics  │  │   Admin    │        │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Load Balancer (nginx)                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ API Server  │ │ API Server  │ │ API Server  │
            │   (Node)    │ │   (Node)    │ │   (Node)    │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
            ┌──────┴───────────────┴───────────────┴──────┐
            │                                             │
    ┌───────▼───────┐  ┌───────────────┐  ┌──────────────▼─────┐
    │    Valkey     │  │  PostgreSQL   │  │     RabbitMQ       │
    │ (Cache/Session)│  │  (Primary DB) │  │ (Analytics Queue)  │
    └───────────────┘  └───────────────┘  └────────────────────┘
```

## Deep Dive: Shared Type Definitions

### API Types

**URL Types:**
- `ShortenedUrl`: Core URL entity with id, shortCode, shortUrl, longUrl, userId, isCustom, isActive, expiresAt, clickCount, timestamps
- `ShortenRequest`: Input with long_url (required), custom_code and expires_at (optional)
- `ShortenResponse`: Output with short_url, short_code, long_url, expires_at, created_at

**Analytics Types:**
- `ClickEvent`: Individual click with urlId, shortCode, referrer, userAgent, deviceType, countryCode, clickedAt
- `AnalyticsData`: Aggregated data with totalClicks, uniqueVisitors, clicksByDay, topReferrers, devices breakdown, countries
- `DailyClicks`: Date and count pair for time-series charts
- `DeviceBreakdown`: Object with mobile, desktop, tablet counts

**Auth Types:**
- `User`: id, email, role (user/admin), createdAt
- `AuthState`: user object and isAuthenticated boolean
- `LoginRequest/RegisterRequest`: email and password

**Admin Types:**
- `SystemStats`: totalUrls, totalClicks, totalUsers, urlsToday, clicksToday, keyPoolAvailable, cacheHitRate

**API Response Wrappers:**
- `ApiResponse<T>`: Success with data property
- `ApiError`: Failure with error object (message, code, details)
- `ApiResult<T>`: Union type for type-safe error handling

### Validation Schemas (shared between frontend and backend)

URL validation uses Zod schema:
- `long_url`: Required, valid URL format, max 2048 chars, HTTP/HTTPS only
- `custom_code`: Optional, 4-20 chars, alphanumeric plus dash/underscore only
- `expires_at`: Optional, ISO datetime, must be in future

**Reserved Codes:** api, admin, auth, login, signup, register, logout, health, metrics, static, assets

## Deep Dive: API Client Layer

### Axios Configuration with Interceptors

The API client class provides:
- Base URL from environment variable (defaults to localhost:3000/api/v1)
- Credentials mode enabled for cookie-based session auth
- JSON content type headers

**Request Interceptor:**
- Adds Idempotency-Key header (UUID) for POST requests to prevent duplicate submissions

**Response Interceptor:**
- Catches 401 errors, clears auth store, redirects to login

**Convenience Methods:** get, post, put, delete with type-safe generics

### URL Service

Service functions for URL operations:
- `shorten(request)`: POST /shorten - Create short URL
- `getUserUrls()`: GET /user/urls - List user's URLs
- `getUrl(shortCode)`: GET /urls/:code - Get URL metadata
- `checkAvailability(code)`: GET /urls/:code/available - Real-time availability check
- `getAnalytics(shortCode, params)`: GET /urls/:code/stats - Analytics with date range
- `deleteUrl(shortCode)`: DELETE /urls/:code - Deactivate URL

## Deep Dive: Backend API Routes

### URL Shortening Endpoint

POST /api/v1/shorten flow:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Generate idempotency key (header or fingerprint)            │
│  2. Check idempotency cache → return cached if duplicate        │
│  3. Validate input with Zod schema                              │
│  4. If custom_code provided:                                    │
│     - Check reserved words → reject if reserved                 │
│     - Check urls + key_pool tables → reject if taken            │
│  5. Else: Get code from pre-generated key pool                  │
│  6. INSERT into urls table                                      │
│  7. Write-through to Redis cache                                │
│  8. Store in idempotency cache                                  │
│  9. Return short_url, short_code, long_url, expires_at          │
└─────────────────────────────────────────────────────────────────┘
```

**Error Responses:**
- 400 VALIDATION_ERROR: Invalid input with field-level details
- 400 RESERVED_CODE: Custom code is reserved
- 409 CODE_TAKEN: Custom code already exists
- 500 INTERNAL_ERROR: Unexpected failure

### Redirect Endpoint

GET /:shortCode flow:

```
┌─────────────────────────────────────────────────────────────────┐
│  RedirectService.getLongUrl(shortCode)                          │
├─────────────────────────────────────────────────────────────────┤
│  Tier 1: Local LRU Cache (in-memory)                            │
│  ├─ Hit (~0.1ms) → Return immediately                           │
│  └─ Miss → Continue                                             │
│                                                                  │
│  Tier 2: Redis Cache                                            │
│  ├─ Hit (~1ms) → Populate local cache, return                   │
│  └─ Miss → Continue                                             │
│                                                                  │
│  Tier 3: PostgreSQL (with circuit breaker)                      │
│  ├─ Found → Check expiration, populate caches, return           │
│  └─ Not Found → Return null                                     │
├─────────────────────────────────────────────────────────────────┤
│  Response:                                                       │
│  - 302 redirect to long URL (not 301 for accurate analytics)   │
│  - 404 if not found                                             │
│  - 410 if expired                                               │
├─────────────────────────────────────────────────────────────────┤
│  Async Analytics (non-blocking via setImmediate):               │
│  → RabbitMQ queue → Analytics Worker → PostgreSQL click_events  │
└─────────────────────────────────────────────────────────────────┘
```

**Metrics Recorded:**
- redirectsTotal counter (status: success/not_found/expired/error, cached: hit/miss)
- redirectLatency histogram

### Analytics Endpoint

GET /api/v1/urls/:code/stats flow:

1. Verify ownership (user_id match or admin role)
2. Parse date range (defaults to last 30 days)
3. Execute parallel queries:
   - Total clicks and unique visitors (COUNT, COUNT DISTINCT ip_hash)
   - Clicks by day (GROUP BY DATE)
   - Top 10 referrers (GROUP BY referrer, ORDER BY count)
   - Device breakdown (GROUP BY device_type)
   - Top 20 countries (GROUP BY country_code)
4. Transform and return aggregated response

## Deep Dive: Full URL Creation Flow

### Frontend to Backend Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User Input (URLShortener Component)                         │
│     - User types long URL                                       │
│     - useUrlValidation hook validates format                    │
│     - Optional: enters custom code (debounced availability)     │
├─────────────────────────────────────────────────────────────────┤
│  2. Form Submission (urlStore.shortenUrl)                       │
│     - Sets isShortening = true                                  │
│     - Generates idempotency key                                 │
│     - Calls urlService.shorten()                                │
├─────────────────────────────────────────────────────────────────┤
│  3. API Request                                                  │
│     POST /api/v1/shorten                                        │
│     Headers: { Idempotency-Key: <uuid> }                        │
│     Body: { long_url, custom_code?, expires_at? }               │
├─────────────────────────────────────────────────────────────────┤
│  4. Backend Processing                                          │
│     a. Check idempotency cache                                  │
│     b. Validate with Zod schema                                 │
│     c. Get short code (custom or key pool)                      │
│     d. Insert into PostgreSQL                                   │
│     e. Write-through to Redis cache                             │
│     f. Store in idempotency cache                               │
├─────────────────────────────────────────────────────────────────┤
│  5. Response Handling (urlStore continued)                      │
│     - Adds new URL to urls array (optimistic)                   │
│     - Sets isShortening = false                                 │
│     - Returns ShortenedUrl                                      │
├─────────────────────────────────────────────────────────────────┤
│  6. UI Update (ShortenedResult Component)                       │
│     - Animated entrance (framer-motion)                         │
│     - Copy button with feedback                                 │
│     - Screen reader announcement                                │
└─────────────────────────────────────────────────────────────────┘
```

## Deep Dive: Authentication Flow

### Session-Based Auth Implementation

**Login Flow:**
1. Find user by email (lowercase)
2. Verify password with bcrypt
3. Generate session token (32 random bytes, hex encoded)
4. Store in PostgreSQL sessions table (backup)
5. Store in Redis with 7-day TTL (primary)
6. Set httpOnly cookie with token

**Session Cookie Configuration:**
- Name: bitly_session
- httpOnly: true (prevents XSS)
- secure: production only
- sameSite: lax (CSRF protection)
- maxAge: 7 days

**Logout Flow:**
1. Delete from Redis
2. Delete from PostgreSQL
3. Clear cookie

**Session Verification (GET /me):**
1. Check Redis for session (fast path)
2. Fallback to PostgreSQL JOIN with users table
3. If found in DB but not Redis, repopulate Redis
4. Return user data or 401

### Frontend Auth Integration

App component checks session on mount via authStore.checkSession(). Routes are organized:
- Public: /login, /register
- Protected (requires auth): /, /urls, /analytics/:code
- Admin (requires admin role): /admin

ProtectedRoute component redirects to /login if not authenticated, preserving the intended destination in location state.

## Deep Dive: Custom Code Availability Check

### Debounced Frontend Check

CustomCodeInput component provides real-time feedback:
1. Debounce input by 300ms
2. Skip check if < 4 characters
3. Check reserved words locally first (instant rejection)
4. Call urlService.checkAvailability
5. Display status indicator (spinner, checkmark, X)

**Input Sanitization:** Strips non-alphanumeric characters (except dash/underscore) on change

### Backend Availability Endpoint

GET /api/v1/urls/:code/available checks:
1. Format validation (4-20 chars, alphanumeric/-/_)
2. Reserved words list
3. URLs table (existing short codes)
4. Key pool table (pre-generated codes)

Returns `{ available: boolean, reason?: string }`

## Deep Dive: Error Handling

### Unified Error Handling

**AppError Class:** Custom error with message, code, statusCode, and optional details object

**Error Handler Middleware:**
1. Log with structured logging (path, method, error, stack)
2. If AppError: Return structured response with code
3. If ZodError: Return VALIDATION_ERROR with flattened field errors
4. Else: Return generic INTERNAL_ERROR (hide implementation details)

### Frontend Error Display

**ErrorBoundary Component:**
- Wraps application with ReactErrorBoundary
- Renders centered error message with retry button
- Calls resetErrorBoundary to attempt recovery

**useApiError Hook:**
- Provides handleError callback
- Extracts message from Axios errors or standard Error
- Shows toast notification via useToastStore

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Shared Zod schemas | Single source of truth, type-safe | Build complexity |
| Session-based auth | Simple, revocable | Requires Redis |
| Debounced availability check | Reduces API calls | Slight UX delay |
| 302 redirects | Accurate analytics | More server load |
| Optimistic UI updates | Instant feedback | Rollback complexity |
| Write-through cache | Consistent reads | Extra write latency |

## Future Fullstack Enhancements

1. **Real-time Analytics**: WebSocket for live click updates
2. **Bulk Operations**: Create/delete multiple URLs via CSV
3. **Link Previews**: Server-side OG image generation
4. **A/B Testing**: Split traffic between multiple destinations
5. **API Keys**: Third-party integration with rate limits
6. **Webhooks**: Notify on click thresholds
7. **Multi-tenancy**: Organization accounts with team members
8. **Mobile App**: React Native with shared business logic
