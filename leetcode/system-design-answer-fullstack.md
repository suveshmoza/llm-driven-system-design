# LeetCode (Online Judge) - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design an online coding practice and evaluation platform that allows users to:
- Browse and solve coding problems across difficulty levels
- Submit code in multiple programming languages
- Execute code securely with real-time feedback
- Track progress and compete on leaderboards

This answer covers the end-to-end architecture, emphasizing the integration between frontend and backend components.

## Requirements Clarification

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

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Browser (React Application)                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Components: ProblemList, CodeEditor, TestResults, ProgressDash   │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  Zustand Store: problems[], code{}, submissions[], language       │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│  ┌───────────────────────────┴───────────────────────────────────────┐  │
│  │  API Service: submit, poll status, fetch problems                 │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │ REST API (JSON)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Express API Server                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Middleware: cors, session, auth, rateLimit                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────┐  ┌──────────────────┐  ┌───────────────────────┐   │
│  │  auth.ts       │  │  problems.ts      │  │  submissions.ts       │   │
│  │  - login       │  │  - list           │  │  - submit             │   │
│  │  - register    │  │  - getBySlug      │  │  - run (sample only)  │   │
│  │  - logout      │  │  - create (admin) │  │  - status             │   │
│  └────────────────┘  └──────────────────┘  └───────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  PostgreSQL  │      │    Valkey    │      │   Docker     │
│  - problems  │      │  - sessions  │      │   Sandbox    │
│  - users     │      │  - status    │      │  - python    │
│  - submits   │      │  - cache     │      │  - node      │
└──────────────┘      └──────────────┘      └──────────────┘
```

## Data Model

### Database Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT NOT NULL,
  difficulty VARCHAR(20) CHECK (difficulty IN ('easy', 'medium', 'hard')),
  time_limit_ms INTEGER DEFAULT 2000,
  memory_limit_mb INTEGER DEFAULT 256,
  starter_code_python TEXT,
  starter_code_javascript TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_sample BOOLEAN DEFAULT FALSE,
  order_index INTEGER DEFAULT 0
);

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE,
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

CREATE TABLE user_problem_status (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'unsolved',
  best_runtime_ms INTEGER,
  attempts INTEGER DEFAULT 0,
  solved_at TIMESTAMP,
  PRIMARY KEY (user_id, problem_id)
);

CREATE INDEX idx_submissions_user_problem ON submissions(user_id, problem_id);
CREATE INDEX idx_problems_difficulty ON problems(difficulty);
```

### TypeScript Interfaces (Shared Types)

```typescript
// shared/types.ts - Used by both frontend and backend

interface Problem {
  id: string;
  title: string;
  slug: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimitMs: number;
  memoryLimitMb: number;
  starterCode: Record<string, string>;
  acceptanceRate?: number;
  userStatus?: 'solved' | 'attempted' | 'unsolved';
}

interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  isSample: boolean;
}

interface Submission {
  id: string;
  problemSlug: string;
  language: string;
  code: string;
  status: SubmissionStatus;
  runtimeMs?: number;
  memoryKb?: number;
  testCasesPassed: number;
  testCasesTotal: number;
  errorMessage?: string;
  createdAt: string;
}

type SubmissionStatus =
  | 'pending'
  | 'running'
  | 'accepted'
  | 'wrong_answer'
  | 'time_limit_exceeded'
  | 'memory_limit_exceeded'
  | 'runtime_error'
  | 'compile_error';

interface SubmissionProgress {
  status: SubmissionStatus;
  currentTest: number;
  testCasesPassed: number;
  testCasesTotal: number;
  runtimeMs?: number;
  memoryKb?: number;
  failedTest?: {
    input: string;
    expected: string;
    actual: string;
  };
}
```

## Deep Dive: API Design

### RESTful Endpoints

```
POST   /api/v1/auth/login        - Create session
POST   /api/v1/auth/register     - Create account
POST   /api/v1/auth/logout       - Destroy session
GET    /api/v1/auth/me           - Get current user

GET    /api/v1/problems          - List problems (paginated)
GET    /api/v1/problems/:slug    - Get problem with sample tests

POST   /api/v1/submissions       - Submit code for judging
POST   /api/v1/submissions/run   - Run against sample tests
GET    /api/v1/submissions/:id/status - Poll execution status

GET    /api/v1/users/progress    - Get user's solve progress
```

### API Integration Pattern

```typescript
// Frontend: services/api.ts
const api = {
  async submitCode(data: { problemSlug: string; language: string; code: string }): Promise<{ submissionId: string }> {
    const res = await fetch('/api/v1/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new ApiError(res);
    return res.json();
  },

  async getSubmissionStatus(submissionId: string): Promise<SubmissionProgress> {
    const res = await fetch(`/api/v1/submissions/${submissionId}/status`, {
      credentials: 'include',
    });
    if (!res.ok) throw new ApiError(res);
    return res.json();
  },

  async getProblems(filters: ProblemFilters): Promise<Problem[]> {
    const params = new URLSearchParams(filters as Record<string, string>);
    const res = await fetch(`/api/v1/problems?${params}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new ApiError(res);
    return res.json();
  },
};
```

```typescript
// Backend: routes/submissions.ts
router.post('/', requireAuth, async (req, res) => {
  const { problemSlug, language, code } = req.body;
  const userId = req.session.userId!;

  // Get problem
  const problem = await pool.query(
    'SELECT id, time_limit_ms, memory_limit_mb FROM problems WHERE slug = $1',
    [problemSlug]
  );
  if (problem.rows.length === 0) {
    return res.status(404).json({ error: 'Problem not found' });
  }

  // Get test cases
  const testCases = await pool.query(
    'SELECT input, expected_output FROM test_cases WHERE problem_id = $1 ORDER BY order_index',
    [problem.rows[0].id]
  );

  // Create submission record
  const submission = await pool.query(`
    INSERT INTO submissions (user_id, problem_id, language, code, test_cases_total)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [userId, problem.rows[0].id, language, code, testCases.rows.length]);

  const submissionId = submission.rows[0].id;

  // Start async execution (don't await)
  executeSubmission(submissionId, {
    language,
    code,
    testCases: testCases.rows,
    timeLimit: problem.rows[0].time_limit_ms,
    memoryLimit: problem.rows[0].memory_limit_mb,
  });

  res.status(202).json({ submissionId });
});

router.get('/:id/status', requireAuth, async (req, res) => {
  const { id } = req.params;

  // Check cache first
  const cached = await valkey.get(`submission:${id}:status`);
  if (cached) {
    return res.json(JSON.parse(cached));
  }

  // Fallback to database
  const result = await pool.query(`
    SELECT status, test_cases_passed, test_cases_total, runtime_ms, memory_kb, error_message
    FROM submissions WHERE id = $1
  `, [id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Submission not found' });
  }

  res.json(result.rows[0]);
});
```

## Deep Dive: Code Execution Pipeline (Full Stack Flow)

### Backend: Sandbox Execution

```typescript
// services/codeExecutor.ts
import Docker from 'dockerode';

const docker = new Docker();

interface ExecutionConfig {
  language: string;
  code: string;
  testCases: Array<{ input: string; expected_output: string }>;
  timeLimit: number;
  memoryLimit: number;
}

async function executeSubmission(submissionId: string, config: ExecutionConfig) {
  const { language, code, testCases, timeLimit, memoryLimit } = config;

  // Update status to running
  await updateStatus(submissionId, { status: 'running', currentTest: 1 });

  const image = language === 'python' ? 'python:3.11-alpine' : 'node:20-alpine';
  let passed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];

    const result = await runInContainer({
      image,
      code,
      stdin: testCase.input,
      timeLimit,
      memoryLimit,
      language,
    });

    // Update progress in cache
    await updateStatus(submissionId, {
      status: 'running',
      currentTest: i + 1,
      testCasesPassed: passed,
      testCasesTotal: testCases.length,
    });

    if (result.error) {
      await finishSubmission(submissionId, {
        status: result.timeout ? 'time_limit_exceeded' :
                result.memoryExceeded ? 'memory_limit_exceeded' : 'runtime_error',
        passed,
        total: testCases.length,
        errorMessage: result.stderr,
      });
      return;
    }

    const outputMatches = compareOutput(result.stdout, testCase.expected_output);
    if (outputMatches) {
      passed++;
    } else {
      await finishSubmission(submissionId, {
        status: 'wrong_answer',
        passed,
        total: testCases.length,
        failedTest: {
          input: testCase.input,
          expected: testCase.expected_output,
          actual: result.stdout,
        },
      });
      return;
    }
  }

  // All tests passed
  await finishSubmission(submissionId, {
    status: 'accepted',
    passed,
    total: testCases.length,
    runtimeMs: result.runtimeMs,
    memoryKb: result.memoryKb,
  });

  // Update user progress
  await updateUserProgress(submissionId);
}

async function runInContainer(config: ContainerConfig): Promise<ExecutionResult> {
  const container = await docker.createContainer({
    Image: config.image,
    Cmd: getRunCommand(config.language),
    HostConfig: {
      Memory: config.memoryLimit * 1024 * 1024,
      MemorySwap: config.memoryLimit * 1024 * 1024,
      NetworkMode: 'none',
      AutoRemove: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      PidsLimit: 50,
    },
  });

  // Write code and run with timeout
  // ...
}

async function updateStatus(submissionId: string, progress: Partial<SubmissionProgress>) {
  await valkey.setex(
    `submission:${submissionId}:status`,
    300,
    JSON.stringify(progress)
  );
}
```

### Frontend: Real-time Status Polling

```tsx
// components/SubmissionTracker.tsx
import { useState, useEffect } from 'react';

function useSubmissionStatus(submissionId: string | null) {
  const [progress, setProgress] = useState<SubmissionProgress | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!submissionId) return;

    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const status = await api.getSubmissionStatus(submissionId);
          setProgress(status);

          if (isFinalStatus(status.status)) {
            setIsComplete(true);
            break;
          }
        } catch (error) {
          console.error('Polling error:', error);
        }

        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [submissionId]);

  return { progress, isComplete };
}

function isFinalStatus(status: string): boolean {
  return ['accepted', 'wrong_answer', 'time_limit_exceeded',
          'memory_limit_exceeded', 'runtime_error', 'compile_error'].includes(status);
}

export function TestResultsPanel() {
  const { activeSubmission } = useProblemStore();
  const { progress, isComplete } = useSubmissionStatus(activeSubmission?.id);

  if (!activeSubmission) {
    return <div className="p-4 text-gray-500">Run your code to see results</div>;
  }

  return (
    <div className="p-4">
      {!isComplete ? (
        <RunningIndicator progress={progress} />
      ) : (
        <FinalResults progress={progress} />
      )}
    </div>
  );
}

function RunningIndicator({ progress }: { progress: SubmissionProgress | null }) {
  return (
    <div className="flex items-center gap-3">
      <Spinner className="w-5 h-5 text-blue-500 animate-spin" />
      <span>
        Running test {progress?.currentTest || 1} of {progress?.testCasesTotal || '?'}...
      </span>
    </div>
  );
}

function FinalResults({ progress }: { progress: SubmissionProgress }) {
  return (
    <div className="space-y-4">
      <StatusBanner status={progress.status} />

      <div className="flex gap-6 text-sm text-gray-600">
        <span>Runtime: {progress.runtimeMs}ms</span>
        <span>Memory: {(progress.memoryKb / 1024).toFixed(1)}MB</span>
        <span>Tests: {progress.testCasesPassed}/{progress.testCasesTotal}</span>
      </div>

      {progress.failedTest && (
        <FailedTestCase test={progress.failedTest} />
      )}
    </div>
  );
}
```

## Deep Dive: Code Editor Integration

### CodeMirror Setup

```tsx
// components/CodeEditor.tsx
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

const languageExtensions = {
  python: python(),
  javascript: javascript(),
};

export function CodeEditor({ language, value, onChange }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        languageExtensions[language] || python(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => viewRef.current?.destroy();
  }, [language]);

  return <div ref={containerRef} className="h-full overflow-auto" />;
}
```

### Code Draft Persistence

```typescript
// stores/problemStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useProblemStore = create<ProblemState>()(
  persist(
    (set, get) => ({
      code: {},  // { [problemSlug]: code }
      currentLanguage: 'python',

      setCode: (slug, code) =>
        set((state) => ({
          code: { ...state.code, [slug]: code },
        })),

      getCode: (slug, starterCode) => {
        const saved = get().code[slug];
        return saved || starterCode[get().currentLanguage] || '';
      },
    }),
    {
      name: 'leetcode-drafts',
      partialize: (state) => ({
        code: state.code,
        currentLanguage: state.currentLanguage,
      }),
    }
  )
);
```

## Session Management

### Backend Configuration

```typescript
// app.ts
import session from 'express-session';
import RedisStore from 'connect-redis';
import { valkey } from './shared/cache';

app.use(session({
  store: new RedisStore({ client: valkey }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));
```

### Frontend Auth State

```typescript
// stores/authStore.ts
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  checkAuth: async () => {
    try {
      const user = await api.getCurrentUser();
      set({ user, isAuthenticated: true });
    } catch {
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (username, password) => {
    const user = await api.login(username, password);
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    await api.logout();
    set({ user: null, isAuthenticated: false });
  },
}));
```

## User Progress Tracking

### Backend Update

```typescript
async function updateUserProgress(submissionId: string) {
  const submission = await pool.query(`
    SELECT user_id, problem_id, runtime_ms
    FROM submissions WHERE id = $1
  `, [submissionId]);

  const { user_id, problem_id, runtime_ms } = submission.rows[0];

  await pool.query(`
    INSERT INTO user_problem_status (user_id, problem_id, status, best_runtime_ms, attempts, solved_at)
    VALUES ($1, $2, 'solved', $3, 1, NOW())
    ON CONFLICT (user_id, problem_id) DO UPDATE SET
      status = 'solved',
      best_runtime_ms = LEAST(EXCLUDED.best_runtime_ms, user_problem_status.best_runtime_ms),
      attempts = user_problem_status.attempts + 1,
      solved_at = COALESCE(user_problem_status.solved_at, NOW())
  `, [user_id, problem_id, runtime_ms]);
}
```

### Frontend Progress Dashboard

```tsx
// components/ProgressDashboard.tsx
export function ProgressDashboard() {
  const { progress } = useUserProgress();

  const stats = useMemo(() => ({
    total: progress.length,
    solved: progress.filter(p => p.status === 'solved').length,
    byDifficulty: {
      easy: progress.filter(p => p.difficulty === 'easy' && p.status === 'solved').length,
      medium: progress.filter(p => p.difficulty === 'medium' && p.status === 'solved').length,
      hard: progress.filter(p => p.difficulty === 'hard' && p.status === 'solved').length,
    },
  }), [progress]);

  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard
        label="Problems Solved"
        value={`${stats.solved}/${stats.total}`}
        percentage={(stats.solved / stats.total) * 100}
      />
      <DifficultyBreakdown stats={stats.byDifficulty} />
      <StreakCard />
    </div>
  );
}
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Docker sandbox | Strong isolation, language-agnostic | ~200ms overhead per execution |
| HTTP polling | Simple, works behind firewalls | 1-2s latency vs WebSocket |
| CodeMirror | Small bundle, mobile-friendly | Less features than Monaco |
| Zustand + persist | Auto-save code drafts | Extra dependency |
| PostgreSQL | ACID, complex queries | More setup than SQLite |

## Scalability Path

### Current: Single Server

```
Browser → Express (Node.js) → PostgreSQL + Docker
```

### Future: Scaled

```
Browser → CDN → Load Balancer → Express (N nodes) → Kafka → Judge Workers
                                    ↓                         ↓
                              Valkey Cluster            Container Pools
                                    ↓
                              PostgreSQL + Replicas
```

1. **Kafka queue**: Decouple submission handling from execution
2. **Judge workers**: Scale execution independently per language
3. **Container pools**: Pre-warm containers for faster cold start
4. **Read replicas**: Scale problem queries

## Future Enhancements

1. **WebSocket Updates**: Real-time progress without polling
2. **Contest Mode**: Time-limited competitions with special scoring
3. **Code Similarity**: MOSS-based plagiarism detection
4. **More Languages**: C++, Java, Go, Rust support
5. **Collaborative Editing**: Pair programming mode
