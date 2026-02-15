# Supabase Dashboard - Full-Stack System Design Answer

## 1. Requirements Clarification

> "We're building a Supabase Studio-like dashboard -- a BaaS management interface where developers manage databases, run SQL, and administer auth users. The defining full-stack challenge is the two-database architecture: the dashboard's own metadata database and dynamically-connected target databases. The frontend must handle schema data it discovers at runtime, while the backend manages connection pools to databases it knows nothing about in advance."

**Functional Requirements:**
- Project CRUD with database connection configuration
- Dynamic schema introspection from target databases
- Spreadsheet-like table data browser with CRUD
- SQL editor with query execution and saved queries
- DDL generation for table creation and alteration
- Auth user management (simulated Supabase auth)
- Connection testing with live status indicators

**Non-Functional Requirements:**
- Schema introspection under 500ms
- SQL query timeout at 30 seconds
- Dark theme matching Supabase branding (#1C1C1C bg, #3ECF8E primary)
- Session-based auth with immediate revocation
- Keyboard shortcuts in SQL editor

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────┐
│              Client (React SPA)               │
│  ┌────────┐ ┌─────────┐ ┌──────┐ ┌────────┐ │
│  │ Table  │ │  SQL    │ │ Auth │ │Settings│ │
│  │ Editor │ │ Editor  │ │ Mgmt │ │        │ │
│  └───┬────┘ └────┬────┘ └──┬───┘ └───┬────┘ │
│      └───────────┴─────────┴─────────┘       │
└─────────────────────┬────────────────────────┘
                      │ HTTP/JSON
               ┌──────┴──────┐
               │ Express API  │
               │  (Stateless) │
               └──────┬──────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
┌───┴────┐     ┌─────┴─────┐     ┌────┴────┐
│Metadata│     │  Dynamic  │     │ Valkey  │
│   DB   │     │Pool Manager│     │Sessions │
│PG 5432 │     │           │     │  Cache  │
└────────┘     └─────┬─────┘     └─────────┘
                     │
              ┌──────┴──────┐
              │  Target DB  │
              │  PG 5433    │
              └─────────────┘
```

> "The architecture has three data paths: (1) metadata operations go to the metadata DB, (2) schema/data operations go through the dynamic pool manager to target databases, (3) session operations go to Valkey. The frontend doesn't know about this split -- it just calls API endpoints and the backend routes to the correct database based on the project's stored connection config."

## 3. Data Model

### Metadata Database (5 tables)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| users | id (UUID), username (unique), email (unique), password_hash | Dashboard authentication |
| projects | id (UUID), name, db_host, db_port, db_name, db_user, db_password, created_by | Connection config per project |
| project_members | project_id, user_id, role | Multi-user access control |
| saved_queries | project_id, name, query_text, created_by | Persistent SQL queries |
| auth_users | project_id, email, encrypted_password, role, raw_user_metadata (JSONB) | Simulated Supabase auth |

> "The projects table stores everything needed to connect to a target database. When connection settings change, the backend evicts the cached connection pool so the next query uses fresh credentials. This is the central coordination point between metadata and target database operations."

### Target Database

Unknown schema -- discovered at runtime via information_schema. The sample database ships with products, customers, orders, and order_items tables with seeded e-commerce data, giving users something to introspect and query immediately.

## 4. API Design

```
POST /api/auth/register         Dashboard user registration
POST /api/auth/login            Session-based login
POST /api/auth/logout           Session destruction
GET  /api/auth/me               Current session check

GET    /api/projects             User's projects
POST   /api/projects             Create with DB config
PUT    /api/projects/:id         Update project
DELETE /api/projects/:id         Delete project
POST   /api/projects/:id/test-connection  Verify DB connectivity

GET    /api/projects/:pid/tables              Schema introspection
POST   /api/projects/:pid/tables              Create table (DDL)
PUT    /api/projects/:pid/tables/:name        Alter table (add/drop/rename column)
DELETE /api/projects/:pid/tables/:name        Drop table

GET    /api/projects/:pid/tables/:name/rows   Paginated rows (sortBy, sortOrder, page, limit params)
POST   /api/projects/:pid/tables/:name/rows   Insert row
PUT    /api/projects/:pid/tables/:name/rows/:id  Update row
DELETE /api/projects/:pid/tables/:name/rows/:id  Delete row

POST   /api/projects/:pid/sql/execute         Run arbitrary SQL
GET    /api/projects/:pid/sql/saved           List saved queries
POST   /api/projects/:pid/sql/saved           Save query
PUT    /api/projects/:pid/sql/saved/:id       Update saved query
DELETE /api/projects/:pid/sql/saved/:id       Delete saved query

GET    /api/projects/:pid/auth-users          List auth users
POST   /api/projects/:pid/auth-users          Create auth user
PUT    /api/projects/:pid/auth-users/:id      Update auth user
DELETE /api/projects/:pid/auth-users/:id      Delete auth user

GET    /api/projects/:pid/settings            Project settings
PUT    /api/projects/:pid/settings            Update settings (invalidates pool cache)
```

## 5. Frontend Architecture

**Routing (TanStack Router, file-based):**

```
/                     Project dashboard (list, create)
/login                Login page
/register             Registration page
/project/:id/tables   Table editor with schema viewer sidebar
/project/:id/tables/:name   Table data browser (paginated grid)
/project/:id/sql      SQL editor with saved queries and results
/project/:id/auth     Auth user management
/project/:id/settings Project settings and connection config
```

**State management (Zustand):**

Two stores: authStore for authentication, projectStore for all project-scoped data (tables, query results, auth users, settings). A single projectStore simplifies atomic project switching -- when the user navigates to a different project, all data resets together without coordinating across multiple stores.

**Component tree (~16 components):**

> "The project layout renders a persistent sidebar with four navigation items (Tables, SQL, Auth, Settings) and a breadcrumb showing the current path. Child routes render in the content area. This means sidebar state (which item is active, which project is selected) persists across section navigation without re-mounting. Navigation between Tables and SQL editor is instant -- only the content area re-renders."

## 6. Deep Dive: Two-Database Architecture

> "The two-database model is the core architectural decision. Everything flows from it -- API routing logic, connection management, and the separation between 'dashboard state' and 'user data'."

**Why two databases?**

The metadata database has a fixed schema that we control (users, projects, saved_queries). The target database has a schema we discover at runtime and modify through DDL operations. If they shared a database:

1. Dashboard migrations could conflict with user tables (what if a user creates a table named "users" or "saved_queries"?)
2. Connection credentials would be shared -- the dashboard admin role would have access to all user data
3. We couldn't support connecting to external databases (the core Supabase use case -- each project is a separate PostgreSQL instance)
4. A bug in the dashboard could accidentally drop user tables, and vice versa

> "In production Supabase, each project gets its own PostgreSQL instance running in an isolated container. Our local version simplifies to two instances on different ports, but the architecture is the same: the metadata database knows about projects, the target database knows about user data, and the API layer bridges them."

**Request flow for schema introspection:**

1. Frontend calls GET /api/projects/:pid/tables
2. Backend looks up project connection config from metadata DB (SELECT db_host, db_port, db_name, db_user, db_password FROM projects)
3. Backend opens a fresh client connection to the target DB (not pooled -- ensures fresh schema)
4. Backend queries information_schema for tables, columns, constraints
5. Backend queries pg_class.reltuples for row count estimates
6. Backend assembles structured TableInfo objects and returns JSON
7. Frontend receives JSON and renders the schema viewer

> "Steps 2-3 hit different databases. The route handler is the bridge -- it reads from metadata to know where to connect, then reads from the target to get the actual schema. This dual-database round trip adds ~100ms compared to a single-database approach (one extra DB lookup + one new TCP connection), but the isolation is essential."

**Request flow for SQL execution:**

1. Frontend sends POST /api/projects/:pid/sql/execute with SQL string
2. Backend looks up project connection config from metadata DB
3. Backend gets or creates a cached pg.Pool for this project
4. Backend executes the SQL against the target DB via the pool
5. Backend returns rows, fields, and rowCount to the frontend
6. Frontend renders results in QueryResults component

> "Steps 3-4 use the dynamic pool manager. Unlike introspection (which uses a fresh client connection for accuracy), SQL execution reuses pooled connections for performance. A single SQL editor session might run dozens of queries, and the 50ms connection overhead per query would add up. The trade-off: pooled connections may have stale session state. We mitigate this by not modifying session-level state in user queries."

| Approach | Pros | Cons |
|----------|------|------|
| Two databases | Clean isolation, external DB support, no namespace conflicts | Dual round-trip, connection management complexity |
| Single database, schema separation | Simpler, fewer connections, one migration system | Name conflicts, shared credentials, can't connect to external DBs |
| Single database, row-level security | Fine-grained access without schema separation | Complex policies, PostgreSQL-specific, hard to debug |

## 7. Deep Dive: DDL Generation and Schema Management

> "Users can create and alter tables through structured forms instead of writing raw SQL. The challenge is generating correct DDL from UI inputs while preventing SQL injection through table and column names."

**Create table flow (frontend to backend to target DB):**

1. User opens CreateTableModal, which pre-populates with id (SERIAL, PK) and created_at (TIMESTAMPTZ, default NOW())
2. User adds columns using ColumnEditor components -- each has name, type dropdown, nullable checkbox, PK checkbox, default value
3. Frontend sends structured column definitions to POST /api/projects/:pid/tables
4. Backend DDL generator produces CREATE TABLE SQL from the definitions
5. Backend sanitizes all identifiers (table name and column names) -- strips non-alphanumeric characters, quotes reserved words
6. Backend executes the DDL against the target database
7. Backend returns the generated SQL to the frontend (for transparency)
8. Frontend refreshes the table list by calling the schema introspection endpoint

**Identifier sanitization:**

> "The DDL generator strips all characters except [a-zA-Z0-9_] from identifiers and quotes PostgreSQL reserved words. If a user names a table 'users; DROP DATABASE sample_db;--', the sanitizer produces the identifier 'usersDROPDATABASEsampledb'. If they name a column 'select', it gets quoted as 'select'. This is simpler and more reliable than trying to parse and block specific SQL injection patterns."

**Column type selection:**

> "The column editor offers a dropdown of 16 common PostgreSQL types (SERIAL, BIGSERIAL, INTEGER, BIGINT, TEXT, VARCHAR, BOOLEAN, TIMESTAMPTZ, UUID, JSONB, NUMERIC, etc.) rather than a free-text input. This prevents invalid type names and guides users toward standard types. Advanced types (arrays, composite, domain types, custom enums) require the SQL editor. This is an intentional 80/20 split."

| Approach | Pros | Cons |
|----------|------|------|
| Structured form + DDL generation | Validated, safe from injection, guided UX | Limited to common types and constraints |
| Raw SQL textarea only | Full flexibility, no feature limits | Error-prone for beginners, SQL injection risk in shared dashboards |
| Visual schema builder (drag-and-drop) | Most intuitive for non-developers | Complex to implement, limited flexibility, heavy UI |

> "I chose structured forms because they cover 90% of table creation needs while being safe by default. The SQL editor handles the remaining 10% for power users who need partial indexes, CHECK constraints, or custom types. This layered approach serves both beginners and experts without compromising security."

**Alter table operations:**

> "Three operations are supported through the PUT endpoint: addColumn (adds a column definition), dropColumn (removes by name), and renameColumn (changes name preserving type and constraints). Each generates the appropriate ALTER TABLE statement. We don't support altering column types through the structured UI because type changes can fail with existing data -- if you have strings in a column and try to change it to integer, PostgreSQL throws an error. That's better handled through the SQL editor where the user can add explicit USING casts."

## 8. Deep Dive: Auth User Simulation

> "Supabase provides a full authentication service (GoTrue) with JWT issuance, email confirmation, OAuth providers, and password reset. Our dashboard simulates this by storing auth users in the metadata database with the essential fields: email, encrypted password, role, confirmation status, and arbitrary metadata."

**Why metadata DB, not target DB?**

> "In production Supabase, the auth.users table lives in the project's database in a separate 'auth' schema. We store it in the metadata DB instead because: (1) we don't want to modify the target database's schema for auth simulation -- that would mean running DDL on the user's database for dashboard purposes, (2) the metadata DB already has the project_id foreign key structure for scoping, (3) it keeps all dashboard state in one place, making backup and restore simpler."

**Auth user management UI:**

```
┌──────────────────────────────────────────────────┐
│ Auth Users                          [Add User]   │
│ Manage authentication users                      │
├──────────────────────────────────────────────────┤
│ Email           │ Role         │ Confirmed │ ...  │
├─────────────────┼──────────────┼───────────┼──────┤
│ alice@ex.com    │ authenticated│   (green) │ Edit │
│ bob@ex.com      │ anon         │   (gray)  │ Edit │
│ admin@ex.com    │ service_role │   (green) │ Edit │
└──────────────────────────────────────────────────┘
```

> "The auth user form has three role options: authenticated (default logged-in user), anon (public/anonymous), and service_role (admin with bypass). These map to Supabase's actual role system and correspond to the JWT claims that Supabase uses for row-level security. The email_confirmed boolean controls whether the user would be allowed to log in in a real system -- in our simulation, it's a status display that helps users understand the confirmation flow."

**What's missing vs. real Supabase auth:**

- JWT issuance and refresh token rotation
- OAuth provider integration (Google, GitHub, Apple, etc.)
- Email verification flow (send email, click link, confirm)
- Password reset flow (forgot password, email link, reset form)
- MFA/TOTP support
- Row-level security integration (policies referencing auth.uid())
- Magic link and OTP login

> "These omissions are intentional -- implementing a full auth service would be a separate system design problem equivalent in scope to the entire dashboard. Our simulation captures the management experience: listing users, creating them with roles, toggling confirmation status. This is sufficient for the dashboard UI design learning goals while keeping the implementation focused."

## 9. Failure Handling

**Frontend error handling:**
- API errors are caught by Zustand store actions and stored as error strings
- Components check for error state and render red banners with the server's error message
- SQL execution errors show PostgreSQL error messages verbatim (line numbers, position offsets)
- Connection test failures show a red "Disconnected" indicator with error tooltip
- Loading states show "Loading..." text to prevent user action during data fetch

**Backend error handling:**
- Circuit breaker wraps target database operations (opens at 50% error rate, resets after 30s)
- Connection pool errors trigger pool eviction from the cache, forcing recreation on next request
- Health check at GET /api/health verifies metadata DB connectivity
- Graceful shutdown: SIGTERM closes all target pools, then metadata pool, then exits
- Rate limiting: 1000 req/15min API-wide, 50 req/15min auth, 100 req/min SQL queries

## 10. Scalability

**What breaks first:** Target database connection pools. Each active project holds up to 5 connections. At 1,000 projects per server, that's 5,000 connections -- exceeding most PostgreSQL max_connections defaults.

**How to scale:**
1. PgBouncer as connection multiplexer between API servers and target databases -- shares connections across projects
2. LRU pool eviction when pool count exceeds a configurable threshold (e.g., 200 per server)
3. Schema introspection caching in Valkey (60-second TTL) -- avoids re-introspecting unchanged schemas
4. Horizontal API server scaling (stateless, sessions in Valkey) behind a load balancer
5. Tiered pooling: frequently-accessed projects get persistent pools, infrequent projects get on-demand connections

**Frontend scaling:**
- Table data browser uses server-side pagination (50 rows per page) -- bounded memory
- No infinite scroll -- predictable render cost regardless of table size
- Schema introspection results cached in Zustand until project switch or explicit refresh
- SQL results displayed in a scrollable container with max-height constraint

## 11. Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Database architecture | Two PostgreSQL instances | Single DB with schemas | Isolation, external DB support, no namespace conflicts |
| DDL approach | Structured forms + generator | Raw SQL input only | Safe by default, guided UX, injection prevention |
| Auth simulation | Metadata DB table | Target DB auth schema | No target DB modifications for dashboard state |
| SQL editor | Plain textarea | CodeMirror/Monaco | Zero dependencies, replaceable interface |
| Connection pooling | Cached per-project pools | Per-request connections | 50-100ms latency saving, connection reuse |
| State management | Zustand (single project store) | React Query / per-feature | Atomic project switching, simple coordination |
| Table browser | Paginated HTML table | Virtualized grid | Clear row counts, bounded memory, natural SQL metaphor |
| Session storage | Valkey + cookie | JWT tokens | Immediate revocation, no token refresh complexity |
