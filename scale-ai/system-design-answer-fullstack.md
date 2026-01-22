# Scale AI - System Design Answer (Fullstack Focus)

*45-minute system design interview format - Fullstack Engineer Position*

## Problem Statement

Design a crowdsourced data labeling platform similar to Scale AI. The system enables users to contribute training data through a drawing game, administrators to manage datasets and trigger model training, and implementors to test trained models for shape recognition.

---

## Requirements Clarification (3 minutes)

### End-to-End Flows

1. **Drawing Collection Flow**: User draws shape on canvas, stroke data submitted to backend, stored in MinIO with metadata in PostgreSQL
2. **Training Flow**: Admin triggers training, job queued in RabbitMQ, worker processes drawings and saves model
3. **Inference Flow**: Implementor submits test drawing, inference service classifies using active model

### Integration Requirements

- Seamless handoff between canvas drawing and backend storage
- Real-time feedback on submission success/failure
- Session management for anonymous users
- Admin authentication with protected API routes
- Model hot-reloading without service restart

---

## High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React + Canvas)                          │
├────────────────────┬────────────────────────┬───────────────────────────────┤
│   Drawing Game     │    Admin Dashboard     │      Implementor Portal       │
│   (PostItCanvas)   │    (Session Auth)      │      (Model Testing)          │
└─────────┬──────────┴───────────┬────────────┴──────────────┬────────────────┘
          │                      │                            │
          │ POST /api/drawings   │ Session Cookie             │ POST /api/inference
          │ X-Idempotency-Key    │ Admin APIs                 │
          ▼                      ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
├─────────────────────┬────────────────────────┬──────────────────────────────┤
│  Collection Service │     Admin Service      │      Inference Service       │
│     (Port 3001)     │     (Port 3002)        │        (Port 3003)           │
│  • Idempotency MW   │  • Session Auth        │  • Model Loader              │
│  • Circuit Breakers │  • Training Job Queue  │  • Stroke-to-Image           │
│  • Retry Logic      │  • Drawing Management  │  • Prediction API            │
└─────────┬───────────┴──────────┬─────────────┴──────────────┬───────────────┘
          │                      │                             │
          │                      │ RabbitMQ                    │
          │                      ▼                             │
          │           ┌──────────────────┐                     │
          │           │  Training Worker │                     │
          │           │    (Python)      │                     │
          │           └────────┬─────────┘                     │
          │                    │                               │
          ▼                    ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                        │
├─────────────────────┬────────────────────────┬──────────────────────────────┤
│     PostgreSQL      │        MinIO           │          Redis               │
│   (Metadata)        │   (Stroke Data +       │    (Sessions + Cache)        │
│                     │    Trained Models)     │                              │
└─────────────────────┴────────────────────────┴──────────────────────────────┘
```

---

## Deep Dive 1: Drawing Submission Flow (10 minutes)

### End-to-End Sequence

```
┌─────────┐        ┌──────────────┐        ┌───────────────────┐
│ Canvas  │        │  Collection  │        │    PostgreSQL     │
│ (React) │        │   Service    │        │ + MinIO + Redis   │
└────┬────┘        └──────┬───────┘        └─────────┬─────────┘
     │                     │                          │
     │ User draws shape    │                          │
     │ (capture strokes)   │                          │
     │                     │                          │
     │ POST /api/drawings  │                          │
     │ X-Idempotency-Key   │                          │
     │ {strokeData}        │                          │
     │────────────────────>│                          │
     │                     │                          │
     │                     │ Check idempotency (Redis)│
     │                     │─────────────────────────>│
     │                     │                          │
     │                     │ If duplicate, return     │
     │                     │<─────────────────────────│
     │                     │                          │
     │                     │ Upload strokes (MinIO)   │
     │                     │─────────────────────────>│
     │                     │                          │
     │                     │ Insert metadata (PG)     │
     │                     │─────────────────────────>│
     │                     │                          │
     │                     │ Mark processed (Redis)   │
     │                     │─────────────────────────>│
     │                     │                          │
     │ 201 Created         │                          │
     │ {drawingId, next}   │                          │
     │<────────────────────│                          │
     │                     │                          │
     │ Show success +      │                          │
     │ next shape prompt   │                          │
     └─────────────────────┴──────────────────────────┘
```

### Frontend: Stroke Capture and Submission

**useDrawingSubmit Hook** manages submission state (idle | submitting | success | error) and handles:
- Generate client-side idempotency key: `{sessionId}:{shapeId}:{timestamp}`
- POST to /api/drawings with headers X-Idempotency-Key, X-Session-Id
- Body includes shapeId, strokeData (canvas dimensions, strokes array, duration, device type)
- On success: store drawingId and nextShape for UI
- On error: display error message

### Backend: Idempotency Middleware

**Flow:**
1. Extract X-Idempotency-Key from headers
2. Check Redis for cached response: `idem:{prefix}:{key}`
3. If found: return cached response immediately
4. If not found: acquire lock with NX (prevent race conditions)
5. If lock fails: return 409 Conflict
6. Wrap res.json to cache response before sending
7. Continue to route handler

### API Contract: Drawing Submission

**Request:**
```
POST /api/drawings
Headers: X-Idempotency-Key, X-Session-Id, Content-Type: application/json
Body: { shapeId, strokeData: { canvas, strokes, duration_ms, device } }
```

**Responses:**
| Status | Description | Body |
|--------|-------------|------|
| 201 Created | Success | `{ id, shape, qualityScore, nextShape, userStats }` |
| 201 Created | Already processed (idempotent) | `{ id, message: "Drawing already submitted" }` |
| 400 Bad Request | Validation error | `{ error, details: [{ field, message }] }` |
| 503 Service Unavailable | Storage down | `{ error, retryAfter }` + Retry-After header |

---

## Deep Dive 2: Admin Authentication and Training Flow (10 minutes)

### Session Management Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        Admin Authentication Flow                           │
└───────────────────────────────────────────────────────────────────────────┘

  ┌─────────────┐        ┌───────────────┐        ┌─────────────────────────┐
  │ Admin Login │        │ Admin Service │        │ Redis (Sessions) + PG   │
  │  (React)    │        │  (Express)    │        │   (Admin Users)         │
  └──────┬──────┘        └───────┬───────┘        └───────────┬─────────────┘
         │                       │                            │
         │ POST /api/admin/login │                            │
         │ {email, password}     │                            │
         │──────────────────────>│                            │
         │                       │                            │
         │                       │ Lookup admin by email      │
         │                       │───────────────────────────>│ (PostgreSQL)
         │                       │                            │
         │                       │ Verify bcrypt hash         │
         │                       │                            │
         │                       │ Create session in Redis    │
         │                       │───────────────────────────>│ (Redis)
         │                       │ Key: session:<uuid>        │
         │                       │ TTL: 24 hours              │
         │                       │                            │
         │ 200 OK                │                            │
         │ Set-Cookie: sid=<uuid>│                            │
         │ {admin: {name, email}}│                            │
         │<──────────────────────│                            │
         │                       │                            │
         │ Subsequent requests   │                            │
         │ Cookie: sid=<uuid>    │                            │
         │──────────────────────>│                            │
         │                       │                            │
         │                       │ Validate + refresh session │
         │                       │───────────────────────────>│ (Redis)
         │                       │                            │
         │                       │ Attach admin to req        │
         │                       │                            │
         └───────────────────────┴────────────────────────────┘
```

### Frontend: Admin Session Hook

**useAdminAuth Hook** provides:
- State: isAuthenticated, admin, isLoading, error
- Actions: login(email, password), logout(), checkSession()
- Auto-check session on mount with credentials: 'include'
- Store admin info (id, name, email) on successful login

### Backend: Session Middleware

**Login Flow:**
1. Query admin_users by email
2. Verify password with bcrypt.compare()
3. Generate UUID for session
4. Store session in Redis with 24h TTL: `session:{uuid}` -> { adminId, email, name, createdAt }
5. Return session cookie + admin info

**requireAdmin Middleware:**
1. Extract sid from cookies
2. If missing: 401 "Authentication required"
3. Lookup session in Redis
4. If expired/missing: 401 "Session expired"
5. Attach admin to req, refresh TTL
6. Continue to route handler

### Training Job Trigger Flow

**POST /admin/training/start** (protected by requireAdmin):
1. Generate config hash (SHA256, first 16 chars) for idempotency
2. Check for existing pending/running job with same hash (within 24h)
3. If exists: return existing job info (status 200)
4. Create new training_jobs row with status "pending"
5. Publish to RabbitMQ
6. Update status to "queued"
7. Return job info (status 201)

---

## Deep Dive 3: Inference Integration (10 minutes)

### Model Loading and Hot-Reload

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ModelManager                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  State:                                                                      │
│   • currentModel: LoadedModel | null                                        │
│   • modelPath: string | null                                                │
│   • checkInterval: Timer (30s)                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Methods:                                                                    │
│   • initialize() ─── loadActiveModel() + start interval                     │
│   • loadActiveModel() ─── query DB → download from MinIO → load             │
│   • checkForUpdates() ─── compare model_path, reload if changed             │
│   • predict(strokeData) ─── render to image → run model                     │
│   • getModelInfo() ─── return { id, version, accuracy }                     │
│   • shutdown() ─── clear interval                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Hot-Reload Strategy:**
- Poll database every 30 seconds for active model
- Compare model_path with currently loaded
- If different: download new model from MinIO, replace in memory
- No service restart required

### Frontend: Implementor Portal Integration

**PredictionState:**
- isLoading, result, error, modelInfo

**Flow:**
1. Fetch model info on mount (GET /api/inference/model/info)
2. Display model version and accuracy badge
3. On drawing complete: POST stroke data to /api/inference/classify
4. Display: main prediction with confidence bar, all predictions list, stroke thumbnail

**PredictionDisplay Component:**
- Main prediction: shape icon + name + confidence percentage bar
- All predictions: mini bars for each shape with percentage
- Stroke preview: thumbnail of user's drawing

### API Contract: Inference Endpoints

**GET /api/inference/model/info**

| Status | Description | Body |
|--------|-------------|------|
| 200 OK | Model loaded | `{ id, version, accuracy, loadedAt }` |
| 503 Service Unavailable | No model | `{ error: "No model loaded" }` |

**POST /api/inference/classify**

**Request:** `{ strokeData: { canvas, strokes, duration_ms, device } }`

| Status | Description | Body |
|--------|-------------|------|
| 200 OK | Success | `{ shape, confidence, allPredictions[], inferenceTimeMs, modelVersion }` |
| 400 Bad Request | Invalid input | `{ error, details }` |
| 503 Service Unavailable | Model not ready | `{ error, retryAfter }` + Retry-After header |

---

## Deep Dive 4: Error Handling Strategy (5 minutes)

### Unified Error Response Format

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AppError Hierarchy                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  AppError (base)                                                             │
│   • statusCode: number                                                       │
│   • code: string (e.g., "VALIDATION_ERROR")                                 │
│   • message: string                                                          │
│   • details?: unknown                                                        │
│   • retryable: boolean                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ValidationError extends AppError                                            │
│   statusCode: 400, code: "VALIDATION_ERROR", retryable: false               │
├─────────────────────────────────────────────────────────────────────────────┤
│  AuthenticationError extends AppError                                        │
│   statusCode: 401, code: "AUTH_ERROR", retryable: false                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ServiceUnavailableError extends AppError                                    │
│   statusCode: 503, code: "SERVICE_UNAVAILABLE", retryable: true             │
│   details: { retryAfter: number }                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Error Handler Middleware

1. Check if error is AppError instance
2. If AppError: log warning, build response with error/message/requestId/details
3. If retryable: set Retry-After header
4. If unexpected: log full error, return 500 with generic message

### Frontend: Error Display Component

- Alert icon + error message
- Retry button (only if retryable and onRetry provided)
- ARIA: `role="alert"`, `aria-live="polite"`

---

## Trade-offs Summary

| Decision | Choice | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Session storage | Redis with cookies | JWT tokens | Revocation support, server-controlled expiry, simpler CSRF protection |
| Idempotency | Redis with TTL | Database table | Faster lookups, automatic expiry, no cleanup needed |
| Model loading | Hot-reload with polling | Webhook notification | Simpler implementation, acceptable 30s delay for model updates |
| Error format | Structured with codes | HTTP status only | Better client-side handling, internationalization support |
| Stroke format | JSON with all metadata | Rendered images | Preserves temporal data, flexible training preprocessing |

---

## Future Enhancements

1. **WebSocket for Training Progress**: Real-time training job updates instead of polling
2. **Pre-signed Upload URLs**: Direct browser-to-MinIO upload for large drawings
3. **Client-side Model**: TensorFlow.js for instant browser-based inference
4. **A/B Testing Framework**: Compare model versions with statistical significance
5. **Collaborative Drawing**: Multiple users contributing to single complex drawing
