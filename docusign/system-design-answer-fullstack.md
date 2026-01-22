# DocuSign - System Design Answer (Fullstack Focus)

## 45-minute system design interview format - Fullstack Engineer Position

---

## 📋 Introduction (2 minutes)

"Thank you for the opportunity. Today I'll design DocuSign, an electronic signature platform, with emphasis on fullstack integration. This system is fascinating because it requires:

1. Seamless frontend-backend coordination for document workflows
2. Real-time state synchronization during signing ceremonies
3. End-to-end type safety from database to UI
4. Legal compliance requiring audit trails across the stack

The fullstack challenges include building consistent data models, handling optimistic updates, and ensuring the frontend accurately reflects backend state transitions.

Let me clarify the requirements."

---

## 🎯 Requirements Clarification (4 minutes)

### Cross-Stack Requirements

"From a fullstack perspective, we need:

1. **Shared Types**: TypeScript definitions used by both frontend and backend
2. **API Contracts**: Well-defined endpoints with request/response schemas
3. **State Synchronization**: Envelope status updates reflected in real-time
4. **Error Handling**: Consistent error format across the stack
5. **Validation**: Zod schemas shared between frontend forms and backend APIs

The key integration points are:
- Document upload with progress tracking
- Field placement with immediate persistence
- Signature capture with optimistic updates
- Audit trail display with chain verification"

### Non-Functional Requirements

"For fullstack implementation:

- **Type Safety**: End-to-end TypeScript coverage
- **Consistency**: Single source of truth for data models
- **Latency**: Sub-100ms API response times for UI operations
- **Reliability**: Graceful degradation when backend is slow/unavailable"

---

## 🏗️ Shared Type Definitions (8 minutes)

### Core Types

"I'm choosing to share TypeScript types and Zod schemas between frontend and backend. This ensures consistency and provides both compile-time and runtime validation."

**Envelope Status State Machine:**
- `draft` -> `sent`, `voided`
- `sent` -> `delivered`, `voided`
- `delivered` -> `signed`, `declined`, `voided`
- `signed` -> `completed`
- Terminal states: `declined`, `voided`, `completed`

**Core Entities:**
- **Envelope**: Central aggregate with id, senderId, name, status, authenticationLevel, expirationDate
- **Recipient**: Assigned to envelope with name, email, role (signer/cc/in_person), routingOrder, accessToken
- **Document**: PDF file with id, envelopeId, name, pageCount, url, processing status
- **DocumentField**: Placed on document with type (signature/initial/date/text/checkbox), position (x, y, width, height), recipientId
- **Signature**: Captured record with type (draw/typed/upload), url, recipientId, fieldId
- **AuditEvent**: Hash-chained log with eventType, data, timestamp, actor, previousHash, hash

### Validation Schemas

Zod schemas provide dual-use validation for frontend forms and backend API:

- **createEnvelopeSchema**: name (required, max 200), authenticationLevel, expirationDate
- **addRecipientSchema**: name, email (valid format), role, routingOrder
- **addFieldSchema**: recipientId, type, pageNumber, position (x, y as percentages), dimensions
- **captureSignatureSchema**: type, imageData (base64)

### API Response Types

Standard response wrapper with success flag, data payload, and structured error (code, message, details).
Paginated responses include items array with total, page, pageSize, hasMore.

---

## 🔍 Backend Implementation (10 minutes)

### Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                           Backend Services                                     │
├───────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐              │
│  │  Express API    │──▶│ Workflow Engine │──▶│ Audit Logger    │              │
│  │  (Routes)       │   │ (State Machine) │   │ (Hash Chain)    │              │
│  └────────┬────────┘   └────────┬────────┘   └─────────────────┘              │
│           │                     │                                              │
│  ┌────────▼────────┐   ┌────────▼────────┐   ┌─────────────────┐              │
│  │  Signature Svc  │──▶│ Queue Publisher │──▶│ Notification    │              │
│  │  (Capture)      │   │ (RabbitMQ)      │   │ Worker          │              │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘              │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Express Route Handler

Routes validate requests using Zod schemas, returning structured errors for validation failures.

**POST /api/v1/envelopes**: Create envelope with user session, log audit event
**GET /api/v1/envelopes/:id**: Fetch envelope with recipients and documents (includes fields)
**POST /api/v1/envelopes/:id/recipients**: Add recipient with generated access token

All routes follow consistent patterns: parse with Zod, handle errors uniformly, log audit events.

### Workflow Engine

"I'm implementing a state machine that enforces valid transitions and handles side effects."

**Key Methods:**
- `transitionState()`: Validates transition allowed, uses FOR UPDATE lock, stores idempotency key
- `sendEnvelope()`: Validates completeness, transitions to 'sent', queues notifications for first recipients
- `getNextRecipients()`: Returns pending recipients at lowest routing order
- `completeRecipient()`: Marks done, checks siblings at same order, triggers next recipients or completes envelope
- `completeEnvelope()`: Transitions to 'completed', queues PDF and certificate generation

**Validation Before Send:**
- At least one recipient required
- At least one ready document required
- All signers must have assigned fields

### Signature Capture Service

"I'm implementing idempotent signature capture with comprehensive audit logging."

**Capture Flow:**
1. Validate access token and get recipient
2. Check idempotency key (sig:{fieldId}:{recipientId})
3. BEGIN transaction, lock field with FOR UPDATE
4. Validate field ownership and not already signed
5. Upload signature image to MinIO
6. Create signature record, mark field completed
7. COMMIT, store idempotency result
8. Log detailed audit event (IP, user agent, timestamp)
9. Check if recipient has completed all required fields

---

## 📊 Frontend Integration (10 minutes)

### Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          React Application                                     │
├───────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐              │
│  │  TanStack       │──▶│  Zustand        │──▶│  Components     │              │
│  │  Router         │   │  Stores         │   │  (UI)           │              │
│  └─────────────────┘   └────────┬────────┘   └─────────────────┘              │
│                                 │                                              │
│  ┌─────────────────┐   ┌────────▼────────┐   ┌─────────────────┐              │
│  │  API Client     │◀──│  React Query    │──▶│  Form           │              │
│  │  (Typed)        │   │  (Cache)        │   │  Validation     │              │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘              │
└───────────────────────────────────────────────────────────────────────────────┘
```

### API Client

Typed client wrapping fetch with credentials, consistent headers, and error handling.

**Envelope Operations:**
- createEnvelope, getEnvelope, listEnvelopes, sendEnvelope

**Recipient Operations:**
- addRecipient, removeRecipient

**Document Operations:**
- uploadDocument (FormData with progress tracking)

**Field Operations:**
- addField, removeField

**Signing Operations:**
- getSigningSession, captureSignature, completeSigningSession

**Audit Operations:**
- getAuditTrail (with chain verification status)

### Zustand Store with API Integration

"I'm using Zustand for state management with optimistic updates and rollback on error."

**State Shape:**
- currentEnvelope, isLoading, error, validationErrors

**Actions with Optimistic Updates:**
- `addRecipient`: Update state on success, set validation errors on failure
- `removeRecipient`: Optimistic delete, rollback on error
- `addField`: Update document fields on success
- `removeField`: Optimistic delete with rollback
- `sendEnvelope`: Set loading, update on success

### Audit Trail Component

"The audit tab displays the hash chain with verification status and event timeline."

**Display Elements:**
- Verification banner (green for valid, red for integrity failure)
- Timestamp of last verification
- Event timeline with vertical line connecting dots
- Each event shows type, timestamp, actor
- Expandable details section with JSON data
- Truncated hash preview for each event

---

## ⚖️ End-to-End Data Flow (5 minutes)

### Signature Capture Flow

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        Signature Capture Flow                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  Frontend                    Backend                          Storage         │
│  ────────                    ───────                          ───────         │
│                                                                                │
│  1. User clicks field                                                          │
│     └──▶ SignatureModal opens                                                  │
│                                                                                │
│  2. User draws/types signature                                                 │
│     └──▶ Canvas captures image                                                 │
│                                                                                │
│  3. User confirms                                                              │
│     └──▶ Convert to base64                                                     │
│                                                                                │
│  4. Submit to API ────────────▶ captureSignature()                            │
│                                 ├──▶ Validate access token                     │
│                                 ├──▶ Check idempotency                         │
│                                 ├──▶ Lock field (FOR UPDATE)                   │
│                                 ├──▶ Validate ownership                        │
│                                 ├──▶ Upload image ──────────▶ MinIO           │
│                                 ├──▶ Create signature record                   │
│                                 ├──▶ Mark field completed                      │
│                                 ├──▶ Log audit event                           │
│                                 └──▶ Check recipient completion                │
│                                                                                │
│  5. Receive response ◀────────────┘                                           │
│     ├──▶ Update UI state                                                       │
│     └──▶ Navigate to next field                                                │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Envelope Lifecycle Flow

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        Envelope Lifecycle Flow                                 │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  Sender                      System                         Recipient          │
│  ──────                      ──────                         ─────────          │
│                                                                                │
│  Create envelope ────────▶ Store in database                                   │
│        │                                                                       │
│  Upload document ────────▶ Validate PDF, generate pages                        │
│        │                                                                       │
│  Add recipients ─────────▶ Store with routing order                            │
│        │                                                                       │
│  Place fields on PDF                                                           │
│        │                                                                       │
│  Send envelope ──────────▶ Validate envelope                                   │
│                            ├──▶ Transition to 'sent'                           │
│                            └──▶ Queue notifications ────────▶ Receive email    │
│                                                                    │           │
│                                                              Click link        │
│                                                                    │           │
│                                                              Load session      │
│                                                                    │           │
│                                                              Sign fields       │
│                                                                    │           │
│                            Recipient completed ◀──────────── Complete signing  │
│                                 │                                              │
│                            Check all recipients                                │
│                                 │                                              │
│                       ┌─────────┴─────────┐                                    │
│                       │ All done?         │                                    │
│                       ├── No ──▶ Notify next recipient                         │
│                       └── Yes ──▶ Complete envelope                            │
│                                   ├──▶ Generate signed PDF                     │
│                                   └──▶ Generate certificate                    │
│                                                                                │
│  Receive completion ◀────────────── Send completion emails                     │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Testing Strategy (3 minutes)

### Integration Testing (Backend)

**Signing API Tests:**
- GET /api/v1/signing/:accessToken: Returns session for valid token, 404 for invalid
- POST /api/v1/signing/:accessToken/fields/:fieldId/sign: Captures successfully, is idempotent for duplicates, rejects invalid types

**Mocking Strategy:**
- Mock storage.uploadSignature to return predictable path
- Use test fixtures for envelope, recipient, document, field setup
- Clean up test data after each suite

### Frontend Component Testing

**SignatureModal Tests:**
- Renders draw and type tabs
- Switches between modes correctly
- Calls onConfirm with typed signature data (base64)
- Calls onClose when cancel clicked

---

## 📝 Trade-offs and Alternatives

| Decision | ✅ Chosen | ❌ Alternative | Rationale |
|----------|-----------|----------------|-----------|
| Shared Types | TypeScript + Zod | OpenAPI/GraphQL | Simpler setup, runtime validation |
| State Sync | Zustand + React Query | Redux + RTK Query | Less boilerplate, adequate for scope |
| API Style | REST | GraphQL | Simpler for document-centric operations |
| Optimistic Updates | Selective | Full | Safer for legal document operations |
| Error Handling | Typed ApiError | Generic errors | Better developer experience |

---

## Summary

"To summarize the fullstack architecture for DocuSign:

1. **Shared Types**: TypeScript definitions and Zod schemas used by both frontend and backend
2. **Backend Services**: Workflow engine with state machine, signature capture with idempotency
3. **Frontend Integration**: Typed API client with Zustand stores for state management
4. **End-to-End Flow**: Document from signature capture through workflow completion
5. **Testing Strategy**: Integration tests for APIs, component tests for UI

The design prioritizes type safety and consistency across the stack while maintaining clear separation of concerns between frontend and backend responsibilities.

What aspects would you like me to elaborate on?"
