# CLAUDE.md — Zoom (Video Conferencing)

## Project Overview

Video conferencing system with SFU architecture, screen sharing, breakout rooms, and in-call chat. Distinguished from the FaceTime project (P2P only) by supporting multi-party video through server-side media routing.

## Key Design Decisions

### Simulated SFU Service
The sfuService models the complete mediasoup architecture (Workers, Routers, WebRtcTransports, Producers, Consumers) without requiring the actual native C++ mediasoup module. This was chosen for portability — mediasoup requires a C++ toolchain and specific OS dependencies that make it impractical for a learning project that needs to run anywhere.

The simulation correctly implements:
- Router creation per meeting room
- Send/recv Transport creation per participant
- Producer registration when a participant shares audio/video/screen
- Consumer creation for each subscriber of a Producer
- Cleanup when producers close or participants leave
- The full WebSocket signaling protocol that a real mediasoup app would use

### Meeting Code Format
Codes use the human-readable format `abc-defg-hij` (3-4-3 lowercase letters) to match Zoom's meeting link style. Codes are stored as VARCHAR(12) with a unique constraint.

### WebSocket Authentication
Simplified to pass userId and username as query parameters on the WebSocket connection URL. In production, this would use the session cookie or a short-lived token.

### Dark Theme
UI uses Zoom-inspired dark color palette with blue (#2D8CFF) as the primary accent color, matching the recognizable Zoom aesthetic.

## Development Phases

### Phase 1: Core Infrastructure
- Database schema (users, meetings, participants, chat, breakout rooms, recordings)
- Express server with session-based auth
- PostgreSQL + Redis via Docker Compose
- REST API for auth and meeting CRUD

### Phase 2: WebSocket Signaling + SFU
- WebSocket handler with full signaling protocol
- Simulated SFU service modeling mediasoup architecture
- Real-time participant state management (mute, video, screen share, hand raise)

### Phase 3: Frontend
- TanStack Router with lobby, meeting room, dashboard, history
- Dynamic video grid layout (1x1 to 5x5 based on participant count)
- Meeting lobby with camera/mic preview and device selection
- Control bar with all media controls
- Chat panel with DM support
- Participant list with status indicators
- Breakout rooms host UI

## Known Simplifications
- Media streams are not actually routed between peers (SFU is simulated)
- No actual recording functionality
- WebSocket auth uses query params instead of session validation
- No waiting room enforcement (just a settings flag)
- Screen share shows a placeholder instead of actual display capture between peers
- Single-server deployment (no horizontal scaling of SFU workers)

## Tech Stack
- **Backend**: Node.js, Express, TypeScript, ws, PostgreSQL, Redis
- **Frontend**: React 19, TypeScript, Vite, TanStack Router, Zustand, Tailwind CSS
- **Testing**: Vitest, Supertest
- **Monitoring**: Pino (logging), prom-client (metrics), Opossum (circuit breaker)
