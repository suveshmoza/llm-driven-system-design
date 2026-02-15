# Retool - No-Code Internal Tool Builder: Architecture

## System Overview

Retool is a no-code platform for building internal tools. Users visually compose applications by dragging components (tables, forms, buttons, charts) onto a canvas, connecting to databases, writing queries, and binding query results to component properties. This project explores the meta-problem of system design: building a tool that builds tools.

**Learning goals**: Component model design, binding engine architecture, query execution safety, two-database separation, drag-and-drop grid systems, publish/versioning workflows.

## Requirements

### Functional Requirements

1. **App Builder**: Visual drag-and-drop editor with component palette, canvas, and property inspector
2. **Component Library**: Pre-built widgets (Table, TextInput, Button, Text, NumberInput, Select, Chart, Form, Container)
3. **Data Source Management**: Connect to external PostgreSQL databases
4. **Query Execution**: Write and run SQL queries against connected data sources
5. **Data Binding**: Bind query results to component props using `{{ expression }}` syntax
6. **Publish/Preview**: Snapshot app state as immutable versions, preview published apps
7. **Authentication**: User accounts with session-based auth

### Non-Functional Requirements (Production Scale)

| Metric | Target |
|--------|--------|
| Availability | 99.99% uptime |
| Latency (editor) | p99 < 200ms for save operations |
| Latency (queries) | p99 < 2s for query execution (depends on target DB) |
| Concurrent editors | 10,000 simultaneous users editing apps |
| Apps per org | Up to 10,000 apps |
| Query execution | 100 QPS per data source connection |

## Capacity Estimation

### Production Scale

- **Users**: 100K registered users, 10K concurrent editors
- **Apps**: 500K total apps, 50K active (edited in last 30 days)
- **Queries**: Average 5 queries per app, 2M query executions/day
- **Storage**: Average app JSON is ~50KB, 500K apps = ~25GB metadata
- **Data sources**: 200K configured connections across all orgs

### Local Development Scale

- **Users**: 2-5 test users
- **Apps**: 10-50 apps
- **Queries**: Manual execution, <10 QPS
- **Components**: Single PostgreSQL for metadata, single target PostgreSQL

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Browser                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │ Component     │  │ Canvas       │  │ Property Inspector          │  │
│  │ Palette       │  │ (Grid)       │  │ + Binding Inputs            │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘  │
│         │    Drag & Drop   │    Select & Edit        │                  │
│         └──────────────────┼─────────────────────────┘                  │
│                            │                                            │
│  ┌─────────────────────────┴────────────────────────────────────────┐   │
│  │                    Query Panel (SQL Editor + Results)            │   │
│  └─────────────────────────┬────────────────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────────────┘
                             │ REST API
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        API Gateway / Load Balancer                     │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
  │  App Service      │ │  Query Service   │ │  Auth Service    │
  │  (CRUD, Publish)  │ │  (Execute, Bind) │ │  (Sessions)      │
  └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
           │                    │                     │
           ▼                    ▼                     ▼
  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
  │  Retool DB       │ │  Target DBs      │ │  Redis/Valkey    │
  │  (PostgreSQL)    │ │  (User-connected │ │  (Sessions,      │
  │  Metadata store  │ │   databases)     │ │   Cache)         │
  └──────────────────┘ └──────────────────┘ └──────────────────┘
```

## Core Components

### 1. Component Model

The component model is the central abstraction. Every UI element on the canvas is an `AppComponent`:

```typescript
interface AppComponent {
  id: string;           // Unique identifier (e.g., "table1", "textInput2")
  type: string;         // Component type from registry
  props: Record<string, unknown>;  // Component-specific properties
  position: {
    x: number;          // Grid column (0-11)
    y: number;          // Grid row
    w: number;          // Width in columns (1-12)
    h: number;          // Height in rows
  };
  bindings: Record<string, string>;  // Prop name -> binding expression
}
```

Components are stored as a JSONB array in the `apps` table. This trades relational query flexibility for schema flexibility -- the component structure can evolve without migrations.

### 2. Binding Engine

The binding engine resolves `{{ expression }}` patterns in component props and query text:

```
Input:  "Hello {{ query1.data[0].name }}"
Context: { query1: { data: [{ name: "Alice" }] } }
Output: "Hello Alice"
```

**Resolution algorithm**:
1. Find all `{{ ... }}` patterns using regex
2. For each expression, split into path segments: `query1.data[0].name` -> `["query1", "data", "0", "name"]`
3. Walk the context object following the path
4. Replace the binding with the resolved value (stringified if object)

**Safety**: Uses property path traversal, never `eval()`. Prevents arbitrary code execution while supporting dot notation and array bracket access.

**Binding context** contains:
- Query results: `{ query1: { data: [...], fields: [...], rowCount: N } }`
- Component values: `{ textInput1: { value: "search term" } }`

### 3. Query Executor

The query executor runs SQL against user-connected databases:

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Query Request │────▶│ Binding Engine    │────▶│ Safety Check     │
│ (SQL + bindings)    │ (resolve {{ }})  │     │ (SELECT only?)   │
└──────────────┘     └──────────────────┘     └────────┬─────────┘
                                                       │
                                              ┌────────▼─────────┐
                                              │ Connection Pool   │
                                              │ (per data source) │
                                              └────────┬─────────┘
                                                       │
                                              ┌────────▼─────────┐
                                              │ Target Database   │
                                              └──────────────────┘
```

**Connection pooling**: Target DB pools are cached by data source ID with `Map<dataSourceId, pg.Pool>`. This avoids creating new connections per query while supporting multiple data sources.

**Safety**: By default, only `SELECT`, `WITH`, and `EXPLAIN` queries are allowed. Write queries require an explicit `allowWrite` flag.

### 4. App Service (CRUD + Versioning)

Apps follow a draft-then-publish workflow:

```
Draft (editing)  ──publish──▶  Version 1 (immutable snapshot)
     │                              │
  continue editing            stored in app_versions
     │
Draft (updated)  ──publish──▶  Version 2
```

Publishing creates a snapshot in `app_versions` with the current components, layout, and queries. The `apps` table tracks the latest draft state and which version is published.

### 5. Component Registry

Defines the available component types with their default props and property schemas:

```typescript
{
  type: 'table',
  label: 'Table',
  icon: 'table',
  category: 'Data Display',
  defaultProps: { data: '{{ query1.data }}', columns: [], pageSize: 10, searchable: true },
  propSchema: [
    { name: 'data', type: 'binding', label: 'Data Source', bindable: true },
    { name: 'columns', type: 'json', label: 'Columns' },
    { name: 'pageSize', type: 'number', label: 'Page Size' },
    { name: 'searchable', type: 'boolean', label: 'Searchable' },
  ]
}
```

The registry serves two purposes: populating the component palette in the editor, and defining the prop editing UI in the property inspector.

## Database Schema

### Retool Metadata Database

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(30) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Apps (draft state)
CREATE TABLE apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  components JSONB DEFAULT '[]',     -- Array of AppComponent
  layout JSONB DEFAULT '{}',          -- Grid configuration
  queries JSONB DEFAULT '[]',         -- Array of AppQuery
  global_settings JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'draft',
  published_version INT,              -- Points to latest published version
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Published versions (immutable snapshots)
CREATE TABLE app_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  components JSONB NOT NULL,
  layout JSONB NOT NULL,
  queries JSONB NOT NULL,
  published_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, version_number)
);

-- External database connections
CREATE TABLE data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL,  -- 'postgresql', 'rest_api'
  config JSONB NOT NULL,       -- { host, port, database, user, password }
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Key Index Strategy

```sql
CREATE INDEX idx_apps_owner ON apps(owner_id, updated_at DESC);
CREATE INDEX idx_app_versions_app ON app_versions(app_id, version_number DESC);
CREATE INDEX idx_data_sources_owner ON data_sources(owner_id);
```

The `apps_owner` index supports the dashboard query (list user's apps sorted by recency). The `app_versions_app` index supports version history lookup.

## API Design

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, set session |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/auth/me` | Current user info |

### Apps

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/apps` | List user's apps |
| GET | `/api/apps/:id` | Get app (draft state) |
| POST | `/api/apps` | Create app |
| PUT | `/api/apps/:id` | Update app (components, queries, etc.) |
| DELETE | `/api/apps/:id` | Delete app |
| POST | `/api/apps/:id/publish` | Publish current state as new version |
| GET | `/api/apps/:id/preview` | Get published version |
| GET | `/api/apps/:id/versions` | Version history |

### Data Sources & Queries

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/datasources` | List data sources |
| POST | `/api/datasources` | Create data source |
| POST | `/api/datasources/:id/test` | Test connection |
| POST | `/api/queries/execute` | Execute SQL query |
| GET | `/api/components` | Get component definitions |

## Key Design Decisions

### 1. JSONB vs Normalized Tables for Components

**Chosen**: JSONB columns on the `apps` table store components, queries, and layout as JSON arrays/objects.

**Alternative**: Separate `components`, `component_props`, and `app_queries` tables with foreign keys.

**Rationale**: A no-code tool's component schema evolves constantly -- adding new component types, new props, new binding formats. With normalized tables, every schema change requires a migration. JSONB absorbs schema changes without migrations. The cost is that querying individual components across apps (e.g., "find all apps using a specific data source in their query bindings") requires JSONB operators, which are slower than indexed relational queries.

At scale, if we needed to query component metadata frequently, we could add materialized views or denormalized indexes.

### 2. Two-Database Architecture

**Chosen**: Separate PostgreSQL instances for metadata and target data.

**Alternative**: Single database with schema separation.

**Rationale**: In production Retool, target databases are customer-owned external systems (AWS RDS, GCP Cloud SQL, on-prem). Modeling this as a separate container mirrors reality. The query executor must create dynamic connections based on stored config, treating the target DB as an external service rather than a co-located schema. This forces us to handle connection pooling, timeouts, and connection failures properly.

### 3. Property Path Resolution vs eval()

**Chosen**: Manual property path traversal for binding resolution.

**Alternative**: JavaScript `eval()` or `Function()` constructor.

**Rationale**: `eval("query1.data[0].name")` with a context object would be powerful but creates a massive security surface. Users could execute arbitrary code: `eval("process.exit(1)")` or `eval("require('child_process').exec('rm -rf /')")`. Property path traversal limits expressions to data access only: navigating object properties and array indices. The trade-off is reduced expressiveness -- users cannot write `{{ query1.data.filter(x => x.active).length }}`. In production Retool, this gap is filled by a sandboxed JavaScript runtime (V8 isolate), but that is beyond the scope of this project.

## Consistency and Idempotency

### Idempotent App Saves

App save operations (PUT /api/apps/:id) must be idempotent to handle network retries and duplicate submissions. Each save request includes the full app state (components, queries, layout) rather than incremental patches. This means replaying the same save request produces the same result regardless of how many times it is delivered. The `updated_at` timestamp on the apps table serves as a lightweight version marker. If two save requests arrive in quick succession, the second overwrites the first with the complete state, and the timestamp reflects the most recent write. This last-writer-wins approach is acceptable because the editor always sends the full component tree, so no partial state can be persisted.

### Optimistic Locking for Concurrent Editing

When multiple users edit the same app simultaneously, conflicting saves can silently overwrite each other. To prevent this, the save endpoint accepts an `expected_version` field (the `updated_at` value the client last read). Before writing, the server checks whether the stored `updated_at` matches the expected version. If it does not match, the save is rejected with a 409 Conflict response, prompting the client to reload the latest state before retrying. This optimistic locking approach avoids holding database locks during the editing session while still preventing lost updates. The trade-off is that users occasionally see conflict errors, but for an internal tool builder where simultaneous editing of the same app is uncommon, this is preferable to the complexity of real-time conflict resolution with CRDTs.

### Query Execution Retry Semantics

Query execution against external target databases is inherently non-idempotent for write operations (INSERT, UPDATE, DELETE). Read queries (SELECT) are safe to retry on transient failures such as connection timeouts or pool exhaustion. The query executor retries failed SELECT queries up to two times with exponential backoff before returning an error to the client. Write queries are never automatically retried because replaying an INSERT could create duplicate rows. Instead, write failures return an error immediately, and the user decides whether to re-execute. For critical write operations at production scale, the platform could support client-supplied idempotency keys attached to each query execution request, allowing the server to deduplicate retries within a short time window.

### Exactly-Once Publish Operations

Publishing an app (POST /api/apps/:id/publish) creates an immutable version snapshot in the app_versions table. This operation must not produce duplicate versions if the client retries after a timeout. The server wraps the publish operation in a database transaction that reads the current maximum version number and inserts the next version atomically. The UNIQUE constraint on (app_id, version_number) acts as a safety net -- if a duplicate insert is attempted due to a retry, the constraint violation causes the transaction to fail. The server catches this specific error and returns the existing version rather than an error, making the publish endpoint effectively idempotent from the client's perspective.

### Consistency Guarantees

The metadata database uses PostgreSQL with default READ COMMITTED isolation. Within a single app save or publish operation, all state changes occur in a single transaction, ensuring atomicity. Cross-app consistency is not a concern because apps are independent entities. For the two-database architecture, there is no distributed transaction between the Retool metadata database and target databases. Query results are ephemeral and not persisted, so there is no consistency boundary to maintain between the metadata store and the query execution path.

## Security

### Query Execution Safety

- **Read-only by default**: Only `SELECT`, `WITH`, and `EXPLAIN` queries are allowed unless `allowWrite` is explicitly set
- **No query parameterization**: Bindings are resolved via string replacement, which is a SQL injection risk. In production, bindings should be resolved server-side and passed as parameterized query values
- **Connection isolation**: Each data source gets its own connection pool with limited max connections (5)

### Authentication

- Session-based auth with Redis session store
- bcrypt password hashing (10 rounds)
- Rate limiting on auth endpoints (50 requests per 15 minutes)
- API rate limiting (1000 requests per 15 minutes)
- CORS restricted to frontend origin

### Data Source Credentials

- Stored encrypted in JSONB `config` column
- Passwords masked in API responses (`********`)
- In production, credentials should be encrypted at rest with envelope encryption (KMS)

## Observability

### Prometheus Metrics

- `http_request_duration_seconds` - Request latency histogram
- `http_requests_total` - Request counter by method/route/status
- `query_execution_duration_seconds` - Query execution time by data source type
- `active_apps_total` - Gauge of total apps

### Structured Logging

Pino logger with JSON output, including request context (method, path, duration).

### Health Check

`GET /api/health` verifies database connectivity and returns status.

## Failure Handling

### Circuit Breaker

Opossum circuit breaker available for wrapping external service calls:
- 50% error threshold opens the circuit
- 30-second reset timeout
- 10-second call timeout

### Connection Pool Failures

Target DB connection pools are cached per data source ID. If a pool encounters an error, it is removed from cache and recreated on next query. Max 5 connections per pool with 60-second idle timeout.

### Graceful Shutdown

SIGTERM/SIGINT handlers close the HTTP server, drain target DB pools, and disconnect from the metadata database.

## Scalability Considerations

### Horizontal Scaling

The API layer is stateless (sessions in Redis) and can scale horizontally behind a load balancer. The main bottleneck is the metadata PostgreSQL.

### App Storage at Scale

At 500K apps with average 50KB JSON, total storage is ~25GB. JSONB compression helps. For organizations with very large apps (thousands of components), we could split component storage into a separate object store (S3) and keep only metadata in PostgreSQL.

### Query Execution Scaling

Each API instance maintains its own target DB connection pools. At scale, a dedicated query execution service with connection pooling (like PgBouncer) would prevent connection exhaustion on popular data sources.

### Multi-Tenancy

Apps are scoped by `owner_id`. At scale, tenant isolation would require row-level security, per-tenant connection limits, and query execution quotas.

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Component storage | JSONB columns | Normalized tables | Schema flexibility for evolving components |
| Binding resolution | Property path traversal | eval() / V8 isolate | Security over expressiveness |
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler |
| Target DB connections | Dynamic pg.Pool cache | PgBouncer proxy | Simpler for local, PgBouncer for production |
| Query safety | String prefix check | SQL parser (pg-query-parser) | Simpler, sufficient for demo |
| Layout system | 12-column grid | Freeform absolute positioning | Predictable alignment, familiar to users |
| Auth | Session-based | OAuth2 / JWT | Sufficient for learning, simpler implementation |

## Implementation Notes

### Production-Grade Patterns Implemented

1. **Prometheus Metrics** (prom-client): Request duration histograms, query execution timing, request counters. See `src/services/metrics.ts`.

2. **Structured Logging** (Pino): JSON log output with request context for log aggregation. See `src/services/logger.ts`.

3. **Circuit Breaker** (Opossum): Wraps external service calls with timeout and error threshold. See `src/services/circuitBreaker.ts`.

4. **Rate Limiting** (express-rate-limit): Separate limits for auth endpoints (50/15min), query execution (100/min), and general API (1000/15min). See `src/services/rateLimiter.ts`.

5. **Health Checks**: `GET /api/health` verifies metadata database connectivity.

6. **Graceful Shutdown**: SIGTERM/SIGINT handlers drain connections before exit.

### Simplified for Local Development

- **Single Express server** instead of separate microservices (App, Query, Auth)
- **MinIO omitted** -- no file/asset storage needed for this project
- **Session auth** instead of OAuth2/JWT
- **String-based query safety** instead of SQL AST parsing
- **Binding resolution** limited to property paths (no JavaScript expressions)

### Omitted from Local Implementation

- **CDN** for static assets and published app hosting
- **Multi-region** deployment and database replication
- **Kubernetes** orchestration
- **Real-time collaboration** (multiple editors on same app via WebSocket/CRDT)
- **Sandboxed JavaScript runtime** for custom transformations
- **Audit logging** for compliance (who changed what, when)
- **Role-based access control** per app/data source
- **Query result caching** with invalidation
