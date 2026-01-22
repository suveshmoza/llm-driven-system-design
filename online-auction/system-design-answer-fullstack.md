# Online Auction System - Fullstack System Design Interview Answer

## Introduction (2 minutes)

"Thanks for this problem. I'll be designing an online auction platform covering both frontend and backend, with emphasis on the integration points between them. I'll focus on real-time bid synchronization, the API contract, type safety across the stack, and ensuring a consistent experience during high-activity periods."

---

## 1. Requirements Clarification (5 minutes)

### Functional Requirements

1. **Auction Lifecycle** - Create, list, bid, auto-bid, end auctions
2. **Real-Time Sync** - Bidders see updates instantly across devices
3. **Anti-Sniping** - Extend auctions on last-minute bids
4. **User Management** - Registration, authentication, watchlists
5. **Admin Operations** - Cancel auctions, ban users, view analytics

### Integration-Focused Non-Functional Requirements

- **Type Safety** - Shared types between frontend and backend
- **Real-Time Latency** - Bid updates delivered within 500ms
- **Optimistic Updates** - Immediate UI feedback with server reconciliation
- **Idempotency** - Safe retries for all mutation operations
- **Graceful Degradation** - Fallback when WebSocket fails

---

## 2. Shared Type Definitions (5 minutes)

"Shared types ensure contract consistency between frontend and backend."

### Core Domain Types

The system defines shared TypeScript interfaces in a `shared/types/` directory used by both frontend and backend:

**Auction**: Contains id, sellerId, title, description, category, startingPrice, currentBid, currentBidderId, reservePrice, bidIncrement, bidCount, status (draft | active | ended | sold | unsold | cancelled), startTime, endTime, originalEndTime, createdAt, updatedAt.

**Bid**: Contains id, auctionId, bidderId, bidderName (anonymized), amount, maxAmount (only visible to owner), isProxyBid, isWinning, createdAt.

**AutoBid**: Contains id, auctionId, bidderId, maxAmount, currentBid, isActive, createdAt.

### API Request/Response Types

**PlaceBidRequest**: amount (number), maxAmount (optional for auto-bid).

**PlaceBidResponse**: bidId, status (accepted | pending | rejected), finalAmount, isHighestBidder, message, auctionEndTime.

**PaginatedResponse<T>**: data array, pagination object with page, limit, total, totalPages.

**ApiError**: error code, message, optional details map.

### WebSocket Message Types

```
┌──────────────────────────────────────────────────────────────┐
│                    WebSocket Message Types                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Server → Client                Client → Server              │
│  ┌──────────────────┐          ┌──────────────────┐         │
│  │ bid_update       │          │ subscribe        │         │
│  │ auction_extended │          │ unsubscribe      │         │
│  │ auction_ended    │          │ ping             │         │
│  │ outbid_notif     │          └──────────────────┘         │
│  │ connection_ack   │                                        │
│  │ error            │                                        │
│  └──────────────────┘                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. WebSocket Integration (10 minutes)

"Real-time synchronization is critical for auction UX. Here's the full-stack implementation."

### Backend: WebSocket Server Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   AuctionWebSocketServer                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ WebSocketServer │    │ Redis Pub/Sub   │                    │
│  │ (ws library)    │    │                 │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           ▼                      ▼                              │
│  ┌─────────────────────────────────────────┐                   │
│  │           State Maps                    │                   │
│  ├─────────────────────────────────────────┤                   │
│  │ clients: Map<WebSocket, ConnectedClient>│                   │
│  │ auctionSubscribers: Map<auctionId, Set> │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                 │
│  ConnectedClient = { ws, userId, watchedAuctions: Set }        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Redis Subscription Setup**: Server pattern-subscribes to `auction:*` channels. On pmessage, extracts auctionId from channel and broadcasts to local subscribers.

**WebSocket Handlers**:
- On connection: Create ConnectedClient, send connection_ack with connectionId
- On "subscribe" message: Add client to auctionSubscribers map
- On "unsubscribe" message: Remove client from auction map
- On "ping" message: Respond with pong
- On disconnect: Cleanup all auction subscriptions

**Cross-Server Broadcasting**: When a bid occurs, server calls `publishBidUpdate()` which publishes to `auction:{id}` Redis channel. All servers subscribed to that pattern receive and broadcast to their local clients.

### Frontend: WebSocket Hook

```
┌────────────────────────────────────────────────────────────────┐
│                    useAuctionSocket Hook                        │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  State                                                          │
│  ├── wsRef: WebSocket reference                                │
│  ├── reconnectAttempts: number                                 │
│  └── isConnected: boolean                                      │
│                                                                 │
│  Connection Lifecycle                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Create WebSocket connection                          │   │
│  │ 2. onopen: setConnected(true), send subscribe message   │   │
│  │ 3. onmessage: Route by type to handlers                 │   │
│  │ 4. onclose: Exponential backoff reconnect (max 5 tries) │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Message Handlers                                               │
│  ├── bid_update → updateFromSocket(currentBid, bidCount)       │
│  ├── auction_extended → updateFromSocket(endTime)              │
│  ├── auction_ended → updateFromSocket(status)                  │
│  └── outbid_notification → onOutbid callback                   │
│                                                                 │
│  Reconnect Formula: delay = min(1000 * 2^attempts, 30000)      │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. API Integration Layer (8 minutes)

### Backend: Express Routes

The auction routes implement validation with Zod, authentication middleware, and rate limiting.

**POST /:auctionId/bids** (Place bid):
1. Validate request body with placeBidSchema (amount positive, multipleOf 0.01)
2. Extract idempotency key from X-Idempotency-Key header
3. Call bidService.placeBid() with auctionId, bidderId, amount, maxAmount, idempotencyKey
4. Return PlaceBidResponse with bidId, status, finalAmount, isHighestBidder, message, auctionEndTime

**POST /:auctionId/proxy** (Set auto-bid):
1. Validate maxAmount
2. Call bidService.setAutoBid()
3. Return current auto-bid state

**GET /:auctionId/bids** (Bid history):
1. Parse page/limit query params
2. Return paginated bid list

**Error Handling Middleware**: Maps domain errors to HTTP responses:
- BidTooLowError → 400 BID_TOO_LOW
- AuctionEndedError → 409 AUCTION_ENDED
- LockError → 429 TOO_MANY_BIDS

### Frontend: API Client

```
┌────────────────────────────────────────────────────────────────┐
│                      ApiClient Class                            │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Base Configuration                                             │
│  └── BASE_URL: VITE_API_URL or http://localhost:3000/api/v1    │
│                                                                 │
│  Core request() Method                                          │
│  ├── Adds credentials: 'include' for session cookies           │
│  ├── Sets Content-Type: application/json                       │
│  ├── Throws ApiClientError on non-ok response                  │
│  └── Returns parsed JSON                                        │
│                                                                 │
│  Methods                                                         │
│  ├── getAuctions(params?) → PaginatedResponse<Auction>         │
│  ├── getAuction(id) → Auction                                  │
│  ├── placeBid(id, data, idempotencyKey) → PlaceBidResponse     │
│  ├── setAutoBid(id, data) → SetAutoBidResponse                 │
│  ├── getBidHistory(id, page, limit) → PaginatedResponse<Bid>   │
│  ├── getWatchlist() → Auction[]                                │
│  ├── addToWatchlist(auctionId) → void                          │
│  └── removeFromWatchlist(auctionId) → void                     │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Frontend: React Query Hooks

**useAuction(auctionId)**: Query with 5s staleTime, 30s refetchInterval as WebSocket fallback.

**useBidHistory(auctionId, page)**: Query with 10s staleTime.

**usePlaceBid()**: Mutation with optimistic update pattern:
1. onMutate: Cancel outgoing queries, snapshot previous value, optimistically update currentBid/bidCount
2. onError: Rollback to previous snapshot
3. onSettled: Invalidate auction and bids queries

**useSetAutoBid()**: Simple mutation that invalidates auction query on success.

---

## 5. Bid Processing Flow (8 minutes)

### Complete Bid Flow: Frontend to Backend to Real-Time Update

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Bid Processing Pipeline                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Step 1: Idempotency Check                                              │
│  └── Check Redis for existing idempotency key → return cached result    │
│                                                                          │
│  Step 2: Distributed Lock                                               │
│  └── Acquire lock:auction:{id} with 5s TTL using SET NX                 │
│  └── If lock fails → throw LockError (429)                              │
│                                                                          │
│  Step 3: Database Transaction                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ BEGIN                                                           │    │
│  │ ├── SELECT auction FOR UPDATE (row lock)                        │    │
│  │ ├── Validate bid (status, timing, seller check, minimum)        │    │
│  │ ├── Fetch competing auto-bids                                   │    │
│  │ ├── Resolve auto-bid competition                                │    │
│  │ ├── INSERT bid record                                           │    │
│  │ ├── UPDATE previous winning bid (is_winning = false)            │    │
│  │ ├── Check anti-sniping window (2 min)                           │    │
│  │ ├── If within window: UPDATE end_time, update Redis scheduler   │    │
│  │ ├── UPDATE auction state (current_high_bid, bidder_id)          │    │
│  │ COMMIT                                                          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Step 4: Post-Transaction Actions                                        │
│  ├── Invalidate Redis cache (auction, bids)                             │
│  ├── Publish bid_update via Redis Pub/Sub                               │
│  ├── Publish auction_extended if time changed                           │
│  └── Notify outbid user                                                 │
│                                                                          │
│  Step 5: Release Lock                                                    │
│  └── Lua script: only delete if we own the lock                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Auto-Bid Resolution Logic

When a new bid comes in against existing auto-bids:

1. If no competing auto-bids: New bidder wins at their amount
2. If new bidder's effective max > highest auto-bid max: New bidder wins at (highest max + increment) or their max, whichever is lower
3. If existing auto-bidder has higher max: Auto-bidder wins at (new amount + increment) or their max, whichever is lower

### Bid Validation Rules

- Auction must exist
- Status must be 'active'
- End time must be in future
- Bidder cannot be the seller
- Amount must be >= (current_high_bid OR starting_price) + bid_increment

---

## 6. State Synchronization Pattern (5 minutes)

### Frontend Store with Server Reconciliation

```
┌────────────────────────────────────────────────────────────────────┐
│                    Zustand Auction Store                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  State Shape                                                        │
│  ├── auctions: Record<string, Auction>                             │
│  ├── pendingBids: Record<string, { amount, timestamp }>            │
│  └── lastServerSync: Record<string, number>                        │
│                                                                     │
│  Actions                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ setAuction(auction)                                         │   │
│  │   └── Store auction, update lastServerSync timestamp        │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ updateFromSocket(auctionId, update)                         │   │
│  │   └── If pendingBid.amount > update.currentBid: skip update │   │
│  │   └── Otherwise: merge update, update sync timestamp        │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ optimisticBid(auctionId, amount)                            │   │
│  │   └── Store in pendingBids with timestamp                   │   │
│  │   └── Update auction.currentBid and bidCount                │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ confirmBid(auctionId, serverData)                           │   │
│  │   └── Clear pendingBid                                      │   │
│  │   └── Apply server's finalAmount                            │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ rollbackBid(auctionId)                                      │   │
│  │   └── Delete pendingBid, next WS update restores state      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Selectors                                                          │
│  ├── useAuctionById(id) → Auction                                  │
│  └── useHasPendingBid(id) → boolean                                │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

**Key Insight**: When a WebSocket update arrives with a lower bid than our pending bid, we skip the update because the server hasn't processed our bid yet. This prevents UI flickering.

---

## 7. Error Handling Across Stack (3 minutes)

### Shared Error Types

The system defines a base AppError class with code, message, and httpStatus. Specific errors extend this:

- **BidTooLowError** (400): Includes minimumBid amount
- **AuctionEndedError** (409): Auction has ended
- **LockError** (429): Too many concurrent requests
- **NotFoundError** (404): Resource not found

### Frontend Error Handling Pattern

The BidForm component handles errors from usePlaceBid mutation:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend Error Mapping                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Error Code          │ User-Facing Message                      │
│  ────────────────────┼──────────────────────────────────────────│
│  BID_TOO_LOW         │ "Your bid is too low. Minimum: $X"       │
│  AUCTION_ENDED       │ "Sorry, this auction has ended."         │
│  LOCK_TIMEOUT        │ "Too many bids right now. Try again."    │
│  (default)           │ "Failed to place bid. Please try again." │
│  (network error)     │ "Network error. Check your connection."  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Trade-offs and Alternatives (3 minutes)

| Decision | Chosen Approach | Trade-off | Alternative |
|----------|----------------|-----------|-------------|
| WebSocket vs SSE | WebSocket | Bidirectional, but more complex | SSE simpler, one-way only |
| Shared types | Monorepo with shared folder | Build complexity | Code generation from OpenAPI |
| Optimistic updates | Immediate UI update | Brief inconsistency | Wait for server (slower UX) |
| Auto-bid resolution | Server-side only | Client doesn't see outcome instantly | Client prediction (complex) |
| Idempotency | UUID per request | Client must generate | Server-generated (less control) |
| State sync | Zustand + WebSocket | Dual source of truth | Single source with polling |

---

## 9. Testing Strategy (2 minutes)

### Integration Test Approach

Tests use vitest with supertest for HTTP assertions. Setup includes:
- seedTestAuction() with known currentBid and bidIncrement
- seedTestUser() for authenticated requests
- getAuthCookie() for session management

**Key Test Cases**:

1. **Accept valid bid**: POST with amount above minimum returns 201 with finalAmount and isHighestBidder=true

2. **Reject low bid**: POST with amount at or below current returns 400 BID_TOO_LOW

3. **Handle duplicate idempotency key**: Second request with same key returns 200 with cached result

---

## 10. Future Enhancements

1. **GraphQL Subscriptions** - Replace WebSocket with GraphQL for unified data layer
2. **Offline Bid Queue** - Queue bids when offline, sync when reconnected
3. **End-to-End Type Generation** - Generate types from OpenAPI or tRPC
4. **Event Sourcing** - Full bid history as event log for audit
5. **Multi-Region** - Geo-distributed deployment with conflict resolution
6. **Mobile Apps** - React Native with shared business logic

---

## Summary

"I've designed a fullstack online auction platform with:

1. **Shared type definitions** - Consistent contracts between frontend and backend
2. **WebSocket integration** - Real-time bid updates with Redis pub/sub for multi-server support
3. **Optimistic UI updates** - Immediate feedback with server reconciliation
4. **Robust bid processing** - Distributed locking, idempotency, auto-bid resolution
5. **Error handling** - Shared error types with appropriate HTTP status codes
6. **State synchronization** - Zustand store that merges optimistic and server state

The key insight is treating the bid as a multi-phase transaction: client optimistic update, server validation and processing, then real-time broadcast to all watchers. This gives users immediate feedback while maintaining correctness through server-side locks and idempotency."
