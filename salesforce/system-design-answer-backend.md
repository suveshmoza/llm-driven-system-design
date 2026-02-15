# Salesforce CRM - Backend System Design Answer

## 1. Requirements Clarification (2 minutes)

"Before diving in, let me clarify scope. We're building a CRM system -- the core of any sales organization. I want to confirm a few things:

- **Entity model**: Accounts, Contacts, Opportunities, Leads, Activities -- the standard Salesforce object model?
- **Pipeline**: Kanban-style opportunity management with stage transitions and probability tracking?
- **Lead conversion**: The atomic workflow where a Lead becomes an Account + Contact + Opportunity?
- **Reporting**: Dashboard KPIs and pipeline/revenue analytics?
- **Scale target**: Tens of thousands of concurrent sales reps, millions of records?
- **Multi-tenancy**: Are we building for a single organization or SaaS multi-tenant?

Great. I'll focus on the data model, lead conversion atomicity, pipeline reporting, and custom fields extensibility. I'll assume single-tenant initially and discuss multi-tenant scaling at the end."

## 2. High-Level Architecture (5 minutes)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐
│   Web App   │────▶│  API Gateway │────▶│    Service Layer         │
│  (React)    │     │  (Rate Limit │     │                         │
└─────────────┘     │   + Auth)    │     │  ┌─────────────────┐    │
                    └──────────────┘     │  │ Account Service  │    │
                                        │  ├─────────────────┤    │
                                        │  │ Contact Service  │    │
                                        │  ├─────────────────┤    │
                                        │  │   Opp Service    │    │
                                        │  ├─────────────────┤    │
                                        │  │  Lead Service    │    │
                                        │  ├─────────────────┤    │
                                        │  │Activity Service  │    │
                                        │  ├─────────────────┤    │
                                        │  │ Report Service   │    │
                                        │  └────────┬────────┘    │
                                        └───────────┼─────────────┘
                                                    │
                                          ┌─────────┴─────────┐
                                          │                   │
                                   ┌──────▼──────┐    ┌───────▼──────┐
                                   │ PostgreSQL  │    │    Redis     │
                                   │  (Primary)  │    │  (Sessions   │
                                   │             │    │   + Cache)   │
                                   └──────┬──────┘    └──────────────┘
                                          │
                                   ┌──────▼──────┐
                                   │  Read       │
                                   │  Replicas   │
                                   └─────────────┘
```

> "The architecture is a standard service layer over PostgreSQL. CRM data is inherently relational -- accounts have contacts, contacts link to opportunities, opportunities have activities. A relational database is the natural fit. I use Redis for session management and caching frequently-accessed dashboard KPIs.

Why PostgreSQL over a NoSQL option like MongoDB? CRM data has strong relational integrity requirements -- a contact belongs to an account, an opportunity belongs to an account and has a close date for pipeline forecasting. These are JOIN-heavy access patterns that relational databases excel at. MongoDB would require denormalization (embedding contacts inside account documents), which creates data consistency problems when the same contact appears in multiple views.

At scale, I'd split into microservices per entity domain, add read replicas for reporting queries, and introduce Elasticsearch for cross-entity search. But the monolith-first approach is correct for initial development -- it avoids distributed transaction complexity while we validate the product."

## 3. Data Model (10 minutes)

### Core Entity Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash, display_name, role | username, email | Authentication and entity ownership |
| accounts | id (UUID PK), name, industry, website, phone, address fields, annual_revenue_cents (BIGINT), employee_count, owner_id (FK users) | owner_id | Companies. Revenue stored as cents to avoid floating-point |
| contacts | id (UUID PK), account_id (FK accounts, ON DELETE SET NULL), first_name, last_name, email, phone, title, department, owner_id (FK users) | account_id, owner_id | People associated with accounts. SET NULL on account delete preserves orphaned contacts |
| opportunities | id (UUID PK), account_id (FK accounts), name, amount_cents (BIGINT), stage, probability, close_date, description, owner_id (FK users) | stage, owner_id, account_id | Deals with pipeline stage tracking |
| leads | id (UUID PK), first_name, last_name, email, company, title, source, status, converted_account_id, converted_contact_id, converted_opportunity_id, converted_at, owner_id (FK users) | status, owner_id | Pre-conversion prospects. Three nullable FK columns track conversion results |
| activities | id (UUID PK), type (call/email/meeting/note), subject, description, due_date, completed, related_type, related_id, owner_id (FK users) | (related_type, related_id), (owner_id, due_date) | Polymorphic activity log. Composite index covers both lookups |

### Custom Fields (Extensibility)

| Table | Key Columns | Notes |
|-------|-------------|-------|
| custom_fields | id, entity_type, field_name, field_type (text/number/date/boolean/select), options (JSONB), is_required | UNIQUE(entity_type, field_name). Metadata only |
| custom_field_values | id, field_id (FK custom_fields), entity_id, value (TEXT) | UNIQUE(field_id, entity_id). EAV pattern |

> "I chose the Entity-Attribute-Value (EAV) pattern for custom fields over JSONB columns on each entity table. The reason: with JSONB, you can't efficiently index or query across custom field values -- 'find all accounts where custom field Region equals West' requires a GIN index and containment operator, which is slower than a B-tree index on the EAV value column. EAV allows us to create indexes on specific field_id + value combinations, and we can enforce uniqueness constraints per entity.

The trade-off is more complex queries -- fetching an entity with its custom fields requires a LEFT JOIN with the custom_field_values table. But CRM systems live and die by custom field flexibility, and the query complexity is manageable."

### Index Strategy

> "I'm deliberate about which indexes I create:

- **Composite index on (related_type, related_id)** for activities: This supports the most common activity query pattern -- 'show all activities for account X.' Without this index, every entity detail page would full-scan the activities table.

- **Single-column index on stage** for opportunities: Pipeline grouping is the most frequent analytical query. The stage index enables an index-only scan for GROUP BY stage with aggregate functions.

- **Composite index on (owner_id, due_date)** for activities: The dashboard's 'activities due today' KPI queries by owner and date range. Without this, the dashboard becomes the bottleneck.

I intentionally do NOT create a unique index on contacts.email because multiple contacts at different companies can share an email address (e.g., support@company.com). This is a common CRM pattern that catches people off guard."

### Money as BIGINT Cents

> "All monetary values are stored as BIGINT cents, not DECIMAL. This is the standard pattern for financial data because integer arithmetic is exact -- no floating-point rounding errors. $1,234.56 is stored as 123456. The frontend converts to display format using Intl.NumberFormat. This matters when you're summing millions of opportunity amounts for pipeline reports -- DECIMAL accumulates rounding errors across large aggregations."

## 4. API Design (5 minutes)

### Entity CRUD Pattern (applied to all entities)

```
GET    /api/{entity}           List with search, filter, pagination
GET    /api/{entity}/:id       Get by ID with JOINed owner info
POST   /api/{entity}           Create (auto-assigns owner_id from session)
PUT    /api/{entity}/:id       Partial update via COALESCE
DELETE /api/{entity}/:id       Hard delete (soft delete for production)
```

> "Every list endpoint supports three query parameters: search (ILIKE across relevant text columns), page/limit for pagination, and entity-specific filters (industry for accounts, status for leads, stage for opportunities). Pagination uses OFFSET/LIMIT which is simple but degrades at high page numbers. At scale, I'd switch to cursor-based pagination using the created_at timestamp and ID for deterministic ordering."

### Specialized Endpoints

```
PUT    /api/opportunities/:id/stage    Kanban stage transition (auto-sets probability)
POST   /api/leads/:id/convert         Lead conversion workflow (transactional)
GET    /api/accounts/:id/contacts      Contacts for account (sub-resource)
GET    /api/accounts/:id/opportunities Opportunities for account (sub-resource)
GET    /api/dashboard                  Aggregated KPIs (8 parallel queries)
GET    /api/reports/pipeline           Pipeline by stage (GROUP BY)
GET    /api/reports/revenue            Revenue by month (date-truncated GROUP BY)
GET    /api/reports/leads              Leads by source (GROUP BY)
```

> "The stage update endpoint is separate from the full opportunity update because kanban drag-drop should be a fast, focused operation that only changes stage and auto-calculates probability. The full PUT endpoint allows changing any field, including manually overriding probability. This separation also makes it easier to add stage transition validation rules later -- for example, preventing a move from Prospecting directly to Closed Won."

### Rate Limiting Strategy

> "I apply different rate limits based on endpoint cost:

- Standard API: 1000 requests per 15 minutes -- generous for normal CRM usage
- Authentication: 50 requests per 15 minutes -- prevents brute-force attacks
- Reports: 30 requests per minute -- reports are expensive aggregate queries

At production scale, I'd move rate limiting to the API gateway (e.g., Kong or AWS API Gateway) and implement per-user quotas rather than per-IP limits."

## 5. Deep Dives

### Deep Dive 1: Lead Conversion Atomicity

> "Lead conversion is the most critical transaction in the system. When a sales rep converts a lead, we must atomically create an account, a contact, and optionally an opportunity, then mark the lead as converted. If any step fails, none should persist. This is the only multi-entity write operation in the CRM.

I use a PostgreSQL transaction with explicit BEGIN/COMMIT/ROLLBACK. The conversion service acquires a dedicated client from the connection pool (not the shared pool), begins a transaction, executes the four operations sequentially, and commits. If any INSERT fails, the ROLLBACK undoes everything. The dedicated client ensures the transaction isn't interleaved with other queries.

**The conversion steps in order:**

1. Fetch the lead and verify it exists and hasn't already been converted (idempotency guard)
2. CREATE the account using lead data (company name, phone)
3. CREATE the contact using lead data (first/last name, email, phone, title) and link to the new account
4. Optionally CREATE an opportunity if the user specified one (name, amount, close date) and link to the new account
5. UPDATE the lead: set status to 'Converted', populate the three converted_*_id foreign keys, set converted_at timestamp
6. COMMIT

The alternative is a saga pattern with compensating transactions -- create the account, then if the contact creation fails, delete the account. This is necessary in a microservices architecture where each entity lives in a separate database. But since all CRM entities share one PostgreSQL instance, database transactions give us stronger guarantees with zero coordination overhead. A saga would require an orchestrator service, event publishing, and compensating handlers -- roughly 10x the code for the same end result.

The trade-off: database transactions hold row-level locks for the duration of the conversion. If conversion takes 200ms and we have 1,000 concurrent conversions, we could exhaust connection pool slots. I mitigate this by keeping the transaction minimal -- only INSERTs and one UPDATE, no external calls within the transaction boundary. The connection pool is sized at 20 connections with a 5-second timeout, which handles 100 conversions per second with headroom.

The idempotency guard (checking converted_at IS NULL) prevents double-conversion. If the frontend retries a failed conversion request, the second attempt returns an error rather than creating duplicate entities. At production scale, I'd add an idempotency key header to the convert endpoint and store the key in Redis with a 24-hour TTL.

At scale, if we split into microservices, I'd switch to a saga with an outbox pattern: write conversion events to an outbox table within the lead service's transaction, then a CDC consumer creates entities in other services. This sacrifices immediate consistency for availability, but the conversion would appear 'in progress' rather than instantly complete."

| Approach | Pros | Cons |
|----------|------|------|
| DB transaction | Atomic, simple, fast, immediate | Holds locks, single DB dependency |
| Saga + outbox | Works across services, no lock contention | Eventually consistent, compensating logic, complex |
| Two-phase commit | Strong consistency across services | Blocking, slow, single coordinator is SPF |

### Deep Dive 2: Pipeline Reporting at Scale

> "The pipeline report groups opportunities by stage and sums amounts. At 100K opportunities, this is a simple GROUP BY query that returns in milliseconds. At 10M opportunities, it becomes a full table scan that takes seconds. The dashboard is the most-visited page -- every sales rep starts their day here. It must be fast.

My scaling strategy has three tiers:

**Tier 1 (up to 1M records)**: Direct queries with proper indexes. The index on (stage) enables an index-only scan for the GROUP BY. The query planner uses a HashAggregate over the index entries. At this scale, even the dashboard's 8 parallel KPI queries complete in under 100ms total.

**Tier 2 (1M-10M records)**: Materialized views refreshed every 5 minutes. I create a materialized view that pre-computes pipeline summaries per owner. The dashboard queries the mat view (sub-millisecond) instead of scanning the opportunities table. The refresh runs CONCURRENTLY so it doesn't block reads. A background scheduler (pg_cron or a Node.js cron job) triggers the refresh.

**Tier 3 (10M+ records)**: Table partitioning on close_date with materialized views per partition. Range-partition the opportunities table by quarter. Pipeline reports query only active partitions (current + next quarter), dramatically reducing scan volume. Historical partitions can be moved to cheaper storage. Combined with materialized views, this handles 100M+ records.

The dashboard KPIs use a similar tiered approach. At small scale, I run 8 aggregate queries in parallel with Promise.all -- one for total revenue, one for open opportunities count, one for pipeline value, one for won deals, one for new leads, one for activities due, one for conversion rate, one for average deal size. At large scale, I'd pre-compute KPIs per user into a Redis hash, refreshed by a background worker every minute. The dashboard reads from Redis (sub-millisecond) instead of PostgreSQL.

The trade-off with materialized views and Redis caching is staleness. A sales rep closes a $1M deal and the dashboard still shows the old pipeline total for up to 5 minutes. For most CRM reporting, this is acceptable -- reports are inherently backward-looking, and reps don't make decisions based on second-by-second pipeline changes. For the individual opportunity view, I always query live data so the rep sees their updates immediately.

The revenue-by-month report uses DATE_TRUNC('month', updated_at) for grouping. I chose updated_at over close_date because a deal's close date might be in the future, but the revenue was recognized when the stage changed to 'Closed Won'. This distinction matters for accurate financial reporting."

| Scale | Strategy | Latency | Freshness | Complexity |
|-------|----------|---------|-----------|------------|
| < 1M | Direct queries | < 100ms | Real-time | Low |
| 1-10M | Materialized views | < 10ms | 5 min stale | Medium |
| 10M+ | Partitioned + mat views + Redis | < 5ms | 1-5 min stale | High |

### Deep Dive 3: Custom Fields Extensibility

> "CRM systems require custom fields -- every organization tracks different data about their accounts and deals. A healthcare company needs 'Number of Beds' on accounts. A SaaS company needs 'ARR Tier' on opportunities. I implement this with the Entity-Attribute-Value (EAV) pattern: a custom_fields table defines field metadata (name, type, validation), and custom_field_values stores the actual values per entity.

The EAV pattern has a well-known reputation problem: querying 'find all accounts where custom field X > 100' requires a JOIN with a value comparison on a TEXT column. This is inherently slower than querying a native column. But the alternative approaches each have worse trade-offs for a CRM.

**Why not JSONB columns?** A JSONB column on each entity table is simpler to query (no JOINs), supports GIN indexes for containment queries, and is easier to reason about. But it can't enforce per-field uniqueness constraints ('only one custom field named Region per entity type'), per-field required validation at the database level, or per-field type checking. For a CRM where data integrity is paramount -- sales reps entering bad data costs real money -- EAV's constraints justify the query complexity.

**Why not ALTER TABLE per custom field?** This gives the best query performance (native columns, B-tree indexes). But it means running DDL migrations in production whenever a user adds a custom field. At scale with thousands of tenants, you'd be running ALTER TABLE thousands of times per day. Each ALTER TABLE acquires an ACCESS EXCLUSIVE lock on the table, blocking all reads and writes for the duration. This is an operational nightmare.

I mitigate EAV's performance limitations in three ways:

1. **Type-aware indexing**: For numeric custom fields, I create a partial index that casts the TEXT value to a numeric type. This allows the query planner to use an index scan for range queries on numeric custom fields, bringing performance close to a native column.

2. **Denormalized search view**: For frequently-queried custom fields (identified by query logging), I create a materialized view that pivots EAV rows into columns. This gives native column performance for the 5-10 'hot' custom fields while keeping the EAV flexibility for the long tail.

3. **Field count limits**: I limit custom fields to 200 per entity type. Salesforce's actual limit is 800 for Enterprise edition. Beyond 200, the JOIN fan-out in queries that fetch all custom fields becomes too large, and the EAV value table grows to billions of rows."

| Approach | Pros | Cons |
|----------|------|------|
| EAV tables | DB-level constraints, indexable, type-safe | Complex queries, JOINs, TEXT column overhead |
| JSONB column | Simple queries, no JOINs, flexible | No per-field constraints, GIN index limitations |
| ALTER TABLE | Best performance, native indexes | DDL in production, locks, migration management |
| Separate tables per field type | Type-safe columns, good indexes | Explosion of tables, complex union queries |

## 6. Scalability Discussion (5 minutes)

### What Breaks First

1. **Dashboard aggregation** -- Full table scans for SUM/COUNT across opportunities and leads. Each KPI query scans the full table independently. Solution: materialized views + Redis caching with background refresh worker.

2. **Cross-entity search** -- ILIKE queries across accounts, contacts, leads are inherently full-scan on text columns. Solution: Elasticsearch with document-per-entity, real-time sync via Change Data Capture (Debezium) or transactional outbox pattern.

3. **Activity writes** -- High-volume activity logging from email integration, call tracking, and automated events. Solution: Write-ahead buffer with Kafka, batch INSERT into PostgreSQL every second. This smooths write spikes without overwhelming the connection pool.

4. **Connection pool exhaustion** -- Too many concurrent report queries each holding a connection for seconds. Solution: Read replicas for reporting, separate connection pool per query type (transactional gets 15 connections, analytical gets 5 connections from replicas).

### Horizontal Scaling Path

```
┌─────────────┐
│ Load        │
│ Balancer    │
└──────┬──────┘
       │
  ┌────┼────┐
  ▼    ▼    ▼
┌───┐┌───┐┌───┐     ┌───────────────┐
│S1 ││S2 ││S3 │────▶│ PG Primary    │
└───┘└───┘└───┘     └───────┬───────┘
       │                     │
  ┌────▼────┐        ┌──────┼──────┐
  │  Redis  │        ▼      ▼      ▼
  │(sessions│     ┌─────┐┌─────┐┌─────┐
  │+ cache) │     │Rep1 ││Rep2 ││Rep3 │
  └─────────┘     │(rpt)││(rpt)││(CDC) │
                  └─────┘└─────┘└─────┘
```

> "Application servers are stateless -- sessions live in Redis, so any instance can handle any request. I scale horizontally by adding API instances behind a load balancer. Database scaling uses read replicas: dedicated replicas for reporting (heavy aggregation), CDC replica for Elasticsearch sync, and primary for writes.

At extreme scale (multi-tenant SaaS), I'd shard by organization_id. Each tenant's data lives on a dedicated shard. The API gateway routes requests to the correct shard based on a tenant lookup table in Redis. This eliminates cross-tenant query interference and enables per-tenant scaling -- a Fortune 500 customer with 50K users gets their own shard while small tenants share shards.

For search, I'd deploy Elasticsearch with one index per entity type. Each entity document includes all searchable fields plus denormalized relationship data (e.g., a contact document includes the account name). Debezium CDC streams changes from PostgreSQL to Elasticsearch via Kafka, maintaining near-real-time search consistency."

## 7. Failure Handling and Observability (3 minutes)

> "CRM downtime directly impacts sales revenue. A 30-minute outage during business hours means reps can't update deals, and pipeline visibility disappears for managers.

**Circuit breakers** (Opossum library): Wraps external service calls with automatic failure detection. After 50% of requests fail within a 10-second window, the circuit opens and fails fast for 30 seconds before retrying. This prevents cascading failures from a slow Redis or a failing webhook service from taking down the entire API.

**Health checks**: The /api/health endpoint verifies database connectivity by running SELECT 1. The load balancer polls this endpoint every 10 seconds and removes unhealthy instances from rotation. A more comprehensive check would verify Redis connectivity and disk space.

**Structured logging** (Pino): All logs are JSON-formatted with request correlation IDs. Each API request gets a unique ID propagated through all service calls, making it possible to trace a single user action through the entire stack. In production, logs ship to Elasticsearch or Datadog for searching and alerting.

**Prometheus metrics**: HTTP request duration histograms (p50, p95, p99), request counters by status code, database query duration, and active connection pool size. These feed into Grafana dashboards and PagerDuty alerts."

## 8. Trade-offs Summary (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Lead conversion | DB transaction | Saga pattern | Single DB, atomic guarantees, immediate |
| Activity model | Polymorphic columns | Separate join tables | Single timeline query, one composite index |
| Custom fields | EAV pattern | JSONB columns | Per-field constraints, type validation |
| Money storage | BIGINT cents | DECIMAL | Exact integer arithmetic, no rounding |
| Pipeline stages | Fixed enum | Configurable per org | Covers 90% of use cases, simpler validation |
| Session auth | Redis sessions | JWT | Immediate revocation, server-side control |
| Reporting | Direct queries + mat views | OLAP database (ClickHouse) | Sufficient for CRM scale, simpler operations |
| Pagination | OFFSET/LIMIT | Cursor-based | Simpler, adequate for typical CRM page counts |
| Search | SQL ILIKE | Elasticsearch | Sufficient for <1M records, ES for production |
