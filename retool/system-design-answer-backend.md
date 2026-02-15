# System Design: No-Code Internal Tool Builder (Backend Focus)

## 1. Requirements Clarification

> "Before diving in, I want to clarify the scope. We are building a platform where users visually compose internal tools -- think customer dashboards, order management panels, admin UIs. The backend must support a component model, query execution against external databases, a binding engine for data flow, and a publish/versioning workflow."

**Functional Requirements:**
- App CRUD with component and query storage
- Data source management (connect to external PostgreSQL databases)
- Query execution with binding resolution
- Publish/preview with immutable version snapshots
- Session-based authentication

**Non-Functional Requirements:**
- p99 save latency < 200ms
- Query execution p99 < 2s (target DB dependent)
- Support 10K concurrent editors
- 99.99% availability

---

## 2. High-Level Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────────┐
│   Browser    │────▶│  API GW /   │────▶│  App Service         │
│   (Editor)   │     │  LB         │     │  (CRUD, Publish)     │
└─────────────┘     └──────┬──────┘     └──────────┬───────────┘
                           │                       │
                           │            ┌──────────▼───────────┐
                           │            │  Query Service        │
                           │            │  (Execute, Bind)      │
                           │            └──────────┬───────────┘
                           │                       │
              ┌────────────▼────┐     ┌───────────▼────────────┐
              │  Redis/Valkey   │     │  Retool DB (Postgres)  │
              │  (Sessions)     │     │  (Apps, Users, Sources) │
              └─────────────────┘     └────────────────────────┘
                                               │
                                      ┌────────▼───────────────┐
                                      │  Target DBs            │
                                      │  (User-connected)      │
                                      └────────────────────────┘
```

> "The key architectural insight is the two-database separation. The Retool metadata DB stores apps, users, and data source configs. Target databases are external systems that user-built apps query against. The query service creates dynamic connection pools based on stored data source configuration."

---

## 3. Data Model

### Apps Table

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| name | VARCHAR(100) | App name |
| owner_id | UUID FK | App owner |
| components | JSONB | Array of AppComponent objects |
| queries | JSONB | Array of AppQuery objects |
| layout | JSONB | Grid configuration |
| status | VARCHAR(20) | draft or published |
| published_version | INT | Latest published version number |

### App Versions Table

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| app_id | UUID FK | Parent app |
| version_number | INT | Sequential version |
| components | JSONB | Snapshot of components |
| queries | JSONB | Snapshot of queries |
| published_by | UUID FK | Publishing user |
| created_at | TIMESTAMPTZ | Publish timestamp |

> "I chose JSONB for components and queries rather than normalized tables. A no-code tool's component schema evolves constantly -- new component types, new props, new binding formats. With normalized tables, every schema change requires a migration. JSONB absorbs these changes. The trade-off is that querying individual components across apps requires JSONB operators which are slower than indexed relational queries. But the primary access pattern is 'load entire app by ID', which JSONB serves perfectly."

### Data Sources Table

Stores connection configuration for external databases:

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Display name |
| type | VARCHAR(30) | postgresql, rest_api |
| config | JSONB | Connection parameters |
| owner_id | UUID FK | Owner |

---

## 4. Core Backend Services

### Query Executor

```
Request ──▶ Resolve Bindings ──▶ Safety Check ──▶ Get Pool ──▶ Execute ──▶ Response
```

> "The query executor is the most security-sensitive component. It resolves `{{ }}` bindings in the SQL text, checks that the query is read-only by default, retrieves or creates a connection pool for the target data source, executes the query, and returns structured results with field metadata."

**Connection pool caching**: Target DB pools are cached by data source ID in a Map. This avoids creating new connections per query while supporting multiple data sources. Pools have a max of 5 connections and 60-second idle timeout. If a pool errors, it is removed from cache and recreated on next use.

**Safety model**: By default, only SELECT, WITH, and EXPLAIN queries are permitted. The executor checks the trimmed, uppercased query prefix. Write queries require an explicit `allowWrite` flag. This is a simple heuristic -- in production, a SQL parser (like pg-query-parser) would provide stronger guarantees.

### Binding Engine

> "The binding engine resolves expressions like `{{ query1.data[0].name }}`. It uses property path traversal rather than eval(). The path is split into segments -- `query1`, `data`, `0`, `name` -- and we walk the context object following each segment."

**Why not eval()?**

| Approach | Pros | Cons |
|----------|------|------|
| eval() | Full JavaScript expressiveness | Arbitrary code execution, process.exit(), require() |
| V8 Isolate | Sandboxed, full JS | Complex setup, resource overhead |
| Property path | Safe, simple, fast | No filtering, mapping, or computation |

> "I chose property path resolution because security is non-negotiable for a tool that runs user-provided expressions against databases. The trade-off is reduced expressiveness -- users cannot write `{{ query1.data.filter(x => x.active) }}`. In production Retool, this gap is filled by V8 isolates (sandboxed JavaScript), but for our scope, property paths cover the common use case of displaying query results in components."

### App Service (Publish/Versioning)

Publishing creates an immutable snapshot:

1. Read current app draft (components, layout, queries)
2. Determine next version number: `MAX(version_number) + 1`
3. Insert into `app_versions` with snapshot data
4. Update `apps.published_version` and `apps.status`

> "This is essentially event sourcing for app state. Each published version is an immutable snapshot. If a user publishes a broken change, they can view any previous version. The trade-off is storage growth -- each version duplicates the full component tree. At ~50KB per app and 10 versions, that is 500KB per app, which is manageable."

---

## 5. API Design

### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| PUT | /api/apps/:id | Save draft (components, queries) |
| POST | /api/apps/:id/publish | Create immutable version snapshot |
| GET | /api/apps/:id/preview | Fetch published version |
| POST | /api/queries/execute | Run SQL against target DB |
| POST | /api/datasources | Register external DB connection |
| POST | /api/datasources/:id/test | Verify connection works |

### Query Execution Request/Response

Request:
- dataSourceId: which database to query
- queryText: SQL with optional `{{ }}` bindings
- context: binding values from components/queries
- allowWrite: boolean flag for mutation queries

Response:
- rows: array of result objects
- fields: column metadata (name, dataType)
- rowCount: number of rows affected/returned
- error: error message if query failed

---

## 6. Deep Dive: Query Execution Safety

> "Query execution is the highest-risk component. We are running user-provided SQL against databases that may contain production data. Let me walk through the safety layers."

**Layer 1 -- Read-only default**: String prefix check blocks INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE. Simple but effective for 95% of cases.

**Layer 2 -- Connection isolation**: Each data source gets a separate pg.Pool with max 5 connections. A runaway query cannot exhaust connections for other data sources.

**Layer 3 -- Query timeout**: pg.Pool has a 10-second connection timeout. Long-running queries time out rather than blocking the pool.

**Layer 4 -- Rate limiting**: Query execution endpoint has its own rate limiter (100/minute) separate from general API limits.

**What breaks**: A user could craft a SELECT that is effectively a write: `SELECT * FROM dblink('host=evil', 'DROP TABLE users')`. String prefix checking does not catch this. In production, you need a SQL parser to analyze the query AST, or run queries in a read-only transaction (`SET TRANSACTION READ ONLY`).

> "The key trade-off here is complexity vs. correctness. String prefix checking is 10 lines of code and catches 95% of dangerous queries. A SQL parser adds a dependency and 100+ lines of code but catches 99.9%. For a learning project, I chose simplicity while acknowledging the gap."

---

## 7. Deep Dive: Data Source Connection Management

> "Managing connections to external databases is tricky because we need to balance connection reuse (performance) against connection freshness (when credentials change)."

**Current approach**: A `Map<dataSourceId, pg.Pool>` caches pools. First query for a data source creates a pool. Subsequent queries reuse it. If a pool errors, it is evicted and recreated.

**Problem at scale**: With 200K data sources, caching all pools is impossible (each pool reserves connections). We need an LRU eviction policy -- keep the most recently used 1000 pools, evict idle ones.

**Production alternative**: PgBouncer as a connection proxy. Instead of each API instance managing its own pools, all instances connect through PgBouncer which handles pooling centrally. This reduces total connections to target databases from `instances * pools * max_connections` to `pgbouncer_max * data_sources`.

| Approach | Pros | Cons |
|----------|------|------|
| In-process pool cache | Simple, no extra infrastructure | Per-instance pools, no sharing |
| PgBouncer proxy | Connection sharing, central management | Extra infrastructure, config complexity |
| Serverless proxy (Neon/Supabase) | Auto-scaling, zero config | Vendor lock-in, latency overhead |

---

## 8. Deep Dive: JSONB Storage Trade-offs

> "Storing components as JSONB is the most consequential data model decision. Let me compare it to the normalized alternative."

**JSONB approach (chosen)**:
- Single `SELECT * FROM apps WHERE id = $1` loads the entire app
- Schema changes (new component props) require zero migrations
- Atomic save: one `UPDATE apps SET components = $1` replaces the whole component tree

**Normalized approach**:
```
apps -> components -> component_props
              -> component_bindings
              -> component_positions
```
- Loading an app requires 4+ JOINs
- Adding a new prop type requires a migration
- Updating one component requires knowing its row ID

> "The access pattern determines the choice. Our primary operations are 'load entire app' and 'save entire app'. These are single-row operations perfectly served by JSONB. The normalized approach would be better if we needed cross-app queries like 'find all components bound to data source X' -- but that is an admin query, not a hot path."

**Hybrid at scale**: Keep JSONB for the hot path (load/save app), but maintain a denormalized index table for cross-app queries:
```sql
CREATE TABLE component_index (
  app_id UUID, component_id TEXT, component_type TEXT,
  data_source_refs TEXT[]  -- extracted from bindings
);
```

---

## 9. Scalability Considerations

**Horizontal API scaling**: Sessions in Redis, stateless API instances behind a load balancer. The bottleneck moves to PostgreSQL.

**Database scaling**: Read replicas for the apps dashboard query. The app editor hits a single row, so sharding is not immediately necessary. If needed, shard by `owner_id` (all of one user's apps on one shard).

**Query execution scaling**: A dedicated query execution service can scale independently from the app CRUD service. This isolates slow target DB queries from fast metadata operations.

**Multi-tenancy**: Row-level security on `owner_id`. Per-tenant rate limits on query execution. Connection quotas per data source to prevent noisy neighbors.

---

## 10. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Component storage | JSONB | Normalized tables | Schema flexibility, atomic save |
| Binding engine | Property path | eval() / V8 isolate | Security over expressiveness |
| Query safety | String prefix | SQL parser | Simplicity, 95% coverage |
| Connection mgmt | In-process pool cache | PgBouncer | Sufficient for local scale |
| Session storage | Redis + cookie | JWT | Immediate revocation |
| Versioning | Full snapshots | Diffs/patches | Simpler, predictable |
