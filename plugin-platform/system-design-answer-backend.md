# Plugin Platform - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design a web-based plugin platform that enables developers to build, publish, and distribute extensions that extend core application functionality. The core challenge is designing a flexible plugin architecture that balances capability with maintainability.

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Install**: Users can add extensions from a marketplace
- **Run**: Execute extensions with access to plugin APIs
- **Publish**: Developers can submit extensions for review
- **Manage**: Enable, disable, update, configure extensions
- **Discover**: Browse, search, and review extensions

### Non-Functional Requirements
- **Composability**: Plugins work independently and together
- **Performance**: < 500ms extension activation
- **Scale**: 10,000+ extensions, 1M+ users
- **Developer Experience**: Easy to build and debug plugins

### Scale Requirements
- **Extensions**: 10,000+
- **Daily active users**: 1M+
- **Extension installations**: 100M+ total
- **API calls/day**: 100M+

## High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React)                                │
│  ┌────────────────────┐  ┌─────────────────────────────────────────────────┐│
│  │   Plugin Host      │  │              Marketplace UI                      ││
│  │  ┌──────────────┐  │  │  ┌───────────┐ ┌───────────┐ ┌───────────────┐ ││
│  │  │ Event Bus    │  │  │  │ Browse    │ │ Install   │ │ Auth Modal    │ ││
│  │  │ State Mgr    │  │  │  │ Plugins   │ │ Uninstall │ │ Login/Register│ ││
│  │  │ Slot System  │  │  │  └───────────┘ └───────────┘ └───────────────┘ ││
│  │  └──────────────┘  │  └─────────────────────────────────────────────────┘│
│  └────────────────────┘                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP/REST
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Backend Services (Express.js)                      │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │ Auth Routes   │  │ Plugin Routes │  │ User Plugins  │  │ Developer    │ │
│  │ - Register    │  │ - Browse      │  │ - Install     │  │ - Publish    │ │
│  │ - Login       │  │ - Search      │  │ - Uninstall   │  │ - Versions   │ │
│  │ - Session     │  │ - Details     │  │ - Settings    │  │ - Manage     │ │
│  └───────────────┘  └───────────────┘  └───────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
    ┌─────────┐           ┌─────────┐            ┌─────────┐
    │PostgreSQL│          │  Redis  │            │  MinIO  │
    │ - Users │           │ - Cache │            │ Plugin  │
    │ - Plugins│          │ - Session│           │ Bundles │
    │ - Reviews│          └─────────┘            └─────────┘
    └─────────┘
```

## Deep Dive 1: Database Schema and Data Modeling (8 minutes)

### Core Tables

| Table | Key Columns | Indexes | Notes |
|-------|-------------|---------|-------|
| **users** | id (UUID PK), username (unique), email (unique), password_hash, is_developer, created_at | — | Tracks whether user has developer privileges |
| **plugins** | id (VARCHAR PK, slug like 'font-selector'), author_id (FK users), name, description, category, license, repository_url, homepage_url, icon_url, status (draft/published/suspended), install_count, created_at, updated_at | status, category, install_count DESC | Human-readable string slug as PK for easier debugging |
| **plugin_versions** | id (UUID PK), plugin_id (FK plugins, CASCADE), version, bundle_url, manifest (JSONB), changelog, min_platform_version, file_size, checksum, created_at | plugin_id; UNIQUE(plugin_id, version) | Immutable release records — each version is a separate row |
| **user_plugins** | user_id + plugin_id (composite PK, both FK with CASCADE), version_installed, is_enabled, settings (JSONB), installed_at | user_id | One installation per user per plugin enforced by composite PK |
| **anonymous_installs** | session_id + plugin_id (composite PK), version_installed, is_enabled, settings (JSONB), installed_at | — | Separate table for session-based anonymous installs; can be migrated to user_plugins on registration |
| **plugin_reviews** | id (UUID PK), plugin_id (FK plugins), user_id (FK users), rating (1-5), title, content, created_at | plugin_id; UNIQUE(plugin_id, user_id) | One review per user per plugin |

### Design Decisions

**Composite Primary Keys**: Using (user_id, plugin_id) for user_plugins ensures one installation per user per plugin while optimizing lookups.

**JSONB for Settings**: Plugin-specific settings vary widely. JSONB allows flexible schema while supporting queries on settings.

**Anonymous Install Support**: Separate table for session-based installs enables anonymous usage while allowing migration when users register.

## Deep Dive 2: API Design and RESTful Endpoints (8 minutes)

### API Endpoint Structure

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/auth/register` | POST | None | Create account |
| `/api/v1/auth/login` | POST | None | Login |
| `/api/v1/auth/logout` | POST | Session | Logout |
| `/api/v1/auth/me` | GET | Session | Get current user |
| `/api/v1/plugins` | GET | Optional | Browse/search plugins |
| `/api/v1/plugins/:id` | GET | Optional | Plugin details |
| `/api/v1/plugins/categories` | GET | None | List categories |
| `/api/v1/user/plugins` | GET | Optional | Installed plugins |
| `/api/v1/user/plugins/install` | POST | Optional | Install plugin |
| `/api/v1/user/plugins/:id` | DELETE | Optional | Uninstall |
| `/api/v1/developer/register` | POST | Required | Become developer |
| `/api/v1/developer/plugins` | GET/POST | Required | Manage plugins |
| `/api/v1/developer/plugins/:id/versions` | POST | Required | Publish version |

### Extension Publishing Service

The publish flow works as follows:

1. **Validate manifest** — check required fields (id, name, version, entry point)
2. **Run basic code review** — static analysis of the bundle for security issues; reject if flagged
3. **Upload bundle to MinIO** — store at path `extensions/{id}/{version}/bundle.js`
4. **Upsert plugin record** — insert into plugins table or update name/description if the plugin already exists
5. **Create version record** — insert into plugin_versions with bundle URL, manifest JSONB, changelog, and minimum platform version
6. **Invalidate cache** — clear all `plugins:*` keys in Redis so marketplace listings reflect the new version
7. **Update search index** — push the new plugin data to Elasticsearch for discoverability

### Search with Elasticsearch

Search uses Elasticsearch with a `bool` query. The `must` clause requires `status = 'published'` and, if a query string is provided, a `multi_match` against the `name` (boosted 3x), `description`, and `tags` (boosted 2x) fields. An optional category filter is appended as a `term` clause. Results can be sorted by popularity (install_count DESC), rating (average_rating DESC), or recency (published_at DESC). The default page size is 20.

## Deep Dive 3: Session Management and Authentication (6 minutes)

### Session-Based Auth with Anonymous Support

We use `express-session` backed by a Redis store. The key configuration choices:

- `saveUninitialized: true` — creates a session for every visitor, enabling anonymous plugin usage
- Cookies are `httpOnly` and `secure` in production, with a 7-day max age
- An `optionalAuth` middleware passes all requests through; `req.session.userId` is populated only for logged-in users

**Migrating anonymous installs on login**: When a user logs in, we copy all rows from `anonymous_installs` matching their session ID into `user_plugins`, using `ON CONFLICT DO NOTHING` to avoid duplicating any plugins already installed under the authenticated account. Then we delete the anonymous rows.

### Install Flow for Both User Types

The install endpoint handles both authenticated and anonymous users:

1. **Verify plugin exists** — join plugins with plugin_versions to confirm the requested plugin ID and version exist and the plugin status is `published`; return 404 otherwise
2. **Store installation** — if the user is authenticated, upsert into `user_plugins` (keyed on user_id + plugin_id); if anonymous, upsert into `anonymous_installs` (keyed on session_id + plugin_id). In both cases, a conflict updates the version and timestamp.
3. **Increment install count** — update the denormalized `install_count` on the plugins table
4. **Return bundle URL** — respond with the CDN URL for the plugin bundle so the frontend can load it

## Deep Dive 4: Caching Strategy (5 minutes)

### Redis Cache Architecture

Redis cache keys follow a namespace pattern:

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `plugins:list:{query_hash}` | 5 minutes | Browse/search results |
| `plugins:detail:{id}` | 10 minutes | Individual plugin with versions and ratings |
| `plugins:categories` | 30 minutes | Category list (rarely changes) |
| `user:{userId}:plugins` | 5 minutes | User's installed plugins |

The cache service follows the **cache-aside** pattern: check local cache first, then Redis, then database. On a cache miss, the database result is stored in Redis with the appropriate TTL.

**Invalidation triggers**: When a plugin is published, all list cache keys are cleared and the specific detail key is deleted. When a plugin is installed, only its detail key is invalidated (to update install count) without a full list refresh.

**Plugin detail query**: The detail lookup joins plugins with plugin_versions and plugin_reviews in a single query, aggregating versions as a JSON array and computing the average rating and review count. This result is cached for 10 minutes.

## Deep Dive 5: Object Storage for Plugin Bundles (5 minutes)

### MinIO Storage Service

Plugin bundles are stored in a MinIO bucket called `plugin-bundles`. The storage service provides three operations:

1. **Upload bundle** — stores the file at `{pluginId}/{version}/bundle.js` with `Content-Type: application/javascript` and `Cache-Control: public, max-age=31536000, immutable`. Returns the CDN-backed public URL.
2. **Upload source map** — stores the debug map at `{pluginId}/{version}/bundle.js.map` with `Content-Type: application/json`, available for developer debugging.
3. **Delete version** — lists all objects under the `{pluginId}/{version}/` prefix and removes them in batch.

Because each version gets a unique URL path, bundles are immutable and cache-friendly. Example URL: `https://cdn.example.com/plugin-bundles/font-selector/1.0.0/bundle.js`

## Trade-offs Summary

| Decision | Chose | Alternative | Rationale |
|----------|-------|-------------|-----------|
| Search | Elasticsearch | PostgreSQL FTS | Better relevance, faceting, scales independently |
| Plugin Storage | MinIO (S3) | PostgreSQL BLOB | CDN integration, scales independently, cheaper at scale |
| Session Store | Redis | PostgreSQL | Faster session lookups, built-in TTL |
| Anonymous Support | Separate table | Single table with nullable user_id | Cleaner data model, easier cleanup |
| Plugin IDs | String slug | UUID | Human-readable, easier debugging |
| Version Storage | Immutable rows | Mutable with history | Simpler, supports rollback |

## Future Backend Enhancements

1. **Plugin Dependencies**: DAG resolution for plugins that depend on other plugins
2. **Webhook Notifications**: Notify developers on installs, reviews, issues
3. **Usage Analytics**: Track plugin activation, feature usage, errors
4. **Rate Limiting**: Per-developer API limits for publishing
5. **Plugin Sandboxing Metadata**: Store security audit results per version
6. **Automated Testing**: Run plugin test suites during publish
7. **Geographic Distribution**: Multi-region MinIO for faster downloads
