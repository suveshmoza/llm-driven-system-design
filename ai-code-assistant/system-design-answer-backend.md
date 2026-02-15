# AI Code Assistant - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 📋 Problem Statement

Design the backend infrastructure for an AI-powered command-line coding assistant. The system must orchestrate an agentic loop where an LLM autonomously invokes tools (file read, file edit, shell commands), manage a finite context window of 128K-200K tokens, abstract over multiple LLM providers, enforce a layered permission system for safe file and command access, persist session state for recovery, and cache file content and tool results for performance. The primary challenge is building a reliable tool orchestration engine that handles retries, permission checks, and context compression without losing conversation coherence.

---

## 📋 Requirements Clarification

### Functional Requirements

1. **LLM integration** -- support multiple LLM providers (Anthropic, OpenAI, local models) through a unified interface
2. **Tool system** -- extensible framework for file operations (Read, Write, Edit, Glob, Grep) and shell commands (Bash)
3. **Context management** -- handle token limits with summarization, truncation, and selective retention
4. **Session persistence** -- store and resume conversation state across process restarts
5. **Permission system** -- enforce layered security policies for file access and command execution

### Non-Functional Requirements

1. **Latency** -- first token streamed to terminal in under 500ms
2. **Portability** -- single-user local application running on macOS, Linux, and Windows
3. **Reliability** -- graceful degradation on API failures with automatic retry
4. **Extensibility** -- plugin system for custom tools and MCP (Model Context Protocol) servers

### Scale Estimates

- Context window: 128K-200K tokens depending on model
- File handling: files up to 10MB
- Session history: thousands of messages across sessions
- Tool execution cache: 500 entries per session
- Concurrent tool executions: up to 5 independent read operations in parallel

---

## 🏗️ High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          AI Code Assistant                            │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐            │
│  │     CLI      │───▶│    Agent     │───▶│   LLM API    │            │
│  │   Interface  │    │  Controller  │    │  (Provider)  │            │
│  └──────────────┘    └──────┬───────┘    └──────────────┘            │
│                             │                                         │
│                             ▼                                         │
│                      ┌──────────────┐                                 │
│                      │    Tool      │                                 │
│                      │   Router     │                                 │
│                      └──────┬───────┘                                 │
│                             │                                         │
│               ┌─────────────┼─────────────┐                          │
│               ▼             ▼             ▼                          │
│         ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│         │   Read   │  │   Edit   │  │   Bash   │                    │
│         │   Tool   │  │   Tool   │  │   Tool   │                    │
│         └──────────┘  └──────────┘  └──────────┘                    │
│               │             │             │                          │
│               ▼             ▼             ▼                          │
│  ┌────────────────────────────────────────────────────────┐          │
│  │              Permission & Safety Layer                  │          │
│  └────────────────────────────────────────────────────────┘          │
│               │             │             │                          │
│               ▼             ▼             ▼                          │
│        ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│        │   File   │  │  Shell   │  │ Session  │                    │
│        │  System  │  │ Sandbox  │  │  Store   │                    │
│        └──────────┘  └──────────┘  └──────────┘                    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

> "The architecture is organized around the Agent Controller at the center, which runs the agentic loop. It talks upward to the LLM via a provider abstraction and downward to tools via a router. Every tool invocation passes through the Permission & Safety Layer before touching the file system or shell. Session state flows to disk through the Session Store. This layering means I can change LLM providers, add new tools, or modify permission rules independently."

---

## 🔧 Deep Dive: The Agentic Loop and Tool Orchestration

### Loop Design

The agentic loop is the heart of the system. After receiving user input, the agent enters a while-true loop: send messages to the LLM, stream the response to the terminal, check if the response contains tool calls, execute them with permission checks, append results to the context, and loop back for the LLM's next turn. The loop exits only when the LLM produces a response with no tool calls -- meaning it has finished its task and is ready for the next user message.

```
User Input
    │
    ▼
┌───────────────────────────────────┐
│      Add message to context       │
└───────────────────┬───────────────┘
                    │
                    ▼
┌───────────────────────────────────┐
│        LLM Inference              │◀────────────┐
│  - Stream text to terminal        │             │
│  - Collect tool call requests     │             │
└───────────────────┬───────────────┘             │
                    │                              │
               Has tool calls?                     │
                    │                              │
              ┌─────┴─────┐                        │
              ▼           ▼                        │
            [Yes]        [No]                      │
              │           │                        │
              │           ▼                        │
              │     Done (await next input)        │
              │                                    │
              ▼                                    │
┌───────────────────────────────────┐             │
│     Check Permissions             │             │
│  - Auto-approve reads             │             │
│  - Prompt user for writes/cmds    │             │
└───────────────────┬───────────────┘             │
                    │                              │
                    ▼                              │
┌───────────────────────────────────┐             │
│     Execute Tools                 │             │
│  - Safe tools in parallel         │             │
│  - Approval-required sequentially │             │
└───────────────────┬───────────────┘             │
                    │                              │
                    ▼                              │
┌───────────────────────────────────┐             │
│     Add results to context        │─────────────┘
└───────────────────────────────────┘
```

### Tool Execution Strategy

Tool calls are grouped by approval requirements. Auto-approved tools (Read, Glob, Grep) execute in parallel via concurrent promises, because they are pure reads with no side effects. Tools requiring approval (Write, Edit, Bash with non-safe commands) execute sequentially, because each needs an explicit user decision before proceeding. If the user denies a tool call, an error result ("User denied permission") is added to the context so the LLM can adapt its strategy rather than retrying the same denied operation.

### Idempotent Tool Execution

Each tool call carries a unique ID assigned by the LLM provider. This ID serves as an idempotency key: if the agent retries a request due to a network error, it checks the execution cache before re-running a tool. For read operations, re-execution is harmless. For write operations, the cache prevents applying the same edit twice. The cache persists for the session duration and is cleaned up when the session ends.

---

## 🔧 Deep Dive: LLM Provider Abstraction

### Provider Interface

> "I designed a provider abstraction layer that normalizes the differences between LLM APIs. Each provider implements a common interface with methods for streaming completion, token counting, and tool definition formatting. This lets us swap providers without changing any agent logic."

```
┌──────────────────────┐
│   LLMProvider        │◀──── Common Interface
│   Interface          │
├──────────────────────┤
│  stream()            │
│  complete()          │
│  countTokens()       │
│  formatMessages()    │
│  formatTools()       │
└──────────┬───────────┘
           │
           ├──────────────────┬──────────────────┐
           ▼                  ▼                  ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │  Anthropic   │   │   OpenAI     │   │    Local     │
    │  Provider    │   │   Provider   │   │   Provider   │
    └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
           ▼                  ▼                  ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │  Claude API  │   │  GPT-4 API   │   │ Ollama /     │
    │              │   │              │   │ LM Studio    │
    └──────────────┘   └──────────────┘   └──────────────┘
```

**Key responsibilities of each provider**:

- **stream()** -- returns an async iterable yielding text chunks and tool call events, normalized into a common StreamChunk format regardless of provider-specific event shapes
- **complete()** -- non-streaming completion for operations like context summarization where we need the full result before proceeding
- **countTokens()** -- estimates token count for context budget calculations; each provider uses its own tokenizer
- **formatMessages()** -- converts internal message format to provider-specific API format (Anthropic uses content blocks, OpenAI uses a flat content string)
- **formatTools()** -- converts tool definitions to provider-specific schema (Anthropic uses input_schema, OpenAI uses function parameters)

### Stream Chunk Processing

The stream from the LLM provider yields four types of events:

| Chunk Type | Agent Action |
|------------|--------------|
| text | Write to terminal via streaming renderer |
| tool_call_start | Store tool call ID and name, show spinner |
| tool_call_delta | Accumulate JSON parameters incrementally |
| tool_call_end | Push completed tool call to pending queue |

After the stream completes, if the pending queue has tool calls, the agent executes them and loops. If the queue is empty, the turn is done.

### Retry Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| maxRetries | 3 | Balance reliability vs user wait time |
| initialDelayMs | 1000 | Allow transient rate limits to clear |
| maxDelayMs | 10000 | Cap wait to avoid user abandonment |
| backoffMultiplier | 2 | Exponential backoff prevents thundering herd |
| retryableErrors | rate_limit, overloaded, timeout | Only retry errors that are likely transient |

---

## 🔧 Deep Dive: Context Window Management

### The Problem

> "LLM context windows are large but finite -- 128K to 200K tokens depending on the model. Long coding sessions easily exceed limits. A single large file read can consume 40K tokens. Tool outputs accumulate rapidly. We need a multi-strategy approach to stay within budget while preserving the conversation's intent and the LLM's ability to reason about recent work."

### Token Budget Allocation

```
┌────────────────────────────────────────────────────────────┐
│              Token Budget (128K Total)                      │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │ System prompt                             2K tokens  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Tool definitions                          5K tokens  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Context summary (compressed history)     10K tokens  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Recent messages (last 10 turns)          30K tokens  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ File cache (recently read files)         40K tokens  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Response buffer (for LLM output)         40K tokens  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### Compression Pipeline

When adding a new message would push the context past 90% capacity, the compression pipeline fires. It applies four strategies in order:

1. **Summarize old messages** -- take all messages except the last 10 turns, send them to the LLM with a summarization prompt, and replace them with a single system message containing the summary. This preserves the *intent* of earlier conversation while dramatically reducing token count.

2. **Truncate large tool outputs** -- any tool result exceeding 10,000 characters is cut to the first 5,000 characters, a "[truncated]" marker, and the last 2,000 characters. Head and tail are both kept because file beginnings often contain imports/declarations and endings contain the code the user asked about.

3. **Deduplicate file reads** -- if the same file was read multiple times, keep only the most recent version. Earlier reads of the same path are removed from context.

4. **Compress edit diffs** -- replace full file edit results with a summary: "Edited /path/to/file.ts: replaced X with Y (3 lines changed)."

```
┌──────────────┐
│ New Message   │
└──────┬───────┘
       │
       ▼
┌──────────────┐    No     ┌──────────────┐
│ Over 90%     │──────────▶│ Add to       │
│ capacity?    │           │ context      │
└──────┬───────┘           └──────────────┘
       │ Yes
       ▼
┌────────────────────────────────────────────┐
│          Compression Pipeline              │
├────────────────────────────────────────────┤
│ 1. Summarize messages older than 10 turns  │
│ 2. Truncate tool outputs > 10K chars       │
│ 3. Deduplicate file reads (keep latest)    │
│ 4. Compress edit diffs to summaries        │
└────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│ Add message  │
└──────────────┘
```

---

## 💾 Data Model

### Session Structure

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Unique session identifier |
| workingDirectory | string | Absolute path to project root |
| startedAt | timestamp | Session creation time |
| messages | Message[] | Full conversation history |
| permissions | Permission[] | Granted permission records |
| settings | SessionSettings | Model, temperature, max tokens |

### Message Structure

| Field | Type | Purpose |
|-------|------|---------|
| role | "user" / "assistant" / "tool" | Message author |
| content | string | Text content |
| toolCalls | ToolCall[] (optional) | Tool invocations requested by assistant |
| toolResults | ToolResult[] (optional) | Results of tool executions |
| timestamp | ISO 8601 | When the message was created |

### Permission Record

| Field | Type | Purpose |
|-------|------|---------|
| type | "read" / "write" / "execute" | Operation category |
| pattern | string | Glob pattern or command prefix matched |
| scope | "session" / "permanent" | How long the grant lasts |
| grantedAt | timestamp | When the user approved |

### Session Storage

Sessions are stored as JSON files at ~/.ai-assistant/sessions/{id}.json. The session manager uses the atomic write pattern for crash safety: write to a temp file with a timestamp suffix, fsync to disk, then atomic rename to the final path. If the rename fails, the temp file is cleaned up. This guarantees the session file is never partially written.

---

## 🔌 API Design -- Tool Definitions

The tools are registered with the LLM as function definitions. Each tool specifies its name, description, parameter schema, and approval requirements.

| Tool | Parameters | Approval | Purpose |
|------|-----------|----------|---------|
| Read | file_path (required), offset, limit | Auto | Read file contents with line numbers |
| Write | file_path (required), content (required) | Required | Create or overwrite a file |
| Edit | file_path, old_string, new_string, replace_all | Required | String-based file modification |
| Glob | pattern (required), path | Auto | Find files matching a glob pattern |
| Grep | pattern (required), path, include | Auto | Search file contents with regex |
| Bash | command (required), timeout, working_directory | Pattern-based | Execute shell command |

### Edit Tool: String Replacement Semantics

The Edit tool uses string-based replacement rather than line-number-based editing. The execution flow is: read the file, count occurrences of old_string, reject if zero occurrences (string not found) or more than one occurrence (ambiguous -- provide more context or use replace_all), perform the replacement, and write the updated file atomically.

> "I chose string replacement over line numbers because line numbers change as files are edited. If the LLM reads a file, identifies a bug on line 42, and then edits line 30, the bug is no longer on line 42. String matching forces the LLM to provide enough context for a unique match, making edits robust to prior changes in the same session."

### Bash Tool: Safety Patterns

The Bash tool uses pattern matching to determine approval requirements. Safe read commands (ls, pwd, cat, head, tail, git status, git log, git diff, npm run dev/build/test/lint) are auto-approved. All other commands require explicit user approval.

---

## 🔒 Permission System

### Layered Defense

```
┌─────────────────────────────────────────┐
│   Layer 1: Path Restrictions            │
│   - Only access working directory       │
│   - Block .env, .ssh/, credentials      │
│   - Block .git/config                   │
└─────────────────────┬───────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────┐
│   Layer 2: Command Filtering            │
│   - Block rm -rf /                      │
│   - Block sudo, chmod 777              │
│   - Block fork bombs, pipe-to-shell     │
└─────────────────────┬───────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────┐
│   Layer 3: User Approval                │
│   - Show exact operation details        │
│   - Require explicit y/n consent        │
│   - Remember session-scoped grants      │
└─────────────────────────────────────────┘
```

**Permission levels**:

| Level | Description | Examples |
|-------|-------------|----------|
| Auto-approve | Always allowed, no prompt | File reads, safe git commands |
| Session-approve | Ask once, remember for session | File writes to specific directories |
| Always-ask | Prompt every time | Arbitrary shell commands |
| Deny | Never allowed, hard block | rm -rf /, sudo, .ssh/ access |

### File System Guard

The guard resolves every path to absolute form and checks it against two sets of rules. First, blocked patterns: .env files, .ssh/ directory, files containing "credentials" or "secret" in the name, and .git/config. If any blocked pattern matches, access is denied regardless of other grants. Second, allowed paths: only the working directory and its descendants are accessible. Paths outside the working directory are denied.

### Command Sandbox

Commands are validated against an explicit blocklist (rm -rf /, sudo, chmod 777, fork bombs, curl|sh, wget|sh) and a set of dangerous regex patterns (recursive deletion from root or home, writes to block devices, filesystem formatting commands, direct disk access with dd). If any match, the command is rejected before it ever reaches the shell.

---

## 🔧 Deep Trade-off: String-Based File Editing vs Line-Number Editing

**Decision**: Use string replacement (find old_string, replace with new_string) rather than line-number-based editing (edit line 42).

**Why string replacement works**: In an agentic loop, the LLM may read a file, make one edit, then decide to make another edit to the same file. If we used line numbers, the first edit would shift line numbers for all subsequent code, invalidating the LLM's knowledge of where things are. String matching is position-independent -- "find this exact text and replace it" works regardless of what happened earlier. It also forces the LLM to include enough surrounding context to uniquely identify the edit location, which produces higher-quality edits because the LLM must demonstrate it understands the code structure.

**Why line-number editing fails**: Consider a file where the LLM inserts 5 lines at line 10. Every line number after line 10 has shifted by 5. If the LLM's next edit targets "line 50," it is actually hitting what was originally line 45. The LLM would need to re-read the file after every edit to get accurate line numbers, doubling the number of tool calls and context tokens consumed. Some systems try to track line offsets, but this adds complexity and can still fail when multiple edits interact.

**What we give up**: String matching fails when the target string appears multiple times in the file. The mitigation is the uniqueness check: if old_string appears more than once, the tool returns an error asking the LLM to provide more context (include surrounding lines) or use the replace_all flag. In practice, this is rare because the LLM typically provides multi-line strings with enough context for uniqueness.

---

## 🔧 Deep Trade-off: LLM-Based Summarization vs Static Truncation for Context Compression

**Decision**: Use the LLM itself to summarize old conversation history rather than simply truncating to the most recent N messages.

**Why summarization works**: A coding session builds up important context over time. The user might say "I'm working on the authentication module" in message 3, then not mention it again for 20 messages. Static truncation would lose this framing context once message 3 scrolls past the window. LLM summarization can identify and preserve key facts: "User is refactoring the auth module. We've already fixed the login endpoint and updated the middleware. Remaining work: the registration flow." This compressed representation preserves intent in 50 tokens instead of 5,000.

**Why static truncation fails**: Truncation to the last N messages creates a jarring loss of context. The LLM suddenly forgets what the user asked it to do. It might re-read files it already analyzed, suggest changes the user already rejected, or lose track of multi-step plans. Users report this as "the AI forgot what we were doing," which undermines trust.

**What we give up**: Summarization has its own costs. It consumes an LLM API call (latency and money). The summary might miss details that turn out to be important later. And it introduces a chicken-and-egg problem: we need context space to generate the summary, which means we must reserve tokens for the summarization response buffer. The mitigation is to trigger summarization at 90% capacity rather than 100%, leaving headroom for the summarization call itself.

---

## 🔧 Deep Trade-off: In-Memory Caching vs Persistent Cache for Tool Results

**Decision**: Use an in-memory LRU cache with session-scoped lifetime for tool results and file checksums, rather than a persistent on-disk or Redis-based cache.

**Why in-memory works**: The assistant is a single-user local application. There is no shared state between instances. The cache only needs to survive within a single session. An LRU cache in memory has sub-microsecond lookup times and zero I/O overhead. File checksums (5-minute TTL, 1000 entries), glob results (30-second TTL, 200 entries), and tool execution results (session lifetime, 500 entries) all fit comfortably in a few megabytes of memory.

**Why persistent or Redis caching fails here**: A Redis instance adds infrastructure complexity (users must install and run Redis) for a single-user CLI tool. Disk-based caching introduces I/O latency for what should be instant lookups. Cross-session caching is actually harmful for file checksums because files change between sessions -- a stale cached checksum could cause the Edit tool to skip conflict detection.

**What we give up**: No cache warming on session restart. When the user resumes a session, all file checksums and glob results must be recomputed. In practice, the first tool call in a resumed session takes slightly longer, but subsequent calls benefit from the freshly populated cache. For a future multi-instance deployment (shared coding environment), Redis would become necessary, but it is premature optimization for a local CLI tool.

### Cache Configuration

| Cache Type | Strategy | TTL | Max Size | Invalidation |
|------------|----------|-----|----------|--------------|
| File checksums | Cache-aside | 5 min | 1000 entries | On file write/edit |
| LLM responses | Cache-aside | 10 min | 100 entries | Manual only |
| Tool results | Write-through | Session | 500 entries | On session end |
| Session state | Write-through | Persistent | N/A | Never (explicit save) |
| Glob results | Cache-aside | 30 sec | 200 entries | On any file change |

---

## 📊 Observability

### Metrics

| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|-----------------|
| tool_execution_duration_seconds | Histogram | Time to execute each tool | p99 > 30s |
| llm_response_time_seconds | Histogram | LLM API latency per provider | p95 > 10s |
| llm_api_errors_total | Counter | Failed LLM API calls | > 5/minute |
| tool_execution_errors_total | Counter | Failed tool executions | > 10/minute |
| context_tokens_used | Gauge | Current context window usage | > 90% capacity |
| cache_hit_ratio | Gauge | Cache effectiveness | < 50% |
| permission_denials_total | Counter | User-denied operations | Informational |

### Structured Logging

Log entries include timestamp (ISO 8601), level (debug/info/warn/error), message, and a context object containing sessionId, toolName, traceId, and spanId. Console output is human-readable with color coding. File output is JSON lines format for parsing and aggregation. For a local CLI tool, verbose logs write to ~/.ai-assistant/logs/ and can be inspected with standard Unix tools.

### File Edit Conflict Detection

When the Edit tool receives a request, it reads the current file, computes a SHA256 checksum, and compares it to the expected checksum from the last Read. If they differ, the file was modified externally since the LLM last read it, and the edit is rejected with a suggestion to re-read the file. This prevents silent data loss from stale-read edits.

### Retry Semantics

| Operation | Retry Behavior | Idempotency |
|-----------|---------------|-------------|
| File Read | Safe to retry | Always returns current state |
| File Write | Idempotent via checksum | Same content produces no-op |
| File Edit | Conflict detection | Fails if file changed since read |
| Bash Command | Not auto-retried | User must approve re-execution |
| LLM API Call | 3 attempts, exponential backoff | Cached by tool call ID |

---

## ⚖️ Trade-offs Summary

| Approach | Pros | Cons |
|----------|------|------|
| ✅ String-based file editing | Robust to line shifts, forces context | Fails on non-unique strings |
| ❌ Line-number editing | Simple, direct addressing | Invalidated by prior edits, fragile |
| ✅ LLM summarization for context | Preserves intent, compresses intelligently | Extra API call cost, possible information loss |
| ❌ Static truncation (last N messages) | Zero cost, instant | Loses framing context, "AI forgets" |
| ✅ Provider abstraction layer | Vendor independence, easy switching | Lowest-common-denominator feature set |
| ❌ Direct provider integration | Full feature access per provider | Vendor lock-in, code duplication |
| ✅ In-memory LRU cache | Sub-microsecond lookups, zero infra | No cross-session persistence |
| ❌ Redis/disk cache | Cross-session warming, shared state | Infrastructure overhead for single-user tool |
| ✅ Atomic file writes for sessions | Prevents corruption on crash | Requires temp files, slight I/O overhead |
| ❌ Direct file writes | Simpler code path | Partial writes on crash corrupt state |
| ✅ Idempotent tool execution | Safe retries, replay capability | Memory overhead for execution cache |
| ❌ Fire-and-forget execution | Simpler, lower memory | Double-execution on retry, data corruption risk |

---

## 🚀 Scalability and Future Enhancements

**What breaks first**: Context window exhaustion is the first bottleneck. Long coding sessions with large files can fill 128K tokens in 15-20 tool calls. The summarization pipeline is the primary mitigation, but extremely large codebases may need semantic search (vector embeddings) to find relevant code without reading entire files.

**What to build next**:

1. **Model routing** -- use cheaper/faster models (Haiku) for simple tasks like file search, reserve expensive models (Opus) for complex reasoning
2. **MCP server mode** -- expose the tool system via Model Context Protocol so external agents can use it
3. **Background summarization** -- async context compression triggered before the user hits the limit
4. **Vector embeddings** -- semantic search over codebase and session history
5. **Audit logging** -- append-only log of all file writes and command executions for compliance
6. **Rate limiting** -- per-model quotas to control API costs in team deployments
