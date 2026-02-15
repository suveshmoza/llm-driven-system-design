# Salesforce CRM - Architecture

## System Overview

A customer relationship management (CRM) system modeled after Salesforce, designed to manage the full sales lifecycle: leads, accounts, contacts, opportunities, and activities. The system provides a pipeline view for tracking deal progression, lead conversion workflows, and reporting dashboards for sales performance analytics. This project demonstrates entity relationship modeling, transactional workflows, polymorphic associations, and kanban-style UI state management.

**Learning goals:** CRM data modeling, transactional lead conversion, pipeline stage management, polymorphic activity tracking, aggregated dashboard KPIs, and drag-drop kanban UI with optimistic updates.

## Requirements

### Functional Requirements
- User authentication with session-based auth
- CRUD operations for accounts, contacts, opportunities, and leads
- Opportunity pipeline with kanban drag-drop stage transitions
- Lead conversion workflow (lead -> account + contact + opportunity in a single transaction)
- Activity logging (calls, emails, meetings, notes) with polymorphic entity association
- Dashboard with aggregated KPI metrics
- Reporting: pipeline by stage, revenue by month, leads by source
- Search and filtering across all entity types

### Non-Functional Requirements (Production Scale)
- 99.9% uptime for core CRM operations
- p99 API response time < 200ms for entity CRUD
- p99 < 500ms for dashboard aggregation queries
- Support 50K concurrent sales users
- Handle 10M+ accounts with sub-second search
- Atomic lead conversion with zero data loss
- Audit trail for all entity state changes

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          CDN / Edge Cache                            │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         API Gateway                                  │
│              (Rate Limiting, Auth, Routing)                          │
└─────┬──────────┬──────────┬──────────┬──────────┬───────────────────┘
      │          │          │          │          │
      ▼          ▼          ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
│ Account │ │ Contact │ │   Opp    │ │  Lead  │ │ Activity │
│ Service │ │ Service │ │ Service  │ │Service │ │ Service  │
└────┬────┘ └────┬────┘ └────┬─────┘ └───┬────┘ └────┬─────┘
     │           │           │           │           │
     └───────────┴───────────┼───────────┴───────────┘
                             │
                     ┌───────┴───────┐
                     │               │
              ┌──────▼──────┐ ┌──────▼──────┐
              │ PostgreSQL  │ │   Redis     │
              │  (Primary)  │ │  (Cache +   │
              │             │ │  Sessions)  │
              └──────┬──────┘ └─────────────┘
                     │
              ┌──────▼──────┐
              │ PostgreSQL  │
              │  (Replica)  │
              └─────────────┘
```

## Core Components

### Entity Relationship Model

The CRM revolves around five core entities with ownership and association relationships:

```
┌─────────┐     ┌───────────┐     ┌───────────────┐
│  Users  │────▶│ Accounts  │────▶│   Contacts    │
│ (owner) │     │           │     │               │
└────┬────┘     └─────┬─────┘     └───────────────┘
     │                │
     │          ┌─────▼─────┐
     │          │Opportuni- │
     │          │   ties    │
     │          └───────────┘
     │
     │          ┌───────────┐     ┌───────────────┐
     └────────▶│   Leads   │ ──▶ │  Conversion   │
               │           │     │ (account +    │
               └───────────┘     │  contact +    │
                                 │  opportunity) │
                                 └───────────────┘

     ┌───────────┐
     │Activities │──── polymorphic ──── any entity
     └───────────┘
```

### Request Flows

**Lead Conversion Flow** (the most complex operation):

```
┌────────┐     ┌────────────┐     ┌──────────────────────────────────┐
│ Client │────▶│ POST       │────▶│         Transaction              │
│        │     │ /leads/:id │     │  1. Validate lead exists         │
└────────┘     │ /convert   │     │  2. CREATE account               │
               └────────────┘     │  3. CREATE contact (from lead)   │
                                  │  4. CREATE opportunity (optional) │
                                  │  5. UPDATE lead status=Converted │
                                  │  6. COMMIT                       │
                                  └──────────────────────────────────┘
```

**Kanban Stage Update Flow:**

```
┌────────┐     ┌────────────┐     ┌──────────────────────────────────┐
│ Client │────▶│ PUT /opps/ │────▶│  1. Validate stage transition    │
│ (drag) │     │ :id/stage  │     │  2. UPDATE stage + probability   │
└────────┘     └────────────┘     │  3. Return updated opportunity   │
                                  └──────────────────────────────────┘
```

### Pipeline Stages and Probability Mapping

| Stage | Probability | Description |
|-------|-------------|-------------|
| Prospecting | 10% | Initial identification |
| Qualification | 20% | Confirmed budget and need |
| Needs Analysis | 40% | Understanding requirements |
| Proposal | 60% | Solution proposed |
| Negotiation | 80% | Terms under discussion |
| Closed Won | 100% | Deal signed |
| Closed Lost | 0% | Deal lost |

## Database Schema

The schema uses 8 tables with UUID primary keys, foreign key relationships, and strategic indexes:

- **users** - Authentication and ownership
- **accounts** - Companies/organizations
- **contacts** - People associated with accounts
- **opportunities** - Sales deals with stage pipeline
- **leads** - Unqualified prospects before conversion
- **activities** - Polymorphic activity log (calls, emails, meetings, notes)
- **custom_fields** - Extensible field definitions per entity type
- **custom_field_values** - Entity-specific custom field values

Key indexes support the primary access patterns:
- `idx_opportunities_stage` - Pipeline grouping for kanban and reports
- `idx_opportunities_owner` - User-specific deal filtering
- `idx_activities_related` - Composite index for polymorphic activity lookups
- `idx_leads_status` - Status-based filtering for lead management

Full schema is in `backend/src/db/init.sql`.

## API Design

### Authentication
```
POST /api/auth/register    Register new user
POST /api/auth/login       Login with credentials
POST /api/auth/logout      Logout and destroy session
GET  /api/auth/me          Get current user
```

### Dashboard
```
GET  /api/dashboard        Aggregated KPIs for current user
```

### Accounts
```
GET    /api/accounts                   List with search/filter/pagination
GET    /api/accounts/:id               Get account detail
POST   /api/accounts                   Create account
PUT    /api/accounts/:id               Update account
DELETE /api/accounts/:id               Delete account
GET    /api/accounts/:id/contacts      List contacts for account
GET    /api/accounts/:id/opportunities List opportunities for account
```

### Contacts
```
GET    /api/contacts        List with search/filter/pagination
GET    /api/contacts/:id    Get contact detail
POST   /api/contacts        Create contact
PUT    /api/contacts/:id    Update contact
DELETE /api/contacts/:id    Delete contact
```

### Opportunities
```
GET    /api/opportunities          List with search/filter/pagination
GET    /api/opportunities/:id      Get opportunity detail
POST   /api/opportunities          Create opportunity
PUT    /api/opportunities/:id      Update opportunity
PUT    /api/opportunities/:id/stage Update stage only (kanban drag-drop)
DELETE /api/opportunities/:id      Delete opportunity
```

### Leads
```
GET    /api/leads              List with search/filter/pagination
GET    /api/leads/:id          Get lead detail
POST   /api/leads              Create lead
PUT    /api/leads/:id          Update lead
POST   /api/leads/:id/convert  Convert lead to account+contact+opportunity
DELETE /api/leads/:id          Delete lead
```

### Activities
```
GET    /api/activities        List with polymorphic filter
GET    /api/activities/:id    Get activity detail
POST   /api/activities        Create activity
PUT    /api/activities/:id    Update activity
DELETE /api/activities/:id    Delete activity
```

### Reports
```
GET  /api/reports/pipeline   Pipeline by stage (count + amount)
GET  /api/reports/revenue    Revenue by month
GET  /api/reports/leads      Leads by source
```

## Key Design Decisions

### Polymorphic Activities vs. Separate Tables

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Activity storage | Polymorphic (related_type + related_id) | Separate join tables per entity | Simpler queries, single timeline view, composite index handles performance |

Activities use `related_type` and `related_id` columns to associate with any entity type. This is simpler than creating `account_activities`, `contact_activities`, etc. join tables. The composite index on `(related_type, related_id)` ensures fast lookups. The trade-off is loss of referential integrity (no FK constraint to a specific table), which we accept because activities are append-only logs and orphaned activities are harmless.

### Transactional Lead Conversion

Lead conversion creates 2-3 entities in a single database transaction (account, contact, and optionally opportunity). This ensures atomicity -- if the opportunity creation fails, neither the account nor contact is created. The alternative (saga pattern with compensating transactions) adds unnecessary complexity for a single-database operation.

### Stage-Probability Coupling

Opportunity stages automatically set probability percentages when changed via the kanban endpoint. This simplifies the pipeline forecasting calculation and ensures consistency. Sales teams can still override probability through the full update endpoint.

### Money as Cents (BIGINT)

All monetary values are stored as cents in BIGINT columns. This avoids floating-point arithmetic issues with DECIMAL/NUMERIC types and is the standard approach for financial data. The frontend formats cents to dollars for display.

## Consistency and Idempotency

- **Lead conversion** uses PostgreSQL transactions with explicit BEGIN/COMMIT/ROLLBACK to ensure atomic multi-entity creation
- **Stage updates** are idempotent -- moving an opportunity to its current stage is a no-op that returns the unchanged record
- **Optimistic concurrency** is handled through `updated_at` timestamps, though not enforced at the database level in the local implementation

## Security and Auth

- Session-based authentication with Redis-backed session store
- Password hashing with bcrypt (10 rounds)
- CORS configured for frontend origin only
- Rate limiting: 1000 req/15min for API, 50 req/15min for auth, 30 req/min for reports
- All data endpoints require authentication via `requireAuth` middleware

## Observability

- **Structured logging** with Pino (JSON format in production, pretty-printed in development)
- **Prometheus metrics** via prom-client: HTTP request duration, request totals, DB query duration
- **Health check** endpoint at `/api/health` that verifies database connectivity

## Failure Handling

- **Circuit breaker** (Opossum) for external service calls with 50% error threshold
- **Database connection pooling** with 20 max connections, 5s connection timeout
- **Redis retry strategy** with exponential backoff (max 2s delay)
- **Graceful shutdown** on SIGTERM/SIGINT with connection cleanup

## Scalability Considerations

### What breaks first at scale
1. **Dashboard aggregation queries** - Scanning all opportunities/leads for KPIs becomes slow past 1M records
2. **Pipeline reports** - GROUP BY queries on opportunities table
3. **Activity lookups** - Polymorphic queries without FK indexes

### Scaling strategies
- **Read replicas** for reporting queries (separate read/write connections)
- **Materialized views** for dashboard KPIs, refreshed every 5 minutes
- **Table partitioning** on opportunities by `close_date` (range partitioning)
- **Elasticsearch** for full-text search across accounts, contacts, leads
- **Activity sharding** by `related_type` to separate high-volume entity types

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Session storage | Redis + cookie | JWT | Immediate revocation, simpler for server-rendered views |
| Activity model | Polymorphic columns | Separate join tables | Simpler queries, single timeline, acceptable FK trade-off |
| Lead conversion | DB transaction | Saga pattern | Single database, transaction guarantees atomicity |
| Pipeline stages | Fixed enum | Configurable per org | Simpler implementation, covers 90% of use cases |
| Money storage | BIGINT cents | DECIMAL | No floating-point issues, standard financial pattern |
| Custom fields | EAV pattern | JSONB column | Queryable, indexable, schema-validated |
| Search | SQL ILIKE | Elasticsearch | Sufficient for local scale, ES for production |

## Implementation Notes

### Production-grade patterns implemented
- **Circuit breaker** (Opossum) in `src/services/circuitBreaker.ts` -- protects against cascading failures from downstream services
- **Prometheus metrics** (prom-client) in `src/services/metrics.ts` -- HTTP request duration/count histograms and DB query timing
- **Structured logging** (Pino) in `src/services/logger.ts` -- JSON logs with request correlation
- **Rate limiting** (express-rate-limit) in `src/services/rateLimiter.ts` -- per-endpoint rate limits
- **Health checks** in `src/app.ts` -- database connectivity verification
- **Transactional integrity** in `src/services/leadConversionService.ts` -- explicit transaction management for multi-entity operations

### What was simplified
- Single PostgreSQL instance instead of primary + read replicas
- SQL ILIKE instead of Elasticsearch for search
- In-process aggregation instead of materialized views for dashboard
- Session auth instead of OAuth 2.0 / SAML SSO
- Fixed pipeline stages instead of configurable per organization

### What was omitted
- CDN and edge caching
- Multi-region deployment
- Kubernetes orchestration
- Full-text search engine
- Audit trail / change history table
- Field-level security and sharing rules
- Workflow automation engine
- Email integration
- File attachments on entities
