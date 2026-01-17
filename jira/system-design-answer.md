# Design Jira - System Design Interview Answer

## Introduction (2 minutes)

"Thanks for the opportunity. Today I'll design Jira, an issue tracking and project management system. Jira is fascinating from a system design perspective because it combines:

1. Highly customizable workflow engines where each team defines their own process
2. Dynamic field schemas that vary by project and issue type
3. Complex permission models with project-level and issue-level controls
4. A powerful query language (JQL) for searching and filtering

Let me start by clarifying requirements."

---

## Requirements Clarification (5 minutes)

### Functional Requirements

"For our core product:

1. **Issues**: Create, read, update issues with standard and custom fields
2. **Workflows**: Customizable state machines - define statuses and allowed transitions
3. **Projects**: Isolated spaces with their own settings, workflows, and permissions
4. **Boards**: Kanban and Scrum views of issues
5. **Search**: JQL-based querying - 'project = PROJ AND status = "In Progress"'

The workflow engine and JQL parser are the most technically interesting, so I'll focus there."

### Non-Functional Requirements

"For scale and performance:

- **Availability**: 99.9% uptime - teams depend on this for daily work
- **Latency**: Under 200ms for issue operations, under 1 second for complex searches
- **Scale**: 1 million projects, 100 million issues
- **Audit Trail**: Complete history of every change for compliance

The audit requirement is important for enterprise customers - they need to see who changed what and when."

---

## High-Level Design (10 minutes)

### Architecture Overview

"Here's my proposed architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│         Web │ Mobile │ IDE Plugins │ CLI                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
│                  (Auth, Rate Limiting)                          │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Issue Service │    │Workflow Engine│    │Search Service │
│               │    │               │    │               │
│ - CRUD        │    │ - Transitions │    │ - JQL Parser  │
│ - Comments    │    │ - Validators  │    │ - Indexing    │
│ - Attachments │    │ - Actions     │    │ - Aggregation │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────────────────────────────────┤
│   PostgreSQL    │              Elasticsearch                    │
│   - Issues      │              - Issue search                   │
│   - Workflows   │              - JQL queries                    │
│   - History     │                                               │
└─────────────────┴───────────────────────────────────────────────┘
```"

### Service Responsibilities

"Three main services:

**Issue Service**: CRUD operations, comments, attachments, watchers. This is the workhorse handling most API calls.

**Workflow Engine**: The state machine that controls issue transitions. Validates that transitions are allowed, runs pre/post functions.

**Search Service**: Parses JQL, translates to Elasticsearch queries, returns results. Also handles aggregations for reports."

---

## Deep Dive: Workflow Engine (12 minutes)

### Workflow Definition

"Workflows are configurable state machines. Here's the data model:

```typescript
interface Workflow {
  id: string
  name: string
  statuses: Status[]
  transitions: Transition[]
}

interface Status {
  id: string
  name: string
  category: 'todo' | 'in_progress' | 'done'  // For reporting
}

interface Transition {
  id: string
  name: string
  from: string[]  // Status IDs (empty means 'from any')
  to: string  // Target status ID
  conditions: Condition[]
  validators: Validator[]
  postFunctions: PostFunction[]
}
```

Each transition can have:
- **Conditions**: Who can perform this transition (e.g., only assignee, only admins)
- **Validators**: What must be true (e.g., 'Summary is not empty', 'Has estimate')
- **Post-Functions**: Actions to run after (e.g., 'Send notification', 'Update field')"

### Transition Execution

"Here's how a transition works:

```javascript
async function executeTransition(issueId, transitionId, user) {
  const issue = await getIssue(issueId)
  const workflow = await getWorkflow(issue.projectId)
  const transition = workflow.transitions.find(t => t.id === transitionId)

  // 1. Check conditions (who can do this?)
  for (const condition of transition.conditions) {
    if (!await checkCondition(condition, issue, user)) {
      throw new Error(`Condition failed: ${condition.type}`)
    }
  }

  // 2. Run validators (is the issue ready?)
  for (const validator of transition.validators) {
    if (!await runValidator(validator, issue)) {
      throw new Error(`Validation failed: ${validator.type}`)
    }
  }

  // 3. Update issue status
  const previousStatus = issue.status
  await db('issues')
    .where({ id: issueId })
    .update({ status: transition.to })

  // 4. Run post-functions (side effects)
  for (const postFunc of transition.postFunctions) {
    await runPostFunction(postFunc, issue, transition)
  }

  // 5. Record in history
  await recordHistory(issueId, 'status', previousStatus, transition.to, user)
}
```

This is a synchronous flow - all steps must complete for the transition to succeed. Post-functions that can fail should be queued asynchronously."

### Example Conditions

"Common condition types:

```javascript
async function checkCondition(condition, issue, user) {
  switch (condition.type) {
    case 'user_in_role':
      const roles = await getUserRoles(user.id, issue.projectId)
      return roles.includes(condition.config.role)

    case 'issue_assignee':
      return issue.assignee_id === user.id

    case 'user_in_group':
      const groups = await getUserGroups(user.id)
      return groups.includes(condition.config.group)

    default:
      return true
  }
}
```"

### Why Database-Driven Workflows?

"We store workflows in the database rather than code because:
1. Administrators can customize without developer involvement
2. Changes can be versioned and rolled back
3. Different projects can use different workflows
4. No code deployment for workflow changes

The tradeoff is we can't have arbitrary code in transitions - only predefined condition/validator/action types. For most use cases, this is sufficient."

---

## Deep Dive: Custom Fields (8 minutes)

### The Challenge

"Each project might have different custom fields. How do we store them efficiently while keeping queries fast?"

### Schema Design

"I'd use a JSONB column on the issues table:

```sql
CREATE TABLE custom_field_definitions (
  id SERIAL PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,  -- 'text', 'number', 'select', 'user', 'date'
  config JSONB,  -- Options for selects, validation rules
  required BOOLEAN DEFAULT FALSE
);

CREATE TABLE issues (
  id SERIAL PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  key VARCHAR(50) UNIQUE,  -- 'PROJ-123'
  summary VARCHAR(500) NOT NULL,
  description TEXT,
  issue_type VARCHAR(50),
  status VARCHAR(50),
  priority VARCHAR(50),
  assignee_id UUID REFERENCES users(id),
  reporter_id UUID REFERENCES users(id),
  custom_fields JSONB,  -- { 'field_123': 'value', 'field_456': 42 }
  created_at TIMESTAMP DEFAULT NOW()
);
```"

### Why JSONB?

"JSONB gives us flexibility with good performance:
- No schema changes when adding fields
- GIN indexes for fast lookups: `CREATE INDEX idx_custom_fields ON issues USING GIN(custom_fields)`
- PostgreSQL operators for querying: `custom_fields->>'field_123' = 'value'`

The alternative is the Entity-Attribute-Value (EAV) pattern with a separate field_values table, but that leads to expensive JOINs and more complex queries."

### Field Type Handling

"Each field type has specific behavior:

```javascript
function validateFieldValue(definition, value) {
  switch (definition.type) {
    case 'text':
      return typeof value === 'string'

    case 'number':
      return typeof value === 'number' && !isNaN(value)

    case 'select':
      return definition.config.options.includes(value)

    case 'user':
      return await userExists(value)

    case 'date':
      return !isNaN(Date.parse(value))
  }
}
```

Validation happens at the API layer before storage."

---

## Deep Dive: JQL Parser (8 minutes)

### JQL Grammar

"JQL (Jira Query Language) looks like this:
```
project = PROJ AND status = 'In Progress' AND assignee = currentUser()
```

The grammar:
```
query     = clause (AND|OR clause)*
clause    = field operator value | '(' query ')'
field     = 'project' | 'status' | 'assignee' | customField
operator  = '=' | '!=' | '~' | '>' | '<' | 'IN' | 'NOT IN'
value     = string | number | EMPTY | function
function  = 'currentUser()' | 'now()' | 'startOfDay()'
```"

### Parser Implementation

"We parse JQL into an AST, then translate to Elasticsearch:

```javascript
class JQLParser {
  parse(jql) {
    const tokens = this.tokenize(jql)
    return this.parseQuery(tokens)
  }

  toElasticsearch(ast) {
    if (ast.type === 'AND') {
      return {
        bool: { must: ast.clauses.map(c => this.toElasticsearch(c)) }
      }
    }
    if (ast.type === 'OR') {
      return {
        bool: { should: ast.clauses.map(c => this.toElasticsearch(c)) }
      }
    }
    if (ast.type === 'clause') {
      return this.clauseToES(ast)
    }
  }

  clauseToES(clause) {
    switch (clause.operator) {
      case '=':
        return { term: { [clause.field]: clause.value } }
      case '~':  // Contains
        return { match: { [clause.field]: clause.value } }
      case 'IN':
        return { terms: { [clause.field]: clause.value } }
      case '>':
        return { range: { [clause.field]: { gt: clause.value } } }
    }
  }
}
```"

### Why Elasticsearch?

"JQL queries can be complex - multiple ANDs/ORs, text search, date ranges, custom fields. Elasticsearch handles this well:
- Full-text search with `~` operator
- Complex boolean queries
- Aggregations for reporting
- Fast even with millions of issues

We sync issues to Elasticsearch asynchronously. For simple queries, we could fall back to PostgreSQL."

---

## Deep Dive: Permission System (5 minutes)

### Permission Model

"Jira has a sophisticated permission system:

```sql
CREATE TABLE permission_schemes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE permission_grants (
  scheme_id INTEGER REFERENCES permission_schemes(id),
  permission VARCHAR(100) NOT NULL,  -- 'create_issue', 'edit_issue', 'transition'
  grantee_type VARCHAR(50),  -- 'role', 'user', 'group', 'anyone'
  grantee_id VARCHAR(100),   -- Role name, user ID, or group ID
  PRIMARY KEY (scheme_id, permission, grantee_type, grantee_id)
);

CREATE TABLE projects (
  id UUID PRIMARY KEY,
  key VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  permission_scheme_id INTEGER REFERENCES permission_schemes(id)
);
```

Projects reference permission schemes. Multiple projects can share the same scheme."

### Permission Check

"Checking permissions:

```javascript
async function hasPermission(userId, projectId, permission) {
  const project = await getProject(projectId)
  const userRoles = await getUserRoles(userId, projectId)
  const userGroups = await getUserGroups(userId)

  const grants = await db('permission_grants')
    .where({ scheme_id: project.permissionSchemeId, permission })

  for (const grant of grants) {
    if (grant.grantee_type === 'anyone') return true
    if (grant.grantee_type === 'user' && grant.grantee_id === userId) return true
    if (grant.grantee_type === 'role' && userRoles.includes(grant.grantee_id)) return true
    if (grant.grantee_type === 'group' && userGroups.includes(grant.grantee_id)) return true
  }

  return false
}
```

This is called frequently, so we'd cache permission grants per project."

---

## Audit Trail (2 minutes)

"Every change is recorded:

```sql
CREATE TABLE issue_history (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES issues(id),
  user_id UUID REFERENCES users(id),
  field VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

When updating an issue, we diff the old and new values and record each changed field. This is straightforward but essential for compliance."

---

## Trade-offs and Alternatives (2 minutes)

"Key decisions:

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Custom Fields | JSONB | EAV table | Simpler queries, better performance |
| Search | Elasticsearch | PostgreSQL FTS | Complex JQL, aggregations |
| Workflows | Database-driven | Code-driven | User customization without deploys |
| History | Event table | Event sourcing | Simpler queries for UI |

If I had more time, I'd discuss:
- Bulk operations (updating 1000 issues)
- Notification system for watchers
- Caching strategy for frequently accessed issues
- Sharding strategy for very large installations"

---

## Summary

"To summarize, I've designed Jira with:

1. **Configurable workflow engine** with conditions, validators, and post-functions
2. **JSONB custom fields** for flexibility without schema changes
3. **JQL parser** that translates to Elasticsearch queries
4. **Permission schemes** with role/group/user grants
5. **Complete audit trail** for compliance

The design prioritizes flexibility - every team can customize their workflows and fields - while maintaining query performance through smart indexing.

What would you like me to elaborate on?"
