# Microsoft Teams - Architecture

## System Overview

Microsoft Teams is an enterprise communication and collaboration platform that enables team-based messaging within organizational hierarchies. This project explores the design of a real-time chat system organized around organizations, teams, and channels, with support for threaded conversations, file sharing, emoji reactions, and user presence tracking.

**Learning goals:** Real-time messaging architecture, hierarchical resource modeling (org > team > channel), Server-Sent Events for push updates, presence tracking with TTL-based keys, and file storage with object storage integration.

## Requirements

### Functional Requirements
- Users create and join organizations, which contain teams and channels
- Channel-based messaging with threaded replies
- File uploads attached to channels/messages
- Emoji reactions on messages
- Real-time message delivery via SSE
- User presence (online/offline) indicators
- User search for adding members

### Non-Functional Requirements (Production Scale)
- 99.99% uptime for messaging delivery
- p99 message delivery latency < 200ms
- Support 10M concurrent users across 500K organizations
- Message storage: 1B+ messages retained for compliance
- File uploads up to 250MB per file
- Presence updates within 60 seconds of state change

## High-Level Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────────────────────────────────┐
│              │     │              │     │                 Backend Services                  │
│   React SPA  │────▶│  API Gateway │────▶│                                                  │
│  (Vite/TS)   │     │  (nginx)     │     │  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│              │     │              │     │  │   Auth      │  │  Message   │  │  Presence  │  │
└──────┬───────┘     └──────────────┘     │  │  Service    │  │  Service   │  │  Service   │  │
       │                                  │  └────────────┘  └─────┬──────┘  └─────┬──────┘  │
       │  SSE                             │                        │               │          │
       │  Stream                          │  ┌────────────┐  ┌────┴───────┐  ┌────┴───────┐  │
       │◀─────────────────────────────────│  │   File      │  │  Redis     │  │  Redis     │  │
       │                                  │  │  Service    │  │  Pub/Sub   │  │  TTL Keys  │  │
                                          │  └─────┬──────┘  └────────────┘  └────────────┘  │
                                          │        │                                          │
                                          └────────┼──────────────────────────────────────────┘
                                                   │
                              ┌─────────────┐  ┌───┴─────────┐  ┌─────────────┐
                              │ PostgreSQL   │  │   MinIO     │  │   Valkey    │
                              │ (Messages,   │  │   (File     │  │  (Sessions, │
                              │  Orgs, Users)│  │  Storage)   │  │  Presence,  │
                              └─────────────┘  └─────────────┘  │  Pub/Sub)   │
                                                                └─────────────┘
```

## Core Components

### Organization Hierarchy

The resource hierarchy follows: **Organization > Team > Channel > Message/Thread**. This mirrors enterprise structures where a company (org) contains cross-functional teams, each with topic-specific channels.

- **Organizations** are top-level containers with unique slugs
- **Teams** belong to one organization and can be public or private
- **Channels** belong to one team; creating a team auto-creates a "General" channel
- **Messages** belong to channels; thread replies reference a `parent_message_id`

### Real-Time Messaging

Messages flow through a pub/sub pipeline:
1. Client sends POST to `/api/messages`
2. Server persists to PostgreSQL
3. Server publishes to Redis pub/sub channel `teams:channel:{channelId}`
4. All server instances subscribed to that channel receive the event
5. Each server pushes the message to connected SSE clients for that channel

This enables horizontal scaling -- multiple API instances can serve SSE connections, and Redis pub/sub ensures all clients receive messages regardless of which instance they connect to.

### Presence System

Presence uses Redis keys with a 60-second TTL:
- Client sends heartbeat every 30 seconds to `/api/presence/heartbeat`
- Server sets `presence:{userId}` with 60-second TTL
- If heartbeat stops (tab closed, network loss), key expires automatically
- Querying presence uses Redis pipeline to check multiple keys in one round trip

### File Storage

Files are uploaded through multiter (memory storage), then streamed to MinIO:
- Upload: `POST /api/files` with multipart form data
- Storage path: `channels/{channelId}/{fileId}.{ext}`
- Download: presigned URLs (1-hour expiry) via `GET /api/files/:fileId/download`

## Database Schema

The schema contains 10 tables modeling the organizational hierarchy, messaging, and file storage. Key design decisions:

- **UUID primary keys** across all tables for distributed ID generation
- **Cascading deletes** from parent to child (org > team > channel > message)
- **Composite unique constraints** prevent duplicate memberships (org_members, team_members, channel_members)
- **`parent_message_id`** self-reference on messages enables threaded replies without a separate table
- **`last_read_at`** on channel_members tracks read position per user per channel
- **Reaction uniqueness** enforced by `(message_id, user_id, emoji)` constraint

Key indexes:
- `idx_messages_channel` on `(channel_id, created_at DESC)` for paginated message loading
- `idx_messages_parent` on `(parent_message_id)` for thread retrieval
- Membership indexes on `user_id` for "my orgs/teams/channels" queries

## API Design

### Authentication
```
POST /api/auth/register    → Create account
POST /api/auth/login       → Login, create session
POST /api/auth/logout      → Destroy session
GET  /api/auth/me          → Current user info
```

### Organizations
```
GET  /api/organizations              → List user's organizations
POST /api/organizations              → Create organization
GET  /api/organizations/:orgId       → Get organization details
GET  /api/organizations/:orgId/members → List org members
POST /api/organizations/:orgId/members → Add member to org
```

### Teams
```
GET  /api/teams?orgId=xxx           → List teams in org
POST /api/teams                     → Create team (auto-creates General channel)
GET  /api/teams/:teamId             → Get team details
GET  /api/teams/:teamId/members     → List team members
POST /api/teams/:teamId/members     → Add member to team
```

### Channels
```
GET  /api/channels?teamId=xxx        → List channels in team
POST /api/channels                   → Create channel
GET  /api/channels/:channelId        → Get channel details
GET  /api/channels/:channelId/members → List channel members
POST /api/channels/:channelId/members → Add member to channel
POST /api/channels/:channelId/read   → Mark channel as read
```

### Messages
```
GET    /api/messages?channelId=xxx&before=xxx&limit=50 → Paginated messages
GET    /api/messages/:messageId/thread                 → Thread messages
POST   /api/messages                                   → Send message
PUT    /api/messages/:messageId                        → Edit message
DELETE /api/messages/:messageId                        → Delete message
```

### Reactions, Files, Presence, SSE
```
POST   /api/reactions                → Add reaction
DELETE /api/reactions                → Remove reaction
POST   /api/files                   → Upload file (multipart)
GET    /api/files/:fileId/download  → Get presigned download URL
GET    /api/files?channelId=xxx     → List channel files
POST   /api/presence/heartbeat      → Send presence heartbeat
GET    /api/presence/channel/:id    → Get channel member presence
GET    /api/sse/:channelId          → SSE stream for real-time updates
```

## Key Design Decisions

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Real-time transport | SSE | WebSocket | Simpler server-side, sufficient for unidirectional push; messages sent via REST |
| Cross-instance messaging | Redis pub/sub | Kafka | Lower latency for real-time chat; no durability needed for push notifications |
| Presence tracking | Redis TTL keys | Database polling | Sub-second state change detection, automatic cleanup on disconnect |
| Thread model | Self-referencing FK | Separate threads table | Simpler schema, thread is just a message with `parent_message_id` |
| File storage | MinIO (S3-compatible) | Database BLOBs | Scalable object storage, presigned URLs offload download bandwidth |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler invalidation |
| Org hierarchy | Org > Team > Channel | Flat channel list | Mirrors enterprise structure, enables per-level access control |

## Consistency and Idempotency

- **Message creation** is idempotent at the application level -- duplicate content from the same user within a short window could be detected client-side
- **Reaction toggle** uses `ON CONFLICT DO NOTHING` for adds and explicit deletes for removes
- **Membership operations** use `ON CONFLICT DO NOTHING` to handle duplicate join requests
- **Read position** updates use `UPDATE ... SET last_read_at = NOW()` which is naturally idempotent

## Security and Auth

- Session-based authentication with Redis-backed store
- Password hashing with bcryptjs (cost factor 10)
- Rate limiting: 1000 req/15min for API, 50 req/15min for auth, 120 msg/min for messages
- HTTP-only, SameSite cookies prevent CSRF
- File upload size limited to 50MB

## Observability

- **Prometheus metrics**: HTTP request duration/count, SSE active connections, messages total, presence heartbeats
- **Structured logging**: Pino with JSON output, request correlation via pino-http
- **Health check**: `GET /api/health` verifies database connectivity

## Failure Handling

- **Circuit breakers** (Opossum) wrap external service calls with 10s timeout, 50% error threshold
- **Redis reconnection**: exponential backoff with max 2s delay, lazy connect
- **SSE heartbeat**: 30-second keepalive prevents proxy timeouts and detects stale connections
- **Graceful shutdown**: SIGTERM/SIGINT handlers close server, pub/sub, and database pool
- **Database connection pool**: max 20 connections, 5s connect timeout, 30s idle timeout

## Scalability Considerations

**What breaks first at scale:**
1. **SSE connections** - Each server holds connections in memory. At 100K users per server, memory becomes the bottleneck. Solution: dedicated SSE gateway servers with sticky sessions.
2. **Message table** - A single PostgreSQL table with billions of rows. Solution: partition by `channel_id` and `created_at`, or migrate hot channels to Cassandra.
3. **Redis pub/sub** - Fan-out to many subscribers on popular channels. Solution: channel-based sharding across Redis clusters.

**Scaling path:**
- Horizontal API scaling behind a load balancer (SSE requires sticky sessions or shared pub/sub)
- Read replicas for message history queries
- Separate write and read paths for messages (CQRS)
- CDN for static assets and file downloads
- Message search via Elasticsearch

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| SSE over WebSocket | Simpler, HTTP-native | WebSocket for bidirectional | Messages sent via REST, only push needed |
| Single PostgreSQL | Simpler operations | Sharded cluster | Sufficient for local dev, partition later |
| Redis pub/sub | Low latency | Kafka | Chat needs speed over durability |
| Self-referencing threads | Simple schema | Separate table | One table handles both top-level and replies |
| MinIO for files | S3-compatible | Local filesystem | Production-like object storage patterns |

## Implementation Notes

### Production-Grade Patterns Implemented

1. **Redis pub/sub for cross-instance messaging** -- enables horizontal scaling by broadcasting messages through Redis rather than relying on in-process EventEmitter alone. See `src/services/pubsub.ts`.

2. **Prometheus metrics** (prom-client) -- tracks HTTP request latency, SSE connection count, message throughput, and presence heartbeats. See `src/services/metrics.ts`.

3. **Structured logging** (Pino) -- JSON-formatted logs with request correlation for debugging distributed message flows. See `src/services/logger.ts`.

4. **Circuit breakers** (Opossum) -- protect against cascading failures when Redis or MinIO become unavailable. See `src/services/circuitBreaker.ts`.

5. **Rate limiting** -- tiered limits for auth (50/15min), general API (1000/15min), and messaging (120/min). See `src/services/rateLimiter.ts`.

6. **Health check endpoint** -- verifies database connectivity for load balancer integration.

### Simplified for Local Development
- Single PostgreSQL instance instead of sharded cluster
- MinIO instead of AWS S3
- Session auth instead of OAuth2/SAML (enterprise SSO)
- SSE instead of WebSocket (simpler for unidirectional push)
- In-process EventEmitter + Redis pub/sub instead of dedicated message broker

### Omitted
- CDN for file delivery
- Multi-region deployment
- Kubernetes orchestration
- Message search (Elasticsearch)
- Video/audio calling (WebRTC)
- End-to-end encryption
- SAML/OAuth2 enterprise SSO
- Message retention policies and compliance archival
