# Retool - Development Notes

## Project Context

This project implements a simplified no-code internal tool builder, inspired by Retool. It demonstrates the meta-problem of building a tool that builds tools, covering component models, binding engines, query executors, and drag-and-drop canvas editors.

## Development Phases

### Phase 1: Architecture and Design
- Defined two-database architecture (metadata DB + target DB)
- Designed component model with position/props/bindings
- Planned binding engine for `{{ expression }}` resolution
- Sketched three-pane editor layout

### Phase 2: Backend Implementation
- Express API with session auth (Redis-backed)
- App CRUD with JSONB storage for components/queries
- Query executor that creates dynamic pg.Pool connections to target databases
- Binding engine with safe property path resolution (no eval)
- Component registry defining 9 widget types with prop schemas
- Publish/versioning system with app_versions table

### Phase 3: Frontend Implementation
- Three-pane editor: palette (left), canvas (center), properties (right)
- @dnd-kit/core for drag-from-palette-to-canvas
- 12-column grid layout with absolute positioning
- Widget renderer dynamically maps component type to widget React component
- BindingInput with `{{ }}` syntax highlighting
- Query panel with SQL editor, data source selector, and results table
- Preview mode renders all components with live data

## Key Design Decisions

### JSONB for Component Storage
Components, queries, and layout are stored as JSONB columns in the apps table rather than normalized relational tables. This trades query flexibility for schema flexibility -- a no-code tool's component structure evolves rapidly and normalization would require constant migrations.

### Two-Database Architecture
The retool metadata database and the target database (sample e-commerce) are completely separate PostgreSQL instances. This mirrors production Retool where user data sources are external systems. The query executor creates dynamic connection pools keyed by data source ID.

### Safe Binding Resolution
The binding engine resolves `{{ query1.data[0].name }}` expressions using property path traversal rather than `eval()`. This prevents arbitrary code execution while supporting dot notation and array bracket access.

### Grid-Based Layout
Components use a 12-column grid (80px per column, 40px per row) with position `{ x, y, w, h }`. This matches Retool's grid approach and makes drag-and-drop positioning predictable.

### Session Auth over JWT
Sessions stored in Redis with express-session. Simpler than JWT for this use case -- immediate revocation, no token refresh complexity, works naturally with server-rendered previews.

## Open Questions

- Should the binding engine support JavaScript expressions beyond property paths?
- How to handle cascading query execution (query B depends on query A's result)?
- Should component events (onClick) support multiple action chains?
- How to implement undo/redo for canvas operations?

## Learnings

- The component model (type + props + position + bindings) is the central abstraction -- every feature flows from it
- JSONB storage is ideal for schema-flexible data but makes querying individual components harder
- Dynamic database connections require careful pooling to avoid connection exhaustion
- Drag-and-drop with grid snapping requires careful coordinate math between pixel and grid units
