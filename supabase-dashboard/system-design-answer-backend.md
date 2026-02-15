# Supabase Dashboard - Backend System Design Answer

## 1. Requirements Clarification

> "Before diving in, I want to clarify scope. We're building a BaaS management dashboard -- like Supabase Studio -- that lets developers introspect database schemas, run SQL queries, create/alter tables, and manage auth users. The key backend challenge is the two-database architecture: our metadata database stores dashboard state, while we dynamically connect to target databases that users configure per-project."

**Functional Requirements:**
- Project CRUD with per-project database connection configuration
- Dynamic schema introspection from target databases (tables, columns, types, constraints)
- Arbitrary SQL execution against target databases with result streaming
- DDL generation for table creation and alteration from structured inputs
- Auth user management (simulated Supabase auth.users)
- Saved query persistence and retrieval
- Connection testing to verify target database connectivity

**Non-Functional Requirements:**
- Schema introspection under 500ms for 100-table databases
- SQL query execution timeout at 30 seconds
- Support 10,000+ concurrent projects with connection pooling
- Session-based authentication with immediate revocation
- Rate limiting to prevent SQL execution abuse
- Structured logging and Prometheus metrics for observability

## 2. High-Level Architecture

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ HTTPS
┌──────┴──────┐
│  API Gateway │
│  / Load Bal  │
└──────┬──────┘
       │
  ┌────┼────┐
  │    │    │
┌─┴─┐┌┴──┐┌┴──┐
│S1 ││S2 ││S3 │    API Servers (stateless)
└─┬─┘└─┬─┘└─┬─┘
  │    │    │
  └────┼────┘
       │
┌──────┴──────────────────────────┐
│        Service Layer            │
│  ┌──────────┐  ┌──────────┐    │
│  │  Schema  │  │  Query   │    │
│  │  Intro-  │  │  Exe-    │    │
│  │  spector │  │  cutor   │    │
│  └────┬─────┘  └────┬─────┘    │
│       │              │          │
│  ┌────┴──────────────┴─────┐   │
│  │  Dynamic Pool Manager   │   │
│  │  Map<projectId, Pool>   │   │
│  └────┬──────────────┬─────┘   │
│       │              │         │
│  ┌────┴────┐    ┌────┴─────┐   │
│  │Metadata │    │ Target   │   │
│  │  DB     │    │   DB(s)  │   │
│  │(PG 5432)│    │(PG 5433) │   │
│  └─────────┘    └──────────┘   │
│                                │
│  ┌──────────┐                  │
│  │  Valkey  │  Sessions/Cache  │
│  └──────────┘                  │
└────────────────────────────────┘
```

> "The architecture separates metadata operations (project CRUD, saved queries, auth users) from target database operations (schema introspection, SQL execution, DDL). Every API server is stateless -- sessions live in Valkey, connection pools are per-instance. This means we can horizontally scale by adding API server instances behind a load balancer."

## 3. Data Model

### Metadata Database

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash, role | email, username | Dashboard admin users, bcrypt-hashed passwords |
| projects | id (UUID PK), name, db_host, db_port, db_name, db_user, db_password, created_by (FK users) | created_by | Per-project connection config stored here |
| project_members | id (UUID PK), project_id (FK), user_id (FK), role | (project_id, user_id) unique | Editor/viewer roles for multi-user access |
| saved_queries | id (UUID PK), project_id (FK), name, query_text, created_by (FK) | project_id | SQL queries saved for reuse |
| auth_users | id (UUID PK), project_id (FK), email, encrypted_password, email_confirmed, role, raw_user_metadata (JSONB) | (project_id, email) unique | Simulated Supabase auth |

> "The projects table is the pivot point -- it stores connection credentials for target databases. When a user hits the table editor or SQL editor, we look up the project's connection config and create or reuse a pool to that target database. The auth_users table simulates Supabase's GoTrue auth service -- in production Supabase, this would be a separate microservice with JWT issuance."

> "Notice the raw_user_metadata JSONB column on auth_users. This mirrors Supabase's approach to storing arbitrary user attributes without schema changes. A user's profile picture URL, display name, or phone number can all go in metadata without altering the table structure. This is a deliberate trade-off: JSONB isn't efficiently queryable with standard B-tree indexes, but user metadata is typically read by primary key, not searched."

### Target Database

The target database has an unknown, user-defined schema. We introspect it at runtime through PostgreSQL's information_schema views rather than maintaining any schema assumptions. The sample database ships with products, customers, orders, and order_items tables to provide immediate value on first setup.

## 4. API Design

```
POST /api/auth/register        Register dashboard user
POST /api/auth/login           Login, returns session cookie
POST /api/auth/logout          Destroy session
GET  /api/auth/me              Current user

GET  /api/projects             List user's projects
POST /api/projects             Create project with DB config
PUT  /api/projects/:id         Update project
DELETE /api/projects/:id       Delete project
POST /api/projects/:id/test-connection    Verify connectivity

GET  /api/projects/:pid/tables           Introspect schema
POST /api/projects/:pid/tables           Create table (DDL)
PUT  /api/projects/:pid/tables/:name     Alter table
DELETE /api/projects/:pid/tables/:name   Drop table

GET  /api/projects/:pid/tables/:name/rows   Paginated rows
POST /api/projects/:pid/tables/:name/rows   Insert row
PUT  /api/projects/:pid/tables/:name/rows/:id   Update row
DELETE /api/projects/:pid/tables/:name/rows/:id Delete row

POST /api/projects/:pid/sql/execute      Execute arbitrary SQL
GET  /api/projects/:pid/sql/saved        List saved queries
POST /api/projects/:pid/sql/saved        Save query
PUT  /api/projects/:pid/sql/saved/:id    Update saved query
DELETE /api/projects/:pid/sql/saved/:id  Delete saved query

GET  /api/projects/:pid/auth-users       List auth users
POST /api/projects/:pid/auth-users       Create auth user
PUT  /api/projects/:pid/auth-users/:id   Update auth user
DELETE /api/projects/:pid/auth-users/:id Delete auth user

GET  /api/projects/:pid/settings         Get project settings
PUT  /api/projects/:pid/settings         Update settings
```

> "Notice the URL structure: everything under /projects/:pid/ scopes operations to a specific project. The route handler looks up the project's connection config from the metadata database, then uses the dynamic pool manager to execute against the correct target database. This means adding a new target database is just creating a new project row -- no server restart needed."

> "The table data endpoints use a primary key convention. GET accepts sortBy and sortOrder query params for server-side sorting. PUT and DELETE require the row's primary key value in the URL path. The client must know the primary key column name, which it gets from the schema introspection response. This is a pragmatic approach -- it works for single-column primary keys but would need extension for composite keys."

## 5. Deep Dive: Dynamic Schema Introspection

> "Schema introspection is the backbone of the table editor. When a user opens the table list, we need to discover every table, its columns, types, constraints, and approximate row counts from a database we've never seen before."

**The introspection pipeline:**

1. Look up project connection config from metadata DB
2. Open a short-lived client connection to the target database (not pooled -- we want fresh schema)
3. Query information_schema.tables for all public base tables
4. For each table, run three queries:
   - information_schema.columns for column definitions (name, type, nullable, default, ordinal position)
   - table_constraints + key_column_usage for primary keys
   - table_constraints + key_column_usage + constraint_column_usage for foreign keys
5. Query pg_class.reltuples for estimated row counts (avoiding expensive COUNT(*))
6. Assemble and return structured TableInfo objects with column details

**Why short-lived connections for introspection?**

> "Pooled connections may return stale schema information if PostgreSQL caches catalog lookups within a session. By using a fresh client connection, we guarantee the introspection reflects the latest DDL changes. This costs ~50ms per introspection call but ensures accuracy -- a critical trade-off for a schema browser."

| Approach | Pros | Cons |
|----------|------|------|
| Short-lived client | Always fresh schema, no stale cache | 50ms connection overhead per call |
| Pooled connection | Fast, reuses existing connection | May miss recent DDL changes |

> "I chose short-lived connections because schema accuracy is non-negotiable in a database management tool. Users expect to see their CREATE TABLE results immediately. The 50ms overhead is acceptable for an operation that typically happens when navigating to the table editor, not on every keystroke."

**Row count estimation:**

> "We use pg_class.reltuples instead of COUNT(*) because a full table scan on a 10M-row table takes seconds. reltuples returns the last ANALYZE estimate, which is usually accurate within 10%. For a dashboard showing approximate counts, this is perfect. We'd add a 'Refresh count' button that runs the actual COUNT(*) for users who need precision."

**N+1 query concern:**

> "The current approach runs 3 queries per table (columns, PKs, FKs). For a database with 100 tables, that's 301 queries per introspection call. This is fine for 10-table databases but becomes a bottleneck at 100+. The optimization path is to batch: query all columns across all tables in one query, all PKs in another, and all FKs in a third, then group by table name in application code. That reduces 301 queries to 4 regardless of table count. We'd implement this when introspection latency exceeds our 500ms target."

## 6. Deep Dive: SQL Execution Sandboxing

> "The SQL editor lets users run arbitrary SQL against their target database. This is inherently dangerous -- a malicious or careless query could DROP DATABASE, run for hours, or return gigabytes of data. We need multiple layers of protection."

**Defense layers:**

1. **Connection credentials** - The target database user should have limited privileges. In production, we'd create a dedicated role per project with specific grants (SELECT, INSERT, UPDATE, DELETE on specific schemas). Locally, the sample user has full access to sample_db for development convenience.

2. **Statement timeout** - The pg.Pool is configured with connectionTimeoutMillis (5s to establish) and the query itself gets a 30-second timeout via PostgreSQL's statement_timeout parameter. This prevents a single runaway query from holding a connection indefinitely, which would eventually exhaust the pool.

3. **Rate limiting** - 100 SQL executions per minute per user. Prevents automated abuse (like running a script that hammers the endpoint) while allowing normal interactive use. A developer typing and running queries rarely exceeds 10 per minute.

4. **Result pagination** - We don't stream unlimited result sets. Queries returning more than a configurable limit get truncated with a warning. This prevents a SELECT * on a billion-row table from consuming all server memory.

5. **Metrics and alerting** - Every query execution is timed via Prometheus histogram, labeled by project and query type (SELECT, INSERT, UPDATE, DELETE). Slow queries trigger alerts. This gives operational visibility into which projects are running expensive queries.

| Approach | Pros | Cons |
|----------|------|------|
| Server-side timeout | Prevents runaway queries, simple to implement | Abrupt termination, user loses partial results |
| Read-only mode | Prevents destructive operations | Too restrictive -- a database management dashboard needs write access |
| Statement parsing | Block specific statements (DROP DATABASE) | Complex, easy to bypass with dynamic SQL, CTEs, stored procedures |

> "I chose server-side timeout over statement parsing because parsing SQL to block dangerous statements is a cat-and-mouse game -- users can construct dynamic SQL, use CTEs, or call functions that internally execute DDL. The timeout approach is simpler and catches all cases. Combined with per-project credentials that limit privileges, this provides defense in depth without trying to be smarter than PostgreSQL's own permission system."

**Query type detection for metrics:**

> "We extract the first word of the SQL statement (SELECT, INSERT, UPDATE, DELETE, CREATE, DROP) for metrics labeling. This is a best-effort classification -- CTEs starting with WITH followed by a DELETE would be labeled as WITH. For metrics purposes, this imprecision is acceptable. If we needed precise classification, we'd use a SQL parser library, but that adds significant complexity for marginal observability benefit."

**Error message passthrough:**

> "When a query fails, we return PostgreSQL's error message verbatim to the client. This is intentional -- PostgreSQL error messages include line numbers, position offsets, and detailed descriptions that help developers debug their SQL. Sanitizing these messages would lose valuable debugging information. Since this is a development tool (not a public-facing API), exposing database error details is appropriate and expected."

## 7. Deep Dive: Multi-Tenant Database Management

> "Each project connects to a potentially different database. At scale, we might have 10,000 projects with 10,000 different connection configurations. The challenge is managing these connections without exhausting server resources."

**Pool lifecycle:**

1. **Creation**: On first query for a project, create a pg.Pool with max=5 connections
2. **Caching**: Store in Map<projectId, Pool> for subsequent queries
3. **Eviction**: Remove pool when project settings change (user updates connection config)
4. **Idle cleanup**: Pools auto-close connections after 60 seconds of inactivity
5. **Error handling**: Pool error handler removes failed pools from cache, preventing retry storms against a dead database
6. **Shutdown**: SIGTERM handler iterates all pools and closes them gracefully

**Why max=5 per project?**

> "Five connections per project is a trade-off between concurrency and resource consumption. A single user browsing tables and running queries rarely needs more than 2 concurrent connections. Five handles the case where the table browser, SQL editor, and schema introspector are all running simultaneously. At 10,000 projects, worst case is 50,000 connections -- which requires PgBouncer in production. One connection per project would serialize all operations (table browse blocks while SQL runs); unlimited connections would risk exhausting PostgreSQL's max_connections."

**Scaling beyond a single server:**

> "Each API server maintains its own pool map -- there's no cross-server coordination. This is intentional: connection pools are lightweight local resources, and sharing them across servers would require a distributed connection broker (adding latency and a new failure point). Instead, we rely on the load balancer's sticky sessions (or session affinity via cookie) to route requests for the same project to the same server, maximizing pool reuse. If a server dies, the new server creates fresh pools -- there's no state to recover."

| Scale | Strategy | Connection Budget |
|-------|----------|-------------------|
| 1-100 projects | Direct pools, max 5 per project | 500 connections |
| 100-1,000 | LRU eviction, idle timeout 60s | 1,000 connections |
| 1,000-10,000 | PgBouncer + on-demand pools | 5,000 via bouncer |
| 10,000+ | Tiered: hot pools + cold on-demand | 10,000 via bouncer |

> "The tiered approach at 10,000+ projects distinguishes 'hot' projects (actively being used in the last 5 minutes) from 'cold' projects (last accessed hours ago). Hot projects maintain persistent pools; cold projects create on-demand connections that are discarded after use. The system tracks last-access timestamps and promotes/demotes projects between tiers automatically. This ensures the 80% of traffic from the most active 20% of projects gets connection reuse, while cold projects don't waste resources."

## 8. Observability

> "A system that manages connections to unknown databases needs strong observability. We can't predict what queries users will run or which target databases will be slow."

**Prometheus metrics:**
- http_request_duration_seconds -- histogram by method, route, status code with 6 buckets from 10ms to 5s
- http_requests_total -- counter by method, route, status code for throughput monitoring
- query_execution_duration_seconds -- histogram by project ID and query type, critical for identifying slow projects
- active_target_connections -- gauge tracking live connection pools, for capacity planning

**Structured logging (Pino):**
- JSON format in production for log aggregation tools (ELK, Datadog, Grafana Loki)
- Pretty-printed in development for readability
- Request context: project ID, user ID, query type, duration
- Error context: PostgreSQL error code, connection details, stack trace

**Health check:**
- GET /api/health tests metadata database connectivity
- Returns 200 with status: ok, or 503 with status: unhealthy
- Load balancer uses this to route traffic away from unhealthy instances

## 9. Failure Handling

**Target database unreachable:**
- Circuit breaker (Opossum) opens after 50% error rate within a 10-second window
- Pool error handler removes the pool from cache, forcing recreation on next request
- Connection test endpoint returns clear error message before user tries to query
- Failing gracefully: the dashboard still works for metadata operations even if the target is down

**Metadata database failure:**
- Health check endpoint returns 503
- Load balancer routes to healthy instances
- Sessions survive in Valkey (independent of metadata DB)
- Degraded mode: existing sessions can still query target databases if pool is cached, but can't load saved queries or project settings

**Query execution failure:**
- Error message returned to client with PostgreSQL error details (code, message, position)
- No partial results on timeout -- connection is terminated cleanly
- Retry is user-initiated (click "Run" again) -- no automatic retry for SQL execution
- Rate limiter prevents retry storms from overwhelming the target database

## 10. Scalability

**What breaks first:** Connection pool count. At 1,000+ active projects per server, memory and file descriptors become the bottleneck. Each pool holds up to 5 TCP connections, and each connection consumes a file descriptor plus ~10MB of PostgreSQL backend memory.

**How to scale:**
1. Add PgBouncer between API servers and target databases -- multiplexes many application connections over fewer database connections
2. Implement LRU pool eviction with a configurable cap (e.g., 200 active pools per server)
3. Cache schema introspection results in Valkey with 60-second TTL
4. Horizontal scale API servers (stateless, sessions in Valkey) behind a load balancer
5. Read replicas for metadata database to handle saved query listing and project listing at scale
6. Partition auth_users table by project_id if it grows beyond millions of rows

## 11. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Database architecture | Two separate PostgreSQL | Single DB, schema separation | Per-project isolation, external DB support |
| Connection management | Cached pool per project | Per-request connections | 50-100ms latency saving per query |
| Schema introspection | information_schema | pg_catalog | SQL-standard, readable types, portable |
| DDL generation | Server-side structured | Client-side raw SQL | Validation, sanitization, prevents injection |
| SQL sandboxing | Timeout + rate limit | Statement parsing/blocking | Simpler, catches all cases without cat-and-mouse |
| Session storage | Valkey + cookie | JWT | Immediate revocation, simpler session management |
| Pool sizing | 5 per project | Unlimited/1 per project | Balance concurrency vs resource consumption |
| Error messages | Passthrough PostgreSQL errors | Sanitized generic errors | Developer tool needs detailed debugging info |
