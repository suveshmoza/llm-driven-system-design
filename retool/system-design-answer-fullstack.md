# System Design: No-Code Internal Tool Builder (Full-Stack)

## 🎯 1. Requirements Clarification

> "We are designing a platform where non-technical users build internal tools visually. Think Retool -- users drag components onto a canvas, connect to databases, write queries, and bind data to UI widgets. This is a meta-problem: we are building a tool that builds tools. The system spans a visual editor frontend, a query execution backend, and a component model that bridges both."

**Functional Requirements:**
- Visual drag-and-drop editor with component palette and grid canvas
- Component library: Table, TextInput, Button, Text, NumberInput, Select, Chart, Form, Container
- Data source management: connect to external PostgreSQL databases
- Query execution with `{{ expression }}` binding resolution
- Publish/preview with immutable version snapshots
- Session-based authentication

**Non-Functional Requirements:**
- p99 editor save < 200ms, query execution < 2s
- Support 10K concurrent editors, 100K apps
- 99.99% availability

---

## 🏗️ 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Client Browser                            │
│                                                                  │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────────────────┐  │
│  │Component │  │  Canvas Area   │  │  Property Inspector      │  │
│  │Palette   │  │  (12-col grid) │  │  + Binding Inputs        │  │
│  │(drag src)│  │  (drop target) │  │  + Position Controls     │  │
│  └──────────┘  └────────────────┘  └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Query Panel: SQL Editor + Data Source + Results Table       │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────────┘
                           │ REST API
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Express API Server                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │Auth      │  │App       │  │Query     │  │Component         │ │
│  │Routes    │  │Routes    │  │Routes    │  │Registry          │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────────────┘ │
│       │              │             │                              │
│  ┌────▼──────────────▼─────────────▼───────────────────────────┐ │
│  │  Services: AppService, QueryExecutor, BindingEngine         │ │
│  └──────┬────────────────────┬─────────────────────────────────┘ │
└─────────┼────────────────────┼───────────────────────────────────┘
          │                    │
          ▼                    ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│ Retool DB    │    │ Target DBs       │    │ Redis/Valkey │
│ (PostgreSQL) │    │ (User-connected  │    │ (Sessions)   │
│ Metadata     │    │  databases)      │    │              │
└──────────────┘    └──────────────────┘    └──────────────┘
```

> "The architecture has three key separations: (1) the editor frontend that manages the visual builder experience, (2) the API server that handles app CRUD, query execution, and binding resolution, and (3) the two-database split between Retool metadata and user-connected target databases."

---

## 🧩 3. The Component Model (The Central Abstraction)

> "Everything flows from the component model. A component is a JSON object with a type, properties, a grid position, and bindings. This single abstraction drives the palette, canvas, property inspector, widget rendering, and preview."

```
AppComponent
┌─────────────────────────────────────────────┐
│  id: "table1"                                │
│  type: "table"                               │
│  props: {                                    │
│    data: "{{ query1.data }}",                │
│    columns: [...],                           │
│    pageSize: 10                              │
│  }                                           │
│  position: { x: 0, y: 2, w: 12, h: 8 }     │
│  bindings: { data: "query1.data" }           │
└─────────────────────────────────────────────┘
```

**Where each field is used:**

| Field | Palette | Canvas | Inspector | Preview |
|-------|---------|--------|-----------|---------|
| type | Icon + label | Widget renderer | Type display | Widget renderer |
| props | (defaults) | Widget behavior | Edit controls | Widget behavior |
| position | - | CSS positioning | Position inputs | CSS positioning |
| bindings | - | - | Binding indicator | Data resolution |

---

## 💾 4. Data Model

### JSONB Storage Strategy

> "I store components and queries as JSONB arrays on the apps table. This is the most consequential data model decision."

| Approach | Load App | Save App | Cross-App Query | Migration Cost |
|----------|----------|----------|-----------------|----------------|
| JSONB | 1 SELECT | 1 UPDATE | JSONB operators (slow) | Zero |
| Normalized | 4+ JOINs | N INSERTs/UPDATEs | Standard WHERE (fast) | Every schema change |

> "Our primary access patterns are 'load app by ID' and 'save app by ID' -- both are single-row operations. JSONB serves these perfectly. The trade-off is that finding all apps using a specific data source requires JSONB path queries like `apps.queries @> '[{"dataSourceId": "abc"}]'`, which cannot use standard B-tree indexes. At scale, I would add a denormalized index table for these admin queries."

### Version Snapshots

```
Draft (mutable)                    Published Versions (immutable)
┌──────────────┐                   ┌──────────────────────────┐
│ apps table   │  ──publish──▶     │ app_versions table       │
│ components   │                   │ version_number: 1        │
│ queries      │                   │ components: [snapshot]   │
│ layout       │                   │ queries: [snapshot]      │
└──────────────┘                   └──────────────────────────┘
      │                                      │
  continue editing                   ──publish──▶
      │                            ┌──────────────────────────┐
      ▼                            │ version_number: 2        │
┌──────────────┐                   │ components: [snapshot]   │
│ apps table   │                   └──────────────────────────┘
│ (updated)    │
└──────────────┘
```

> "Each publish creates a full snapshot. This is event sourcing for app state. The trade-off is storage duplication (~50KB per version), but the simplicity of 'load version N' as a single row read outweighs the cost."

---

## 🖥️ 5. Frontend Architecture

### Store Architecture

Three Zustand stores with clear separation:

- **AuthStore**: User session, login/logout
- **EditorStore**: App state, component CRUD, selection, query management
- **DataStore**: Data sources, query results, component runtime values, binding context

> "The key insight is separating edit-time state (EditorStore) from run-time state (DataStore). The editor updates on every user interaction -- drag, select, type. Query results update only on execution. By splitting stores, canvas components re-render on edit actions without re-computing query bindings, and data-bound widgets re-render on query execution without re-rendering the entire canvas."

### Drag-and-Drop

```
@dnd-kit/core Flow:

1. useDraggable(component.type)  ── attached to palette items
2. useDroppable('canvas')        ── attached to canvas area
3. DragOverlay                   ── floating preview during drag
4. onDragEnd                     ── calculate grid position, add component
```

Grid position calculation:
```
gridCol = floor((pointerX - canvasLeft) / 80)  // 80px per column
gridRow = floor((pointerY - canvasTop) / 40)   // 40px per row
```

### Widget Rendering

Dynamic dispatch from component type to React component:

```
WidgetRenderer({ component })
  │
  ├── type: 'table'     ──▶ TableWidget    (resolves {{ data }} binding)
  ├── type: 'textInput' ──▶ TextInputWidget (writes to componentValues)
  ├── type: 'button'    ──▶ ButtonWidget   (triggers query on click)
  ├── type: 'text'      ──▶ TextWidget     (resolves {{ value }} binding)
  └── type: 'chart'     ──▶ ChartWidget    (SVG bar/line chart)
```

> "This pattern makes the system extensible. Adding a new widget type requires: (1) a ComponentDefinition in the registry, (2) a React component, (3) one line in the WIDGET_MAP. No router changes, no API changes."

---

## ⚙️ 6. Backend Architecture

### Query Execution Pipeline

```
Client Request                          Server
┌──────────────────┐                   ┌─────────────────────────────┐
│ dataSourceId     │                   │ 1. Look up data source      │
│ queryText        │──────────────────▶│ 2. Resolve {{ bindings }}   │
│ context          │                   │ 3. Safety check (SELECT?)   │
│ allowWrite       │                   │ 4. Get/create pool          │
└──────────────────┘                   │ 5. Execute query            │
                                       │ 6. Return rows + fields     │
                                       └─────────────────────────────┘
```

**Connection pool caching**: `Map<dataSourceId, pg.Pool>` stores persistent pools. First query for a data source creates a pool (max 5 connections, 60s idle timeout). Subsequent queries reuse it. Pool errors trigger eviction and recreation.

**Binding resolution**: The binding engine parses `{{ expression }}` patterns and resolves them via property path traversal. For example:
- Input: `SELECT * FROM customers WHERE name = '{{ searchInput.value }}'`
- Context: `{ searchInput: { value: "Alice" } }`
- Output: `SELECT * FROM customers WHERE name = 'Alice'`

> "Note: this is string interpolation, not parameterized queries. In production, bindings should be extracted and passed as parameterized values to prevent SQL injection. For our learning scope, string replacement demonstrates the concept while acknowledging the security gap."

---

## 🔧 7. Deep Dive: The Binding Engine

> "The binding engine is the nervous system of the platform -- it connects data to UI. Let me walk through the full-stack data flow."

### End-to-End Binding Flow

```
1. User runs query1 ──▶ API executes SQL ──▶ returns { rows: [...] }
2. DataStore.queryResults["query1"] = { data: rows, ... }
3. DataStore.getBindingContext() builds: { query1: { data: [...] } }
4. TableWidget reads component.props.data = "{{ query1.data }}"
5. resolveBindingValue("query1.data", context) returns the rows array
6. TableWidget renders the rows as table rows
```

### Safety: Why Not eval()?

| Approach | Security | Expressiveness | Complexity |
|----------|----------|----------------|------------|
| Property path traversal | Safe -- data access only | Limited -- no filtering/mapping | Low |
| eval() | Dangerous -- arbitrary code | Full JavaScript | Low |
| V8 Isolate | Safe -- sandboxed | Full JavaScript | High |
| WebAssembly sandbox | Safe -- isolated | Custom language | Very High |

> "I chose property path traversal. With eval(), a user could write `{{ process.exit(1) }}` or `{{ require('child_process').exec('rm -rf /') }}`. Property path traversal restricts expressions to navigating object properties: `query1.data[0].name`. The trade-off is that users cannot write `{{ query1.data.filter(x => x.active) }}`. In production Retool, this is solved with V8 isolates -- sandboxed JavaScript runtimes with memory and CPU limits."

---

## 🔧 8. Deep Dive: Two-Database Architecture

> "The two-database separation is not just a local simplification -- it mirrors production reality. Retool's metadata database is internal infrastructure. Target databases are customer-owned systems in their own VPCs."

```
┌──────────────────┐          ┌──────────────────┐
│  Retool DB       │          │  Target DB       │
│  (port 5432)     │          │  (port 5433)     │
│                  │          │                  │
│  users           │          │  customers       │
│  apps            │          │  products        │
│  app_versions    │   ────▶  │  orders          │
│  data_sources ───┼── config │  order_items     │
│  saved_queries   │          │                  │
└──────────────────┘          └──────────────────┘
```

**Data source config stored in Retool DB** includes host, port, database, user, and password. The query executor reads this config to create dynamic pg.Pool connections.

**Security implications**: Data source credentials are stored in JSONB. In production, these must be encrypted at rest (envelope encryption with KMS). Passwords are masked in API responses (`********`).

> "This separation forces us to handle real distributed system concerns: connection pooling across many target databases, credential management, connection timeouts, and the fact that a target database being slow should not affect other users' apps."

---

## 🔧 9. Deep Dive: Grid Layout System

> "The grid system converts a logical position (column/row) into pixel coordinates. Every component stores `{ x, y, w, h }` in grid units."

### Grid Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| GRID_COLS | 12 | Canvas width in columns |
| COL_WIDTH | 80px | Pixels per column |
| ROW_HEIGHT | 40px | Pixels per row |

### Position to Pixels

```
CSS left:   component.position.x * 80px
CSS top:    component.position.y * 40px
CSS width:  component.position.w * 80px
CSS height: component.position.h * 40px
```

### Canvas Background

A dotted grid pattern using CSS `background-image` with `linear-gradient`:
```
background-size: 80px 40px;  // matches grid cell size
```

This provides visual alignment guides without any JavaScript rendering overhead.

---

## 🚀 10. Publish/Preview Workflow

### Full-Stack Flow

```
Editor (Draft)                 API                        Database
┌──────────────┐              ┌──────────────┐           ┌──────────────┐
│ User clicks  │──save──────▶│PUT /apps/:id │──────────▶│UPDATE apps   │
│ "Publish"    │              └──────────────┘           │SET components│
│              │              ┌──────────────┐           └──────────────┘
│              │──publish───▶│POST /publish │──────────▶│INSERT INTO   │
│              │              └──────────────┘           │app_versions  │
└──────────────┘                                         └──────────────┘

Preview Mode                   API                        Database
┌──────────────┐              ┌──────────────┐           ┌──────────────┐
│ Load preview │──fetch─────▶│GET /preview  │──────────▶│SELECT FROM   │
│              │              └──────────────┘           │app_versions  │
│ Run on_load  │──execute───▶│POST /execute │──────────▶│Target DB     │
│ queries      │              └──────────────┘           └──────────────┘
│ Render all   │
│ components   │
└──────────────┘
```

> "The save-then-publish pattern ensures the published version is always a complete, consistent snapshot. If the user is mid-edit (has unsaved changes), the publish flow saves first, then snapshots."

---

## 🔐 11. Authentication

Session-based with Redis:

```
Login ──▶ Verify bcrypt hash ──▶ Create session in Redis ──▶ Set cookie
Request ──▶ Read cookie ──▶ Load session from Redis ──▶ Attach userId to req
Logout ──▶ Destroy session ──▶ Clear cookie
```

> "Sessions over JWT because: (1) immediate revocation -- deleting from Redis instantly logs out the user, (2) no token refresh complexity, (3) works naturally with the same-origin API proxy."

---

## 📊 12. Monitoring and Observability

### Backend Metrics (Prometheus)

- `http_request_duration_seconds`: Histogram with method/route/status labels
- `query_execution_duration_seconds`: How long target DB queries take
- `http_requests_total`: Counter for request volume

### Health Check

`GET /api/health` verifies metadata database connectivity. Returns 200/503.

### Structured Logging

Pino JSON logs with request context for log aggregation and search.

---

## 📈 13. Scalability Path

### Current (Local)

Single Express server, single PostgreSQL, single Redis. Handles 2-5 concurrent users.

### 10K Users

- Horizontal API scaling (3+ instances behind Nginx)
- PostgreSQL read replicas for dashboard queries
- Redis cluster for session distribution
- Rate limiting per user/data source

### 100K Users

- Dedicated query execution service (isolates slow queries)
- PgBouncer for target DB connection pooling
- JSONB component index table for admin queries
- CDN for published app static assets
- Multi-tenant isolation with row-level security

---

## ⚖️ 14. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Component storage | JSONB | Normalized tables | Schema flexibility, atomic save |
| Binding engine | Property path | eval() / V8 isolate | Security over expressiveness |
| State management | Zustand (3 stores) | Redux, Context | Less boilerplate, selective re-renders |
| Drag-and-drop | @dnd-kit/core | react-beautiful-dnd | Maintained, freeform support |
| Grid positioning | Absolute CSS | CSS Grid | Overlapping support |
| Query safety | String prefix check | SQL parser | Simple, 95% coverage |
| Session storage | Redis + cookie | JWT | Immediate revocation |
| Chart rendering | SVG in React | Chart.js, D3 | Zero dependencies |
| Target DB pooling | In-process cache | PgBouncer | Simpler for local |
