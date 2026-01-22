# Job Scheduler - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Opening Statement

"Today I'll design a distributed job scheduler, covering both the backend distributed coordination and the frontend dashboard experience. The key fullstack challenges are real-time execution status updates across the stack, type-safe API contracts between frontend and backend, end-to-end job lifecycle management, and integrating the priority queue system with responsive UI feedback."

---

## 📋 Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Job Management** - Create, edit, delete, pause, resume, trigger jobs
2. **Scheduling** - One-time, recurring (cron), and delayed execution
3. **Priority Queues** - Higher priority jobs execute first
4. **Retry Logic** - Automatic retries with exponential backoff
5. **Real-time Monitoring** - Live execution status updates
6. **Worker Dashboard** - View active workers and health

### Non-Functional Requirements

- **Reliability**: At-least-once execution guarantee
- **Responsiveness**: UI reflects job status within 1 second
- **Type Safety**: Shared types between frontend and backend
- **Consistency**: Optimistic updates with proper rollback

### Fullstack Deep Dive Areas

- End-to-end job lifecycle (create -> schedule -> execute -> display)
- WebSocket architecture for real-time updates
- Shared type contracts
- Error handling across the stack

---

## 🎯 Step 2: Shared Type Contracts

### Core Types Overview

"I'm choosing TypeScript interfaces shared between frontend and backend to ensure type safety across the API boundary. This prevents drift between client expectations and server responses."

| Type | Purpose | Key Fields |
|------|---------|------------|
| **Job** | Job definition | id, name, handler, schedule, priority, status, maxRetries |
| **Execution** | Run instance | id, jobId, status, attempt, startedAt, error |
| **Worker** | Worker status | id, status, concurrency, activeJobs, lastHeartbeat |
| **CreateJobRequest** | API input | name, handler, payload, schedule, priority |

### Status Enums

| JobStatus | ExecutionStatus |
|-----------|-----------------|
| SCHEDULED | PENDING |
| QUEUED | RUNNING |
| RUNNING | COMPLETED |
| PAUSED | FAILED |
| | PENDING_RETRY |
| | CANCELLED |

### WebSocket Message Types

Messages flow from backend to frontend for real-time updates:
- `execution_started` - Worker picked up job
- `execution_updated` - Status change (completed/failed/retry)
- `job_updated` - Job configuration changed
- `worker_joined/left` - Worker pool changes

---

## 🏗️ Step 3: End-to-End Job Lifecycle

### Create Job Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CREATE JOB FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐      ┌──────────┐      ┌───────────────┐      ┌──────────┐   │
│  │ Frontend │─────▶│   API    │─────▶│   Database    │─────▶│  Redis   │   │
│  │   Form   │ POST │  Server  │      │  (PostgreSQL) │      │  Cache   │   │
│  └──────────┘      └──────────┘      └───────────────┘      └──────────┘   │
│       │                 │                    │                    │         │
│       │ Idempotency-Key │                    │                    │         │
│       │────────────────▶│ Check duplicate    │                    │         │
│       │                 │───────────────────▶│                    │         │
│       │                 │ Validate handler   │                    │         │
│       │                 │ Calculate next_run │                    │         │
│       │                 │ INSERT job         │                    │         │
│       │                 │───────────────────▶│                    │         │
│       │                 │ Cache response     │                    │         │
│       │                 │───────────────────────────────────────▶│         │
│       │◀────────────────│ 201 Created        │                    │         │
│       │ Optimistic add  │                    │                    │         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Frontend Job Creation Pattern

"I'm choosing to generate idempotency keys client-side, combining request parameters with a timestamp rounded to the minute. This allows safe retries on network failures without creating duplicate jobs."

| Step | Action | Error Handling |
|------|--------|----------------|
| 1 | Generate idempotency key | - |
| 2 | Submit to API | Show loading state |
| 3 | Optimistic add to list | - |
| 4 | Navigate to job detail | On 409: show duplicate error |
| 5 | - | On failure: rollback, show toast |

### Backend Job Creation

Validation chain:
1. Parse request with Zod schema
2. Check for duplicate name
3. Validate handler exists in registry
4. Parse cron expression (if recurring)
5. Calculate next_run_time
6. Insert with idempotency_key
7. Broadcast job_created event

---

## 📊 Step 4: Execution Flow with Real-Time Updates

### Complete Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXECUTION FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐          │
│  │ Scheduler │    │   Redis   │    │  Worker   │    │    WS     │          │
│  │           │    │   Queue   │    │           │    │   Hub     │          │
│  └─────┬─────┘    └─────┬─────┘    └─────┬─────┘    └─────┬─────┘          │
│        │                │                │                │                 │
│        │ Scan due jobs  │                │                │                 │
│        │───────────────▶│                │                │                 │
│        │ ZADD (priority)│                │                │                 │
│        │───────────────▶│                │                │                 │
│        │                │ ZPOPMIN        │                │                 │
│        │                │◀───────────────│                │                 │
│        │                │                │                │                 │
│        │                │                │ Update RUNNING │                 │
│        │                │                │───────────────▶│ Broadcast       │
│        │                │                │                │────────▶ UI     │
│        │                │                │                │                 │
│        │                │                │ Execute handler│                 │
│        │                │                │ (with timeout) │                 │
│        │                │                │                │                 │
│        │                │                │ Update COMPLETE│                 │
│        │                │                │───────────────▶│ Broadcast       │
│        │                │                │                │────────▶ UI     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Worker Execution Logic

| Phase | Action | On Failure |
|-------|--------|------------|
| 1. Claim | Update status to RUNNING, set worker_id | Release claim |
| 2. Execute | Run handler through circuit breaker | Catch error |
| 3a. Success | Update to COMPLETED, store result | - |
| 3b. Retry | If attempts < maxRetries, schedule retry | Exponential backoff |
| 3c. DLQ | If max retries exceeded, move to dead letter | Log error |
| 4. Broadcast | Publish execution_updated event | - |

### Retry with Exponential Backoff

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RETRY BACKOFF STRATEGY                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Attempt 1 failed ──▶ Wait 1s   ──▶ Retry                                  │
│  Attempt 2 failed ──▶ Wait 2s   ──▶ Retry                                  │
│  Attempt 3 failed ──▶ Wait 4s   ──▶ Retry                                  │
│  Attempt 4 failed ──▶ Wait 8s   ──▶ Retry                                  │
│  Attempt 5 failed ──▶ Dead Letter Queue                                    │
│                                                                             │
│  Formula: min(initial_backoff * 2^attempt, max_backoff)                    │
│  Default: min(1000ms * 2^n, 3600000ms)                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Step 5: WebSocket Architecture

### Backend WebSocket Hub

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WEBSOCKET ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                   │
│  │  Client A   │     │  Client B   │     │  Client C   │                   │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘                   │
│         │                   │                   │                           │
│         └───────────────────┼───────────────────┘                           │
│                             │                                               │
│                    ┌────────▼────────┐                                      │
│                    │   WS Hub /ws    │                                      │
│                    │  (per server)   │                                      │
│                    └────────┬────────┘                                      │
│                             │                                               │
│                    ┌────────▼────────┐                                      │
│                    │  Redis Pub/Sub  │ ◀──── Workers publish events         │
│                    │ job_scheduler:* │                                      │
│                    └─────────────────┘                                      │
│                                                                             │
│  Channels:                                                                  │
│  - executions (global execution feed)                                      │
│  - workers (worker status changes)                                         │
│  - job:{jobId}:executions (specific job updates)                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Connection Lifecycle

| Event | Backend Action | Frontend Action |
|-------|----------------|-----------------|
| Connect | Authenticate via cookie | Receive userId confirmation |
| Subscribe | Validate channel access | Add to local subscriptions |
| Message | Broadcast to matching clients | Update Zustand store |
| Disconnect | Remove from client map | Auto-reconnect after 3s |

### Frontend WebSocket Hook

"I'm choosing a custom useWebSocket hook that manages connection lifecycle, channel subscriptions, and automatic reconnection. The hook accepts a list of channels and a callback for incoming messages."

Key features:
- Automatic reconnection with 3-second delay
- Channel subscription management
- Pause state for tab visibility
- Error handling with user feedback

---

## ⚖️ Step 6: Job Detail Page Integration

### Fullstack Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        JOB DETAIL PAGE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Job Header                                                          │   │
│  │ ┌──────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐ │   │
│  │ │ Name + Badge │  │  Trigger   │  │ Pause/     │  │   More ▼    │ │   │
│  │ │              │  │    Now     │  │  Resume    │  │  Edit/Delete│ │   │
│  │ └──────────────┘  └────────────┘  └────────────┘  └──────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Details Grid                                                        │   │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │ │ Handler  │ │ Priority │ │  Retries │ │ Timeout  │ │ Next Run │  │   │
│  │ │ email    │ │    75    │ │   3/5    │ │   5min   │ │  2min    │  │   │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Execution Timeline (real-time via WebSocket)                        │   │
│  │ ● COMPLETED  2min ago   Worker-1   Result: { sent: 150 }           │   │
│  │ ○ RUNNING    now        Worker-2   ...                              │   │
│  │ ● FAILED     5min ago   Worker-1   Error: SMTP timeout  [Retry]    │   │
│  │ ● COMPLETED  1hr ago    Worker-3   Result: { sent: 142 }           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Fetching Strategy

| Data | Initial Load | Real-time Update |
|------|--------------|------------------|
| Job details | GET /api/v1/jobs/:id | WS: job_updated |
| Executions | GET /api/v1/jobs/:id/executions | WS: execution_started/updated |
| Retry action | POST /api/v1/executions/:id/retry | Appears via WS |

### JobActions Component

Actions with optimistic feedback:
- **Trigger Now**: Shows spinner, success toast with execution ID
- **Pause/Resume**: Immediate status badge update, API call
- **Edit**: Navigate to edit form
- **Delete**: Confirm dialog, navigate to list on success

---

## 🚀 Step 7: Dead Letter Queue Management

### Dead Letter Queue UI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DEAD LETTER QUEUE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Dead Letter Queue                                              12 items    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ┌──────────────────────────────────────────────────┐  ┌─────┬─────┐ │   │
│  │ │ email-handler                    View Job ──▶    │  │Retry│ X   │ │   │
│  │ │ Failed 5 minutes ago                             │  └─────┴─────┘ │   │
│  │ ├──────────────────────────────────────────────────┤                │   │
│  │ │ Error: SMTP connection refused                   │                │   │
│  │ ├──────────────────────────────────────────────────┤                │   │
│  │ │ ▶ View payload                                   │                │   │
│  │ └──────────────────────────────────────────────────┘                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Empty state: "All jobs are processing successfully" ✓                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### DLQ Operations

| Action | Backend | Frontend |
|--------|---------|----------|
| List | GET /api/v1/dead-letter | Fetch on mount |
| Retry | POST /api/v1/dead-letter/:id/retry | Show spinner, remove on success |
| Dismiss | DELETE /api/v1/dead-letter/:id | Optimistic remove |

### Backend DLQ Logic

On retry:
1. Find item in Redis list
2. Create new execution with attempt=1
3. Enqueue in priority queue
4. Remove from dead letter list
5. Return new execution ID

---

## 📝 Step 8: Metrics Dashboard Integration

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DASHBOARD                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │Queue Depth │  │ Processing │  │Completed/1h│  │ Failed/1h  │            │
│  │    142     │  │     8      │  │    1,247   │  │     3      │            │
│  │     ▲      │  │            │  │     ✓      │  │     ⚠      │            │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘            │
│                                                                             │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐        │
│  │ Workers                      │  │ Dead Letter Queue            │        │
│  │ 4/5 active                   │  │ 3 items  ──▶ View queue      │        │
│  │ ████████████░░░ 12/15 slots  │  │                              │        │
│  └──────────────────────────────┘  └──────────────────────────────┘        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Recent Executions                                    View all ──▶   │   │
│  │ ● report-gen     COMPLETED   2s ago    Worker-2                     │   │
│  │ ○ email-batch    RUNNING     now       Worker-1                     │   │
│  │ ● cleanup        COMPLETED   15s ago   Worker-3                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Metrics Aggregation

Backend aggregates from multiple sources:
- **Queue metrics**: Redis ZCARD for queue/processing
- **Execution stats**: PostgreSQL COUNT with 1-hour window
- **Worker status**: Redis HGETALL, filter by heartbeat recency

### Real-time Dashboard Updates

| Metric | Update Mechanism | Refresh Rate |
|--------|------------------|--------------|
| Queue depth | Polling | 10 seconds |
| Recent executions | WebSocket | Immediate |
| Worker count | Polling | 10 seconds |
| Dead letter count | Polling | 10 seconds |

---

## ⚖️ Trade-offs Discussion

### Key Fullstack Trade-offs

| Decision | ✅ Chosen | ❌ Alternative | Rationale |
|----------|-----------|----------------|-----------|
| Type sharing | TypeScript interfaces | OpenAPI codegen | Simpler, single source of truth |
| Real-time | WebSocket + Redis pub/sub | Long polling | Lower latency, less traffic |
| Idempotency | Client-generated keys | Server-generated | Safe retries without coordination |
| State updates | Optimistic UI | Wait for response | Responsive feel, rollback on error |
| DLQ storage | Redis list | PostgreSQL table | Fast access, matches queue pattern |

---

## Closing Summary

"I've designed a fullstack job scheduler with:

1. **Shared type contracts** ensuring type safety between frontend and backend
2. **End-to-end job lifecycle** from creation through execution with real-time feedback
3. **WebSocket architecture** with Redis pub/sub for cross-instance real-time updates
4. **Optimistic UI updates** with proper error handling and rollback
5. **Dead letter queue management** for failed job inspection and retry
6. **Integrated metrics dashboard** showing queue health, worker status, and recent executions

The key fullstack insight is maintaining a single source of truth in the backend while providing responsive UI feedback. WebSockets ensure all connected clients see execution updates immediately, while the shared types prevent API contract drift. The dead letter queue provides operational visibility into failures with one-click retry capability."
