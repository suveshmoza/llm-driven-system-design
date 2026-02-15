# Microsoft Teams - Development Notes

## Project Context

This project implements a simplified enterprise chat platform inspired by Microsoft Teams. It demonstrates hierarchical resource modeling (organization > team > channel), real-time messaging with SSE and Redis pub/sub, presence tracking with Redis TTL keys, and file sharing with MinIO object storage.

## Development Phases

### Phase 1: Architecture and Design
- Designed four-level hierarchy: Organization > Team > Channel > Message
- Chose SSE over WebSocket for unidirectional real-time push
- Planned Redis pub/sub for cross-instance message broadcasting
- Defined 10-table schema with self-referencing messages for threading

### Phase 2: Backend Implementation
- Express API with session auth (Redis-backed via connect-redis)
- 9 domain route files: organizations, teams, channels, messages, reactions, files, presence, sse, users
- Redis pub/sub service for cross-instance SSE broadcasting
- Presence service using Redis SETEX with 60-second TTL
- File upload via multer (memory storage) + MinIO object storage
- Prometheus metrics for HTTP requests, SSE connections, messages, presence
- Circuit breakers (Opossum), rate limiting, structured logging (Pino)

### Phase 3: Frontend Implementation
- TanStack Router with nested file-based routes matching org/team/channel hierarchy
- Two Zustand stores: AuthStore (auth state) and ChatStore (messages, channels, SSE)
- SSE connection management per channel with auto-reconnect
- Thread panel as a slide-in side panel
- Member list with online/offline presence indicators
- Reaction picker with common emoji set
- File upload via message input attachment button
- Teams brand color scheme (purple #5B5FC7 primary)

## Key Design Decisions

### SSE Over WebSocket
Messages are sent via REST POST and pushed via SSE. This separation gives us request/response semantics for error handling on writes and efficient server-to-client push for reads. SSE's built-in reconnection via EventSource simplifies the client code significantly.

### Self-Referencing Thread Model
Threads use a `parent_message_id` foreign key back to the messages table rather than a separate threads table. This works because Teams uses flat threads (one level deep). The trade-off is that deeply nested threading isn't supported, but the schema is simpler and queries are faster.

### Redis Pub/Sub for Cross-Instance Broadcasting
In-process EventEmitter only delivers to SSE clients on the same server instance. Redis pub/sub broadcasts messages to all instances, enabling horizontal scaling. Each server subscribes to channels its clients are viewing.

### Redis TTL for Presence
Presence is a Redis key with a 60-second TTL, refreshed by client heartbeats every 30 seconds. If the heartbeat stops, the key auto-expires -- no cleanup cron job needed. Batch presence checks use Redis pipeline for efficiency.

### MinIO for File Storage
Files are uploaded to MinIO (S3-compatible) and accessed via presigned URLs. This offloads download bandwidth from the API server and matches production S3 patterns.

## Open Questions

- Should typing indicators be implemented via SSE events or a separate polling endpoint?
- How to handle unread message counts efficiently at scale (denormalized counter vs. query)?
- Should message search be added via PostgreSQL full-text search or Elasticsearch?
- How to handle message edit/delete notifications in the SSE stream?

## Learnings

- The org > team > channel hierarchy maps naturally to nested routes, making navigation-driven data loading straightforward
- SSE is underrated for chat -- the auto-reconnect and HTTP-native behavior simplify both server and client
- Redis pub/sub is the right tool for real-time fan-out but lacks durability -- messages during server restarts are lost
- Presence with TTL keys is elegant but requires careful tuning of heartbeat interval vs. TTL duration
