# Notification System - Full-Stack Engineer Interview Answer

## System Design Interview (45 minutes)

### Opening Statement (1 minute)

"I'll design a complete notification system that delivers messages across push, email, SMS, and in-app channels with reliability guarantees. The system needs to handle millions of notifications per minute while respecting user preferences and providing real-time delivery feedback.

As a full-stack engineer, I'll focus on the integration between frontend and backend components - from the API contract for preference management to real-time delivery status updates via WebSocket, ensuring a seamless user experience backed by scalable infrastructure."

---

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Multi-Channel Delivery**: Push (iOS/Android), Email, SMS, In-App
- **Priority Handling**: Critical notifications bypass normal queues
- **User Preferences**: Respect opt-outs, quiet hours, channel preferences
- **Real-Time Feedback**: Immediate delivery status in UI
- **Template System**: Dynamic content with variable substitution

### Non-Functional Requirements
- **Throughput**: 1M+ notifications per minute
- **Latency**: < 100ms for critical notifications
- **Reliability**: 99.99% delivery rate
- **UI Responsiveness**: Sub-100ms preference updates

---

## Shared Type Definitions (5 minutes)

### Core Domain Types

**Notification Channels and Priority:**

| Type | Values |
|------|--------|
| `NotificationChannel` | push, email, sms, in_app |
| `NotificationPriority` | critical, high, normal, low |
| `DeliveryStatus` | pending, sent, delivered, failed, suppressed |
| `NotificationCategory` | security, order, social, marketing, system, reminder |

**Notification Structure:**

| Field | Type | Purpose |
|-------|------|---------|
| id | string | Unique identifier |
| userId | string | Target user |
| templateId | string | Content template reference |
| content | NotificationContent | title, body, data, imageUrl |
| channels | NotificationChannel[] | Delivery channels |
| priority | NotificationPriority | Queue priority |
| status | DeliveryStatus | Overall status |
| deliveryStatus | ChannelDeliveryStatus[] | Per-channel status |

### User Preferences Types

```
┌─────────────────────────────────────────────────────────────────┐
│  UserPreferences                                                 │
├─────────────────────────────────────────────────────────────────┤
│  userId: string                                                  │
│  channels: ChannelPreferences                                    │
│    └─ push/email/sms/in_app: { enabled, categories }           │
│  categories: CategoryPreferences                                 │
│    └─ [category]: { enabled, channels }                         │
│  quietHours: { enabled, start, end, allowCritical }             │
│  timezone: string                                                │
└─────────────────────────────────────────────────────────────────┘
```

### API Request/Response Types

**Send Notification Request:**

| Field | Type | Required |
|-------|------|----------|
| userId | string | Yes |
| templateId | string | Yes |
| data | Record | No |
| channels | NotificationChannel[] | No (uses template default) |
| priority | NotificationPriority | No (defaults to normal) |
| scheduledAt | string | No |
| idempotencyKey | string | No |

**Send Notification Response:**

| Field | Type | Description |
|-------|------|-------------|
| notificationId | string | Assigned ID |
| status | queued or suppressed | Initial status |
| channels | NotificationChannel[] | Channels used |
| reason | string | If suppressed, why |

### WebSocket Event Types

| Event Type | Payload | Purpose |
|------------|---------|---------|
| NEW_NOTIFICATION | notification object | New notification arrived |
| DELIVERY_UPDATE | notificationId, channel, status, error | Channel status changed |
| PREFERENCE_SYNC | preferences object | Remote preference update |
| QUEUE_DEPTH_UPDATE | depth metrics | Admin monitoring |

---

## Deep Dive: Notification Sending Flow (10 minutes)

### Backend: Notification Service

```
┌─────────────────────────────────────────────────────────────────┐
│  NotificationService.sendNotification()                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Check idempotency key ────────> Return cached if exists     │
│                                                                  │
│  2. Validate template ────────────> 404 if not found            │
│                                                                  │
│  3. Get user preferences ─────────> From cache or DB            │
│                                                                  │
│  4. Filter channels ──────────────> Remove disabled channels    │
│         │                                                        │
│         └── All filtered? ────────> Return { suppressed }       │
│                                                                  │
│  5. Check quiet hours ────────────> Schedule if in quiet hours  │
│         │                                                        │
│         └── Critical? ────────────> Bypass quiet hours          │
│                                                                  │
│  6. Check rate limits ────────────> 429 if exceeded             │
│                                                                  │
│  7. Render template ──────────────> Substitute variables        │
│                                                                  │
│  8. Insert notification record ───> PostgreSQL                  │
│                                                                  │
│  9. Queue per channel ────────────> RabbitMQ queues             │
│         │                                                        │
│         ├── notifications.push                                   │
│         ├── notifications.email                                  │
│         ├── notifications.sms                                    │
│         └── notifications.in_app                                 │
│                                                                  │
│  10. Cache idempotency result ────> Redis (24h TTL)             │
│                                                                  │
│  11. Emit WebSocket event ────────> NEW_NOTIFICATION            │
│                                                                  │
│  Return { notificationId, status: 'queued', channels }          │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend: Send Notification Hook

**useSendNotification() Hook:**
- Uses TanStack Query `useMutation`
- On success: invalidate notifications query, show toast
- On error: handle rate limit with retry countdown
- Returns mutation object with `mutate()` function

---

## Deep Dive: Real-Time Delivery Updates (10 minutes)

### Backend: WebSocket Handler

```
┌─────────────────────────────────────────────────────────────────┐
│  NotificationWebSocketHandler                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  connections: Map<userId, Set<WebSocket>>                        │
│  redisSubscriber: RedisClient                                    │
│                                                                  │
│  On Connection:                                                  │
│    1. Authenticate from request                                  │
│    2. Add to user's connection set                              │
│    3. Subscribe to user's Redis channel                         │
│    4. Send initial state (unread count)                         │
│    5. Set up heartbeat (30s ping)                               │
│                                                                  │
│  On Redis Message:                                               │
│    1. Parse event from channel                                   │
│    2. Broadcast to all user's connections                       │
│                                                                  │
│  On Disconnect:                                                  │
│    1. Remove from connection set                                │
│    2. Unsubscribe if no connections left                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Backend: Delivery Status Update

```
┌─────────────────────────────────────────────────────────────────┐
│  DeliveryWorker.updateDeliveryStatus()                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Update delivery_status table                                 │
│        SET status = $status, error = $error                     │
│                                                                  │
│  2. Get user_id from notifications table                        │
│                                                                  │
│  3. Emit WebSocket event ────────> DELIVERY_UPDATE              │
│        { notificationId, channel, status, error }               │
│                                                                  │
│  4. Update aggregate notification status                        │
│        - All sent/delivered? ────> Mark delivered               │
│        - All failed? ────────────> Mark failed                  │
│        - Mixed? ─────────────────> Keep pending                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend: WebSocket Hook

**useNotificationSocket() Hook:**
- Manages WebSocket connection lifecycle
- Handles reconnection with exponential backoff
- Reconnects when tab becomes visible
- Dispatches events to Zustand store:
  - `INITIAL_STATE` -> setUnreadCount
  - `NEW_NOTIFICATION` -> addNotification + toast
  - `DELIVERY_UPDATE` -> updateDeliveryStatus

### Frontend: Live Delivery Status Component

```
┌─────────────────────────────────────────────────────────────────┐
│  DeliveryStatusTracker                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Delivery Status  [expand/collapse]                              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  [push icon]  Push      [clock] Pending    Attempt 1        ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │  [mail icon]  Email     [check] Delivered                   ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │  [phone icon] SMS       [x]     Failed                      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Status Icons:**
| Status | Icon | Color |
|--------|------|-------|
| pending | Clock | yellow-500 |
| sent | PaperAirplane | blue-500 |
| delivered | CheckCircle | green-500 |
| failed | XCircle | red-500 |
| suppressed | MinusCircle | gray-400 |

---

## Deep Dive: Preference Sync (8 minutes)

### Backend: Preferences Service with Caching

```
┌─────────────────────────────────────────────────────────────────┐
│  PreferencesService                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  getPreferences(userId):                                         │
│    1. Check Redis cache (prefs:{userId})                        │
│    2. If hit ─────────────────> Return cached                   │
│    3. If miss ────────────────> Query PostgreSQL                │
│    4. Cache result (5 min TTL)                                  │
│    5. Return preferences                                         │
│                                                                  │
│  updatePreferences(userId, updates):                             │
│    1. Get current preferences                                    │
│    2. Merge with updates                                         │
│    3. Upsert to PostgreSQL                                       │
│    4. Delete cache key                                           │
│    5. Broadcast PREFERENCE_SYNC via Redis pub/sub               │
│    6. Return updated preferences                                 │
│                                                                  │
│  Default preferences:                                            │
│    - push: enabled                                               │
│    - email: enabled                                              │
│    - sms: disabled                                               │
│    - in_app: enabled                                             │
│    - quietHours: disabled, 22:00-07:00, allowCritical: true     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend: Preferences Store with Sync

**usePreferencesStore (Zustand + persist):**

| State | Type | Purpose |
|-------|------|---------|
| preferences | UserPreferences | Current preferences |
| loading | boolean | Fetching state |
| saving | boolean | Save in progress |
| pendingUpdates | Partial | Uncommitted changes |
| lastSyncedAt | string | Last sync timestamp |

| Action | Behavior |
|--------|----------|
| fetchPreferences | Load from API, cache locally |
| updatePreference | Optimistic update + debounced sync |
| syncPreferences | Flush pending changes immediately |
| handleRemoteUpdate | Merge remote changes (skip if local pending) |

**Debounced Auto-Save:**
- 1 second debounce on updates
- Compose multiple rapid changes
- Retry on failure (keep pending)

### Frontend: Multi-Tab Sync

```
┌─────────────────────────────────────────────────────────────────┐
│  Multi-Tab Synchronization                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tab A                    Tab B                    Tab C         │
│    │                        │                        │           │
│    │ User toggles          │                        │           │
│    │ email off             │                        │           │
│    │                        │                        │           │
│    ▼                        │                        │           │
│  Update store              │                        │           │
│    │                        │                        │           │
│    ├──────── BroadcastChannel ──────────────────────┤           │
│    │         PREFERENCE_UPDATE                       │           │
│    │                        │                        │           │
│    │                        ▼                        ▼           │
│    │                  handleRemoteUpdate      handleRemoteUpdate │
│    │                        │                        │           │
│    ▼                        ▼                        ▼           │
│  API sync ──────> WebSocket ──────> PREFERENCE_SYNC to all      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Deep Dive: Error Handling (5 minutes)

### Backend: Centralized Error Handling

**Error Classes:**

| Class | Status | Code | Use Case |
|-------|--------|------|----------|
| AppError | varies | varies | Base error class |
| RateLimitError | 429 | RATE_LIMITED | Rate limit exceeded |
| NotFoundError | 404 | NOT_FOUND | Resource not found |
| ValidationError | 400 | VALIDATION_ERROR | Invalid input |

**Error Response Format:**

```
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded",
    "details": {
      "retryAfter": 60,
      "current": 100,
      "limit": 100
    }
  }
}
```

### Frontend: Error Boundary with Recovery

```
┌─────────────────────────────────────────────────────────────────┐
│  NotificationErrorBoundary                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    [Warning Icon]                                │
│                                                                  │
│              Something went wrong                                │
│                                                                  │
│    We couldn't load your notifications. Please try again.       │
│                                                                  │
│                    [ Retry ]                                     │
│                                                                  │
│  - Catches render errors in notification components              │
│  - Logs to error tracking service                                │
│  - Provides recovery action                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### API Error Hook

**useApiError() Hook handles:**

| Error Code | Action |
|------------|--------|
| RATE_LIMITED | Toast with retry countdown |
| UNAUTHORIZED | Redirect to login |
| NOT_FOUND | Toast with error message |
| Network error | Toast "check connection" |
| Unknown | Generic error toast |

---

## Trade-offs and Alternatives

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Real-Time Updates | WebSocket | SSE/Polling | Bi-directional needed for acks |
| Preference Sync | Debounced auto-save | Manual save | Better UX, fewer clicks |
| State Management | Zustand + persist | Redux | Simpler API, built-in persistence |
| Multi-Tab Sync | BroadcastChannel | localStorage events | More reliable, structured data |
| Error Handling | Centralized + codes | Per-endpoint | Consistent client handling |
| Cache Invalidation | Delete on update | TTL only | Immediate preference effect |
| Type Sharing | Shared package | Duplicate types | Single source of truth |

---

## Future Enhancements

1. **GraphQL Subscriptions**: Replace WebSocket with GraphQL subscriptions for unified API
2. **Optimistic UI**: Show notifications as sent before backend confirmation
3. **Offline Queue**: Queue sends when offline, sync when connected
4. **Push Notification Service Worker**: Background notification handling
5. **A/B Testing Integration**: Test different notification strategies
6. **Analytics Events**: Track notification interactions across channels
