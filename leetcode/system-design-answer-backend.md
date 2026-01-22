# LeetCode (Online Judge) - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for an online coding practice and evaluation platform that allows users to:
- Browse and solve coding problems
- Submit code in multiple programming languages
- Execute user code securely in sandboxed environments
- Validate outputs against test cases with resource limits
- Track progress and maintain leaderboards

## Requirements Clarification

### Functional Requirements
1. **Problem Management**: CRUD operations for coding problems with descriptions, test cases, constraints
2. **Code Submission**: Accept code in multiple languages (Python, JavaScript, Java, C++)
3. **Sandboxed Execution**: Run untrusted code safely with resource limits
4. **Test Validation**: Compare outputs against expected results with tolerance for formatting
5. **User Progress**: Track solved problems, attempts, best runtime per user
6. **Leaderboards**: Rankings by problems solved and performance metrics

### Non-Functional Requirements
1. **Security**: Sandboxed execution preventing system access, network calls, resource exhaustion
2. **Latency**: Results within 5 seconds for simple problems, 15 seconds for complex
3. **Fairness**: Consistent evaluation across all users and submissions
4. **Scale**: Support 100K concurrent users, 10K submissions/minute during contests

### Scale Estimates
- 10 million registered users
- 500K daily active users
- Normal: 1M submissions/day = 12/second
- Contest peak: 10K submissions/minute = 170/second
- Average execution time: 2 seconds
- Concurrent executions needed at peak: ~340

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Load Balancer (nginx)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ API Server  │ │ API Server  │ │ API Server  │
            │   (Node)    │ │   (Node)    │ │   (Node)    │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   └───────────────┼───────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │  PostgreSQL  │      │    Kafka     │      │    Valkey    │
    │  (Primary)   │      │  (Submission │      │   (Cache +   │
    │              │      │    Queue)    │      │   Sessions)  │
    └──────────────┘      └──────┬───────┘      └──────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
    ┌─────────────┐      ┌─────────────┐       ┌─────────────┐
    │ Judge Worker│      │ Judge Worker│       │ Judge Worker│
    │  (Python)   │      │   (Java)    │       │   (C++)     │
    │ ┌─────────┐ │      │ ┌─────────┐ │       │ ┌─────────┐ │
    │ │ gVisor  │ │      │ │ gVisor  │ │       │ │ gVisor  │ │
    │ │ Sandbox │ │      │ │ Sandbox │ │       │ │ Sandbox │ │
    │ └─────────┘ │      │ └─────────┘ │       │ └─────────┘ │
    └─────────────┘      └─────────────┘       └─────────────┘
```

## Deep Dive: Sandboxed Code Execution

### Security Requirements

User code is untrusted. We must prevent:
1. **System access**: Reading files, executing commands
2. **Network access**: Making external requests
3. **Resource exhaustion**: Infinite loops, memory bombs
4. **Process escape**: Breaking out of sandbox

### Sandbox Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Host Machine                                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    Container Runtime (gVisor)                   │ │
│  │                                                                 │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │                 Sandbox Container                         │  │ │
│  │  │                                                           │  │ │
│  │  │  ┌─────────────────────────────────────────────────────┐  │  │ │
│  │  │  │              User Process                           │  │  │ │
│  │  │  │                                                     │  │  │ │
│  │  │  │  - No network access                                │  │  │ │
│  │  │  │  - Read-only filesystem                             │  │  │ │
│  │  │  │  - No fork/exec beyond limits                       │  │  │ │
│  │  │  │  - Memory limit: 256MB                              │  │  │ │
│  │  │  │  - CPU limit: 2 seconds                             │  │  │ │
│  │  │  │  - No /proc, /sys access                            │  │  │ │
│  │  │  └─────────────────────────────────────────────────────┘  │  │ │
│  │  │                                                           │  │ │
│  │  │  Seccomp: Whitelist of allowed syscalls                   │  │ │
│  │  │  AppArmor: Mandatory access control                       │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  cgroups: Resource limits enforced at kernel level                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Container Security Configuration

```yaml
# Docker security options
security_opt:
  - no-new-privileges:true
  - seccomp:./seccomp-profile.json
cap_drop:
  - ALL
network_mode: none
read_only: true
mem_limit: 256m
cpus: 0.5
pids_limit: 10
```

### Execution Flow

```typescript
async function executeSubmission(submission: Submission): Promise<Result> {
  const sandbox = await sandboxPool.acquire(submission.language);

  try {
    // 1. Write user code to sandbox
    await sandbox.writeFile('/code/solution.py', submission.code);

    // 2. Compile if needed (for compiled languages)
    if (needsCompilation(submission.language)) {
      const compileResult = await sandbox.exec(
        getCompileCommand(submission.language),
        { timeout: 30000, memory: '512m' }
      );
      if (compileResult.exitCode !== 0) {
        return { status: 'COMPILE_ERROR', error: compileResult.stderr };
      }
    }

    // 3. Run against each test case
    const results: TestCaseResult[] = [];
    for (const testCase of submission.problem.testCases) {
      const result = await runTestCase(sandbox, submission, testCase);
      results.push(result);

      // Early termination on failure
      if (result.status !== 'PASSED' && !submission.showAllResults) {
        break;
      }
    }

    return aggregateResults(results);

  } finally {
    await sandbox.reset();
    sandboxPool.release(sandbox);
  }
}

async function runTestCase(
  sandbox: Sandbox,
  submission: Submission,
  testCase: TestCase
): Promise<TestCaseResult> {
  const startTime = Date.now();

  try {
    const result = await sandbox.exec(
      getRunCommand(submission.language),
      {
        stdin: testCase.input,
        timeout: submission.problem.timeLimit,
        memory: submission.problem.memoryLimit
      }
    );

    const executionTime = Date.now() - startTime;

    if (result.timeout) {
      return { status: 'TIME_LIMIT_EXCEEDED', time: executionTime };
    }
    if (result.memoryExceeded) {
      return { status: 'MEMORY_LIMIT_EXCEEDED', time: executionTime };
    }
    if (result.exitCode !== 0) {
      return { status: 'RUNTIME_ERROR', error: result.stderr };
    }

    const passed = compareOutput(result.stdout, testCase.expectedOutput);
    return {
      status: passed ? 'PASSED' : 'WRONG_ANSWER',
      time: executionTime,
      output: result.stdout.substring(0, 1000)
    };

  } catch (error) {
    return { status: 'SYSTEM_ERROR', error: error.message };
  }
}
```

### Output Comparison

```typescript
function compareOutput(actual: string, expected: string): boolean {
  // Normalize whitespace
  const normalizeWhitespace = (s: string) =>
    s.trim().replace(/\r\n/g, '\n').replace(/\s+$/gm, '');

  const actualNorm = normalizeWhitespace(actual);
  const expectedNorm = normalizeWhitespace(expected);

  if (actualNorm === expectedNorm) return true;

  // Handle floating point comparison
  if (isNumericOutput(expectedNorm)) {
    return compareNumeric(actualNorm, expectedNorm, 1e-6);
  }

  return false;
}
```

## Deep Dive: Database Schema

### PostgreSQL Schema

```sql
-- Problems table
CREATE TABLE problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT NOT NULL,
  difficulty VARCHAR(20) CHECK (difficulty IN ('easy', 'medium', 'hard')),
  time_limit_ms INTEGER DEFAULT 2000,
  memory_limit_mb INTEGER DEFAULT 256,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Test cases with sample flag
CREATE TABLE test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_sample BOOLEAN DEFAULT FALSE,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Submissions with status tracking
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES contests(id),
  language VARCHAR(20) NOT NULL,
  code TEXT NOT NULL,
  status VARCHAR(30) DEFAULT 'pending',
  runtime_ms INTEGER,
  memory_kb INTEGER,
  test_cases_passed INTEGER DEFAULT 0,
  test_cases_total INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User progress tracking
CREATE TABLE user_problem_status (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'unsolved',
  best_runtime_ms INTEGER,
  best_memory_kb INTEGER,
  attempts INTEGER DEFAULT 0,
  solved_at TIMESTAMP,
  PRIMARY KEY (user_id, problem_id)
);

-- Performance indexes
CREATE INDEX idx_submissions_user_problem ON submissions(user_id, problem_id);
CREATE INDEX idx_submissions_created_at ON submissions(created_at DESC);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_test_cases_problem ON test_cases(problem_id, order_index);
CREATE INDEX idx_problems_difficulty ON problems(difficulty);
```

### Why PostgreSQL?

| Consideration | PostgreSQL | MongoDB | Cassandra |
|---------------|------------|---------|-----------|
| ACID transactions | Excellent | Limited | Limited |
| Complex queries | Excellent | Moderate | Poor |
| JSON storage | Good (JSONB) | Excellent | Poor |
| Operational simplicity | High | Moderate | Complex |
| Submission history | Excellent | Good | Excellent |

**Decision**: PostgreSQL provides strong consistency for submissions and user progress, with good query flexibility for leaderboards.

## Deep Dive: Queue-Based Submission Processing

### Why Kafka for Submissions?

```
┌───────────────┐     ┌────────────────────────────────────┐
│  API Server   │────►│             Kafka                  │
│  (Producer)   │     │                                    │
└───────────────┘     │  ┌────────────────────────────┐   │
                      │  │ Topic: submissions.python   │   │
                      │  │ Partitions: 10              │   │
                      │  └────────────────────────────┘   │
                      │  ┌────────────────────────────┐   │
                      │  │ Topic: submissions.java     │   │
                      │  │ Partitions: 10              │   │
                      │  └────────────────────────────┘   │
                      │  ┌────────────────────────────┐   │
                      │  │ Topic: submissions.cpp      │   │
                      │  │ Partitions: 10              │   │
                      │  └────────────────────────────┘   │
                      └────────────────────────────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
    ┌─────────────┐           ┌─────────────┐            ┌─────────────┐
    │ Python      │           │ Java        │            │ C++         │
    │ Workers (5) │           │ Workers (3) │            │ Workers (3) │
    └─────────────┘           └─────────────┘            └─────────────┘
```

### Benefits

1. **Decoupling**: API servers return immediately, workers process asynchronously
2. **Backpressure**: Queue buffers traffic spikes during contests
3. **Language-specific scaling**: Scale Python workers independently from Java
4. **Retry semantics**: Failed submissions can be retried automatically
5. **Ordering guarantees**: FIFO within partition

### Producer Implementation

```typescript
async function submitCode(req, res) {
  const { problemSlug, language, code } = req.body;
  const userId = req.session.userId;

  // Validate request
  const problem = await getProblem(problemSlug);
  if (!problem) return res.status(404).json({ error: 'Problem not found' });

  // Create submission record
  const submission = await pool.query(`
    INSERT INTO submissions (user_id, problem_id, language, code, status)
    VALUES ($1, $2, $3, $4, 'pending')
    RETURNING id
  `, [userId, problem.id, language, code]);

  // Queue for execution
  await kafka.send({
    topic: `submissions.${language}`,
    messages: [{
      key: submission.rows[0].id,
      value: JSON.stringify({
        submissionId: submission.rows[0].id,
        problemId: problem.id,
        language,
        code,
        timeLimit: problem.time_limit_ms,
        memoryLimit: problem.memory_limit_mb
      })
    }]
  });

  // Return immediately
  res.status(202).json({
    submissionId: submission.rows[0].id,
    status: 'pending'
  });
}
```

### Consumer Implementation

```typescript
async function startWorker(language: string) {
  const consumer = kafka.consumer({ groupId: `judge-${language}` });
  await consumer.subscribe({ topic: `submissions.${language}` });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const submission = JSON.parse(message.value);

      // Update status
      await updateSubmissionStatus(submission.submissionId, 'running');
      await cacheStatus(submission.submissionId, { status: 'running' });

      try {
        const result = await executeSubmission(submission);

        await pool.query(`
          UPDATE submissions
          SET status = $1, runtime_ms = $2, memory_kb = $3,
              test_cases_passed = $4, test_cases_total = $5
          WHERE id = $6
        `, [result.status, result.runtime, result.memory,
            result.passed, result.total, submission.submissionId]);

        // Update user progress if accepted
        if (result.status === 'accepted') {
          await updateUserProgress(submission);
        }

      } catch (error) {
        await updateSubmissionStatus(submission.submissionId, 'system_error');
      }
    }
  });
}
```

## Deep Dive: Resource Limits by Language

```typescript
const resourceLimits: Record<string, ResourceLimits> = {
  python: { time: 10000, memory: '256m', multiplier: 3 },
  java: { time: 5000, memory: '512m', multiplier: 2 },
  cpp: { time: 2000, memory: '256m', multiplier: 1 },
  javascript: { time: 8000, memory: '256m', multiplier: 2.5 },
  go: { time: 3000, memory: '256m', multiplier: 1.2 },
  rust: { time: 2000, memory: '256m', multiplier: 1 },
};

// Problem time limit = base_limit * language_multiplier
function getTimeLimit(problem: Problem, language: string): number {
  return problem.time_limit_ms * resourceLimits[language].multiplier;
}
```

## Caching Strategy

### Cache Layers

```
┌──────────────────────────────────────────────────────────┐
│                      Valkey Cache                         │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  problem:{slug}           -> Problem JSON (5 min)   │ │
│  │  submission:{id}:status   -> Status JSON (5 min)    │ │
│  │  user:{id}:progress       -> Progress JSON (1 min)  │ │
│  │  leaderboard:global       -> Top 100 users (1 min)  │ │
│  │  session:{sid}            -> Session data (7 days)  │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Submission Status Caching

```typescript
// Real-time status updates during execution
async function updateProgress(submissionId: string, progress: Progress) {
  await valkey.setex(
    `submission:${submissionId}:status`,
    300, // 5 minute TTL
    JSON.stringify(progress)
  );
}

// Fast polling from frontend
async function getStatus(submissionId: string): Promise<Progress> {
  const cached = await valkey.get(`submission:${submissionId}:status`);
  if (cached) return JSON.parse(cached);

  // Fallback to database
  const result = await pool.query(
    'SELECT status, test_cases_passed, test_cases_total FROM submissions WHERE id = $1',
    [submissionId]
  );
  return result.rows[0];
}
```

## API Design

### RESTful Endpoints

```
Authentication:
POST   /api/v1/auth/register     Create new account
POST   /api/v1/auth/login        Authenticate and create session
POST   /api/v1/auth/logout       Destroy session
GET    /api/v1/auth/me           Get current user

Problems:
GET    /api/v1/problems          List problems (paginated, filterable)
GET    /api/v1/problems/:slug    Get problem details + sample test cases
POST   /api/v1/problems          Create problem (admin only)

Submissions:
POST   /api/v1/submissions       Submit code for judging
POST   /api/v1/submissions/run   Run against sample tests only
GET    /api/v1/submissions/:id   Get submission details
GET    /api/v1/submissions/:id/status  Poll status (cached)

Users:
GET    /api/v1/users/progress    Get solve progress
GET    /api/v1/users/:id/profile User profile + stats
```

### WebSocket for Real-time Updates

```typescript
// Subscribe to submission result
ws.on('subscribe', (submissionId) => {
  subscriptions.set(submissionId, ws);
});

// Push updates as execution progresses
async function notifyProgress(submissionId: string, progress: Progress) {
  const ws = subscriptions.get(submissionId);
  if (ws) {
    ws.send(JSON.stringify({
      type: 'progress',
      submissionId,
      ...progress
    }));
  }
}
```

## Scalability Considerations

### Worker Pool Auto-Scaling

```typescript
async function autoScaleWorkers() {
  const queueDepth = await getQueueDepth();
  const processingCapacity = activeWorkers * avgThroughput;

  // Target: process queue in 30 seconds
  const targetCapacity = queueDepth / 30;

  if (targetCapacity > processingCapacity * 1.2) {
    const newWorkers = Math.ceil(
      (targetCapacity - processingCapacity) / avgThroughput
    );
    await kubernetes.scaleDeployment('judge-workers', newWorkers);
  }
}
```

### Container Pre-warming

```typescript
class SandboxPool {
  private warmContainers: Map<string, Sandbox[]> = new Map();
  private minWarm = 5;

  async acquire(language: string): Promise<Sandbox> {
    const pool = this.warmContainers.get(language) || [];
    if (pool.length > 0) {
      return pool.pop()!;
    }
    return this.createSandbox(language);
  }

  async release(sandbox: Sandbox): Promise<void> {
    await sandbox.reset();
    const pool = this.warmContainers.get(sandbox.language) || [];
    if (pool.length < this.minWarm * 2) {
      pool.push(sandbox);
    } else {
      await sandbox.destroy();
    }
  }
}
```

### Estimated Capacity

| Component | Single Node | Scaled (4x) |
|-----------|-------------|-------------|
| PostgreSQL writes | 500/sec | 2K/sec (with pooling) |
| PostgreSQL reads | 5K/sec | 20K/sec (replicas) |
| Kafka throughput | 50K msgs/sec | 50K msgs/sec |
| Judge workers | 50 concurrent | 200 concurrent |
| Valkey cache | 100K/sec | 100K/sec |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| gVisor sandboxing | Strong security, syscall filtering | 10-20% overhead |
| Kafka for queuing | Durability, backpressure, ordering | Operational complexity |
| Language-specific workers | Optimized containers, independent scaling | More infrastructure |
| Sequential test execution | Fair comparison, predictable | Slower than parallel |
| Polling with cache | Simple, stateless | 1-2s latency |

## Future Backend Enhancements

1. **WebAssembly Sandbox**: For browser-based execution
2. **Distributed Tracing**: OpenTelemetry for execution pipeline
3. **Code Similarity Detection**: MOSS algorithm for plagiarism
4. **Contest Mode**: Time-limited competitions with rate limiting
5. **Custom Test Cases**: User-provided inputs for debugging
