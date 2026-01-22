# GitHub - System Design Answer (Backend Focus)

## 45-minute system design interview format - Backend Engineer Position

---

## 1. Requirements Clarification (2 min)

### Functional Requirements
- Create, clone, push, pull Git repositories
- Create, review, and merge pull requests
- Search code across millions of repositories
- Webhooks for external system integration

### Non-Functional Requirements
- 99.99% availability for Git operations
- < 100ms latency for API requests
- Zero data loss (code is irreplaceable)
- Scale to 200M repositories, 1B files indexed

### Scale Estimates

| Metric | Estimate |
|--------|----------|
| Repositories | 200M |
| Daily Git Operations | 100M |
| Daily Pushes | 10M |
| Files Indexed | 1B |
| Webhooks/Day | 100M |

---

## 2. High-Level Architecture (3 min)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│  Web UI  |  Git CLI  |  GitHub CLI  |  IDE Extensions          │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Git Server  │    │   API Server  │    │ Search Service│
│               │    │               │    │               │
│ - SSH/HTTPS   │    │ - REST/GraphQL│    │ - Code index  │
│ - Pack files  │    │ - PRs, Issues │    │ - Elasticsearch│
│ - LFS         │    │ - Webhooks    │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Storage Layer                              │
├─────────────┬─────────────┬─────────────────────────────────────┤
│ Git Storage │ PostgreSQL  │           Elasticsearch             │
│ (Object store)│ - Repos    │           - Code search             │
│ - Blobs     │ - PRs       │           - Symbols                 │
│ - Trees     │ - Users     │                                     │
│ - Commits   │ - Webhooks  │                                     │
└─────────────┴─────────────┴─────────────────────────────────────┘
```

---

## 3. Deep Dive: Git Object Storage (10 min)

### Understanding Git Objects

Git has four object types, all content-addressed by SHA-1 hash:

| Type | Contains | Example |
|------|----------|---------|
| **Blob** | File contents | `function hello() {...}` |
| **Tree** | Directory structure | `src/` -> blob, blob, tree |
| **Commit** | Commit metadata | Author, message, parent, tree |
| **Tag** | Annotated tag | Tag name, tagger, commit |

### Storage Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                    Repository Storage                            │
├─────────────────────────────────────────────────────────────────┤
│  /repositories/{owner}/{repo}/                                  │
│  ├── objects/                                                    │
│  │   └── pack/                                                  │
│  │       ├── pack-abc123.pack   (compressed objects)            │
│  │       └── pack-abc123.idx    (index for fast lookup)         │
│  └── refs/                                                       │
│      ├── heads/                                                  │
│      │   ├── main              (→ commit SHA)                   │
│      │   └── feature-branch    (→ commit SHA)                   │
│      └── tags/                                                   │
│          └── v1.0.0            (→ commit SHA)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Content-Addressed Deduplication

```
┌──────────────────────────────────────────────────────────────────┐
│                   Git Object Storage Flow                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Input: object type + content                                    │
│                                                                   │
│  1. Create header: "{type} {length}\0{content}"                  │
│                                                                   │
│  2. SHA-1 hash the combined data                                 │
│     ┌────────────────────────────────────────┐                   │
│     │ hash = SHA1(header + content)          │                   │
│     │ e.g., "abc123def456..."                │                   │
│     └────────────────────────────────────────┘                   │
│                                                                   │
│  3. Check if object exists (deduplication!)                      │
│     path = objects/{hash[0:2]}/{hash[2:]}                        │
│                                                                   │
│  4. If not exists: compress with zlib and store                  │
│                                                                   │
│  Result: Same content = same hash = stored once                  │
└──────────────────────────────────────────────────────────────────┘
```

### Pack Files for Efficiency

Pack files bundle multiple objects with delta compression for storage efficiency.

```
┌────────────────────────────────────────────────────────────────┐
│                    Pack File Structure                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Pack Index (.idx):                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Fanout Table (256 entries)                               │   │
│  │ - For binary search by first byte of hash               │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ Sorted SHA-1 Hashes                                      │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ CRC32 Checksums                                          │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ Offsets into Pack File                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Pack Data (.pack):                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Object 1: [type|size] [compressed data]                 │   │
│  │ Object 2: [type|size] [compressed data]                 │   │
│  │ Object 3: [DELTA|base-ref] [delta instructions]         │   │
│  │ ...                                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Lookup: O(log n) via fanout table + binary search             │
└────────────────────────────────────────────────────────────────┘
```

### Delta Compression

Store base object, then only differences for similar objects. This is why editing one line in a file is efficient.

```
┌────────────────────────────────────────────────────────────────┐
│                   Delta Instructions                            │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Base Object (v1):        Target Object (v2):                  │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ Line 1          │     │ Line 1          │                   │
│  │ Line 2          │     │ Line 2 MODIFIED │                   │
│  │ Line 3          │     │ Line 3          │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                                                 │
│  Delta Instructions:                                            │
│  1. COPY offset=0, size=10   (copy "Line 1\n")                 │
│  2. INSERT "Line 2 MODIFIED\n"                                 │
│  3. COPY offset=18, size=7   (copy "Line 3\n")                 │
│                                                                 │
│  Result: Store ~50 bytes instead of duplicating 100+ bytes     │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Deep Dive: Pull Request Workflow (8 min)

### Database Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                    Pull Request Tables                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  pull_requests                          reviews                  │
│  ┌─────────────────────────┐           ┌─────────────────────┐  │
│  │ id (PK)                 │           │ id (PK)             │  │
│  │ repo_id (FK)            │◄──────────│ pr_id (FK)          │  │
│  │ number                  │           │ reviewer_id (FK)    │  │
│  │ title, body             │           │ state (approved,    │  │
│  │ state (open/closed/     │           │   changes_requested,│  │
│  │        merged)          │           │   commented)        │  │
│  │ head_branch, head_sha   │           │ body, commit_sha    │  │
│  │ base_branch, base_sha   │           │ created_at          │  │
│  │ author_id (FK)          │           └─────────────────────┘  │
│  │ merged_by, merged_at    │                                    │
│  │ additions, deletions    │           review_comments           │
│  │ changed_files           │           ┌─────────────────────┐  │
│  │ is_draft                │           │ id (PK)             │  │
│  │ created_at, updated_at  │           │ review_id (FK)      │  │
│  └─────────────────────────┘           │ pr_id (FK)          │  │
│                                         │ path, line, side    │  │
│  Indexes:                               │ body                │  │
│  • idx_prs_repo (repo_id)              │ created_at          │  │
│  • idx_prs_author (author_id)          └─────────────────────┘  │
│  • idx_prs_state (repo_id, state)                               │
│  • idx_reviews_pr (pr_id)                                       │
└─────────────────────────────────────────────────────────────────┘
```

### PR Creation Flow

```
┌────────────────────────────────────────────────────────────────┐
│                   PR Creation Flow                              │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  POST /:owner/:repo/pulls                                      │
│  {title, body, headBranch, baseBranch}                         │
│                                                                 │
│  1. Validate repository exists                                  │
│     └── Query: repos JOIN users WHERE owner=? AND name=?       │
│                                                                 │
│  2. Validate branches exist                                     │
│     ├── getRef(refs/heads/{headBranch}) → headSha              │
│     └── getRef(refs/heads/{baseBranch}) → baseSha              │
│                                                                 │
│  3. Compute diff statistics                                     │
│     └── git diff --stat baseSha..headSha                       │
│         → {additions, deletions, files[]}                      │
│                                                                 │
│  4. Get next PR number                                          │
│     └── SELECT MAX(number) + 1 FROM pull_requests              │
│                                                                 │
│  5. Insert PR record                                            │
│                                                                 │
│  6. Emit webhook: pull_request.opened                          │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Merge Strategies

```
┌────────────────────────────────────────────────────────────────┐
│                    Merge Strategies                             │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. MERGE COMMIT                                               │
│     ┌───────────────────────────────────────┐                  │
│     │ base ──○──○──○──┬──○ (merge commit)   │                  │
│     │                 │                      │                  │
│     │ head ──○──○──○──┘                      │                  │
│     └───────────────────────────────────────┘                  │
│     Creates commit with two parents                            │
│     Message: "Merge PR #N from head_branch"                    │
│                                                                 │
│  2. SQUASH MERGE                                               │
│     ┌───────────────────────────────────────┐                  │
│     │ base ──○──○──○──○ (single squashed)   │                  │
│     │                ▲                       │                  │
│     │ head ──○──○──○─┘ (all changes)        │                  │
│     └───────────────────────────────────────┘                  │
│     Combines all commits into one                              │
│     Message includes all original commit messages              │
│                                                                 │
│  3. REBASE MERGE                                               │
│     ┌───────────────────────────────────────┐                  │
│     │ base ──○──○──○──○'──○'──○' (replayed) │                  │
│     │                                        │                  │
│     │ head ──○──○──○ (original)             │                  │
│     └───────────────────────────────────────┘                  │
│     Cherry-picks each commit onto base                         │
│     Linear history, no merge commits                           │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Mergeability Check

Before any merge, check for conflicts:
1. Attempt test merge in memory
2. If conflicts detected, parse error message for conflicting files
3. Return `{mergeable: false, conflicts: ['file1.js', 'file2.js']}`

---

## 5. Deep Dive: Code Search with Elasticsearch (8 min)

### Elasticsearch Index Design

```
┌────────────────────────────────────────────────────────────────┐
│                 Code Search Index Mapping                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Document Fields:                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ repo_id:     keyword    (filter by repo)                │   │
│  │ repo_name:   keyword    (display)                       │   │
│  │ owner:       keyword    (filter by owner)               │   │
│  │ path:        keyword    (file path for display)         │   │
│  │ filename:    keyword    (filter by name)                │   │
│  │ extension:   keyword    (filter by .js, .py, etc.)      │   │
│  │ language:    keyword    (detected language)             │   │
│  │ content:     text       (full-text search)              │   │
│  │ symbols:     nested     (functions, classes)            │   │
│  │   - name:    keyword                                    │   │
│  │   - kind:    keyword    (function, class, method)       │   │
│  │   - line:    integer                                    │   │
│  │ commit_sha:  keyword                                    │   │
│  │ indexed_at:  date                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Custom Analyzer: "code_analyzer"                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Tokenizer: pattern [^a-zA-Z0-9_]+                       │   │
│  │ Filters:                                                 │   │
│  │   - lowercase                                            │   │
│  │   - camelcase_split (handleClick → handle, Click)       │   │
│  │   - underscore_split (user_name → user, name)           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Indexing Pipeline

```
┌────────────────────────────────────────────────────────────────┐
│                   Indexing Pipeline                             │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  On Push Event:                                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │ Git Push    │───▶│ Diff Files  │───▶│ For Each    │        │
│  │ before/after│    │ A/M/D       │    │ Changed File│        │
│  └─────────────┘    └─────────────┘    └──────┬──────┘        │
│                                                │                │
│                    ┌───────────────────────────┘                │
│                    ▼                                            │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ For each file:                                          │    │
│  │                                                          │    │
│  │ If DELETED:                                              │    │
│  │   → ES deleteByQuery(repo_id + path)                    │    │
│  │                                                          │    │
│  │ If ADDED/MODIFIED:                                       │    │
│  │   → Skip if binary (isBinary check)                     │    │
│  │   → Skip if > 1MB                                        │    │
│  │   → Detect language from extension                      │    │
│  │   → Extract symbols (functions, classes)                │    │
│  │   → ES index document                                    │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Search Query Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    Search Query Flow                            │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  GET /search/code?q=handleClick&language=typescript&repo=myapp │
│                                                                 │
│  Build Query:                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ bool:                                                    │   │
│  │   must:                                                  │   │
│  │     - match: {content: "handleClick"}                   │   │
│  │   filter:                                                │   │
│  │     - term: {language: "typescript"}                    │   │
│  │     - term: {repo_name: "myapp"}                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Symbol Search (e.g., "func:handleClick"):                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ nested:                                                  │   │
│  │   path: "symbols"                                        │   │
│  │   query:                                                 │   │
│  │     match: {"symbols.name": "handleClick"}              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Response includes:                                             │
│  - File paths with repo                                         │
│  - Highlighted code snippets (3 fragments, 150 chars each)     │
│  - Language and symbols                                         │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. Deep Dive: Webhook Delivery System (8 min)

### Reliable Delivery Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                Webhook Delivery System                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Event Source              Queue                Workers         │
│  ┌─────────────┐    ┌───────────────┐    ┌───────────────┐    │
│  │ PR Merged   │───▶│               │───▶│ Worker 1      │    │
│  │ Push        │    │  RabbitMQ     │    │ Worker 2      │    │
│  │ Issue       │    │  Webhook      │    │ Worker 3      │    │
│  │ Comment     │    │  Queue        │    │ ...           │    │
│  └─────────────┘    └───────────────┘    └───────┬───────┘    │
│                                                   │             │
│                                                   ▼             │
│                           ┌───────────────────────────────┐    │
│                           │ For each webhook subscriber:  │    │
│                           │                               │    │
│                           │ 1. Sign payload with HMAC-256│    │
│                           │ 2. POST to webhook URL        │    │
│                           │ 3. Log delivery result        │    │
│                           │ 4. Retry on failure           │    │
│                           └───────────────────────────────┘    │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Webhook Job Structure

```
┌────────────────────────────────────────────────────────────────┐
│                    Webhook Job                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  {                                                              │
│    deliveryId: "uuid",                                         │
│    webhookId: 123,                                              │
│    url: "https://api.example.com/webhook",                     │
│    secret: "webhook-secret-key",                               │
│    event: "pull_request.merged",                               │
│    payload: { action: "merged", number: 42, ... },             │
│    attempt: 1,                                                  │
│    scheduledAt: 1705432000000                                  │
│  }                                                              │
│                                                                 │
│  HTTP Request:                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ POST {url}                                               │   │
│  │ Headers:                                                 │   │
│  │   Content-Type: application/json                        │   │
│  │   X-GitHub-Event: pull_request.merged                   │   │
│  │   X-GitHub-Delivery: {deliveryId}                       │   │
│  │   X-Hub-Signature-256: sha256={HMAC(secret, body)}      │   │
│  │ Body: {payload}                                          │   │
│  │ Timeout: 30 seconds                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Retry Schedule (Exponential Backoff)

| Attempt | Delay | Cumulative Time |
|---------|-------|-----------------|
| 1 | Immediate | 0 |
| 2 | 2s | 2s |
| 3 | 4s | 6s |
| 4 | 8s | 14s |
| 5 | 16s | 30s |
| 6 | 32s | ~1 min |
| 7 | 64s | ~2 min |
| 8 | 128s | ~4 min |
| 9 | 256s | ~8 min |
| 10 | 512s | ~17 min |

Retry on: 5xx errors, network timeouts, connection failures.
Stop after: 10 attempts or 2xx response.

---

## 7. Caching Strategy (3 min)

### Multi-Layer Cache

```
┌────────────────────────────────────────────────────────────────┐
│                    Cache TTL Configuration                      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Cache Key Pattern          TTL        Rationale               │
│  ────────────────────────  ─────────  ─────────────────────    │
│  repo:{id}:metadata        5 min      Frequently accessed      │
│  repo:{id}:branches        1 min      Changes on push          │
│  repo:{id}:commits:{ref}   5 min      Semi-static              │
│  blob:{sha}                1 hour     Immutable (SHA-based!)   │
│  pr:{id}:diff              10 min     Changes on force-push    │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Cache Invalidation

```
┌────────────────────────────────────────────────────────────────┐
│                 Event-Driven Invalidation                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  On Push:                                                       │
│    invalidate("repo:{repoId}:branches")                        │
│    invalidate("repo:{repoId}:commits:*")                       │
│                                                                 │
│  On PR Update:                                                  │
│    invalidate("pr:{prId}:diff")                                │
│                                                                 │
│  Pattern: Use SCAN (not KEYS) for wildcard invalidation        │
│           to avoid blocking Redis                               │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 8. Trade-offs and Decisions

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Git storage | Object store | Database | Immutable, content-addressed, dedup |
| Code search | Elasticsearch | PostgreSQL FTS | Scale (1B files), tokenization |
| Webhooks | Queue-based | Synchronous | Reliability, non-blocking |
| Pack files | On-disk | Database | Git-native, compression |
| Merge strategies | 3 options | Single merge | Developer choice, clean history |

---

## 9. Summary

### Key Backend Decisions

1. **Content-addressed storage** for Git objects with automatic deduplication
2. **Pack files with delta compression** for storage efficiency
3. **Elasticsearch with custom code analyzer** for billion-file search
4. **Queue-based webhook delivery** with exponential backoff retries
5. **Redis caching** with event-driven invalidation

### Future Enhancements

- Large File Storage (LFS) for binary assets
- Partial clone for monorepo performance
- GitHub Actions CI/CD runner
- Dependabot dependency updates
- Code scanning for security vulnerabilities
