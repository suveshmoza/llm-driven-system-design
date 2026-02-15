# Supabase Dashboard - Development Notes

## Project Context

This project implements a simplified Supabase Studio dashboard -- a BaaS management interface for database introspection, SQL execution, and auth user management. The core challenge is the two-database architecture: a metadata database for the dashboard itself, and dynamic connections to target databases that users manage through the UI.

## Development Phases

### Phase 1: Architecture and Design
- Defined two-database model (metadata DB on 5432, target DB on 5433)
- Designed schema introspection via information_schema queries
- Planned DDL generation for structured table creation/alteration
- Chose dark-themed UI with Supabase brand colors (#3ECF8E primary)

### Phase 2: Backend Implementation
- Express API with session auth (Valkey-backed)
- Project CRUD with per-project database connection configuration
- Dynamic pool management for target databases (keyed by project ID)
- Schema introspection service querying information_schema.tables, columns, key_column_usage
- DDL generator producing CREATE TABLE, ALTER TABLE, DROP TABLE from structured inputs
- SQL executor for arbitrary query execution against target databases
- Auth user service simulating Supabase auth.users table management
- 7 route files: auth, projects, tables, tableData, sql, authUsers, settings, users

### Phase 3: Frontend Implementation
- Dark-themed dashboard with Supabase brand colors
- Project list with create/delete, connection status indicators
- Table editor with schema viewer showing columns, types, PK/FK constraints
- Table data browser with pagination, sorting, inline editing, row insert/delete
- SQL editor with Ctrl+Enter to run, saved queries sidebar
- Auth user management with create/edit/delete forms
- Project settings with connection configuration

## Key Design Decisions

### Two-Database Architecture
The metadata database (supabase_meta) and target database (sample_db) are completely separate PostgreSQL instances on different ports. This mirrors production Supabase where user databases are isolated from the platform's own database. The query executor creates dynamic connection pools keyed by project ID, enabling each project to connect to a different database.

### Dynamic Pool Management
Rather than opening a new connection for every query, the query executor maintains a Map of pg.Pool instances keyed by project ID. Pools are created on first use, cached for subsequent queries, and cleaned up when connection config changes or on shutdown. This prevents connection exhaustion while supporting multiple concurrent projects.

### Schema Introspection via information_schema
Instead of using pg_catalog directly, we query information_schema.tables, information_schema.columns, and join to table_constraints + key_column_usage for PK/FK detection. The information_schema approach is more portable and produces cleaner output, at the cost of slightly more joins. Row count estimates come from pg_class.reltuples.

### DDL Generation with Identifier Sanitization
The DDL generator produces SQL strings from structured column definitions. All identifiers are sanitized to alphanumeric + underscore characters, and reserved words are quoted. This prevents SQL injection through table/column names while keeping the generated SQL readable.

### Session Auth over JWT
Sessions stored in Valkey with express-session. Simpler than JWT for this use case -- immediate revocation, no token refresh complexity, and consistent with the retool project pattern.

### Supabase Dark Theme
The frontend uses Supabase's dark color scheme by default (#1C1C1C background, #3ECF8E primary green). This matches the real Supabase Studio aesthetic and provides a comfortable coding environment for the SQL editor.

## Open Questions

- Should the SQL editor support multiple statements separated by semicolons?
- How to handle connection pool limits when many projects are active simultaneously?
- Should DDL changes trigger automatic schema cache invalidation?
- How to implement row-level security (RLS) policy management?
- Should saved queries support parameterized variables?

## Learnings

- Two-database architectures require careful connection lifecycle management -- pools must be created, cached, and invalidated correctly
- information_schema queries are verbose but provide clean, structured metadata compared to pg_catalog
- DDL generation from structured inputs is safer than string concatenation but still requires careful identifier sanitization
- The metadata/target split means every route handler needs to determine which database to talk to, which adds routing complexity
- Dark-themed UIs need careful contrast ratios -- text readability suffers if foreground/background are too close
