# System Design: Video Conferencing (Backend Focus)

## 1. Requirements Clarification

> "Before diving in, let me clarify the scope. We're building a Zoom-like video conferencing system. Key backend concerns are: media routing architecture, signaling protocol, meeting lifecycle, and scaling beyond thousands of concurrent meetings."

**Functional Requirements:**
- Multi-party video calls (up to 100 participants)
- Audio/video mute, camera toggle, hand raise
- Screen sharing
- In-call chat (broadcast + DM)
- Breakout rooms
- Meeting scheduling with human-readable codes

**Non-Functional Requirements:**
- Video latency < 150ms within same region
- Signaling latency < 50ms (p99)
- Support 100K concurrent meetings
- 99.99% availability

---

## 2. Capacity Estimation

> "Let me size the system to understand where the bottlenecks will appear."

- **Peak concurrent meetings**: 100,000
- **Average participants/meeting**: 8
- **Peak concurrent participants**: 800,000
- **SFU worker capacity**: ~500 participants per CPU core
- **Workers needed**: 1,600 SFU processes
- **Signaling messages**: 50 msgs/participant/min = 40M msgs/min
- **Media bandwidth per participant**: ~2 Mbps upload + 2 Mbps * (N-1) streams download

---

## 3. High-Level Architecture

```
┌──────────┐    ┌───────────┐    ┌────────────────┐
│  Client  │───▶│  CDN/Edge │───▶│ Load Balancer  │
│ (Browser)│    │  (static) │    │ (L7 + sticky)  │
└────┬─────┘    └───────────┘    └───────┬────────┘
     │                                   │
     │  WebSocket (signaling)            │
     │  SRTP (media)                     │
     │                                   ▼
     │                        ┌──────────────────┐
     │                        │   API Gateway    │
     │                        │ (auth, rate limit)│
     │                        └────────┬─────────┘
     │                                 │
     ▼                    ┌────────────┼────────────┐
┌──────────┐        ┌─────┴─────┐  ┌──┴──────────┐ │
│SFU Cluster│       │ Signaling │  │  Meeting    │ │
│(mediasoup │◀─────▶│ Service   │  │  Service    │ │
│ Workers)  │       │(WebSocket)│  │ (REST API)  │ │
└─────┬─────┘       └─────┬─────┘  └──────┬──────┘ │
      │                   │               │         │
      ▼                   ▼               ▼         ▼
┌──────────┐      ┌──────────┐    ┌──────────┐  ┌────────┐
│  Redis   │      │  Redis   │    │PostgreSQL│  │Object  │
│ (pub/sub │      │(sessions │    │(meetings │  │Storage │
│  rooms)  │      │  state)  │    │ users)   │  │(record)│
└──────────┘      └──────────┘    └──────────┘  └────────┘
```

---

## 4. SFU Architecture Deep Dive

> "The SFU is the most critical backend component. Let me explain why we chose it over P2P mesh and MCU."

### SFU vs P2P vs MCU

| Approach | Pros | Cons |
|----------|------|------|
| **SFU** | O(N) server connections, preserves individual streams, moderate server CPU | Server handles SRTP encryption, still O(N) client download bandwidth |
| **P2P Mesh** | No server infrastructure, lowest latency for 2 users | O(N^2) connections, impractical beyond 4-5 participants |
| **MCU** | Lowest client bandwidth (single mixed stream) | Highest server CPU (real-time transcoding), loses individual stream control |

> "We chose SFU because P2P mesh breaks at 5+ participants. With 8 participants in a mesh, each client maintains 7 WebRTC connections, sending 7 copies of their video — that's 14 Mbps upload for a single user at 2 Mbps per stream. Most home connections can't sustain that. SFU reduces this to a single upload stream, with the server forwarding to all recipients. The trade-off is server CPU for SRTP encryption/decryption, but that's linear and predictable. MCU would reduce client bandwidth further by sending a single mixed stream, but it requires real-time transcoding at ~$0.50/participant/hour in compute cost, and users lose the ability to individually pin or spotlight speakers."

### mediasoup Architecture Model

```
┌─────────────────────────────────────────┐
│               Node.js Process           │
│                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Worker 1│  │ Worker 2│  │ Worker N│ │
│  │(CPU core)│  │(CPU core)│  │(CPU core)│ │
│  │         │  │         │  │         │ │
│  │ Router A│  │ Router C│  │ Router E│ │
│  │ Router B│  │ Router D│  │ Router F│ │
│  └─────────┘  └─────────┘  └─────────┘ │
└─────────────────────────────────────────┘
```

**Key concepts:**
- **Worker**: OS-level process, one per CPU core. Handles SRTP encryption and media forwarding.
- **Router**: Routing context for a meeting room. Holds codec capabilities (VP8, H264, Opus).
- **WebRtcTransport**: ICE+DTLS connection per participant per direction (send/recv).
- **Producer**: A participant's outbound audio/video track registered on a Router.
- **Consumer**: A participant's inbound copy of another participant's Producer.

**Per-participant resource allocation:**
- 1 send transport, 1 recv transport
- Up to 3 producers (audio, video, screen share)
- N-1 consumers per producer kind (consuming all other participants' tracks)

---

## 5. Signaling Protocol Deep Dive

> "The signaling protocol is the control plane for WebRTC. Every media stream setup requires a multi-step negotiation."

### WebRTC Connection Flow

```
Client                  Signaling Server              SFU
  │                          │                         │
  │──join-meeting───────────▶│                         │
  │                          │──create Router──────────▶│
  │                          │◀─Router capabilities────│
  │                          │──create Transports──────▶│
  │◀─joined (capabilities,   │◀─Transport options──────│
  │   transport options,     │                         │
  │   existing producers)    │                         │
  │                          │                         │
  │──produce (audio)─────────▶│──create Producer────────▶│
  │◀─produced (producerId)───│◀─Producer created───────│
  │                          │                         │
  │  [other clients]         │                         │
  │◀─new-producer────────────│                         │
  │──consume (producerId)───▶│──create Consumer────────▶│
  │◀─consume-response────────│◀─Consumer created───────│
  │                          │                         │
  │  [ongoing]               │                         │
  │──toggle-mute────────────▶│──broadcast update───────▶│
  │◀─participant-update──────│                         │
```

### Message Types

| Direction | Message | Payload |
|-----------|---------|---------|
| C→S | `join-meeting` | meetingCode, displayName |
| S→C | `joined` | meetingId, participants, rtpCapabilities, transportOptions, existingProducers |
| C→S | `produce` | kind (audio/video/screen), rtpParameters |
| S→C | `produced` | producerId, kind |
| S→C | `new-producer` | userId, producerId, kind |
| C→S | `consume` | producerId |
| S→C | `consume-response` | consumerId, producerId, kind, rtpParameters |
| C→S | `producer-close` | producerId |
| S→C | `producer-closed` | producerId, userId |
| C→S | `toggle-mute` | muted: boolean |
| S→ALL | `participant-update` | userId, isMuted, isVideoOn, isScreenSharing, isHandRaised |
| C→S | `chat-message` | content, recipientId? |
| S→ALL/DM | `chat-message` | senderId, senderName, content, recipientId?, createdAt |

---

## 6. Data Model

### Core Schema

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    users     │     │    meetings      │     │meeting_participants│
│──────────────│     │──────────────────│     │──────────────────│
│ id (UUID PK) │◀────│ host_id (FK)     │     │ meeting_id (FK)  │
│ username     │     │ meeting_code     │◀────│ user_id (FK)     │
│ email        │     │ title            │     │ display_name     │
│ password_hash│     │ status           │     │ role             │
│ display_name │     │ settings (JSONB) │     │ is_muted         │
└──────────────┘     │ scheduled_start  │     │ is_video_on      │
                     │ actual_start     │     │ is_screen_sharing│
                     │ actual_end       │     │ is_hand_raised   │
                     └──────────────────┘     │ joined_at        │
                                              │ left_at          │
                                              └──────────────────┘
```

**Meeting codes** use format `abc-defg-hij` (3-4-3 lowercase letters) — human-readable and verbally communicable. Stored with a UNIQUE constraint and indexed for fast lookup.

**Settings as JSONB** instead of normalized columns because settings are always read/written as a unit, the schema evolves frequently (new features like waiting room, E2EE toggle), and we never query across meetings by individual settings.

---

## 7. Breakout Rooms

> "Breakout rooms are architecturally interesting because they require dynamic Router allocation and participant migration."

**Flow:**
1. Host creates N breakout rooms via REST API
2. Host assigns participants to rooms
3. Host activates breakout rooms
4. Server creates a new SFU Router per breakout room
5. Assigned participants' transports are migrated from main Router to breakout Router
6. When host closes breakout rooms, participants migrate back to main Router

**Key challenge**: Transport migration. In mediasoup, you can't move a Transport between Routers. Instead:
1. Close participant's existing consumers on the main Router
2. Create new Transports on the breakout Router
3. Re-negotiate ICE/DTLS (client performs new WebRTC handshake)
4. Recreate Producers and Consumers on the new Router

This causes a ~1-2 second interruption during the switch, which is acceptable UX.

---

## 8. Scaling Strategy

### Horizontal SFU Scaling

> "A single SFU worker handles ~500 concurrent participants. For 800K participants, we need ~1,600 workers distributed across machines."

```
┌──────────────────────────────────┐
│        SFU Controller            │
│  (routes meetings to workers)    │
└────────────┬─────────────────────┘
             │
    ┌────────┼────────┐
    ▼        ▼        ▼
┌────────┐┌────────┐┌────────┐
│Server 1││Server 2││Server N│
│ 8 cores││ 8 cores││ 8 cores│
│8 workers│8 workers│8 workers│
│~4K users│~4K users│~4K users│
└────────┘└────────┘└────────┘
```

**Routing strategy**: Consistent hashing by meeting_code determines which server handles a meeting. All participants in the same meeting go to the same server's Workers.

**Large meetings** (100+ participants): Span multiple Workers on the same server using **pipe transports** — internal connections between Workers that forward Producer streams without client involvement.

### Bandwidth Optimization

| Technique | How it works | Impact |
|-----------|-------------|--------|
| Simulcast | Client sends 3 quality layers (low/mid/high) | SFU forwards appropriate layer based on viewer's tile size |
| Active speaker detection | Only forward high-quality video for active speakers | Reduces bandwidth by 60-70% in large meetings |
| Last-N | Only forward video for the N most recent speakers | Caps download bandwidth for 50+ participant meetings |

> "Simulcast is the single most impactful optimization. Without it, a 25-person meeting requires each client to download 24 streams at full 720p (48 Mbps). With simulcast and a 5x5 grid, the SFU forwards low-quality layers (180p, ~100kbps) for small tiles and high-quality (720p, ~2Mbps) only for the active speaker — reducing total download to ~5 Mbps."

---

## 9. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Media architecture | SFU | P2P / MCU | O(N) connections, individual stream control |
| Signaling transport | WebSocket | HTTP polling | Sub-second ICE/DTLS negotiation required |
| Media server | mediasoup | Janus / LiveKit | Node.js native, single-process, lower overhead |
| Meeting code format | 3-4-3 letters | Numeric ID / UUID | Human-readable, verbally communicable |
| Settings storage | JSONB | Normalized table | Co-read/co-written unit, evolving schema |
| Breakout implementation | New Router per room | Single Router with filtering | True isolation, independent quality control |
| Chat delivery | WebSocket (in-band) | Separate service | Already connected for signaling |
| Session management | Redis + cookie | JWT | Immediate revocation, simpler implementation |

---

## 10. Failure Scenarios

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| SFU Worker crash | Meeting participants disconnected | Auto-reconnect, reassign to healthy Worker |
| Signaling server down | New joins fail, existing calls continue | Multiple signaling servers behind LB |
| Redis outage | Sessions lost, pub/sub breaks | Redis Sentinel for HA, session re-auth |
| PostgreSQL down | Meeting creation fails, history unavailable | Circuit breaker, cached meeting state in Redis |
| Network partition | Split-brain in distributed SFU | TURN fallback, server-side health monitoring |

> "The most important insight: once a WebRTC media connection is established between client and SFU, it survives signaling server failures. Participants already in a call continue talking even if the signaling server goes down. Only new joins and state changes (mute/unmute) are affected. This is a fundamental advantage of the SFU architecture — the media plane and control plane are decoupled."
