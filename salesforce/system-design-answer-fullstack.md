# Salesforce CRM - Full-Stack System Design Answer

## 1. Requirements Clarification (2 minutes)

"We're designing a CRM system -- the backbone of sales operations. Let me confirm scope:

- **Core entities**: Accounts, Contacts, Opportunities, Leads, Activities -- the standard CRM object model?
- **Pipeline management**: Kanban board for opportunity stages with drag-drop transitions?
- **Lead lifecycle**: Lead capture, qualification, and atomic conversion to account + contact + opportunity?
- **Activity tracking**: Log calls, emails, meetings, notes against any entity?
- **Analytics**: Dashboard KPIs, pipeline reports, revenue trends, lead source breakdown?
- **Scale**: Initially thousands of users, designed to scale to 50K+ concurrent reps with millions of records?

I'll cover the full stack: data model, API design, frontend architecture, and three deep dives on the hardest problems."

## 2. High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client (React SPA)                           │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Sidebar  │  │ Dashboard │  │  Kanban   │  │  Entity Lists   │  │
│  │ (nav)    │  │ (KPIs)    │  │  Board    │  │  + Detail Views │  │
│  └──────────┘  └───────────┘  └───────────┘  └──────────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP (REST)
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                     API Server (Express)                           │
│  ┌────────┐ ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌──────────┐  │
│  │  Auth  │ │ Accounts │ │   Opps    │ │  Leads  │ │ Reports  │  │
│  │ Routes │ │ + Conts  │ │ + Kanban  │ │+Convert │ │+Dashboard│  │
│  └────────┘ └──────────┘ └───────────┘ └─────────┘ └──────────┘  │
└──────────────┬────────────────────────┬────────────────────────────┘
               │                        │
        ┌──────▼──────┐          ┌──────▼──────┐
        │ PostgreSQL  │          │    Redis    │
        │  (8 tables) │          │ (Sessions)  │
        └─────────────┘          └─────────────┘
```

> "This is a monolithic API server that's simple to deploy and reason about, with clear separation into route modules per entity domain. PostgreSQL is the right choice because CRM data is inherently relational -- accounts have contacts, contacts link to opportunities, leads convert into accounts. Redis stores sessions for immediate revocation and can cache dashboard KPIs.

At scale, I'd split the API into microservices per domain, add read replicas for reporting, and introduce Elasticsearch for cross-entity search. But starting monolithic avoids distributed system complexity while we validate the product."

## 3. Data Model (8 minutes)

### Entity Relationships

```
┌─────────┐      1:N      ┌───────────┐      1:N      ┌──────────────┐
│  Users  │──────────────▶│ Accounts  │──────────────▶│  Contacts    │
│ (owner) │               │           │               │              │
└────┬────┘               └─────┬─────┘               └──────────────┘
     │                          │
     │ owns                     │ 1:N
     │                    ┌─────▼─────┐
     │                    │Opportuni- │
     │                    │   ties    │
     │                    └───────────┘
     │
     │ owns               ┌───────────┐     converts     ┌───────────┐
     └───────────────────▶│   Leads   │ ───────────────▶ │ Account + │
                          └───────────┘                  │ Contact + │
                                                         │ Opp       │
                                                         └───────────┘
     ┌───────────┐
     │Activities │ ──── polymorphic ──── any entity above
     └───────────┘
```

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| users | id (UUID PK), username (unique), email (unique), password_hash, display_name, role | email | Auth and ownership |
| accounts | id (UUID PK), name, industry, website, phone, address fields, annual_revenue_cents (BIGINT), employee_count, owner_id (FK) | owner_id | Companies |
| contacts | id (UUID PK), account_id (FK ON DELETE SET NULL), first_name, last_name, email, phone, title, department, owner_id (FK) | account_id | People at accounts |
| opportunities | id (UUID PK), account_id (FK), name, amount_cents (BIGINT), stage, probability, close_date, description, owner_id (FK) | stage, owner_id, account_id | Deals in pipeline |
| leads | id (UUID PK), first_name, last_name, email, company, title, source, status, converted_account_id, converted_contact_id, converted_opportunity_id, converted_at, owner_id (FK) | status, owner_id | Pre-conversion prospects |
| activities | id (UUID PK), type (call/email/meeting/note), subject, description, due_date, completed, related_type, related_id, owner_id (FK) | (related_type, related_id), (owner_id, due_date) | Polymorphic log |
| custom_fields | id, entity_type, field_name, field_type, options (JSONB), is_required | UNIQUE(entity_type, field_name) | Field definitions |
| custom_field_values | id, field_id (FK), entity_id, value (TEXT) | UNIQUE(field_id, entity_id), entity_id | EAV values |

> "All monetary values are BIGINT cents -- $1,234.56 stored as 123456. This eliminates floating-point rounding errors in pipeline totals. The frontend converts to display format using Intl.NumberFormat."

## 4. API Design (4 minutes)

### Authentication

```
POST /api/auth/register      Create user account
POST /api/auth/login         Session login
POST /api/auth/logout        Destroy session
GET  /api/auth/me            Current user
```

### Entity CRUD (same pattern for accounts, contacts, leads)

```
GET    /api/{entity}          List (search, filter, pagination)
GET    /api/{entity}/:id      Detail
POST   /api/{entity}          Create
PUT    /api/{entity}/:id      Update
DELETE /api/{entity}/:id      Delete
```

### Specialized Endpoints

```
PUT    /api/opportunities/:id/stage    Stage transition (kanban)
POST   /api/leads/:id/convert         Lead conversion
GET    /api/accounts/:id/contacts      Related contacts
GET    /api/accounts/:id/opportunities Related opportunities
GET    /api/dashboard                  Aggregated KPIs
GET    /api/reports/pipeline           Stage breakdown
GET    /api/reports/revenue            Monthly revenue
GET    /api/reports/leads              Source breakdown
```

> "The stage endpoint is separate from the full opportunity PUT because kanban drag-drop should only change stage and auto-compute probability. This keeps the interaction fast and focused."

## 5. Frontend Architecture (5 minutes)

### State Management

> "Two Zustand stores: authStore for session state, crmStore for all entity data. Zustand's selector pattern prevents cross-entity re-renders -- the kanban board subscribes only to the opportunities slice, so creating a new lead doesn't cause the kanban to re-render."

### Component Architecture

> "The UI uses a persistent sidebar for navigation and a content area that changes per route. Key component patterns:

- **EntityForm**: A shared modal form component that renders different fields based on entityType prop. Accounts show name/industry/phone, contacts show name/email/account-selector, etc. This avoids duplicating form logic across 4 entity types.

- **StatusBadge**: A single component that maps status strings to color classes. Ensures 'Closed Won' is always green, 'New' lead is always blue, everywhere in the app.

- **ActivityTimeline**: A shared component used on any entity detail page. Receives activities as props, renders chronologically with type-specific icons. The parent context provides relatedType/relatedId for creating new activities.

- **KanbanBoard/KanbanColumn/OpportunityCard**: Three-tier component hierarchy. Board manages DndContext, columns are droppable zones, cards are draggable items."

## 6. Deep Dives

### Deep Dive 1: CRM Data Model Design

> "The CRM data model has three interesting design decisions: polymorphic activities, the EAV custom fields pattern, and the lead conversion schema.

**Polymorphic activities:** Activities use related_type and related_id columns to associate with any entity type. The composite index (related_type, related_id) enables fast lookups like 'all activities for account X.' The alternative -- separate join tables (account_activities, contact_activities, etc.) -- would require querying multiple tables to build a unified activity timeline. With polymorphic columns, a single query returns all activities for any entity.

The trade-off is no foreign key constraint -- we can't create a FK that references different tables depending on the type column. Orphaned activities (pointing to deleted entities) are possible but harmless since activities are immutable logs. I add application-level validation to ensure the related entity exists on creation.

**Money as BIGINT cents:** All amounts use BIGINT cents. When a pipeline report sums 10,000 opportunity amounts, integer addition is exact. DECIMAL would also work but BIGINT is more natural for programmatic arithmetic and avoids any scale/precision configuration. The frontend handles cents-to-dollars conversion for display.

**Lead conversion schema:** Leads have three nullable FK columns: converted_account_id, converted_contact_id, converted_opportunity_id. These create a permanent link from the historical lead record to the converted entities. This lets reporting track 'what percentage of Web leads converted to won deals?' by joining leads -> opportunities -> WHERE stage = 'Closed Won'.

The alternative is deleting leads after conversion, which is simpler but loses the conversion audit trail. CRM users expect to see the full lifecycle -- where did this account originate?"

| Decision | Chosen | Trade-off |
|----------|--------|-----------|
| Polymorphic activities | Single table, one query | No FK constraint, orphans possible |
| BIGINT cents | Exact arithmetic | Must convert for display |
| Lead conversion links | Audit trail preserved | Extra nullable FKs on leads table |

### Deep Dive 2: Sales Pipeline and Forecasting

> "The pipeline is the heart of the CRM. The kanban board visualizes it, but the backend must support accurate forecasting.

**Stage-probability coupling:** Each pipeline stage maps to a default probability: Prospecting (10%), Qualification (20%), Needs Analysis (40%), Proposal (60%), Negotiation (80%), Closed Won (100%), Closed Lost (0%). When a user drags a deal to a new stage via the kanban, the backend automatically updates the probability. This simplifies the weighted pipeline calculation: pipeline value = SUM(amount * probability / 100).

The kanban frontend uses @dnd-kit with three component layers. DndContext wraps the entire board, providing drag state and collision detection. KanbanColumn components register as droppable zones via useDroppable, identified by stage name. OpportunityCard components register as draggable items via useDraggable, identified by opportunity ID.

**Optimistic updates:** When a card is dropped on a new column, I immediately update the local store to move the opportunity. The user sees instant feedback. Then I fire the API call to persist the change. If it fails, I re-fetch all opportunities to revert to the true state. This is safe because stage changes are idempotent -- re-dropping on the same stage is a no-op.

**Pipeline reporting:** The reports endpoint aggregates opportunities by stage with SUM(amount_cents) and COUNT(*). At small scale (< 1M records), this is a direct GROUP BY query with the stage index. At large scale, I'd use materialized views refreshed every 5 minutes:

- The mat view pre-computes stage counts and totals
- REFRESH MATERIALIZED VIEW CONCURRENTLY rebuilds without blocking reads
- Dashboard queries hit the mat view (sub-millisecond) instead of scanning the opportunities table

The trade-off is 5-minute staleness. A rep closes a $500K deal and the pipeline chart doesn't update for 5 minutes. For most CRM reporting, this is acceptable -- reports are inherently backward-looking. For the individual opportunity view, I always query live data."

| Scale | Reporting Strategy | Latency | Freshness |
|-------|--------------------|---------|-----------|
| < 1M | Direct GROUP BY | < 100ms | Real-time |
| 1-10M | Materialized views | < 10ms | 5 min stale |
| 10M+ | Partitioned tables + mat views | < 10ms | 5 min stale |

### Deep Dive 3: Activity Tracking Architecture

> "Activities are the CRM's audit trail -- every customer interaction is logged. The architecture must handle high write volume (email integration, call logging, automated events) while supporting fast reads for entity timelines.

**Write path:** Activities are created via POST /api/activities with type, subject, description, due_date, and polymorphic related_type/related_id. The endpoint validates that the type is one of (call, email, meeting, note) and that the related_type is a valid entity. At scale, write-heavy activity logging (especially from automated email sync) would use a Kafka queue: the API publishes activity events to Kafka, and a consumer batch-inserts into PostgreSQL every second. This absorbs write spikes without overwhelming the database connection pool.

**Read path:** The ActivityTimeline component on entity detail pages fetches activities filtered by related_type and related_id. The composite index (related_type, related_id) makes this a fast index scan even with millions of activities. Activities are ordered by due_date ascending (tasks due soonest first), falling back to created_at descending for completed items.

**Dashboard integration:** The KPI 'Activities Due' counts uncompleted activities with due_date <= tomorrow. This uses the composite index (owner_id, due_date) for a range scan. The ActivityForm component provides inline activity creation on any entity detail page, passing relatedType and relatedId from the parent context.

**The polymorphic query pattern:** To fetch activities for an account and all its contacts and opportunities, I'd need three queries (one per related_type). At scale, I'd denormalize by adding an account_id column to activities, populated at write time. This avoids the three-query fan-out at the cost of one additional column and write-time computation.

The frontend renders activities with the shared ActivityTimeline component. Each activity shows a type-specific icon (phone, envelope, calendar, pencil), the subject, optional description, due date, completion status, and the owner who logged it. Completed activities appear with a strikethrough subject and 'Completed' badge."

| Pattern | Pros | Cons |
|---------|------|------|
| Direct DB writes | Simple, consistent | Write bottleneck at scale |
| Kafka buffered | Handles write spikes | Eventually consistent, added infra |
| Pre-aggregated counters | Fast dashboard queries | Counter drift, reconciliation needed |

## 7. Scalability Discussion (3 minutes)

### Frontend Scaling

- **Code splitting**: Route-based chunks via TanStack Router. The kanban page with @dnd-kit loads only on /opportunities navigation.
- **Selective subscriptions**: Zustand selectors prevent cross-entity re-renders.
- **Pagination**: CRM list pages use server-side pagination (not infinite scroll) because total counts and page navigation are meaningful for sales workflows.

### Backend Scaling

```
┌─────────────┐
│   Nginx     │
│   (LB)      │
└──────┬──────┘
       │
  ┌────┼────┐
  ▼    ▼    ▼
┌───┐┌───┐┌───┐     ┌─────────┐     ┌──────────┐
│S1 ││S2 ││S3 │────▶│PG Primary│────▶│PG Replica │
└───┘└───┘└───┘     └─────────┘     │ (reports) │
       │                             └──────────┘
  ┌────▼────┐
  │  Redis  │
  │(sessions│
  │+ cache) │
  └─────────┘
```

- **Stateless API**: Sessions in Redis, any server handles any request.
- **Read replicas**: Dedicated replicas for reporting queries, primary for writes.
- **Connection pooling**: 20 connections per API server, PgBouncer in front of replicas.
- **Sharding**: At extreme scale, shard by organization_id so each tenant's data lives on a dedicated database.

## 8. Trade-offs Summary (2 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Architecture | Monolith | Microservices | Simpler until team/scale demands splitting |
| Lead conversion | DB transaction | Saga pattern | Single DB, atomic guarantees |
| Activity model | Polymorphic | Separate join tables | Single timeline query, simpler |
| Kanban library | @dnd-kit | react-beautiful-dnd | Active, typed, accessible |
| Pipeline charts | CSS-only bars | Chart.js | Zero bundle cost for simple visuals |
| State management | Zustand | React Context | Selector-based, no unnecessary re-renders |
| Session auth | Redis sessions | JWT | Immediate revocation, server control |
| Money storage | BIGINT cents | DECIMAL | Exact integer arithmetic |
| Custom fields | EAV pattern | JSONB | Per-field constraints, indexable |
