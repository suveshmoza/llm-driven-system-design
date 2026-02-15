# Scale AI - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 1. Problem Statement (2 minutes)

"Design a crowdsourced data labeling platform where users contribute training data through a drawing game, administrators manage datasets and trigger model training, and ML engineers use trained models for inference."

This is a **backend-focused problem** requiring expertise in:
- High-throughput data ingestion pipelines
- Object storage for large binary data
- Message queues for async job processing
- Database schema for ML training metadata
- Model versioning and serving

---

## 2. Requirements Clarification (3 minutes)

### Functional Requirements
- Receive and store drawing submissions (stroke data)
- Manage dataset with quality scoring and flagging
- Trigger and monitor model training jobs
- Serve trained models for inference
- Track model versions and performance metrics

### Non-Functional Requirements
- **Throughput**: 10K concurrent users submitting drawings
- **Storage**: 10M+ drawings per month (100-500GB)
- **Training**: Jobs complete in hours, not days
- **Inference**: Sub-100ms latency for predictions
- **Reliability**: No data loss for submitted drawings

### Backend-Specific Clarifications
- "How to store drawings?" - Stroke JSON in object storage, metadata in PostgreSQL
- "Training orchestration?" - RabbitMQ for job queue, Python worker consumes
- "Model serving?" - Load models into memory, warm inference
- "Failure handling?" - Circuit breakers, idempotency keys, retry with backoff

---

## 3. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND LAYER                            │
│  Drawing Game (Canvas)  │  Admin Portal  │  Implementor Portal  │
└─────────────┬───────────┴───────┬────────┴──────────┬───────────┘
              │                   │                    │
              ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                   API GATEWAY / LOAD BALANCER                   │
└─────────────┬───────────────────┬────────────────────┬──────────┘
              │                   │                    │
              ▼                   ▼                    ▼
      ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
      │  Collection   │   │    Admin      │   │   Inference   │
      │   Service     │   │   Service     │   │    Service    │
      │    :3001      │   │    :3002      │   │     :3003     │
      └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
              │                   │                    │
              │                   ▼                    │
              │           ┌───────────────┐            │
              │           │   RabbitMQ    │            │
              │           │  (Job Queue)  │            │
              │           └───────┬───────┘            │
              │                   │                    │
              │                   ▼                    │
              │           ┌───────────────┐            │
              │           │   Training    │            │
              │           │    Worker     │            │
              │           │   (Python)    │            │
              │           └───────┬───────┘            │
              │                   │                    │
              ▼                   ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                               │
├─────────────────┬─────────────────────┬─────────────────────────┤
│   PostgreSQL    │   MinIO (S3)        │       Redis             │
│   (Metadata)    │   (Drawings/Models) │       (Cache)           │
└─────────────────┴─────────────────────┴─────────────────────────┘
```

### Service Responsibilities

| Service | Responsibility | Scaling Pattern |
|---------|---------------|-----------------|
| Collection | Ingest drawings, store stroke data | Horizontal (stateless) |
| Admin | Dataset management, trigger training | Single instance OK |
| Inference | Model loading, prediction serving | Horizontal + warm models |
| Training Worker | Consume jobs, train PyTorch models | Scale with GPU workers |

---

## 4. Deep Dives (25 minutes)

### Deep Dive 1: Drawing Ingestion Pipeline (8 minutes)

**Challenge**: Handle 10K concurrent users submitting drawings without data loss.

**Data Flow**:

```
User Canvas → Collection Service → MinIO (stroke JSON) + PostgreSQL (metadata)
```

**Drawing Data Format** (stored in MinIO):

Each drawing is a JSON object containing: an ID, the target shape name, canvas dimensions (width and height), an array of strokes (each with a points array containing x, y, pressure, and timestamp values, plus stroke color and width), total drawing duration in milliseconds, and device type (mouse, touch, or stylus).

**Why Stroke Data over Images**:
1. **Preserves information**: Temporal ordering, pressure, drawing speed
2. **Compact storage**: JSON is smaller than PNG for simple drawings
3. **Flexible rendering**: Generate any resolution at training time
4. **Future use cases**: Stroke-based models, animation generation

**Submission Handler with Reliability**:

The drawing submission endpoint follows these steps:

1. **Check idempotency** — if an `X-Idempotency-Key` header is present, look it up in Redis. If already processed, return the existing drawing ID with a "duplicate" status.
2. **Generate drawing ID** — create a UUID and construct the MinIO storage path as `drawings/{userId}/{drawingId}.json`.
3. **Upload to MinIO** — store the stroke JSON via a circuit breaker wrapper. If MinIO is down, the circuit breaker opens and returns 503 with Retry-After.
4. **Insert metadata** — write the drawing record to PostgreSQL with the ID, user, shape, storage path, and metadata.
5. **Update user stats** — increment the user's `total_drawings` counter (eventual consistency is acceptable here).
6. **Mark idempotency key** — store the drawing ID in Redis with a 1-hour TTL.
7. **Emit metric** — increment `drawings.submitted` counter with shape label.
8. **Return 201** with the drawing ID.

**Failure Handling**:

| Failure | Detection | Response |
|---------|-----------|----------|
| MinIO down | Circuit breaker opens | 503 with Retry-After |
| PostgreSQL down | Connection timeout | Queue in Redis (short-term) |
| Partial failure | MinIO OK, DB fails | Orphan cleanup job |

---

### Deep Dive 2: Training Job Pipeline (8 minutes)

**Challenge**: Decouple training from web requests, ensure jobs complete reliably.

**Job Flow**:

```
Admin triggers → PostgreSQL (job record) → RabbitMQ → Training Worker → Model saved to MinIO
```

**Job Creation with Idempotency**:

The training job creation endpoint:

1. **Hash the config** — compute a SHA-256 hash of the training configuration to use as a deduplication key
2. **Check for duplicates** — query for any pending, queued, or running job with the same config hash created in the last 24 hours. If found, return the existing job ID.
3. **Create job record** — insert into `training_jobs` with the config JSONB, config hash, and creator user ID
4. **Publish to RabbitMQ** — send the job ID and config to the `training_exchange` with routing key `training.new`, using persistent message delivery
5. **Update status to "queued"** — mark the job as queued after successful publish
6. **Return 201** with the job ID and status

**Training Worker (Python)**:

The Python training worker consumes jobs from RabbitMQ and processes them through these steps:

1. **Update status** to "running" in PostgreSQL
2. **Fetch drawings** from MinIO based on any config filters (shape type, quality score range, etc.)
3. **Preprocess** — render stroke data into 128x128 pixel images and extract shape labels
4. **Create PyTorch dataset** and data loader with batch size 32 and shuffling
5. **Train CNN model** — a ShapeClassifier with configurable epoch count (default 50), using Adam optimizer and cross-entropy loss. Progress is reported back to PostgreSQL after each epoch.
6. **Evaluate** — compute accuracy on a validation set
7. **Save model** — serialize model state dict to a temp file, upload to MinIO at `models/{jobId}/model.pt`
8. **Create model version record** in PostgreSQL with the job ID, model path, and accuracy
9. **Update job status** to "completed" with metrics, or "failed" with the error message if an exception occurs

The worker connects to RabbitMQ, declares the `training_jobs` queue as durable, and consumes messages with acknowledgment.

**Job Status Tracking**:

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **training_jobs** | id (UUID PK), status (enum: pending/queued/running/completed/failed), config (JSONB), config_hash (VARCHAR 64), progress (FLOAT), metrics (JSONB), error_message, model_path, started_at, completed_at, created_by (FK admin_users), created_at | — | Config hash enables deduplication of identical training requests |

---

### Deep Dive 3: Model Serving for Inference (5 minutes)

**Challenge**: Sub-100ms inference latency with model version management.

The model server maintains a single loaded model in memory. At startup (and on model activation), it:

1. Queries PostgreSQL for the active model (only one can be active, enforced by a unique partial index on `is_active = TRUE`)
2. Downloads the model file from MinIO to local disk if not already cached
3. Loads the model into TensorFlow.js for inference

**Classification flow**: Incoming stroke data is rendered to a 128x128 image tensor (using the same preprocessing as training), fed through the model, and the output probabilities are mapped to shape classes (line, circle, square, triangle, heart). The response includes the predicted shape, confidence score, model version, and inference latency.

**Model activation** is atomic: within a single transaction, the currently active model is deactivated and the new model is activated. The unique partial index ensures at most one active model at any time.

---

### Deep Dive 4: Circuit Breaker and Retry Patterns (4 minutes)

**Circuit Breaker Implementation**:

The circuit breaker tracks three states: closed (normal), open (failing fast), and half-open (testing recovery). It is configured with a failure threshold (default 5), and a reset timeout (default 30 seconds).

- In the **closed** state, operations pass through. If failures accumulate past the threshold, the breaker opens.
- In the **open** state, all operations are immediately rejected with a `CircuitOpenError`. After the reset timeout elapses, the breaker transitions to half-open.
- In the **half-open** state, the next operation is attempted. On success, the breaker closes. On failure, it reopens.

Each state transition emits a Prometheus gauge metric for monitoring. Separate breaker instances are created per dependency — for example, `minioCircuitBreaker` (threshold 5, 30s reset) and `dbCircuitBreaker` (threshold 3, 15s reset).

**Retry with Exponential Backoff**:

The retry wrapper attempts an operation up to `maxRetries` times. On each failure:

1. Calculate the delay as `initialDelayMs * 2^attempt`, capped at `maxDelayMs`
2. Add random jitter (up to 10% of the delay) to prevent thundering herd
3. Log a warning with the operation name, attempt number, and error message
4. Sleep for the delay plus jitter before retrying

If all attempts fail, the last error is thrown.

---

## 5. Database Schema (3 minutes)

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), session_id (unique), role (default 'user'), total_drawings (INT), created_at | — | Session-based identity for anonymous drawing game |
| **shapes** | id (SERIAL PK), name (unique), description, difficulty (INT) | — | Target shapes for the drawing game |
| **drawings** | id (UUID PK), user_id (FK users), shape_id (FK shapes), stroke_data_path (VARCHAR 500), metadata (JSONB), quality_score (FLOAT), is_flagged, created_at, deleted_at | shape_id; created_at DESC; quality_score WHERE NOT NULL | Soft delete via deleted_at; stroke data stored externally in MinIO |
| **models** | id (UUID PK), training_job_id (FK training_jobs), version, is_active, accuracy (FLOAT), model_path (VARCHAR 500), created_at | UNIQUE partial index on is_active WHERE TRUE | Ensures exactly one active model at a time |

---

## 6. Trade-offs Summary (2 minutes)

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| Stroke JSON over images | Preprocessing at training time | Preserves temporal data, smaller storage |
| MinIO over DB BLOB | Operational complexity | Designed for large files, S3-compatible |
| RabbitMQ over polling | Additional infrastructure | Reliable delivery, decouples services |
| Single active model | Can't A/B test easily | Simpler deployment, clear rollback |
| Soft deletes | Storage overhead | Audit trail, undo capability |

---

## 7. Future Enhancements

1. **Distributed Training**: Multi-GPU support with PyTorch DistributedDataParallel
2. **Active Learning**: Prioritize collecting underperforming shape classes
3. **Model A/B Testing**: Traffic splitting for model comparison
4. **Pre-signed URLs**: Direct-to-MinIO uploads for higher throughput
5. **Batch Inference**: Group predictions for efficiency
