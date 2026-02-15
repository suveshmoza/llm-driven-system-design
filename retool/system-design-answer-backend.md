# System Design: No-Code Internal Tool Builder (Backend Focus)

## 🎯 1. Requirements Clarification

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

## 🏗️ 2. High-Level Architecture

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

## 💾 3. Data Model

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

### Index Strategy

The primary indexes support the two hot-path access patterns. An index on (owner_id, updated_at DESC) on the apps table supports the dashboard query that lists a user's apps sorted by recency. An index on (app_id, version_number DESC) on app_versions supports version history lookup and finding the latest published version. An index on owner_id on data_sources supports listing a user's configured connections. These B-tree indexes cover all primary key and foreign key lookups without requiring additional composite indexes.

---

## ⚙️ 4. Core Backend Services

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
| ✅ Property path | Safe, simple, fast | No filtering, mapping, or computation |
| ❌ eval() | Full JavaScript expressiveness | Arbitrary code execution, process.exit(), require() |
| ❌ V8 Isolate | Sandboxed, full JS | Complex setup, resource overhead |

> "I chose property path resolution because security is non-negotiable for a tool that runs user-provided expressions against databases. The trade-off is reduced expressiveness -- users cannot write `{{ query1.data.filter(x => x.active) }}`. In production Retool, this gap is filled by V8 isolates (sandboxed JavaScript), but for our scope, property paths cover the common use case of displaying query results in components."

### App Service (Publish/Versioning)

Publishing creates an immutable snapshot:

1. Read current app draft (components, layout, queries)
2. Determine next version number: MAX(version_number) + 1
3. Insert into app_versions with snapshot data
4. Update apps.published_version and apps.status

> "This is essentially event sourcing for app state. Each published version is an immutable snapshot. If a user publishes a broken change, they can view any previous version. The trade-off is storage growth -- each version duplicates the full component tree. At ~50KB per app and 10 versions, that is 500KB per app, which is manageable."

---

## 🔌 5. API Design

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

## 🔧 6. Deep Dive: Query Execution Safety

> "Query execution is the highest-risk component. We are running user-provided SQL against databases that may contain production data. Let me walk through the safety layers."

**Layer 1 -- Read-only default**: String prefix check blocks INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE. Simple but effective for 95% of cases.

**Layer 2 -- Connection isolation**: Each data source gets a separate pg.Pool with max 5 connections. A runaway query cannot exhaust connections for other data sources.

**Layer 3 -- Query timeout**: pg.Pool has a 10-second connection timeout. Long-running queries time out rather than blocking the pool.

**Layer 4 -- Rate limiting**: Query execution endpoint has its own rate limiter (100/minute) separate from general API limits.

**What breaks**: A user could craft a SELECT that is effectively a write: `SELECT * FROM dblink('host=evil', 'DROP TABLE users')`. String prefix checking does not catch this. In production, you need a SQL parser to analyze the query AST, or run queries in a read-only transaction (SET TRANSACTION READ ONLY).

> "The key trade-off here is complexity vs. correctness. String prefix checking is 10 lines of code and catches 95% of dangerous queries. A SQL parser adds a dependency and 100+ lines of code but catches 99.9%. For a learning project, I chose simplicity while acknowledging the gap."

---

## 🔧 7. Deep Dive: Data Source Connection Management

> "Managing connections to external databases is tricky because we need to balance connection reuse (performance) against connection freshness (when credentials change)."

**Current approach**: A Map keyed by dataSourceId caches pools. First query for a data source creates a pool. Subsequent queries reuse it. If a pool errors, it is evicted and recreated.

**Problem at scale**: With 200K data sources, caching all pools is impossible (each pool reserves connections). We need an LRU eviction policy -- keep the most recently used 1000 pools, evict idle ones.

**Production alternative**: PgBouncer as a connection proxy. Instead of each API instance managing its own pools, all instances connect through PgBouncer which handles pooling centrally. This reduces total connections to target databases from `instances * pools * max_connections` to `pgbouncer_max * data_sources`.

| Approach | Pros | Cons |
|----------|------|------|
| ✅ In-process pool cache | Simple, no extra infrastructure | Per-instance pools, no sharing |
| ❌ PgBouncer proxy | Connection sharing, central management | Extra infrastructure, config complexity |
| ❌ Serverless proxy (Neon/Supabase) | Auto-scaling, zero config | Vendor lock-in, latency overhead |

---

## 🔧 8. Deep Dive: JSONB Storage Trade-offs

> "Storing components as JSONB is the most consequential data model decision. Let me compare it to the normalized alternative."

**JSONB approach (chosen)**:
- Single SELECT loads the entire app
- Schema changes (new component props) require zero migrations
- Atomic save: one UPDATE replaces the whole component tree

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

**Hybrid at scale**: Keep JSONB for the hot path (load/save app), but maintain a denormalized index table for cross-app queries. This table would store app_id, component_id, component_type, and data_source_refs (extracted from bindings) as columns. A background process or trigger populates it when apps are saved, enabling efficient admin queries without sacrificing the JSONB load/save performance.

---

## 🔒 9. Security and Multi-Tenancy

### Query Execution Safety

Read-only by default with explicit opt-in for writes. Connection isolation ensures one data source's failures do not cascade to others.

### Authentication

Session-based auth with Redis session store, bcrypt password hashing (10 rounds), rate limiting on auth endpoints (50 requests per 15 minutes), and CORS restricted to the frontend origin.

### Data Source Credential Protection

Credentials are stored in the JSONB config column. Passwords are masked in API responses. At production scale, credentials must be encrypted at rest using envelope encryption with a key management service. Access to data source configurations is restricted to the owning user.

### Multi-Tenancy Isolation

Apps are scoped by owner_id. Every query includes an owner_id filter to prevent cross-tenant data access. At scale, this evolves into PostgreSQL row-level security policies that enforce tenant boundaries at the database level rather than relying on application-layer filtering. Per-tenant rate limits on query execution prevent noisy neighbors from monopolizing shared infrastructure. Connection quotas per data source prevent a single tenant's workload from exhausting connection pools that could affect other tenants sharing the same target database.

> "Multi-tenancy is the silent complexity of any SaaS platform. The owner_id filter pattern works at small scale, but a single missed WHERE clause leaks data across tenants. Row-level security moves this enforcement to the database layer, making it impossible to accidentally bypass. The migration from application-layer to database-layer enforcement is a one-way door -- once enabled, every query is filtered automatically regardless of what the application code does."

---

## 📊 10. Observability

### Metrics (Prometheus)

The backend exposes four key metric families. Request duration is tracked as a histogram labeled by method, route, and status code, enabling p99 latency monitoring per endpoint. Query execution duration is tracked separately by data source type, isolating slow target databases from the metadata API performance. A request counter tracks total volume for capacity planning. An active apps gauge monitors growth.

### Structured Logging

Pino produces JSON logs with request context (method, path, duration, status). Each log entry includes a correlation ID for tracing a request through the query execution pipeline. Error logs include the data source ID and sanitized query text (with binding values redacted) to aid debugging without exposing user data.

### Health Checks

The health endpoint verifies metadata database connectivity and Redis session store availability. It returns a structured response with individual component statuses, enabling load balancers to route traffic away from unhealthy instances. At production scale, deep health checks would also verify connectivity to frequently used target databases.

### Alerting Strategy

Key alerts include: p99 save latency exceeding 200ms, query execution error rate exceeding 5% per data source, connection pool exhaustion (available connections dropping to zero), and session store unavailability. These metrics feed into Grafana dashboards for real-time visibility.

---

## 🔄 11. Caching Strategy

### Application Metadata Caching

Published app versions are immutable and ideal for caching. Once a version is published, it never changes, so the cache entry can live indefinitely (or until the app is deleted). The server caches published versions in Redis with a key pattern of `app_version:{app_id}:{version_number}`. Cache hits avoid a database read for every preview page load. Draft app state is not cached because it changes on every save operation and caching would introduce stale-read risks.

### Component Registry Caching

The component registry (widget definitions, prop schemas, default values) changes only on deployments. It is loaded into memory at startup and served directly from process memory, avoiding database or Redis round-trips entirely.

### Data Source Config Caching

Data source connection configurations are cached in-process for the lifetime of the connection pool. When a user updates their data source credentials, the old pool must be evicted from cache and a new pool created on the next query. This is handled by the PUT endpoint for data sources, which explicitly clears the cached pool entry.

> "I avoid caching draft app state because the edit-save cycle is so frequent that cache invalidation would fire on nearly every operation. The complexity of maintaining cache consistency for a rapidly changing document outweighs the latency savings of a cache hit."

---

## 🛡️ 12. Failure Handling

### Circuit Breaker for Target Databases

The circuit breaker wraps target database query execution. When a target database becomes unresponsive, the circuit opens after a 50% error threshold is reached, immediately failing subsequent queries rather than queuing them behind slow connections. After a 30-second cooldown, the circuit enters half-open state and allows one probe query. If it succeeds, the circuit closes and normal operation resumes.

> "Without a circuit breaker, a single slow target database could consume all available connection pool slots and request handler threads, degrading performance for all users -- even those querying different databases. The circuit breaker isolates failures to the affected data source."

### Connection Pool Recovery

When a target database pool encounters a connection error, the pool is evicted from the in-memory cache and destroyed. The next query for that data source creates a fresh pool. This handles credential rotation, network configuration changes, and transient DNS failures without requiring a server restart.

### Graceful Shutdown

On SIGTERM/SIGINT, the server stops accepting new connections, waits for in-flight requests to complete (with a 10-second deadline), drains all target database pools, disconnects from the metadata database, and closes the Redis session store. This ensures clean shutdown during deployments without dropping active requests.

### Error Propagation

Target database errors are translated into user-friendly messages before reaching the client. Connection refused errors become "Unable to connect to data source -- verify the host and port are correct." Authentication failures become "Data source credentials are invalid." Query syntax errors pass through the target database's error message directly, since these are the user's own SQL mistakes. Internal server errors are logged with full stack traces but return a generic 500 to the client to avoid leaking infrastructure details.

### Retry Policy

| Operation | Retries | Strategy | Rationale |
|-----------|---------|----------|-----------|
| Read queries (SELECT) | 2 | Exponential backoff | Safe to retry, transient failures common |
| Write queries | 0 | None | Non-idempotent, risk of duplicates |
| App save | 0 | None | Client retries with full state |
| Publish | 0 | None | UNIQUE constraint prevents duplicates |

---

## 📈 13. Scalability Considerations

**Horizontal API scaling**: Sessions in Redis, stateless API instances behind a load balancer. The bottleneck moves to PostgreSQL.

**Database scaling**: Read replicas for the apps dashboard query. The app editor hits a single row, so sharding is not immediately necessary. If needed, shard by owner_id (all of one user's apps on one shard).

**Query execution scaling**: A dedicated query execution service can scale independently from the app CRUD service. This isolates slow target DB queries from fast metadata operations. Query workers can be auto-scaled based on queue depth.

**Multi-tenancy at scale**: Row-level security on owner_id. Per-tenant rate limits on query execution. Connection quotas per data source to prevent noisy neighbors. Large tenants with heavy query workloads can be migrated to dedicated query execution pools.

**JSONB storage limits**: At 500K apps with average 50KB each, total storage is approximately 25GB. PostgreSQL handles this comfortably. For organizations with very large apps (thousands of components pushing JSONB documents to several megabytes), the component tree could be stored in object storage (S3) with only metadata kept in PostgreSQL.

**What breaks first**: The target database connection pool. With 200K data sources and each pool reserving up to 5 connections, a naive caching strategy would attempt to hold 1M database connections. LRU eviction with a cap of 1000 active pools per API instance is essential. At higher scale, a centralized connection proxy (PgBouncer) replaces per-instance pooling entirely.

**Deployment strategy**: Blue-green deployments allow zero-downtime releases. Since the API is stateless and sessions live in Redis, new instances can be brought up behind the load balancer while old instances drain their in-flight requests. Database migrations run as a separate step before deploying new code, ensuring backward compatibility. The graceful shutdown handler ensures no requests are dropped during instance rotation.

> "The scalability story for a no-code platform is unusual because the heaviest operations -- query execution against target databases -- are inherently bounded by external systems we do not control. Our job is to isolate those external dependencies so that one slow target database does not degrade the experience for users querying different databases. Circuit breakers, per-data-source connection pools, and rate limits are the tools for this isolation."

---

## ⚖️ 14. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Component storage | JSONB | Normalized tables | Schema flexibility, atomic save |
| Binding engine | Property path | eval() / V8 isolate | Security over expressiveness |
| Query safety | String prefix | SQL parser | Simplicity, 95% coverage |
| Connection mgmt | In-process pool cache | PgBouncer | Sufficient for local scale |
| Session storage | Redis + cookie | JWT | Immediate revocation |
| Versioning | Full snapshots | Diffs/patches | Simpler, predictable |
| Multi-tenant isolation | Application-layer owner_id | Row-level security | Simpler for initial scale |
| Draft caching | No cache | Redis cache | Edit frequency makes invalidation costly |
