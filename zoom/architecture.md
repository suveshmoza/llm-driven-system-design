# Zoom — Video Conferencing System Architecture

## System Overview

A real-time video conferencing platform supporting multi-party video calls, screen sharing, in-call chat, breakout rooms, and meeting management. The architecture centers on an SFU (Selective Forwarding Unit) model where a media server selectively forwards each participant's media streams to all other participants, avoiding the O(n^2) mesh topology of P2P while maintaining lower latency than an MCU (Multipoint Control Unit).

**Learning goals**: SFU vs P2P vs MCU trade-offs, WebRTC signaling, media routing scalability, real-time state synchronization, breakout room orchestration.

## Requirements

### Functional Requirements
1. Users can create, schedule, and join meetings via a human-readable code (e.g., `abc-defg-hij`)
2. Multi-party video with up to 100 participants per meeting
3. Audio/video mute, camera toggle, hand raise
4. Screen sharing with presenter layout
5. In-call chat (broadcast and direct messages)
6. Breakout rooms (create, assign, activate, close)
7. Meeting lobby with camera/mic preview and device selection
8. Meeting history

### Non-Functional Requirements (Production Scale)
| Metric | Target |
|--------|--------|
| Concurrent meetings | 100,000+ |
| Participants per meeting | Up to 1,000 (100 video, 900 audio-only) |
| Video latency (p99) | < 150ms (same region) |
| Signaling latency (p99) | < 50ms |
| Availability | 99.99% |
| Audio/video quality | Adaptive bitrate, 720p default, 1080p optional |

## Capacity Estimation

### Production Scale
- **Peak concurrent meetings**: 100,000
- **Average participants per meeting**: 8
- **Peak concurrent participants**: 800,000
- **Signaling messages**: ~50 messages/participant/minute = 40M messages/minute
- **Media bandwidth per participant**: ~2 Mbps send + ~2 Mbps per received stream
- **SFU worker capacity**: ~500 participants per worker (CPU-bound for SRTP encryption)
- **Workers needed**: 800,000 / 500 = 1,600 SFU workers

### Local Development Scale
- 1-5 concurrent meetings
- 2-10 participants per meeting
- Single-process SFU (simulated)
- All infrastructure on localhost

## High-Level Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   Clients   │────▶│  CDN/Edge   │────▶│  Load Balancer   │
│  (Browser)  │     │  (static)   │     │  (L7/WebSocket)  │
└──────┬──────┘     └─────────────┘     └────────┬─────────┘
       │                                         │
       │  WebSocket (signaling)                  │
       │  SRTP (media via SFU)                   │
       │                                         ▼
       │                              ┌──────────────────┐
       │                              │   API Gateway     │
       │                              │  (rate limiting,  │
       │                              │   auth, routing)  │
       │                              └────────┬─────────┘
       │                                       │
       ▼                                       ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  SFU Cluster │  │  Signaling   │  │  Meeting Service  │
│  (mediasoup  │  │  Service     │  │  (CRUD, lifecycle)│
│   Workers)   │  │  (WebSocket) │  │                  │
└──────┬───────┘  └──────┬───────┘  └────────┬─────────┘
       │                 │                    │
       │                 │         ┌──────────┴──────────┐
       │                 │         │                     │
       ▼                 ▼         ▼                     ▼
┌──────────┐    ┌──────────┐  ┌──────────┐      ┌──────────┐
│  Redis   │    │  Redis   │  │PostgreSQL│      │ Object   │
│ (pub/sub,│    │(sessions,│  │(meetings,│      │ Storage  │
│  rooms)  │    │  state)  │  │ users)   │      │(records) │
└──────────┘    └──────────┘  └──────────┘      └──────────┘
```

## Core Components

### 1. SFU Service (Media Routing)

The SFU is the core differentiator from P2P architectures. Each meeting room gets a **Router** that manages media routing.

**Architecture Concepts (mediasoup model):**

| Concept | Description |
|---------|-------------|
| **Worker** | OS process handling media routing. One per CPU core. |
| **Router** | Media routing context for a room. Holds RTP capabilities. |
| **WebRtcTransport** | ICE+DTLS connection. Each participant gets a send transport and a recv transport. |
| **Producer** | Represents a media track being sent to the SFU (audio, video, or screen). |
| **Consumer** | Represents a media track being forwarded from the SFU to a participant. |

**Media flow:**
```
Participant A                SFU Router              Participant B
    │                           │                         │
    │──[send transport]────────▶│                         │
    │   Producer(audio)         │                         │
    │   Producer(video)         │                         │
    │                           │──[recv transport]──────▶│
    │                           │   Consumer(A.audio)     │
    │                           │   Consumer(A.video)     │
    │                           │                         │
    │◀──[recv transport]────────│                         │
    │   Consumer(B.audio)       │◀──[send transport]──────│
    │   Consumer(B.video)       │   Producer(audio)       │
    │                           │   Producer(video)       │
```

For N participants, the SFU creates:
- N send transports (one per participant)
- N recv transports (one per participant)
- Up to 2N producers (audio + video per participant)
- Up to 2N(N-1) consumers (each participant consumes all other producers)

This is O(N) work on the server vs O(N^2) connections in P2P mesh.

### 2. Signaling Service (WebSocket)

The signaling server handles the WebRTC negotiation handshake between clients and the SFU:

**Message Protocol:**

| Direction | Message | Purpose |
|-----------|---------|---------|
| Client → Server | `join-meeting` | Join with meeting code + display name |
| Server → Client | `joined` | Meeting state, participants, RTP capabilities, transport options |
| Client → Server | `produce` | Register audio/video/screen track |
| Server → Client | `produced` | Confirm producer creation |
| Server → Client | `new-producer` | Notify others about new media track |
| Client → Server | `consume` | Request to receive a producer's media |
| Server → Client | `consume-response` | Consumer parameters for playback |
| Client → Server | `producer-close` | Stop sending a track |
| Server → Client | `producer-closed` | Notify track removal |
| Bidirectional | `participant-update` | Mute, video, screen share, hand raise state |
| Bidirectional | `chat-message` | In-call chat (broadcast or DM) |

### 3. Meeting Service (Lifecycle)

Manages meeting CRUD operations and participant state:

- **Meeting codes**: Generated as `abc-defg-hij` (3-4-3 lowercase letters)
- **Meeting lifecycle**: scheduled → active → ended
- **Participant tracking**: Join/leave timestamps, role (host/co-host/participant), media states
- **Settings**: Waiting room, mute on entry, screen share permission, max participants

### 4. Breakout Room Service

Enables hosts to split a meeting into smaller groups:

```
Main Meeting Room (Router A)
    │
    ├── Breakout Room 1 (Router B)
    │   ├── Participant 1
    │   └── Participant 4
    │
    ├── Breakout Room 2 (Router C)
    │   ├── Participant 2
    │   └── Participant 5
    │
    └── Breakout Room 3 (Router D)
        ├── Participant 3
        └── Participant 6
```

Each breakout room gets its own Router. When breakout rooms close, participants are moved back to the main room's Router.

### 5. Chat Service

In-meeting chat with persistence:
- Messages stored in PostgreSQL for meeting history
- Real-time delivery via WebSocket
- Support for broadcast (to everyone) and direct messages (to specific participant)

## Database Schema

```sql
-- Users table with auth credentials
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(30) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meetings with lifecycle tracking
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_code VARCHAR(12) UNIQUE NOT NULL,  -- abc-defg-hij format
  title VARCHAR(255),
  host_id UUID NOT NULL REFERENCES users(id),
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'scheduled',
  settings JSONB DEFAULT '{"waitingRoom": false, "muteOnEntry": false, "allowScreenShare": true, "maxParticipants": 100}'
);

-- Active participant tracking
CREATE TABLE meeting_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  display_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'participant',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  is_muted BOOLEAN DEFAULT false,
  is_video_on BOOLEAN DEFAULT true,
  is_screen_sharing BOOLEAN DEFAULT false,
  is_hand_raised BOOLEAN DEFAULT false,
  UNIQUE(meeting_id, user_id)
);

-- Breakout rooms and assignments
CREATE TABLE breakout_rooms (
  id UUID PRIMARY KEY, meeting_id UUID REFERENCES meetings(id),
  name VARCHAR(100), is_active BOOLEAN DEFAULT false
);

CREATE TABLE breakout_assignments (
  breakout_room_id UUID REFERENCES breakout_rooms(id),
  participant_id UUID REFERENCES meeting_participants(id),
  UNIQUE(breakout_room_id, participant_id)
);

-- In-meeting chat with optional DM targeting
CREATE TABLE meeting_chat_messages (
  id UUID PRIMARY KEY, meeting_id UUID REFERENCES meetings(id),
  sender_id UUID REFERENCES users(id), content TEXT,
  recipient_id UUID REFERENCES users(id),  -- NULL = broadcast
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Key Indexes
- `idx_meetings_code` on meetings(meeting_code) — fast lookup by code
- `idx_meetings_host` on meetings(host_id, created_at DESC) — user's meetings
- `idx_participants_meeting` on meeting_participants(meeting_id) — participant list
- `idx_chat_messages_meeting` on meeting_chat_messages(meeting_id, created_at) — chat history

## API Design

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user |
| POST | `/api/meetings` | Create meeting |
| GET | `/api/meetings` | List user's meetings |
| GET | `/api/meetings/code/:code` | Get meeting by code |
| POST | `/api/meetings/:id/start` | Start meeting |
| POST | `/api/meetings/:id/end` | End meeting |
| GET | `/api/meetings/:id/participants` | Get participants |
| POST | `/api/rooms/:meetingId/breakout-rooms` | Create breakout rooms |
| POST | `/api/rooms/:meetingId/breakout-rooms/activate` | Open breakout rooms |
| POST | `/api/rooms/:meetingId/breakout-rooms/close` | Close breakout rooms |
| GET | `/api/chat/:meetingId/messages` | Get chat history |

### WebSocket Protocol

Connection: `ws://host/ws?userId=<id>&username=<name>`

All messages are JSON with a `type` field. See the Signaling Service section for the full protocol.

## Key Design Decisions

### SFU vs P2P vs MCU

| Architecture | Pros | Cons |
|-------------|------|------|
| **SFU (chosen)** | O(N) server connections, preserves individual streams, lower latency than MCU | Server CPU for SRTP, still O(N) bandwidth per client |
| P2P Mesh | No server, lowest latency for 2 participants | O(N^2) connections, client CPU/bandwidth scales quadratically |
| MCU | Lowest client bandwidth (receives single mixed stream) | Highest server CPU (transcoding), loses individual stream control |

We chose SFU because video conferencing with 5-100 participants cannot use P2P mesh (quadratic scaling makes it impractical beyond 4-5 participants), and MCU's transcoding cost is prohibitive at scale while removing the ability to individually pin, spotlight, or layout participant streams.

### WebSocket vs HTTP Polling for Signaling

WebSocket is mandatory for WebRTC signaling. The ICE/DTLS handshake requires sub-second round-trip message exchanges. HTTP polling at 1-second intervals would add 500ms average latency to each step of a multi-step negotiation that must complete in under 2 seconds for acceptable UX. Additionally, ongoing participant state changes (mute, video, hand raise) must propagate to all participants within 100ms — polling creates an unacceptable 50-500ms delay that makes the UI feel disconnected from reality.

### JSONB Settings vs Normalized Settings Table

Meeting settings (waitingRoom, muteOnEntry, allowScreenShare, maxParticipants) are stored as JSONB. These settings are always read and written as a unit, never queried individually, and may evolve over time. JSONB avoids schema migrations for new settings and reduces join complexity. The trade-off: we lose the ability to query "all meetings with waiting room enabled" efficiently, but that's not a core query pattern.

## Consistency and Idempotency

### Idempotent Meeting Creation

Meeting creation requests include a client-generated idempotency key (UUID) sent in the `Idempotency-Key` header. The server stores completed request outcomes keyed by this value in Redis with a 24-hour TTL. If a duplicate request arrives — due to a network retry or the user double-clicking the "New Meeting" button — the server returns the previously created meeting rather than generating a second one. This prevents orphaned meetings that no one joins, which would pollute the user's meeting history and consume meeting codes unnecessarily.

The meeting code itself provides a secondary uniqueness constraint. Because codes are generated server-side with a UNIQUE database constraint, even without an idempotency key, a duplicate insert would fail at the database level. However, relying on database errors for flow control is fragile — the idempotency key approach catches duplicates before they reach the database.

### WebSocket Message Delivery Semantics

Signaling messages use at-least-once delivery with client-side deduplication. Each WebSocket message includes a monotonically increasing sequence number per connection. When a client reconnects after a brief disconnection, it sends its last received sequence number in the `join-meeting` message, and the server replays any missed state changes from a short-lived buffer stored in Redis (retained for 60 seconds after disconnection).

For participant state updates (mute, video toggle, hand raise), the system uses last-writer-wins semantics. These are inherently idempotent — receiving "user X is muted" twice produces the same state as receiving it once. The server maintains the authoritative participant state in Redis, and any conflicting updates resolve to the most recent timestamp.

### Exactly-Once Chat Message Guarantees

Chat messages require stronger guarantees than signaling messages because users expect every message to appear exactly once in the correct order. Each chat message is assigned a server-side UUID before being persisted to PostgreSQL and broadcast via WebSocket. The client tracks received message IDs in a local Set. If a duplicate arrives during reconnection replay, the client silently drops it.

On the write path, the client includes a client-generated message ID with each chat submission. The server checks for this ID in a Redis set (scoped to the meeting, TTL of 1 hour) before inserting into PostgreSQL. If the ID already exists, the server returns the existing message without creating a duplicate row. This handles the case where the client sends a message, the server persists it, but the acknowledgment is lost — prompting the client to retry.

### Handling Duplicate Join and Leave Events

Join and leave events are idempotent by design. The `meeting_participants` table has a UNIQUE constraint on `(meeting_id, user_id)`, so a duplicate join attempt results in an upsert that updates the `joined_at` timestamp and clears the `left_at` field rather than creating a second row. Similarly, a duplicate leave event sets `left_at` to the current timestamp regardless of whether it was already set.

During network instability, a participant may appear to leave and rejoin rapidly. The server applies a grace period of 5 seconds before broadcasting a `participant-left` event to other participants. If the user reconnects within that window, the departure is never announced, avoiding the disruptive "X left / X joined" notification flicker that degrades the meeting experience. The reconnecting client re-establishes its WebSocket connection, re-registers its producers, and other participants see seamless continuity.

## Security / Auth

- **Session-based authentication** with Redis session store
- **bcrypt** password hashing (cost factor 10)
- **Rate limiting** on auth endpoints (20 requests / 15 minutes)
- **API rate limiting** (100 requests / 15 minutes per IP)
- **CORS** restricted to frontend origin
- **HttpOnly cookies** for session tokens

In production: OAuth 2.0 (Google, SSO), JWT with refresh tokens, end-to-end encryption for media streams.

## Observability

### Metrics (Prometheus via prom-client)
- `active_meetings_total` — Gauge: current active meeting count
- `active_participants_total` — Gauge: current participant count
- `websocket_connections_total` — Gauge: active WebSocket connections
- `http_request_duration_seconds` — Histogram: API latency by route

### Structured Logging (Pino)
- Request-level logging via pino-http
- Meeting lifecycle events (created, started, ended)
- SFU operations (router created, transport created, producer/consumer lifecycle)
- Participant join/leave events

### Health Check
- `GET /api/health` — Returns server status and timestamp
- PostgreSQL connection pool health
- Redis connectivity

## Failure Handling

### Circuit Breaker (Opossum)
Applied to database queries. Prevents cascade failures when PostgreSQL is unavailable:
- Error threshold: 50%
- Timeout: 5 seconds
- Reset timeout: 30 seconds

### WebSocket Reconnection
Client implements exponential backoff reconnection:
- Max 5 attempts
- Delay: 1s, 2s, 4s, 8s, 16s
- On reconnect: rejoin meeting with current state

### Graceful Shutdown
Server handles SIGTERM/SIGINT:
1. Stop accepting new connections
2. Close WebSocket server
3. Wait for ongoing requests
4. Close database pool

## Scalability Considerations

### SFU Worker Scaling
```
                    ┌─────────────────┐
                    │  SFU Controller  │
                    │  (routing layer) │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                   ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │  SFU Worker 1│  │  SFU Worker 2│  │  SFU Worker N│
   │  (CPU Core)  │  │  (CPU Core)  │  │  (CPU Core)  │
   │  ~500 users  │  │  ~500 users  │  │  ~500 users  │
   └──────────────┘  └──────────────┘  └──────────────┘
```

- mediasoup Worker per CPU core (Node.js worker_threads)
- Load-balanced by participant count per Router
- Large meetings span multiple Workers with pipe transports

### Horizontal Scaling
- **Signaling**: Stateless WebSocket servers behind L7 load balancer with sticky sessions
- **State synchronization**: Redis pub/sub for cross-server participant state
- **Database**: Read replicas for meeting queries, write primary for state mutations
- **Meeting routing**: Consistent hashing by meeting_code to assign SFU Workers

### Bandwidth Optimization
- **Simulcast**: Clients send 3 spatial layers (low/medium/high quality). SFU forwards appropriate layer based on viewer's layout size.
- **SVC (Scalable Video Coding)**: Alternative to simulcast with temporal/spatial layers in a single stream.
- **Adaptive bitrate**: SFU adjusts forwarded quality based on receiver's bandwidth estimation.
- **Audio-only mode**: For large meetings, only active speakers transmit video.

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Media routing | SFU | P2P mesh / MCU | O(N) connections, individual stream control |
| Signaling | WebSocket | HTTP polling / SSE | Sub-second round-trip for ICE/DTLS negotiation |
| Media server | mediasoup | Janus / Jitsi | Single-process, Node.js native, lower overhead |
| Session store | Redis + cookie | JWT | Immediate revocation, simpler |
| Meeting settings | JSONB | Normalized table | Co-read/co-written, evolving schema |
| Video codec | VP8 / H264 | VP9 / AV1 | Widest browser support, hardware acceleration |
| Chat delivery | WebSocket | Separate service | Already connected for signaling, low-latency |

## Implementation Notes

### Production-Grade Patterns Implemented

1. **Structured Logging (Pino)** — JSON logs with request correlation, SFU operation tracking. Critical for debugging media issues in production.
   - File: `backend/src/services/logger.ts`

2. **Prometheus Metrics (prom-client)** — Active meetings gauge, participant count, WebSocket connections, HTTP request duration histogram.
   - File: `backend/src/services/metrics.ts`

3. **Circuit Breaker (Opossum)** — Wraps database calls to prevent cascade failures during PostgreSQL outages.
   - File: `backend/src/services/circuitBreaker.ts`

4. **Rate Limiting** — Auth endpoints (20/15min), API endpoints (100/15min) to prevent abuse.
   - File: `backend/src/services/rateLimiter.ts`

5. **Full WebSocket Signaling Protocol** — Complete message protocol for WebRTC negotiation, matching what a real mediasoup application would implement.
   - File: `backend/src/websocket/handler.ts`

### What Was Simplified
- **SFU is simulated** — The sfuService models mediasoup concepts in memory without the native C++ module. Signaling is real; media packet forwarding is logged.
- **Media not actually routed** — Clients capture local streams for preview, but no SRTP packets are exchanged between peers through the SFU.
- **Single server** — No Worker-per-core, no cross-server pipe transports, no horizontal SFU scaling.
- **Session auth** — Production would use OAuth 2.0 with Google/SSO integration.

### What Was Omitted
- CDN for static assets
- End-to-end encryption (E2EE) for media
- Kubernetes orchestration for SFU workers
- Recording pipeline (capture, transcode, store)
- Waiting room enforcement
- Virtual backgrounds / noise cancellation (ML processing)
- TURN/STUN server infrastructure
- Multi-region deployment with geo-routing
