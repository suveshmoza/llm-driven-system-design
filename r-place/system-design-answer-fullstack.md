# r/place - Collaborative Real-time Pixel Canvas - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Introduction (2 minutes)

"Thanks for this challenge. I'll be designing r/place, Reddit's collaborative pixel art canvas where millions of users place colored pixels on a shared canvas in real-time, with rate limiting to encourage collaboration. As a fullstack engineer, I'll focus on the end-to-end pixel placement flow, the real-time WebSocket protocol, session management, and how frontend and backend coordinate to deliver a smooth collaborative experience. Let me clarify the requirements."

---

## 🎯 1. Requirements Clarification (4 minutes)

### Functional Requirements

1. **Shared Pixel Canvas** - A grid where any authenticated user can place colored pixels
2. **Rate Limiting** - Users can only place one pixel every 5 seconds
3. **Real-time Updates** - All users see pixel placements from others instantly
4. **Color Palette** - 16-color selection
5. **Canvas History** - Store all pixel placement events
6. **Session Management** - Support both registered users and anonymous guests

### Non-Functional Requirements

- **Latency** - Pixel updates visible within 100ms
- **Scale** - Support 100K concurrent users
- **Consistency** - Eventual consistency with last-write-wins
- **Availability** - 99.9% uptime during events

### Fullstack Considerations

- WebSocket protocol design for bidirectional communication
- Optimistic UI with server-side validation
- Session handling across frontend and backend
- Error handling and graceful degradation

---

## 🏗️ 2. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Canvas View  │  │ WebSocket    │  │ Auth Store   │          │
│  │ (HTML5)      │  │ Manager      │  │ (Zustand)    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (nginx)                         │
│                        Port 3000                                 │
└─────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Express + WS)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ REST Routes  │  │ WebSocket    │  │ Session      │          │
│  │ /api/v1/*    │  │ Handler      │  │ Middleware   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                          │
├───────────────┬───────────────┬───────────────┬─────────────────┤
│    Redis      │  PostgreSQL   │   RabbitMQ    │     Redis       │
│   (Canvas)    │   (History)   │   (Jobs)      │   (Sessions)    │
└───────────────┴───────────────┴───────────────┴─────────────────┘
```

---

## 🔧 3. Deep Dive: End-to-End Pixel Placement Flow (10 minutes)

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   PIXEL PLACEMENT FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FRONTEND                 BACKEND                    REDIS      │
│     │                        │                         │        │
│     │ 1. Click canvas (x,y)  │                         │        │
│     │───────────────────────▶│                         │        │
│     │    WebSocket: place    │                         │        │
│     │                        │                         │        │
│     │                        │ 2. Check rate limit     │        │
│     │                        │────────────────────────▶│        │
│     │                        │ SET NX EX               │        │
│     │                        │                         │        │
│     │                        │ 3. Update canvas        │        │
│     │                        │────────────────────────▶│        │
│     │                        │ SETRANGE                │        │
│     │                        │                         │        │
│     │                        │ 4. Publish update       │        │
│     │                        │────────────────────────▶│        │
│     │                        │ PUBLISH                 │        │
│     │                        │                         │        │
│     │ 5. Receive update      │                         │        │
│     │◀───────────────────────│                         │        │
│     │    pixels: [...]       │                         │        │
│     │                        │                         │        │
│     │ 6. Update local canvas │                         │        │
│     ▼                        ▼                         ▼        │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend: Click Handler with Optimistic Update

"We use optimistic updates to show the pixel immediately, then rollback if the server rejects it."

**Step-by-step:**
1. **Get coordinates** - Convert click position to canvas (x, y)
2. **Check local cooldown** - If cooldownEnd > now, show toast and return
3. **Store previous color** - For rollback: previousColor = canvas[y × width + x]
4. **Optimistic update** - Immediately update canvas and start cooldown
5. **Send to server** - WebSocket message with x, y, color, requestId
6. **Handle response:**
   - On success: Update cooldown from server's nextPlacement
   - On error: Rollback to previousColor, show error toast

### Backend: Placement Handler

**Validation:**
1. Check 0 ≤ x < WIDTH and 0 ≤ y < HEIGHT → INVALID_COORDS error
2. Check 0 ≤ color < 16 → INVALID_COLOR error

**Rate limit check:**
- Key: `ratelimit:user:{userId}`
- Command: SET key 1 NX EX 5 (only set if not exists, expire in 5s)
- If returns null → RATE_LIMITED error with TTL

**Update canvas:**
- offset = y × WIDTH + x
- SETRANGE canvas:main {offset} {colorByte}

**Broadcast and persist:**
- PUBLISH canvas:updates {x, y, color, userId, timestamp}
- Queue event for PostgreSQL via RabbitMQ

**Return success:**
- `{ type: 'success', requestId, nextPlacement: now + cooldownMs }`

---

## 📡 4. Deep Dive: WebSocket Protocol Design (8 minutes)

### Message Types

**Client → Server:**

| Type | Fields | Description |
|------|--------|-------------|
| `place` | x, y, color, requestId | Place a pixel |
| `ping` | — | Keepalive |

**Server → Client:**

| Type | Fields | Description |
|------|--------|-------------|
| `welcome` | userId, cooldown, canvasInfo | Connection established |
| `canvas` | data (base64), width, height | Full canvas state |
| `pixels` | events[] | Batch of pixel updates |
| `success` | requestId, nextPlacement | Placement confirmed |
| `error` | code, message, requestId?, remainingSeconds? | Placement failed |
| `pong` | — | Heartbeat response |

**CanvasInfo structure:**
- width: number (e.g., 500)
- height: number (e.g., 500)
- cooldownSeconds: number (e.g., 5)
- colorCount: number (e.g., 16)

### Backend: Connection Lifecycle

**On server start:**
1. Create Redis subscriber
2. Subscribe to `canvas:updates` channel
3. On message: broadcast to all connected clients

**On new connection:**
1. Get or create session from cookie
2. Add to connections set
3. Send welcome message with userId, remaining cooldown
4. Send full canvas state (base64 encoded)
5. Set up message and close handlers

**On disconnect:**
1. Remove from connections set
2. Clean up pending requests

### Frontend: WebSocket Manager

**State:**
- ws: WebSocket | null
- reconnectAttempts: number
- pendingRequests: Map<requestId, { resolve, reject }>

**connect():**
1. Determine protocol (wss: for https:, ws: for http:)
2. Create WebSocket to `${protocol}//${host}/ws`
3. Set up handlers for open, message, close, error
4. On open: reset attempts, set connected, start batch processing

**Reconnection:**
- Delay: min(1000 × 2^attempts, 30000)
- Jitter: random() × 1000
- Schedule reconnect with delay + jitter

**placePixel(x, y, color) → Promise:**
1. Generate requestId (UUID)
2. Store { resolve, reject } in pendingRequests
3. Send message, set 5s timeout
4. On response: match by requestId, resolve or reject

---

## 🔐 5. Deep Dive: Session Management (6 minutes)

### Session Structure

| Field | Type | Description |
|-------|------|-------------|
| userId | string | Unique identifier |
| username | string | Display name |
| isGuest | boolean | Anonymous or registered |
| isAdmin | boolean | Admin privileges |
| createdAt | Date | Session creation time |

### Backend: Session Middleware

**On each request:**
1. Check for sessionId cookie
2. If exists: fetch session from Redis (`session:{sessionId}`)
3. If valid: attach to request, refresh TTL
4. If missing/invalid: create guest session

**Creating guest session:**
- Generate new sessionId (UUID)
- Create session with random username (Guest_XXXXXX)
- Store in Redis with 24h TTL
- Set httpOnly, secure, sameSite cookie

### Auth API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Create account |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/logout` | End session |
| GET | `/api/v1/auth/me` | Get current user |

**Register flow:**
1. Validate username (3-32 chars) and password (≥8 chars)
2. Check username not taken
3. Hash password with bcrypt (cost 12)
4. Insert into users table
5. Update session to non-guest

**Login flow:**
1. Look up user by username (check not banned)
2. Verify password with bcrypt
3. Update session with user data

### Frontend: Auth Store (Zustand)

**State:**
- userId, username, isGuest, isAdmin, isLoading

**Actions:**
- fetchSession(): GET /api/v1/auth/me on app load
- login(username, password): POST /api/v1/auth/login
- logout(): POST /api/v1/auth/logout, reload page

---

## 🚨 6. Deep Dive: Error Handling (5 minutes)

### Error Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND                 BACKEND               USER FEEDBACK   │
│     │                        │                       │          │
│     │ 1. Place pixel         │                       │          │
│     │───────────────────────▶│                       │          │
│     │                        │                       │          │
│     │ 2. Rate limited        │                       │          │
│     │◀───────────────────────│                       │          │
│     │  error: RATE_LIMITED   │                       │          │
│     │  remainingSeconds: 3   │                       │          │
│     │                        │                       │          │
│     │ 3. Rollback pixel      │                       │          │
│     │ 4. Update cooldown     │                       │          │
│     │ 5. Show toast ─────────────────────────────────▶│         │
│     │                        │    "Wait 3 seconds"   │          │
│     ▼                        ▼                       ▼          │
└─────────────────────────────────────────────────────────────────┘
```

### Backend: AppError Class

| Property | Type | Example |
|----------|------|---------|
| code | string | 'RATE_LIMITED' |
| message | string | 'Please wait before placing another pixel' |
| statusCode | number | 429 |
| metadata | object | { remainingSeconds: 3 } |

**Error handler middleware:**
- If AppError: respond with code, message, metadata
- Else: log error, respond with generic INTERNAL_ERROR

### Frontend: Error Handling

**ErrorBoundary:**
- Wrap entire app
- Show fallback UI on crash
- Log error to monitoring

**Toast notifications:**
- Queue of toasts with auto-dismiss (3s)
- Color-coded by type (error, success, info)

---

## 📡 7. API Design Summary

### REST Endpoints

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| GET | `/api/v1/canvas` | Full canvas binary | Binary (250KB) |
| GET | `/api/v1/canvas/info` | Canvas metadata | `{ width, height, colorCount, cooldownSeconds }` |
| GET | `/api/v1/history/pixel?x=&y=` | Pixel history | `{ placements: [...] }` |
| POST | `/api/v1/auth/register` | Create account | `{ success, username }` |
| POST | `/api/v1/auth/login` | Login | `{ success, username, isAdmin }` |
| POST | `/api/v1/auth/logout` | Logout | `{ success }` |
| GET | `/api/v1/auth/me` | Current user | `{ userId, username, isGuest, isAdmin }` |

### WebSocket Endpoint

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `/ws` | WS/WSS | Real-time bidirectional communication |

---

## ⚖️ 8. Trade-offs Analysis

### Trade-off 1: WebSocket vs. Server-Sent Events + REST

| Approach | Pros | Cons |
|----------|------|------|
| ✅ WebSocket | Bidirectional, single connection, request/response matching | Connection management complexity |
| ❌ SSE + REST | Simpler server, built-in reconnection | Two connections, no request/response correlation |

> "We chose WebSocket because pixel placement needs request/response correlation—when a user places a pixel, we need to tell them specifically whether THAT placement succeeded or failed. With SSE+REST, we'd have to correlate a POST response with an SSE event, adding complexity. WebSocket lets us send a requestId and match the response. The trade-off is we need to implement reconnection logic, but that's well-understood. For a read-only feed, SSE would be simpler, but r/place is inherently bidirectional."

### Trade-off 2: Session-Based Auth vs. JWT

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Session + Redis | Revocable, simple, server can invalidate | Requires Redis lookup on each request |
| ❌ JWT | Stateless, no Redis lookup | Can't revoke without blacklist, token bloat |

> "We chose session-based auth because we need instant session invalidation for moderation (banning abusive users must take effect immediately). With JWT, a banned user's token remains valid until expiration. The Redis lookup adds ~1ms latency, which is negligible compared to our 100ms target. Sessions also keep the cookie small (just a session ID vs. a full JWT payload). The trade-off is that every request hits Redis, but we're already hitting Redis for rate limiting, so it's not an additional dependency."

### Trade-off 3: Optimistic UI vs. Wait for Confirmation

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Optimistic + rollback | Instant feedback, responsive UX | Brief incorrect state on rejection |
| ❌ Wait for server | Always accurate | 50-200ms delay feels sluggish |

> "We show the pixel immediately because users expect instant feedback. A 100ms delay is perceptible and makes the app feel broken. The trade-off is that ~1% of placements get rejected (mostly rate limiting), requiring rollback. We mitigate this by checking local cooldown state first—if the frontend knows the user is on cooldown, we don't even try to place. Rollback is visually smooth since we restore a single pixel. For financial transactions this would be unacceptable, but for collaborative art, brief optimistic inaccuracy is fine."

---

## 🚨 9. Failure Handling

| Component | Failure Mode | Mitigation |
|-----------|--------------|------------|
| Redis | Down | Circuit breaker, serve cached canvas from CDN |
| PostgreSQL | Down | Buffer events in RabbitMQ, retry on recovery |
| WebSocket | Disconnect | Auto-reconnect with exponential backoff |
| API Server | Crash | Load balancer health checks, stateless servers |

---

## 📝 Summary

"To summarize, I've designed r/place as a fullstack application with:

1. **End-to-end pixel flow** using WebSocket for real-time communication with optimistic updates and server-side validation
2. **Bidirectional protocol** with typed messages for placement, confirmation, errors, and broadcast updates
3. **Session management** using Redis-backed sessions with cookie authentication, supporting both guests and registered users
4. **Comprehensive error handling** with rollback on failure, appropriate user feedback, and graceful degradation
5. **Frontend state** in Zustand with optimistic updates and automatic reconnection
6. **Backend services** with rate limiting, event persistence, and pub/sub broadcasting

The key insight is that the frontend and backend work together as a unified system—optimistic updates provide instant feedback while server validation ensures correctness. The WebSocket protocol enables true real-time collaboration while the session system provides flexible authentication for both casual and engaged users."
