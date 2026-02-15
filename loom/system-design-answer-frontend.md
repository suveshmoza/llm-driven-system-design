# Loom - System Design Answer (Frontend Focus)

## 1. Clarifying Questions (2 minutes)

> "We're designing a Loom-like video recording and sharing platform. I'll focus on the frontend: browser-based recording with MediaRecorder, the upload experience with progress tracking, the video player with time-anchored comments, and the share page. Should I cover the recording editing experience (trimming, annotations) or keep it to capture-and-upload?"

Assuming capture-and-upload for this exercise. Trimming and annotations would be follow-up features.

> "One more question -- should I design for mobile responsiveness or desktop-only? Recording APIs have different support levels on mobile."

Assuming desktop-first (768px-1920px viewport), since MediaRecorder's `getDisplayMedia()` for screen capture is a desktop-only API.

## 2. Functional Requirements

- Browser-based screen and camera recording with pause/resume
- Video upload with accurate progress tracking
- Video library with folders, search, and responsive grid view
- Video player with custom controls and time position tracking
- Time-anchored comments that link to specific moments in a video
- Share link creation with password, expiry, and download options
- Public share page for unauthenticated viewers
- View analytics dashboard for video owners
- Empty states for first-time users

## 3. Non-Functional Requirements

- Recording must work in Chrome, Firefox, and Edge (Safari has limited MediaRecorder support)
- Upload progress must be accurate and responsive (update at least every 500ms)
- Video playback must start within 2 seconds of page load
- Share page must render without authentication
- Comments must load without blocking video playback
- UI must be responsive from 768px to 1920px viewport
- Recording must not accumulate unbounded memory for long sessions (30+ minutes)
- Upload must survive temporary network interruptions (retry without re-recording)

## 4. Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      App Root                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │                    Header                        │   │
│  │  [Logo]  [Library]  [Record]  [User]  [Sign Out] │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │                TanStack Router                   │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  / (Library)                               │  │   │
│  │  │  ┌────────────┐  ┌─────────────────────┐   │  │   │
│  │  │  │ FolderTree │  │     VideoGrid       │   │  │   │
│  │  │  │  [All]     │  │  ┌──────────────┐   │   │  │   │
│  │  │  │  [Work]    │  │  │  VideoCard   │   │   │  │   │
│  │  │  │  [Personal]│  │  │  VideoCard   │   │   │  │   │
│  │  │  └────────────┘  │  └──────────────┘   │   │  │   │
│  │  │  ┌─────────────────────────────────┐   │   │  │   │
│  │  │  │        VideoFilters             │   │   │  │   │
│  │  │  └─────────────────────────────────┘   │   │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  /record                                   │  │   │
│  │  │  ┌─────────────────────────────────────┐   │  │   │
│  │  │  │  RecordingInterface                 │   │  │   │
│  │  │  │  [Mode: Screen | Camera]            │   │  │   │
│  │  │  │  [Preview]  [Timer]  [Controls]     │   │  │   │
│  │  │  │                                     │   │  │   │
│  │  │  │  RecordingPreview (after stop)      │   │  │   │
│  │  │  │  [Video]  [Title]  [Upload/Discard] │   │  │   │
│  │  │  │                                     │   │  │   │
│  │  │  │  UploadProgress (during upload)     │   │  │   │
│  │  │  │  [Circle]  [Bar]  [Label]           │   │  │   │
│  │  │  └─────────────────────────────────────┘   │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────┐  │   │
│  │  │  /videos/:id                               │  │   │
│  │  │  ┌──────────────────┐  ┌───────────────┐   │  │   │
│  │  │  │   VideoPlayer    │  │ [Comments|    │   │  │   │
│  │  │  │   [Video]        │  │  Analytics]   │   │  │   │
│  │  │  │   [Controls]     │  │ CommentSection│   │  │   │
│  │  │  └──────────────────┘  │ AnalyticsPanel│   │  │   │
│  │  │  [Title] [Author]      └───────────────┘   │  │   │
│  │  │  [Share Button]                            │  │   │
│  │  │  ┌────────────────────────────────────┐    │  │   │
│  │  │  │         ShareModal (overlay)       │    │  │   │
│  │  │  └────────────────────────────────────┘    │  │   │
│  │  └────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## 5. State Management

> "I use Zustand for global state because it's minimal, TypeScript-friendly, and avoids the boilerplate of Redux. Each store has a clear responsibility boundary. Local UI state stays in React useState to avoid polluting global state with ephemeral concerns."

**authStore** -- User authentication state, login/register/logout actions, session check on app mount. The `loading` flag starts as `true` and flips to `false` after `checkAuth()` resolves -- this prevents a flash of the login page when the user has a valid session cookie. The Header and route guards consume this store.

**videoStore** -- Video list with pagination (`videos[]`, `total`, `page`), current video for detail view (`currentVideo`), upload state (`uploading`, `uploadProgress`), and recording state (`recording`, `recordedBlob`). The `createAndUpload` action orchestrates the four-step upload flow and updates progress at each stage. The Blob is held in the store so it persists across route changes (navigating away from /record doesn't lose the recording).

**What stays local (not in Zustand):**
- Comment input text and "anchor to time" checkbox (CommentSection only)
- Search filter value (index route only)
- Modal open/close state (ShareModal only)
- Recording mode selection (RecordingInterface only)
- Active tab in the sidebar (comments vs. analytics)
- Share form fields (password, expiry, download permission)
- Video player current time (passed via callback, not stored globally)

> "The rule of thumb: if the state needs to survive a route change or be accessed by sibling components, it goes in Zustand. Otherwise, it stays local."

## 6. Route Structure

```
/                     Video library (authenticated, redirects to /login if not)
/login                Sign in page
/register             Create account page
/record               Recording interface (authenticated)
/videos/:videoId      Video player + comments + analytics (authenticated)
/share/:token         Public share page (no auth required)
```

> "The share route is deliberately separate from the video route. It uses a token parameter instead of a video ID, has no authentication requirement, and fetches video data through the share validation endpoint rather than the authenticated video API. This separation means the share page can be the lightest page in the app -- no folder tree, no analytics tab, no edit controls."

**Route guards:** The index, record, and video pages check `useAuthStore` on mount. If `!loading && !user`, they navigate to `/login`. The `__root.tsx` component calls `checkAuth()` in useEffect on mount, which validates the session cookie against the backend.

## 7. Deep Dives

### Deep Dive 1: MediaRecorder API for Screen Capture

> "Browser-based recording is the core differentiator. The MediaRecorder API makes this possible but has several sharp edges that affect UX and memory management."

**The recording flow:**

1. User arrives at `/record` and selects recording mode (screen or camera)
2. For screen recording, we call `navigator.mediaDevices.getDisplayMedia()` which triggers the browser's native screen picker dialog. The user chooses a tab, window, or entire screen. We request 1920x1080 at 30fps
3. Optionally, we also call `getUserMedia({ audio: true })` to capture microphone audio. This is wrapped in a try-catch -- if the user denies microphone permission, we proceed with display audio only
4. We combine video tracks from the display stream and audio tracks from both streams into a single MediaStream. This gives us screen video + system audio + microphone audio
5. A MediaRecorder instance is created with `video/webm;codecs=vp9,opus` as the MIME type. VP9 provides good compression, and Opus is the standard audio codec for WebM
6. Recording starts with `mediaRecorder.start(1000)` -- the 1000ms timeslice is critical for memory management
7. Chunks are accumulated in an array via the `ondataavailable` event. On stop, they are assembled into a single Blob

**Why the 1-second timeslice is critical:**

Without a timeslice parameter, `MediaRecorder.start()` buffers ALL recorded data in memory until `stop()` is called. For a 30-minute recording at 2Mbps, that is 450MB of video data held in the MediaRecorder's internal buffer before any data is emitted. The browser can't garbage-collect this data because the MediaRecorder owns it.

With `start(1000)`, the MediaRecorder fires `ondataavailable` every second with a ~250KB chunk. Each chunk is pushed to our array immediately. While the array still grows (we need all chunks to assemble the final Blob), the MediaRecorder's internal buffer stays small (< 1MB). If the browser needs memory under pressure, it has more flexibility to manage the chunk array than a monolithic internal buffer.

The practical difference: without timeslice, a 30-minute recording may crash the tab on devices with < 4GB RAM. With timeslice, memory usage grows linearly and predictably.

**Pause/resume:** MediaRecorder natively supports `pause()` and `resume()`. When paused, no new `ondataavailable` events fire, but the preview stream stays active -- the user can see their screen while paused. We clear the recording timer interval on pause and restart it on resume. This matches Loom's behavior where pausing freezes the recording but the camera bubble remains live.

**Handling browser-initiated stop:** When a user stops screen sharing via the browser's "Stop Sharing" button (not our UI), the display stream's video track fires an `ended` event. We listen for this event on `stream.getVideoTracks()[0]` and gracefully stop the MediaRecorder, trigger the blob assembly, and transition to the preview state. Without this handler, the recording would continue capturing a black frame, wasting memory and producing corrupted output at the end.

**Recording timer:** A `setInterval` running every 1 second increments a counter in state. This is independent of the MediaRecorder's internal timing -- it is a UI-only timer for display purposes. On pause, we clear the interval. On resume, we restart it. The actual recording duration is calculated from wall-clock timestamps: `(Date.now() - startTime) / 1000`. We use this for the `durationSeconds` value sent to the backend.

**Cross-browser considerations:** Chrome and Firefox support `video/webm;codecs=vp9,opus`. We should check `MediaRecorder.isTypeSupported()` before creating the recorder and fall back to `video/webm;codecs=vp8,opus` or just `video/webm` if VP9 is unavailable. Safari added MediaRecorder support in Safari 14.5 but prefers `video/mp4;codecs=h264,aac`. For this design, we target Chrome and Firefox as primary browsers.

**Resource cleanup on unmount:** The RecordingInterface component cleans up in its useEffect return:
1. `MediaStream.getTracks().forEach(track => track.stop())` releases camera/screen capture hardware
2. Timer interval is cleared
3. MediaRecorder is stopped if still active

The recorded blob is NOT cleaned up on component unmount -- it persists in Zustand so the user can navigate to other routes and return to the record page without losing their recording.

**The trade-off:** WebM is not universally playable -- Safari on iOS, older Android browsers, and some desktop video players cannot play WebM natively. The alternative is server-side transcoding to MP4/HLS after upload, which adds infrastructure complexity (FFmpeg pipeline, processing queue, storage of multiple format renditions, 30-60 second delay before the video is playable). For a local implementation, WebM is sufficient. At production scale, transcoding becomes necessary, and the user would see a "Processing..." status while transcoding completes.

### Deep Dive 2: Video Player with Time-Anchored Comments

> "Time-anchored comments are what make Loom's commenting system special. Clicking a comment jumps the video to that moment. Adding a comment captures the current playback position. The challenge is coordinating state between the player and the comment UI without tight coupling."

**Player architecture:**

The VideoPlayer component wraps a native HTML5 `<video>` element. We use a ref (`useRef<HTMLVideoElement>`) to access the DOM element directly for programmatic control. The `onTimeUpdate` event fires approximately 4 times per second (browser-dependent), reporting the current playback position to the parent component via a callback prop.

The parent (VideoPage) holds `playerTime` in local state and passes it down:

```
VideoPlayer ──onTimeUpdate──▶ VideoPage (playerTime state)
                                  │
                                  ├──▶ CommentSection (reads playerTime for anchor label)
                                  └──▶ AnalyticsPanel (doesn't consume playerTime)
```

This creates unidirectional data flow. The VideoPlayer is the source of truth for playback position. CommentSection is a consumer. Neither component knows about the other.

**Comment creation flow:**

1. User types a comment in the textarea below the video
2. A checkbox labeled "Anchor at X:XX" displays, updating every ~250ms as the video plays
3. The displayed time comes from `Math.floor(playerTime)` passed from the parent
4. If checked, the comment is submitted with `timestampSeconds` set to the floored player time
5. If unchecked, `timestampSeconds` is null -- creating a general comment
6. The new comment is appended to the local comments array optimistically and appears immediately

**CommentItem timestamp badge:**

When `comment.timestampSeconds` is non-null, the CommentItem renders a small rounded pill badge with the formatted time (e.g., "2:34"). The badge uses the `.timestamp-badge` CSS class -- brand purple background with 10% opacity, brand purple text, rounded-full corners. Hover darkens the background to 20% opacity.

To implement seeking on badge click, we would pass a `seekTo` function from VideoPage through CommentSection to CommentItem. Clicking the badge calls `seekTo(comment.timestampSeconds)` which sets `videoRef.current.currentTime = seconds`. The video jumps to that moment.

**Comment threading model:**

Comments support single-level nesting via `parentId`. The CommentSection filters comments into two groups:
- `topLevel`: comments where `parentId` is null
- `replies`: comments where `parentId` is non-null

Top-level comments are rendered in chronological order. Below each top-level comment, matching replies are rendered with 24px left margin indentation (`ml-6` in Tailwind).

> "I deliberately chose single-level nesting over unlimited depth. Two levels (comment + reply) covers 95% of asynchronous discussion patterns on video. Unlimited nesting creates recursive rendering complexity, confusing indentation in a narrow sidebar (the comment panel is ~300px wide on desktop), and makes chronological ordering ambiguous when replies can be nested arbitrarily. Loom's actual product uses single-level replies."

**Why not a timeline-synced comment sidebar?** Some video platforms auto-scroll comments to match the current playback position. This creates a disorienting UX:

1. Comments arrive in chronological order of posting, not video timestamp order, so the sidebar would jump randomly between time-anchored and general comments during playback
2. General comments (no timestamp) have no meaningful position in the timeline -- where should they appear?
3. A user actively reading or scrolling through comments would be interrupted by auto-scrolling on every timeupdate event (4 times/second)
4. The implementation requires a complex intersection observer or virtual scroll synced to video time

Instead, we show all comments in chronological order with optional timestamp badges. Users can scan for badges to find comments about specific moments. This is simple, predictable, and doesn't fight with user scrolling intent.

**The trade-off:** Storing timestamp as a nullable float preserves sub-second precision. We floor to integer in the UI ("2:34" not "2:34.7") because fractional seconds look awkward in text. Integer storage would be simpler but loses precision we might need for future features like frame-accurate annotations or drawing overlays. At 4 bytes per float vs. 4 bytes per integer, there is zero storage cost difference.

### Deep Dive 3: Upload UX with Progress Tracking

> "Upload progress is critical for recordings that can be hundreds of megabytes. Users need confidence that their recording is safe before navigating away. A stuck progress bar or vague spinner kills trust in the product."

**The upload state machine:**

The upload has five distinct visual states, each with different UI. The Zustand store tracks `uploading: boolean` and `uploadProgress: number (0-100)`:

1. **Idle** (progress = 0, uploading = false) -- User sees RecordingPreview with the recorded video playing, title/description input fields, and "Upload Video" / "Discard" buttons
2. **Creating metadata** (0-10%) -- POST `/api/videos` creates the database record. UploadProgress component shows "Creating video..." with a circular progress indicator at ~5%
3. **Getting presigned URL** (10-20%) -- POST `/api/upload/presigned` returns the S3/MinIO upload URL. Shows "Preparing upload..." at ~15%
4. **Uploading** (20-85%) -- XHR PUT to the presigned URL with byte-level progress tracking. Shows "Uploading video..." with a progress bar reflecting actual bytes transferred
5. **Finalizing** (85-100%) -- POST `/api/upload/complete` marks the video ready in the database. Shows "Finalizing..." then "Upload complete!" at 100%

**Why XMLHttpRequest instead of fetch?**

The Fetch API does not support upload progress events. There is no equivalent to `xhr.upload.onprogress` in the fetch world. The `ReadableStream` body approach provides download progress (via `response.body.getReader()`) but not upload progress.

XMLHttpRequest's `xhr.upload.addEventListener('progress', callback)` fires repeatedly during the upload with `{ loaded: number, total: number }`. We calculate the actual file transfer progress and map it to the 20-85% range of overall progress:

`overallProgress = 20 + (loaded / total) * 65`

This mapping gives the user a continuous sense of forward motion. The first 20% covers the fast metadata steps (both complete in < 500ms), the middle 65% covers the slow upload (could take minutes for large files), and the final 15% covers the finalization step.

**UploadProgress component design:**

The component shows two progress indicators simultaneously:
1. A circular SVG indicator using `stroke-dasharray` and `stroke-dashoffset` to animate a ring. The ring fills clockwise from the top. Inside the ring, the percentage number is displayed
2. A linear progress bar below for precise progress sense

The circular indicator provides a clear visual focal point. The linear bar provides precise information about progress rate. Both animate smoothly via CSS `transition: width 0.3s ease`.

Stage labels change at each transition point: "Creating video...", "Preparing upload...", "Uploading video...", "Finalizing...", "Upload complete!". These reassure the user that the system is working even during fast stages where the progress bar barely moves.

**Handling navigation during upload:**

A critical UX concern: the user might click "Library" or use the browser back button during upload.

In-app navigation (TanStack Router): The Zustand store persists across route changes because it lives outside the React component tree. The XHR continues in the background. When the upload completes, the `createAndUpload` action automatically navigates to the new video's page. If the user returns to /record while uploading, they see the UploadProgress component with current progress.

Closing the browser tab: This kills the XHR. We would add a `beforeunload` event listener when `uploading === true` that shows the browser's native confirmation dialog: "Your upload is still in progress. Are you sure you want to leave?". If confirmed, the upload is lost but the video stays in "processing" status for cleanup.

**Retry behavior:**

If the XHR fails (network timeout, S3 error, browser offline), the frontend shows an error message with a "Retry" button. Retrying is smart about which steps to repeat:

- If metadata was already created, we reuse the video ID (no duplicate records)
- We always request a new presigned URL because the old one may have expired
- We re-upload the entire blob (S3 doesn't support resumable single-part uploads)
- We complete as normal

The recorded Blob stays in Zustand's `recordedBlob` state until either the upload succeeds or the user clicks "Discard".

**The trade-off:** Keeping the recorded Blob in browser memory during the multi-step upload means 50-500MB of RAM is consumed. On a device with 8GB RAM, a 500MB recording consumes 6% of total memory just for the Blob. The alternative is streaming chunks to the server progressively during recording (tus protocol or WebSocket streaming), which frees memory as each chunk is transmitted. But progressive streaming requires a server-side reassembly pipeline, makes preview-before-upload impossible, and complicates pause/resume semantics. We choose the simpler model: record completely, preview, then upload. At typical recording sizes (50-200MB), this is acceptable on modern devices.

## 8. Rendering and Performance Strategy

> "Let me cover how the frontend stays responsive with potentially large video libraries."

**Video library rendering:** The VideoGrid uses CSS Grid with responsive columns: 1 column below 640px, 2 at 640-1024px, 3 at 1024px+. For a user with hundreds of videos, we paginate server-side (20 per page) rather than loading all videos and virtualizing. The API returns `{ videos, total, page, limit }`.

> "I chose pagination over infinite scroll because Loom's library is a reference/organization tool, not a feed. Users want to find specific videos by title or folder, not endlessly browse. Pagination with folder filtering and search covers this use case better than infinite scroll."

**Video playback initialization:** The VideoPage makes two parallel requests on mount: metadata and presigned download URL. The video element's `src` is set when the presigned URL resolves. HTML5 video with progressive download starts playback within 1-2 seconds.

**Comment loading strategy:** Comments load in a separate API call, independently from video metadata. The video starts playing while comments load. This ensures a video with 500 comments doesn't delay playback.

**Share page optimization:** The share route is the lightest page -- no auth check, no folder tree, no analytics, no edit controls. Single API call returns everything needed. Minimizes time-to-playback for shared links.

## 9. Client-Server Interaction

```
┌─────────┐                    ┌──────────┐                 ┌─────────┐
│ Browser │                    │ API      │                 │ MinIO   │
│         │                    │ Server   │                 │ (S3)    │
└────┬────┘                    └────┬─────┘                 └────┬────┘
     │                              │                            │
     │  POST /api/videos            │                            │
     │  { title, description }      │                            │
     │─────────────────────────────▶│                            │
     │  { video: { id, status } }   │                            │
     │◀─────────────────────────────│                            │
     │                              │                            │
     │  POST /api/upload/presigned  │                            │
     │  { videoId }                 │                            │
     │─────────────────────────────▶│  presignedPutObject()      │
     │  { uploadUrl, objectName }   │───────────────────────────▶│
     │◀─────────────────────────────│◀───────────────────────────│
     │                              │                            │
     │  PUT uploadUrl               │                            │
     │  [video blob via XHR]        │                            │
     │  [progress events every ~1s] │                            │
     │──────────────────────────────┼───────────────────────────▶│
     │  200 OK                      │                            │
     │◀─────────────────────────────┼────────────────────────────│
     │                              │                            │
     │  POST /api/upload/complete   │                            │
     │  { videoId, durationSeconds }│                            │
     │─────────────────────────────▶│  statObject() for size     │
     │  { video: { status: ready }} │───────────────────────────▶│
     │◀─────────────────────────────│◀───────────────────────────│
     │                              │                            │
```

> "Note the third step: the browser talks directly to MinIO, bypassing the API server entirely. This is the presigned URL pattern in action -- the API generates the authorization, but the heavy lifting (transferring video bytes) happens between the browser and object storage."

## 10. Accessibility Considerations

> "A video platform has specific accessibility needs."

**Video player:** Native `<video>` with `controls` provides built-in keyboard support (space for play/pause, arrows for seek) and screen reader announcements. Custom players must reimplement this -- native controls avoid regressions.

**Timestamp badges:** The `.timestamp-badge` class uses sufficient color contrast (brand purple on light background, WCAG AA compliant). If made clickable for seeking, they should be `<button>` elements with descriptive `aria-label`.

**Upload progress:** The UploadProgress component includes text alternatives (percentage number) for the visual SVG indicator. Should include `role="progressbar"` with `aria-valuenow`.

**Empty states:** EmptyState component includes descriptive text and an action button. Screen readers can understand the state and available action without visual context.

## 11. Trade-offs Summary

| Approach | Pros | Cons |
|----------|------|------|
| MediaRecorder with WebM | Zero server processing, instant recording, good compression | Limited Safari support, no post-recording editing |
| ❌ Server-side recording via streaming | Universal format, server controls quality | WebSocket/WebRTC infra required, recording latency |
| XHR for upload progress | Accurate byte-level progress, well-supported | Older API, more verbose, no built-in AbortController |
| ❌ Fetch API for upload | Modern syntax, cleaner code | No upload progress support whatsoever |
| Blob in memory until upload | Full preview before upload, simple mental model | High memory (50-500MB), may crash low-RAM devices |
| ❌ Stream during recording (tus) | Low memory, progressive upload | No preview possible, complex server reassembly |
| Paginated library (not virtualized) | Simple, predictable, bookmarkable | Page transitions disrupt browsing flow |
| ❌ Virtualized infinite scroll | Smooth continuous browsing | Complex scroll management, hard to bookmark |
| Native HTML5 video controls | Zero implementation effort, accessible, keyboard support | No custom branding, no speed control, limited styling |
| ❌ Custom player chrome | Full feature control, branded UX | 500+ lines of code, must reimplement a11y |
| Zustand for global state | Minimal API, TypeScript-friendly, no boilerplate | Less structured than Redux, no devtools time-travel |
| ❌ Redux Toolkit | Rich ecosystem, devtools, middleware | Boilerplate-heavy for a CRUD app with 2 stores |
| Comments in chronological order | Simple, predictable, no auto-scroll disruption | Time-anchored comments scattered in list |
| ❌ Timeline-synced comment sidebar | Comments appear at relevant moment | Fights user scrolling, ambiguous for general comments |
