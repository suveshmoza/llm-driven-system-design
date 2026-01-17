# evylcode CLI - Development with Claude

## Project Context

This document tracks the development journey of implementing evylcode CLI, an AI-powered CLI coding assistant similar to Claude Code, GeminiCLI, or opencode. Now with real Anthropic Claude API integration!

## Key Challenges to Explore

1. Agentic loop design and tool orchestration
2. Context window management and summarization
3. Safe file system and shell access
4. Streaming responses and terminal UI
5. Multi-provider LLM abstraction
6. Session persistence and history
7. Permission and safety systems

## Development Phases

### Phase 1: Requirements and Design
*Completed*

**Deliverables:**
- Detailed architecture document (architecture.md)
- System design interview answer (system-design-answer.md)
- Core component specifications
- Technology stack decisions

**Key decisions made:**
- TypeScript + Node.js for runtime
- String-based file editing (not line numbers) for robustness
- Layered permission system for safety
- Mock LLM provider for demo mode

### Phase 2: Initial Implementation
*Completed*

**Completed:**
- Project structure and configuration (package.json, tsconfig.json)
- Type definitions (src/types/index.ts)
- CLI interface with colors and streaming (src/cli/)
- Tool system with 6 core tools:
  - Read: File reading with line numbers
  - Write: File creation
  - Edit: String-based file modification
  - Bash: Shell command execution with safety patterns
  - Glob: File pattern matching
  - Grep: Content search with regex
- Mock LLM provider with pattern-based intent detection (src/llm/)
- Agent controller with agentic loop (src/agent/)
- Permission manager with blocked patterns (src/permissions/)
- Session manager with persistence (src/session/)
- Main entry point with CLI argument parsing

### Phase 3: Anthropic Integration
*Completed*

**Added:**
- Real Anthropic Claude API integration (src/llm/anthropic-provider.ts)
- API key support via environment variable or CLI argument
- Model selection (claude-sonnet-4-20250514, claude-opus-4-20250514, etc.)
- Streaming responses from Claude
- Colorful evylcode branding and UI
- Time-based greeting messages
- Enhanced terminal aesthetics with chalk styling
- Demo mode flag for testing without API key

**evylcode branding:**
- Renamed from "ai-code-assistant" to "evylcode"
- Custom ASCII art logo in coral (#FF6B6B) and teal (#4ECDC4)
- Styled prompts and UI elements
- Anthropic-branded messaging

### Phase 4: Scaling and Optimization
*Not started*

**Focus areas:**
- Add caching layer
- Optimize tool execution
- Implement load balancing for multiple LLM providers
- Add monitoring

### Phase 5: Polish and Documentation
*In Progress*

**Focus areas:**
- Complete documentation
- Add comprehensive tests
- Performance tuning
- Code cleanup

## Design Decisions Log

### 2024 - Initial Implementation

**Decision: Use string replacement for file editing instead of line numbers**
- Rationale: Line numbers change as files are edited, making them unreliable
- String matching forces the LLM to provide enough context for unique matches
- Trade-off: Fails if string is not unique (but can use replace_all flag)

**Decision: Layered permission system**
- Auto-approve: Safe read operations
- Session-approve: Write operations (approved once per session)
- Always-ask: Potentially dangerous commands
- Never-allow: Blocked patterns (rm -rf /, .ssh, credentials)

**Decision: Mock LLM provider for demo**
- Allows testing the full agentic loop without API keys
- Pattern-based intent detection simulates LLM behavior
- Easy to swap for real provider (AnthropicProvider)

**Decision: Streaming responses**
- Better UX - user sees progress in real-time
- Character-by-character streaming with small delay for demo effect
- Real LLM providers stream actual tokens

### 2025 - Anthropic Integration

**Decision: Use official Anthropic SDK**
- @anthropic-ai/sdk provides type-safe API access
- Native streaming support with proper event handling
- Tool use support with input_schema

**Decision: Default to Claude Sonnet**
- claude-sonnet-4-20250514 provides good balance of speed and capability
- Users can override with --model flag
- Opus available for more complex tasks

**Decision: Colorful terminal branding**
- Coral (#FF6B6B) for "evyl" and interactive elements
- Teal (#4ECDC4) for "code" and informational elements
- Yellow (#FFE66D) for warnings and permission prompts
- Creates memorable, polished user experience

## Iterations and Learnings

### Iteration 1: Core Structure
- Created modular architecture with clear separation of concerns
- Each component (CLI, Agent, Tools, LLM, Permissions, Session) is independent
- TypeScript interfaces define contracts between components

### Iteration 2: Tool Implementation
- Implemented 6 core tools following the Tool interface
- Each tool handles its own validation and error cases
- Permission checking is done in ToolContext

### Iteration 3: Real Claude Integration
- Anthropic SDK provides clean abstraction over API
- Streaming requires careful handling of different event types
- Tool use responses need proper message conversion
- Type system helps catch integration issues early

## Questions and Discussions

### Open Questions
1. How to handle very large files (>10MB)?
   - Current approach: Truncate output, allow offset/limit parameters
   - Future: Streaming file reads, lazy loading

2. How to manage context window efficiently?
   - Current: Simple message array
   - Future: Summarization of old messages, selective retention

3. How to handle concurrent tool execution safely?
   - Current: Auto-approved tools run in parallel, approval-needed run sequentially
   - Future: Dependency graph for tool execution order

### Resolved Questions
- **Q: Line numbers vs string replacement for edits?**
  A: String replacement - more robust to changes

- **Q: How to handle dangerous commands?**
  A: Layered system with blocked patterns, safe patterns, and approval prompts

- **Q: Mock vs real LLM provider?**
  A: Both! Mock for demo/testing, Anthropic for production use

## Resources and References

- [Anthropic Tool Use Documentation](https://docs.anthropic.com/claude/docs/tool-use)
- [Anthropic SDK for Node.js](https://github.com/anthropics/anthropic-sdk-typescript)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [aider Architecture](https://aider.chat/docs/architecture.html)

## Next Steps

- [x] Define detailed requirements
- [x] Sketch initial architecture
- [x] Choose technology stack
- [x] Implement MVP
- [x] Add real LLM provider support (Anthropic)
- [x] Add colorful branding and UI
- [ ] Test and iterate
- [ ] Add context window management
- [ ] Add comprehensive tests
- [ ] Add more LLM providers (OpenAI, local models)

---

*This document will be updated throughout the development process to capture insights, decisions, and learnings.*
