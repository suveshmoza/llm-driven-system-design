# Loom - Development Notes

## Project Context

This project implements a simplified video recording and sharing platform, inspired by Loom. It demonstrates browser-based media capture with MediaRecorder API, direct-to-storage upload via presigned URLs, time-anchored commenting, token-based sharing with access controls, and view analytics aggregation.

## Development Phases

### Phase 1: Architecture and Design
- Designed presigned URL upload pattern to keep video bytes off the API server
- Defined 7-table schema: users, videos, comments, shares, view_events, folders, video_folders
- Planned share token security model with password protection and expiration
- Sketched analytics aggregation queries

### Phase 2: Backend Implementation
- Express API with session auth (Redis-backed via connect-redis)
- MinIO storage service for presigned upload/download URL generation
- Share service with crypto-random token generation and bcrypt password hashing
- Analytics service with PostgreSQL aggregation (total views, unique viewers, avg duration, completion rate)
- 6 route files: videos, upload, comments, shares, analytics, folders
- Circuit breaker (Opossum) wrapping MinIO operations
- Prometheus metrics for HTTP requests, upload duration, active viewers

### Phase 3: Frontend Implementation
- TanStack Router with 6 routes: library, login, register, record, video player, share
- RecordingInterface component with MediaRecorder API, screen/camera mode selection, pause/resume
- XHR-based upload with progress tracking mapped to a 5-stage progress indicator
- VideoPlayer wrapping native HTML5 video with onTimeUpdate for comment anchoring
- CommentSection with optional time-anchor checkbox and single-level threading
- ShareModal with password, expiry, and download permission options
- AnalyticsPanel with stat cards and ViewsChart bar chart
- FolderTree for video organization

## Key Design Decisions

### Presigned URL Upload Pattern
Video files go directly from the browser to MinIO/S3 via presigned PUT URLs. The API server generates the URL (< 100ms) but never touches the video bytes. This keeps the API stateless and horizontally scalable. The trade-off is more complex client-side upload logic (XHR for progress, multi-step orchestration).

### Time-Anchored Comments as Nullable Float
A single `timestamp_seconds FLOAT` column (nullable) distinguishes time-anchored from general comments. Null means general, non-null anchors to a video timestamp. This avoids the complexity of polymorphic comment types for what amounts to a single optional field.

### Crypto-Random Share Tokens
Share tokens use `crypto.randomBytes(32).toString('hex')` -- 256 bits of entropy. This is stronger than UUID v4 (122 bits) and makes tokens unguessable. Token-based shares support individual revocation (delete the row), unlike signed URLs which require key rotation to revoke.

### WebM Format (No Transcoding)
MediaRecorder outputs WebM natively. We serve it as-is without server-side transcoding. This eliminates the need for an FFmpeg pipeline but limits playback to browsers that support WebM. Production would transcode to HLS/DASH for adaptive bitrate streaming.

### XHR Instead of Fetch for Upload
XMLHttpRequest's `upload.onprogress` event provides byte-level upload progress. The Fetch API does not support upload progress events. We map XHR progress to the 20-85% range of a 5-stage progress indicator.

## Open Questions

- Should we add WebSocket notifications for upload completion and new comments?
- How to handle recordings over 1GB (S3 multipart upload with multiple presigned URLs)?
- Should the video player support playback speed control and keyboard shortcuts?
- How to implement video thumbnail extraction without server-side FFmpeg?
- Should we add a trash/recycle bin instead of hard-deleting videos?

## Learnings

- The presigned URL pattern is powerful but requires careful client-server coordination (4-step upload flow)
- MediaRecorder's 1-second timeslice parameter prevents memory accumulation during long recordings
- Browser screen sharing can be stopped via the browser's native UI, requiring an `ended` event listener on the video track
- Comment anchoring is surprisingly simple -- a nullable timestamp and a checkbox in the UI
- Share token security is straightforward with `crypto.randomBytes()` but password protection adds bcrypt latency to every authenticated share access
