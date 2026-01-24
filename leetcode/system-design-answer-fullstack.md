# LeetCode (Online Judge) - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

---

## 🎯 Problem Statement

Design an online coding practice and evaluation platform that allows users to:
- Browse and solve coding problems across difficulty levels
- Submit code in multiple programming languages
- Execute code securely with real-time feedback
- Track progress and compete on leaderboards

This answer covers the end-to-end architecture, emphasizing the integration between frontend and backend components.

---

## 📋 Requirements Clarification

### Functional Requirements

1. **Problem browsing** with filtering by difficulty, tags, and status
2. **Code editor** with syntax highlighting and multi-language support
3. **Code submission** with secure sandbox execution
4. **Real-time results** showing test case progress
5. **User progress** tracking solved problems and performance

### Non-Functional Requirements

1. **Security**: Sandboxed execution preventing malicious code
2. **Low latency**: Results within 5 seconds for simple problems
3. **Responsive UI**: Smooth editor experience, instant feedback
4. **Scale**: Support 10K+ concurrent users during contests

### Scale Estimates

- 500K daily active users
- 1M submissions/day (normal), 10K/minute (contest peak)
- 3,000 problems with 50 test cases each

---

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser (React Application)                       │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │    ProblemList  │  CodeEditor  │  TestResults  │  ProgressDash     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│  ┌────────────────────────────────┴────────────────────────────────────┐│
│  │  Zustand Store: problems[], code{}, submissions[], language          ││
│  └────────────────────────────────┬────────────────────────────────────┘│
│                                   │                                      │
│  ┌────────────────────────────────┴────────────────────────────────────┐│
│  │  API Service: submit(), pollStatus(), fetchProblems()                ││
│  └────────────────────────────────┬────────────────────────────────────┘│
└───────────────────────────────────┼──────────────────────────────────────┘
                                    │ REST API (JSON)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Express API Server                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Middleware: cors │ session │ auth │ rateLimit                      │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  /auth         │  │  /problems      │  │  /submissions           │  │
│  │  - login       │  │  - list         │  │  - submit               │  │
│  │  - register    │  │  - getBySlug    │  │  - run (sample only)    │  │
│  │  - logout      │  │  - create(admin)│  │  - status               │  │
│  └────────────────┘  └─────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────┐
        ▼                         ▼                     ▼
┌──────────────┐          ┌──────────────┐      ┌──────────────┐
│  PostgreSQL  │          │    Valkey    │      │    Docker    │
│  - problems  │          │  - sessions  │      │   Sandbox    │
│  - users     │          │  - status    │      │  - python    │
│  - submits   │          │  - cache     │      │  - node      │
└──────────────┘          └──────────────┘      └──────────────┘
```

---

## 💾 Data Model

### Database Schema (PostgreSQL)

**Users Table**
- id (UUID, PK), username (unique), email (unique), password_hash
- role (default 'user'), created_at

**Problems Table**
- id (UUID, PK), title, slug (unique), description (TEXT)
- difficulty ('easy'/'medium'/'hard'), time_limit_ms, memory_limit_mb
- starter_code_python (TEXT), starter_code_javascript (TEXT)

**Test Cases Table**
- id (UUID, PK), problem_id (FK → problems)
- input (TEXT), expected_output (TEXT)
- is_sample (boolean), order_index (integer)

**Submissions Table**
- id (UUID, PK), user_id (FK), problem_id (FK)
- language, code (TEXT), status (default 'pending')
- runtime_ms, memory_kb, test_cases_passed, test_cases_total
- error_message (TEXT), created_at

**User Progress Table**
- user_id + problem_id (composite PK)
- status ('solved'/'attempted'/'unsolved')
- best_runtime_ms, attempts, solved_at

### Shared TypeScript Types

| Type | Key Fields | Purpose |
|------|------------|---------|
| Problem | id, title, slug, difficulty, starterCode | Problem metadata |
| TestCase | id, input, expectedOutput, isSample | Test validation |
| Submission | id, status, runtimeMs, memoryKb, testCasesPassed | Submission result |
| SubmissionProgress | status, currentTest, testCasesTotal, failedTest | Real-time updates |

---

## 🔧 Deep Dive: Code Execution Pipeline

### End-to-End Flow

```
┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐
│  Editor  │─────▶│  API     │─────▶│  Create  │─────▶│  Return  │
│  Submit  │      │  Server  │      │  Record  │      │  ID      │
└──────────┘      └──────────┘      └──────────┘      └──────────┘
                                          │
                                          │ Async (don't await)
                                          ▼
                                    ┌──────────────┐
                                    │  Execution   │
                                    │  Pipeline    │
                                    └──────┬───────┘
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            │                              │                              │
            ▼                              ▼                              ▼
     ┌─────────────┐              ┌─────────────┐              ┌─────────────┐
     │  Create     │              │  Run Each   │              │  Compare    │
     │  Container  │─────────────▶│  Test Case  │─────────────▶│  Output     │
     │  (Docker)   │              │  w/ Limits  │              │  Update DB  │
     └─────────────┘              └─────────────┘              └─────────────┘
                                         │
                                         │ After each test
                                         ▼
                                  ┌─────────────┐
                                  │  Update     │
                                  │  Valkey     │
                                  │  Status     │
                                  └─────────────┘
```

### Frontend Polling Flow

```
┌────────────────┐         ┌────────────────┐         ┌────────────────┐
│   Submit Code  │         │   Backend API  │         │   Valkey Cache │
└───────┬────────┘         └───────┬────────┘         └───────┬────────┘
        │                          │                          │
        │  POST /submissions       │                          │
        │─────────────────────────▶│                          │
        │  { submissionId }        │                          │
        │◀─────────────────────────│                          │
        │                          │                          │
        ├──────────────────────────── POLLING LOOP ───────────┤
        │                          │                          │
        │  GET /status/{id}        │                          │
        │─────────────────────────▶│   GET submission:{id}    │
        │                          │─────────────────────────▶│
        │                          │   { status: "running" }  │
        │  { status, currentTest } │◀─────────────────────────│
        │◀─────────────────────────│                          │
        │                          │                          │
        │  ...poll every 1s...     │                          │
        │                          │                          │
        │  GET /status/{id}        │                          │
        │─────────────────────────▶│                          │
        │  { status: "accepted",   │                          │
        │    runtimeMs: 42 }       │                          │
        │◀─────────────────────────│                          │
        │                          │                          │
        │  STOP POLLING            │                          │
        ▼                          ▼                          ▼
```

### Docker Sandbox Security

| Security Layer | Configuration | Purpose |
|----------------|---------------|---------|
| Network | network_mode: none | Block external calls |
| Filesystem | read_only: true | Prevent writes |
| Capabilities | cap_drop: ALL | No privilege escalation |
| Resources | memory: 256MB, CPU: 0.5 | Prevent exhaustion |
| Processes | pids_limit: 50 | Prevent fork bombs |
| Privileges | no-new-privileges | Prevent escalation |

---

## 🔧 Deep Dive: Code Editor Integration

### CodeMirror 6 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CodeEditor Component                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      EditorState                            │ │
│  │                                                             │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐    │ │
│  │  │ basicSetup │  │ Language   │  │    Theme           │    │ │
│  │  │ (line nums,│  │ Extension  │  │    (oneDark)       │    │ │
│  │  │  folding)  │  │ (python/js)│  │                    │    │ │
│  │  └────────────┘  └────────────┘  └────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      EditorView                             │ │
│  │                                                             │ │
│  │  updateListener ──▶ onChange callback                       │ │
│  │  Recreates on language change                               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Code Draft Persistence

```
┌────────────────┐     keystroke      ┌─────────────────┐
│  CodeEditor    │───────────────────▶│  In-memory      │
│  onChange      │                    │  Draft          │
└────────────────┘                    └────────┬────────┘
                                               │
                                      500ms debounce
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │  Zustand Store  │
                                      │  + localStorage │
                                      │  persist()      │
                                      └─────────────────┘
```

> "I persist code drafts to localStorage via Zustand's persist middleware. This prevents users from losing work if they accidentally close the browser. The 500ms debounce prevents excessive writes during rapid typing."

---

## 🔧 Deep Dive: Trade-off Analysis

### Trade-off 1: Polling vs WebSocket for Results

| Approach | Pros | Cons |
|----------|------|------|
| ✅ HTTP Polling | Simple, works behind firewalls, stateless | 1-2s latency, more requests |
| ❌ WebSocket | Real-time, fewer requests | Connection management, stateful |

> "I chose HTTP polling over WebSockets for submission status updates. Polling at 1-second intervals introduces acceptable latency for a code execution flow where users expect 2-5 second turnaround anyway. The simplicity benefit is significant: polling is stateless, works through corporate proxies that block WebSockets, and requires no connection lifecycle management. WebSockets would be premature optimization—the ~1s polling delay is imperceptible when sandboxed execution itself takes 1-3 seconds. The trade-off is slightly higher server load from repeated requests, but Valkey caching makes these status checks sub-millisecond. For contests with 10K concurrent users, we can easily handle 10K requests/second to a cached endpoint. If we later need sub-100ms updates (e.g., streaming compiler output), WebSocket upgrade is straightforward since the status shape already supports incremental progress."

### Trade-off 2: CodeMirror vs Monaco Editor

| Approach | Pros | Cons |
|----------|------|------|
| ✅ CodeMirror 6 | 150KB bundle, mobile-friendly, customizable | Less IDE-like |
| ❌ Monaco Editor | Full IDE features, familiar to VS Code users | 2MB bundle, poor mobile |

> "I chose CodeMirror 6 over Monaco for the code editor. Monaco provides a richer IDE experience—IntelliSense, multi-cursor, VS Code keybindings—but at 2MB it bloats our bundle significantly and performs poorly on mobile devices. For a LeetCode-style platform, users don't need IntelliSense since they're implementing known function signatures against known test cases. CodeMirror 6's 150KB footprint means faster initial load, and its modular architecture lets us add exactly the features we need: syntax highlighting, line numbers, and bracket matching. The trade-off is that power users accustomed to VS Code may miss features like go-to-definition, but these features aren't useful when working with single-file algorithm problems. Mobile support matters because users practice during commutes—CodeMirror handles touch input well while Monaco is effectively desktop-only."

### Trade-off 3: Synchronous vs Async Execution

| Approach | Pros | Cons |
|----------|------|------|
| ✅ Async with Polling | Non-blocking, handles bursts, clean separation | More complex |
| ❌ Synchronous Response | Simpler API contract | Blocks connections, timeouts |

> "I chose asynchronous execution with polling over synchronous HTTP responses. If we waited for code execution to complete before responding, a 10-second C++ problem would hold an HTTP connection open for 10 seconds. With 1000 concurrent submissions during a contest, we'd need 1000 sustained connections just for execution waits—exhausting connection pools and hitting load balancer timeouts. Async execution returns a submission ID immediately, freeing the connection. The execution pipeline runs in the background, updating Valkey with progress. Frontend polls at 1-second intervals. This decoupling also enables future improvements: we can add a Kafka queue between API and workers, scale workers independently, and implement priority queuing for contest submissions. The trade-off is implementation complexity—we need cache-based status tracking and idempotent status endpoints—but this complexity is well-contained and enables true horizontal scaling."

---

## 🌐 API Design

### RESTful Endpoints

```
Authentication:
POST   /api/v1/auth/login        ──▶ Create session
POST   /api/v1/auth/register     ──▶ Create account
POST   /api/v1/auth/logout       ──▶ Destroy session
GET    /api/v1/auth/me           ──▶ Get current user

Problems:
GET    /api/v1/problems          ──▶ List (paginated, filterable)
GET    /api/v1/problems/:slug    ──▶ Get with sample tests

Submissions:
POST   /api/v1/submissions       ──▶ Submit for judging (returns ID)
POST   /api/v1/submissions/run   ──▶ Run sample tests only
GET    /api/v1/submissions/:id/status ──▶ Poll execution status

Users:
GET    /api/v1/users/progress    ──▶ Get solve progress
```

### Response Flow

```
POST /submissions { problemSlug, language, code }
     │
     ▼
202 Accepted { submissionId: "uuid" }
     │
     │  Client polls GET /submissions/{id}/status
     ▼
     ┌─────────────────────────────────────────┐
     │ { status: "pending" }                   │
     │ { status: "running", currentTest: 3 }   │
     │ { status: "accepted", runtimeMs: 42 }   │
     └─────────────────────────────────────────┘
```

---

## ⚖️ Trade-offs Summary

| Decision | Choice | Trade-off |
|----------|--------|-----------|
| Editor | ✅ CodeMirror 6 | Less features vs 10x smaller bundle |
| Status updates | ✅ Polling | Simpler vs 1-2s latency |
| Execution | ✅ Async pipeline | Complex vs connection-efficient |
| Sandbox | ✅ Docker | ~200ms overhead vs strong isolation |
| State | ✅ Zustand + persist | Extra dependency vs auto-save drafts |
| Database | ✅ PostgreSQL | More setup vs ACID guarantees |

---

## 📈 Scalability Path

### Current: Single Server

```
Browser ──▶ Express (Node.js) ──▶ PostgreSQL + Docker
```

### Future: Scaled Architecture

```
Browser ──▶ CDN ──▶ Load Balancer ──▶ Express (N nodes) ──▶ Kafka ──▶ Workers
                                           │                          │
                                     Valkey Cluster           Container Pools
                                           │
                                     PostgreSQL + Replicas
```

**Scaling steps:**
1. **Kafka queue**: Decouple submission handling from execution
2. **Judge workers**: Scale execution independently per language
3. **Container pools**: Pre-warm containers for faster cold start
4. **Read replicas**: Scale problem queries

---

## 🔮 Future Enhancements

1. **WebSocket Updates**: Real-time progress without polling
2. **Contest Mode**: Time-limited competitions with special scoring
3. **Code Similarity**: MOSS-based plagiarism detection
4. **More Languages**: C++, Java, Go, Rust support
5. **Collaborative Editing**: Pair programming mode

---

## 📝 Closing Summary

> "I've designed a full-stack online judge with CodeMirror 6 for lightweight editing, async execution with Docker sandboxes for security, and HTTP polling for submission status. The key architectural insight is the async execution pattern—returning immediately with a submission ID, then polling for results—which prevents connection exhaustion during contests and enables independent scaling of API servers and judge workers. The frontend uses Zustand with persistence to auto-save code drafts, and the API follows REST conventions with clear separation between synchronous operations (auth, problem fetching) and asynchronous workflows (code submission)."
