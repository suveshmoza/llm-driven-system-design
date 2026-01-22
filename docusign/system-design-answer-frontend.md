# DocuSign - System Design Answer (Frontend Focus)

## 45-minute system design interview format - Frontend Engineer Position

---

## Introduction (2 minutes)

"Thank you for the opportunity. Today I'll design DocuSign, an electronic signature platform, with emphasis on the frontend architecture. This system is fascinating from a frontend perspective because it combines:

1. Complex document rendering with interactive overlays
2. Multi-step workflow UX with clear state communication
3. Signature capture using canvas APIs
4. Legal compliance requiring precise audit trail display

The frontend challenges include building a responsive PDF viewer with draggable field placement, a smooth signing ceremony experience, and accessible interfaces that work across devices.

Let me clarify the requirements."

---

## Requirements Clarification (4 minutes)

### User-Facing Requirements

"From a frontend perspective, we need to support:

1. **Document Preparation UI**: Upload PDFs, view pages, drag-and-drop field placement
2. **Recipient Management**: Add signers with routing order (serial/parallel)
3. **Signing Ceremony**: Step-by-step guided experience with signature capture
4. **Progress Tracking**: Visual indicators for envelope status and field completion
5. **Audit Trail Display**: Chronological event history with verification status

Two distinct user personas drive the design:
- **Senders**: Complex preparation UI with field placement tools
- **Signers**: Simple, focused signing experience without distractions"

### Frontend-Specific Non-Functional Requirements

"For the frontend specifically:

- **Performance**: PDF rendering under 2 seconds for typical documents
- **Accessibility**: WCAG 2.1 AA compliance for signing ceremony
- **Responsiveness**: Tablet-friendly signing (mobile is stretch goal)
- **Browser Support**: Modern browsers (Chrome, Firefox, Safari, Edge)
- **Offline Tolerance**: Graceful handling of network interruptions during signing"

---

## Component Architecture (10 minutes)

### High-Level Component Organization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Frontend Architecture                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │    Components   │  │     Routes      │  │          Services           │  │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────────────────┤  │
│  │ common/         │  │ envelopes/      │  │ api.ts (HTTP + auth)        │  │
│  │ ├─StatusBadge   │  │ ├─index         │  └─────────────────────────────┘  │
│  │ ├─LoadingSpinner│  │ ├─new           │  ┌─────────────────────────────┐  │
│  │ └─MessageBanner │  │ └─$envelopeId   │  │          Stores             │  │
│  │                 │  │                 │  ├─────────────────────────────┤  │
│  │ envelope/       │  │ sign/           │  │ authStore (user, login)     │  │
│  │ ├─DocumentsTab  │  │ └─$accessToken  │  │ envelopeStore (CRUD ops)    │  │
│  │ ├─RecipientsTab │  │                 │  └─────────────────────────────┘  │
│  │ ├─FieldsTab     │  │                 │                                   │
│  │ ├─FieldsSidebar │  │                 │                                   │
│  │ ├─PdfViewer     │  │                 │                                   │
│  │ └─AuditTab      │  │                 │                                   │
│  │                 │  │                 │                                   │
│  │ signing/        │  │                 │                                   │
│  │ ├─SigningHeader │  │                 │                                   │
│  │ ├─SigningSidebar│  │                 │                                   │
│  │ ├─SigningPdfViewer                   │                                   │
│  │ └─SignatureModal│  │                 │                                   │
│  └─────────────────┘  └─────────────────┘                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Common Components

"The common components provide consistent UI patterns across the application."

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Common UI Components                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  StatusBadge:                                                               │
│  ├─ Props: status (draft|sent|delivered|signed|completed|declined|voided)  │
│  ├─ Color mapping: draft→gray, sent→blue, delivered→yellow, signed→green   │
│  └─ Output: <span> with color class + capitalized status                   │
│                                                                             │
│  LoadingSpinner:                                                            │
│  ├─ Props: size (sm|md|lg), centered (boolean), message (string)           │
│  ├─ Size mapping: sm→h-4, md→h-8, lg→h-12                                  │
│  └─ Accessibility: role="status", aria-live="polite", sr-only label        │
│                                                                             │
│  MessageBanner:                                                             │
│  ├─ Props: type (error|success|info|warning), message, onDismiss?          │
│  ├─ Style mapping: error→red, success→green, info→blue, warning→yellow     │
│  └─ Accessibility: role="alert" for errors, role="status" for others       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## PDF Rendering and Field Placement (10 minutes)

### PDF Viewer Component

"PDF rendering is critical for the document preparation experience. We use react-pdf (PDF.js wrapper) for consistent cross-browser rendering."

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PdfViewer Component                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Props: documentUrl, currentPage, onPageChange, fields, onFieldClick,       │
│         onPageClick, selectedRecipientId                                    │
│                                                                             │
│  State: numPages (from PDF load), pageWidth (responsive, max 700px)         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Render Structure                                │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  ┌─ Page Navigation ────────────────────────────────────────────┐   │   │
│  │  │  [Previous] Page {n} of {total} (aria-live) [Next]           │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                                 │                                   │   │
│  │  ┌─ PDF Container (relative, click handler) ────────────────────┐   │   │
│  │  │  <Document> file={url} loading=<Spinner> error=<Banner>      │   │   │
│  │  │    └─ <Page> pageNumber={n} width={w}                        │   │   │
│  │  │                                                              │   │   │
│  │  │  ┌─ Field Overlays (absolute positioned) ─────────────────┐  │   │   │
│  │  │  │  fields.map(f => <FieldOverlay field={f} />)           │  │   │   │
│  │  │  └────────────────────────────────────────────────────────┘  │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                                                                     │   │
│  │  Click Handler: Calculate (x, y) as percentage of page dimensions  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Field Overlay Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FieldOverlay Component                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Props: field, onClick?, isHighlighted?, isCompleted?                       │
│                                                                             │
│  Field Type Icons: signature→Pen, initial→"I", date→Calendar,              │
│                    text→Text, checkbox→Check                                │
│                                                                             │
│  State Styles:                                                              │
│  ├─ isCompleted   → bg-green-100 border-green-500                           │
│  ├─ isHighlighted → bg-yellow-100 border-yellow-500                         │
│  └─ default       → bg-blue-50 border-blue-300 hover:border-blue-500        │
│                                                                             │
│  Positioning: style={{ left: field.x%, top: field.y%,                      │
│                        width: field.width%, height: field.height% }}        │
│                                                                             │
│  Content: If completed → CheckIcon, else → fieldTypeIcon                    │
│  Accessibility: aria-label with field type and completion status            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Field Placement Sidebar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       FieldsSidebar Component                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Props: recipients, selectedRecipientId, onRecipientSelect,                 │
│         selectedFieldType, onFieldTypeSelect                                │
│                                                                             │
│  ┌─ Section: Assign to Recipient ────────────────────────────────────────┐ │
│  │  recipients.map(r => <button aria-pressed>{r.name} {r.email}</button>)│ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Section: Field Type (grid) ──────────────────────────────────────────┐ │
│  │  Types: signature, initial, date, text, checkbox                      │ │
│  │  <button disabled={!selectedRecipientId}> icon + label </button>      │ │
│  │  If !selectedRecipientId: "Select a recipient first"                  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Instructions (if recipient + fieldType selected) ────────────────────┐ │
│  │  "Click on the document to place a {type} field for {name}"           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Signature Capture Modal (8 minutes)

"The signature modal provides draw and type modes for capturing signatures. Canvas-based drawing ensures consistent output across browsers."

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SignatureModal Component                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Props: isOpen, onClose, onConfirm({ type, imageData }), fieldType          │
│  State: mode ('draw'|'type'), typedText, canvasRef, signaturePadRef         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Modal: fixed inset-0 bg-black/50, role="dialog" aria-modal="true"  │   │
│  │                                                                     │   │
│  │  ┌─ Header ───────────────────────────────────────────────────────┐ │   │
│  │  │  "Add Your Signature/Initials"  [X Close]                      │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  ┌─ Mode Tabs ────────────────────────────────────────────────────┐ │   │
│  │  │  [Draw] role="tab" aria-selected  [Type] role="tab"            │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  ┌─ Draw Mode ────────────────────────────────────────────────────┐ │   │
│  │  │  <canvas> 400x150, signature_pad library, cursor-crosshair     │ │   │
│  │  │  aria-label="Draw your signature here"                         │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  ┌─ Type Mode ────────────────────────────────────────────────────┐ │   │
│  │  │  <input> "Type your name"                                      │ │   │
│  │  │  <canvas> preview with "Dancing Script" font, centered         │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                     │   │
│  │  ┌─ Actions ──────────────────────────────────────────────────────┐ │   │
│  │  │  [Clear] [Cancel] [Confirm]                                    │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Confirm: Draw → signaturePad.toDataURL('image/png'), validate !isEmpty()   │
│           Type → typedCanvas.toDataURL('image/png'), validate text.trim()   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Signing Ceremony Page (8 minutes)

### Signing Page Route

"The signing page provides a focused, guided experience for signers."

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Signing Page Route: /sign/$accessToken                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Data: useQuery('signing-session') → { envelope, recipient, document,       │
│         fields }                                                            │
│  Loading → <SigningLoadingState>    Error → <SigningErrorState>             │
│                                                                             │
│  Mutations:                                                                 │
│  ├─ signMutation: captureSignature(accessToken, fieldId, data) → refetch   │
│  └─ completeMutation: completeSession(accessToken) → navigate to done      │
│                                                                             │
│  Computed:                                                                  │
│  ├─ myFields = fields.filter(f.recipientId === recipient.id)                │
│  ├─ completedCount = myFields.filter(f.completed).length                    │
│  ├─ totalRequired = myFields.filter(f.required).length                      │
│  └─ allComplete = completedCount >= totalRequired                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SigningHeader: documentName, progress, [Finish] canFinish=allComplete│  │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  ┌──────────────┬────────────────────────────────────────────────┐  │   │
│  │  │SigningSidebar│                 <main>                         │  │   │
│  │  │              │           SigningPdfViewer                     │  │   │
│  │  │ - Field list │           - documentUrl                        │  │   │
│  │  │ - Progress   │           - fields (myFields)                  │  │   │
│  │  │ - Checklist  │           - onFieldClick                       │  │   │
│  │  └──────────────┴────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  <SignatureModal> isOpen, onConfirm={handleSignatureConfirm}                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Signing Sidebar Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SigningSidebar Component                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Props: fields, currentPage, onFieldSelect, completedCount, totalCount      │
│                                                                             │
│  ┌─ Progress Section ────────────────────────────────────────────────────┐ │
│  │  "Your Progress" {completedCount} of {totalCount}                     │ │
│  │  <div role="progressbar" aria-valuenow/min/max>                       │ │
│  │    width: (completedCount/totalCount) * 100%                          │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Required Fields List ────────────────────────────────────────────────┐ │
│  │  <ul role="list">                                                     │ │
│  │    requiredFields.map((f, i) =>                                       │ │
│  │      <button onClick={onFieldSelect}>                                 │ │
│  │        [Circle: index or checkmark] Field Type, Page {n}              │ │
│  │      </button>                                                        │ │
│  │    )                                                                  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Optional Fields (if any) ────────────────────────────────────────────┐ │
│  │  Similar structure with different styling                             │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Instructions: "Click on highlighted fields or select from list above."    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## State Management (5 minutes)

### Zustand Stores

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Zustand Store Architecture                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  authStore:                                                                 │
│  ├─ State: user, token, isAuthenticated                                     │
│  ├─ Actions: login(email, password), logout()                               │
│  └─ Middleware: persist to localStorage (token + user only)                 │
│                                                                             │
│  envelopeStore:                                                             │
│  ├─ State: currentEnvelope, isLoading, error                                │
│  └─ Actions:                                                                │
│     ├─ fetchEnvelope(id) → set isLoading, fetch, set envelope/error         │
│     ├─ updateEnvelope(updates) → api.update, merge into currentEnvelope     │
│     ├─ addRecipient(r) → api.add, push to recipients                        │
│     ├─ removeRecipient(id) → api.remove, filter from recipients             │
│     ├─ addField(f) → api.add, push to documents[0].fields                   │
│     ├─ removeField(id) → api.remove, filter from all documents              │
│     ├─ sendEnvelope() → api.send, set status='sent'                         │
│     └─ clearEnvelope() → reset to null                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Accessibility Considerations (3 minutes)

"Accessibility is critical for signing ceremonies - legal documents must be signable by everyone."

### Key Accessibility Features

1. **Keyboard Navigation**: All interactive elements focusable and operable via keyboard
2. **Screen Reader Support**: ARIA labels, live regions for status updates
3. **Focus Management**: Modal trapping, focus return after modal close
4. **Color Contrast**: WCAG AA compliant color combinations
5. **Error Messaging**: Clear, descriptive error messages linked to inputs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Accessible Field Pattern                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Props: id, label, error?, required?, children                              │
│                                                                             │
│  <div>                                                                      │
│    <label htmlFor={id}>                                                     │
│      {label}                                                                │
│      If required: <span aria-hidden>*</span> <span sr-only>(required)</span>│
│    </label>                                                                 │
│    {children}  <!-- input with id={id}, aria-describedby="{id}-error" -->   │
│    If error: <p id="{id}-error" role="alert">{error}</p>                    │
│  </div>                                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Trade-offs and Alternatives (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| PDF Rendering | react-pdf | PDF.js direct | Simpler React integration |
| Signature Capture | signature_pad | Fabric.js | Lightweight, purpose-built |
| State Management | Zustand | Redux | Less boilerplate, simpler API |
| Routing | TanStack Router | React Router | Type-safe, file-based routing |
| Styling | Tailwind CSS | CSS Modules | Rapid development, consistent design |

---

## Summary

"To summarize the frontend architecture for DocuSign:

1. **Component Organization**: Clear separation between common components, envelope preparation, and signing ceremony
2. **PDF Rendering**: react-pdf with interactive field overlays for document viewing
3. **Signature Capture**: Canvas-based drawing and typed signature modes
4. **State Management**: Zustand stores for authentication and envelope data
5. **Accessibility**: WCAG 2.1 AA compliance throughout signing flow
6. **Responsive Design**: Tablet-friendly layouts for on-the-go signing

The design prioritizes a focused, guided signing experience while providing powerful preparation tools for document senders.

What aspects would you like me to elaborate on?"
