# Salesforce CRM - Development Notes

## Project Context

This project implements a simplified CRM system modeled after Salesforce, covering the full sales lifecycle: leads, accounts, contacts, opportunities, activities, and reporting. It demonstrates entity relationship modeling, transactional lead conversion, polymorphic activity tracking, kanban-style pipeline management, and dashboard KPI aggregation.

## Development Phases

### Phase 1: Architecture and Design
- Defined 8-table schema with UUID primary keys and strategic indexes
- Designed polymorphic activity model with related_type/related_id columns
- Planned lead conversion as a single PostgreSQL transaction
- Mapped opportunity stages to default probabilities for pipeline forecasting
- Sketched Salesforce-style sidebar navigation with brand colors

### Phase 2: Backend Implementation
- Express API with session auth (Redis-backed via connect-redis)
- 7 domain route files: dashboard, accounts, contacts, opportunities, leads, activities, reports
- Lead conversion service with explicit BEGIN/COMMIT/ROLLBACK transaction management
- Report service with parameterized aggregation queries (pipeline by stage, revenue by month, leads by source)
- Dashboard service with parallel KPI queries (total revenue, open opps, new leads, activities due)
- Kanban stage update endpoint with automatic probability mapping

### Phase 3: Frontend Implementation
- Salesforce-branded sidebar navigation with cloud blue (#00A1E0) and navy (#032D60)
- @dnd-kit kanban board with DragOverlay for smooth drag-drop experience
- Shared EntityForm modal component supporting all 4 entity types
- ConvertLeadModal with optional opportunity creation
- AccountDetail with tabbed view (contacts, opportunities, activities)
- CSS-only pipeline and revenue bar charts (no charting library dependency)
- StatusBadge component with per-entity-type color mappings

## Key Design Decisions

### Polymorphic Activities
Activities use `related_type` (string) and `related_id` (UUID) columns instead of separate join tables. This enables a single ActivityTimeline component that works on any entity detail page. The composite index `(related_type, related_id)` handles query performance. The trade-off is no FK constraint, but activities are append-only logs where orphans are harmless.

### Transactional Lead Conversion
Lead conversion creates 2-3 entities (account, contact, optional opportunity) and updates the lead status in a single PostgreSQL transaction. This guarantees atomicity without the complexity of a saga pattern. The transaction acquires a dedicated client from the pool and uses explicit BEGIN/COMMIT/ROLLBACK.

### Stage-Probability Coupling
The PUT /api/opportunities/:id/stage endpoint automatically maps stages to probabilities (Prospecting=10%, Qualification=20%, etc.). This ensures consistent pipeline forecasting. Users can override probability via the full PUT endpoint, but kanban drag-drop always applies the default mapping.

### CSS-Only Charts
Dashboard and report visualizations use proportional-width divs instead of Chart.js or Recharts. This adds zero bundle size while providing sufficient visualization for pipeline and revenue data. The trade-off is no tooltips, animations, or interactive legends.

### Shared EntityForm
A single EntityForm component renders different fields based on entityType prop. This avoids 4 separate form components (AccountForm, ContactForm, etc.) and ensures consistent modal behavior, validation patterns, and save/cancel UX across all entities.

## Open Questions

- Should custom field values be queryable via the API? Currently the custom_fields and custom_field_values tables exist in the schema but aren't exposed through routes.
- How to handle concurrent kanban updates from multiple users? Currently last-write-wins.
- Should the dashboard cache KPIs in Redis with a TTL instead of computing on every request?
- How to implement bulk operations (mass update stage, mass reassign owner)?

## Learnings

- The CRM data model is deceptively simple (5 entities + 2 custom field tables) but the relationships create complex query patterns, especially for reporting
- Lead conversion is the riskiest operation -- it's the only multi-entity write transaction, and failure means incomplete data
- Kanban drag-drop UX requires careful attention to the DragOverlay pattern to avoid layout shifts during drag
- Dashboard KPI queries can be parallelized with Promise.all for significant latency reduction (8 sequential queries -> 1 round-trip)
- Polymorphic associations simplify the application layer at the cost of database integrity guarantees
