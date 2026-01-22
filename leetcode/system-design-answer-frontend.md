# LeetCode (Online Judge) - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for an online coding practice platform that allows users to:
- Browse and filter coding problems by difficulty and tags
- Write and edit code in a syntax-highlighted editor
- Submit code and view real-time execution results
- Track progress across problems
- Participate in timed contests

## Requirements Clarification

### Functional Requirements
1. **Problem Browser**: Filterable, sortable list of coding problems
2. **Code Editor**: Syntax highlighting, multiple language support, auto-complete
3. **Test Runner**: Execute code against sample test cases
4. **Submission Results**: Real-time status updates with test case details
5. **Progress Dashboard**: Visualize solved problems, streaks, rankings

### Non-Functional Requirements
1. **Responsive**: Support desktop, tablet, and mobile layouts
2. **Performance**: Editor responsive at 60fps, instant UI feedback
3. **Accessibility**: Keyboard navigation, screen reader support
4. **Offline Resilience**: Cache problems for offline viewing

### UI/UX Requirements
- Clean, distraction-free coding environment
- Clear visual feedback for submission status
- Intuitive navigation between problems
- Real-time progress updates without page refresh

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          React Application                               │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                      React Router DOM                                ││
│  │    /                    → Problem List                               ││
│  │    /problems/:slug      → Problem Detail + Editor                    ││
│  │    /submissions         → Submission History                         ││
│  │    /progress            → User Dashboard                             ││
│  │    /contests/:id        → Contest View                               ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌───────────────┐  ┌────────────────────────────────────────────────┐  │
│  │   Sidebar     │  │              Main Content Area                  │  │
│  │  ┌─────────┐  │  │  ┌──────────────────────────────────────────┐  │  │
│  │  │ Problem │  │  │  │           Problem Description             │  │  │
│  │  │  List   │  │  │  │  - Title, difficulty badge                │  │  │
│  │  │         │  │  │  │  - Description markdown                   │  │  │
│  │  │ Filters │  │  │  │  - Examples with I/O                      │  │  │
│  │  │ - Easy  │  │  │  └──────────────────────────────────────────┘  │  │
│  │  │ - Med   │  │  │  ┌──────────────────────────────────────────┐  │  │
│  │  │ - Hard  │  │  │  │              Code Editor                  │  │  │
│  │  │         │  │  │  │  - Language selector                      │  │  │
│  │  │ Tags    │  │  │  │  - CodeMirror with syntax highlighting   │  │  │
│  │  │ Status  │  │  │  │  - Run / Submit buttons                   │  │  │
│  │  └─────────┘  │  │  └──────────────────────────────────────────┘  │  │
│  └───────────────┘  │  ┌──────────────────────────────────────────┐  │  │
│                     │  │           Test Results Panel              │  │  │
│                     │  │  - Status badges (Pass/Fail/TLE/MLE)     │  │  │
│                     │  │  - Expected vs Actual output              │  │  │
│                     │  │  - Runtime and memory stats               │  │  │
│                     │  └──────────────────────────────────────────┘  │  │
│                     └────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Zustand Store                                    ││
│  │  problems[] | submissions[] | currentCode | language | user         ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: Code Editor Integration

### CodeMirror 6 Setup

```tsx
// components/CodeEditor.tsx
import { useCallback, useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';

const languageExtensions = {
  python: python(),
  javascript: javascript(),
  java: java(),
  cpp: cpp(),
};

interface CodeEditorProps {
  language: string;
  value: string;
  onChange: (value: string) => void;
}

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
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, [language]); // Recreate on language change

  // Update content when value prop changes externally
  useEffect(() => {
    if (viewRef.current && viewRef.current.state.doc.toString() !== value) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: value,
        },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto border rounded-lg"
    />
  );
}
```

### Language Selector Component

```tsx
// components/LanguageSelector.tsx
const LANGUAGES = [
  { value: 'python', label: 'Python 3', icon: '🐍' },
  { value: 'javascript', label: 'JavaScript', icon: '📜' },
  { value: 'java', label: 'Java', icon: '☕' },
  { value: 'cpp', label: 'C++', icon: '⚡' },
];

interface LanguageSelectorProps {
  value: string;
  onChange: (language: string) => void;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 border rounded-lg bg-white hover:border-blue-500 focus:ring-2 focus:ring-blue-500"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.value} value={lang.value}>
          {lang.icon} {lang.label}
        </option>
      ))}
    </select>
  );
}
```

### Why CodeMirror 6?

| Factor | CodeMirror 6 | Monaco Editor | Ace Editor |
|--------|--------------|---------------|------------|
| Bundle size | ~150KB | ~2MB | ~500KB |
| Mobile support | Excellent | Poor | Moderate |
| Customization | Excellent | Moderate | Good |
| TypeScript | Built-in | Excellent | Good |
| Performance | Excellent | Good | Good |

**Decision**: CodeMirror 6 offers the best balance of features, bundle size, and mobile support for a LeetCode-style editor.

## Deep Dive: State Management with Zustand

### Store Design

```typescript
// stores/problemStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProblemState {
  // Problems list
  problems: Problem[];
  filters: {
    difficulty: 'all' | 'easy' | 'medium' | 'hard';
    status: 'all' | 'solved' | 'attempted' | 'unsolved';
    search: string;
  };

  // Current problem
  currentProblem: Problem | null;
  currentLanguage: string;
  code: Record<string, string>; // { [problemSlug]: code }

  // Submissions
  submissions: Submission[];
  activeSubmission: Submission | null;

  // Actions
  setFilter: (filter: Partial<Filters>) => void;
  setCurrentProblem: (problem: Problem) => void;
  setLanguage: (language: string) => void;
  setCode: (problemSlug: string, code: string) => void;
  submitCode: () => Promise<void>;

  // Computed
  getFilteredProblems: () => Problem[];
}

export const useProblemStore = create<ProblemState>()(
  persist(
    (set, get) => ({
      problems: [],
      filters: { difficulty: 'all', status: 'all', search: '' },
      currentProblem: null,
      currentLanguage: 'python',
      code: {},
      submissions: [],
      activeSubmission: null,

      setFilter: (newFilters) =>
        set((state) => ({
          filters: { ...state.filters, ...newFilters },
        })),

      setCode: (problemSlug, code) =>
        set((state) => ({
          code: { ...state.code, [problemSlug]: code },
        })),

      getFilteredProblems: () => {
        const { problems, filters } = get();
        return problems.filter((problem) => {
          if (filters.difficulty !== 'all' && problem.difficulty !== filters.difficulty) {
            return false;
          }
          if (filters.status !== 'all' && problem.userStatus !== filters.status) {
            return false;
          }
          if (filters.search && !problem.title.toLowerCase().includes(filters.search.toLowerCase())) {
            return false;
          }
          return true;
        });
      },

      submitCode: async () => {
        const { currentProblem, currentLanguage, code } = get();
        if (!currentProblem) return;

        const submission: Submission = {
          id: crypto.randomUUID(),
          problemSlug: currentProblem.slug,
          language: currentLanguage,
          code: code[currentProblem.slug] || '',
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        set({ activeSubmission: submission });

        // API call handled separately
      },
    }),
    {
      name: 'leetcode-storage',
      partialize: (state) => ({
        code: state.code,
        currentLanguage: state.currentLanguage,
      }),
    }
  )
);
```

### Why Zustand with Persist?

| Factor | Zustand | Redux | Context |
|--------|---------|-------|---------|
| Boilerplate | Minimal | Heavy | Moderate |
| Persistence | Built-in middleware | External | Manual |
| DevTools | Built-in | Built-in | Manual |
| Bundle size | 1KB | 7KB | 0KB |
| Code draft saving | Easy with persist | Possible | Manual |

**Decision**: Zustand with persist middleware automatically saves code drafts to localStorage, preventing data loss.

## Deep Dive: Submission Results UI

### Real-time Status Polling

```tsx
// hooks/useSubmissionStatus.ts
import { useEffect, useState } from 'react';
import { useProblemStore } from '../stores/problemStore';

export function useSubmissionStatus(submissionId: string | null) {
  const [status, setStatus] = useState<SubmissionStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    if (!submissionId) return;

    setIsPolling(true);
    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const response = await fetch(`/api/v1/submissions/${submissionId}/status`);
          const data = await response.json();

          if (!cancelled) {
            setStatus(data);

            // Stop polling when complete
            if (['accepted', 'wrong_answer', 'time_limit_exceeded',
                 'memory_limit_exceeded', 'runtime_error', 'compile_error'].includes(data.status)) {
              setIsPolling(false);
              break;
            }
          }
        } catch (error) {
          console.error('Polling error:', error);
        }

        // Wait 1 second between polls
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  return { status, isPolling };
}
```

### Test Results Component

```tsx
// components/TestResults.tsx
interface TestResultsProps {
  submission: Submission | null;
  status: SubmissionStatus | null;
  isPolling: boolean;
}

export function TestResults({ submission, status, isPolling }: TestResultsProps) {
  if (!submission) {
    return (
      <div className="p-4 text-gray-500 text-center">
        Run your code to see results
      </div>
    );
  }

  if (isPolling) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-3">
          <Spinner className="w-5 h-5 text-blue-500" />
          <span className="text-gray-700">
            Running test {status?.current_test || 1} of {status?.test_cases_total || '?'}...
          </span>
        </div>
        <ProgressBar
          value={status?.test_cases_passed || 0}
          max={status?.test_cases_total || 1}
          className="mt-3"
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Status Banner */}
      <StatusBanner status={status?.status || 'pending'} />

      {/* Stats Row */}
      <div className="flex gap-6 text-sm">
        <div>
          <span className="text-gray-500">Runtime: </span>
          <span className="font-medium">{status?.runtime_ms} ms</span>
        </div>
        <div>
          <span className="text-gray-500">Memory: </span>
          <span className="font-medium">{(status?.memory_kb / 1024).toFixed(1)} MB</span>
        </div>
        <div>
          <span className="text-gray-500">Tests: </span>
          <span className="font-medium">
            {status?.test_cases_passed}/{status?.test_cases_total} passed
          </span>
        </div>
      </div>

      {/* Test Case Details */}
      {status?.status !== 'accepted' && status?.failed_test && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 font-medium">Failed Test Case</div>
          <div className="p-4 space-y-3">
            <div>
              <div className="text-sm text-gray-500 mb-1">Input:</div>
              <pre className="bg-gray-100 p-2 rounded text-sm overflow-x-auto">
                {status.failed_test.input}
              </pre>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">Expected Output:</div>
              <pre className="bg-green-50 p-2 rounded text-sm text-green-800 overflow-x-auto">
                {status.failed_test.expected}
              </pre>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-1">Your Output:</div>
              <pre className="bg-red-50 p-2 rounded text-sm text-red-800 overflow-x-auto">
                {status.failed_test.actual}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Status Badge Component

```tsx
// components/StatusBadge.tsx
const STATUS_CONFIG = {
  accepted: {
    label: 'Accepted',
    className: 'bg-green-100 text-green-800 border-green-200',
    icon: CheckCircle,
  },
  wrong_answer: {
    label: 'Wrong Answer',
    className: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircle,
  },
  time_limit_exceeded: {
    label: 'Time Limit Exceeded',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: Clock,
  },
  memory_limit_exceeded: {
    label: 'Memory Limit Exceeded',
    className: 'bg-orange-100 text-orange-800 border-orange-200',
    icon: HardDrive,
  },
  runtime_error: {
    label: 'Runtime Error',
    className: 'bg-red-100 text-red-800 border-red-200',
    icon: AlertTriangle,
  },
  compile_error: {
    label: 'Compile Error',
    className: 'bg-purple-100 text-purple-800 border-purple-200',
    icon: AlertCircle,
  },
  pending: {
    label: 'Pending',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
    icon: Clock,
  },
  running: {
    label: 'Running',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Loader,
  },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <div className={cn('inline-flex items-center gap-2 px-3 py-1 rounded-full border', config.className)}>
      <Icon className="w-4 h-4" />
      <span className="font-medium">{config.label}</span>
    </div>
  );
}
```

## Deep Dive: Problem List with Virtualization

### Virtualized Problem Table

```tsx
// components/ProblemList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useProblemStore } from '../stores/problemStore';

export function ProblemList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const problems = useProblemStore((state) => state.getFilteredProblems());

  const virtualizer = useVirtualizer({
    count: problems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56, // Row height
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-white border-b">
          <tr>
            <th className="w-16 px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Title</th>
            <th className="w-24 px-4 py-3 text-left">Difficulty</th>
            <th className="w-24 px-4 py-3 text-left">Acceptance</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ height: virtualizer.getTotalSize() }}>
            <td colSpan={4} className="relative">
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const problem = problems[virtualRow.index];
                return (
                  <ProblemRow
                    key={problem.id}
                    problem={problem}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  />
                );
              })}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ProblemRow({ problem, style }: { problem: Problem; style: React.CSSProperties }) {
  const navigate = useNavigate();

  return (
    <div
      style={style}
      className="flex items-center border-b hover:bg-gray-50 cursor-pointer"
      onClick={() => navigate(`/problems/${problem.slug}`)}
    >
      <div className="w-16 px-4">
        <StatusIcon status={problem.userStatus} />
      </div>
      <div className="flex-1 px-4 font-medium">{problem.title}</div>
      <div className="w-24 px-4">
        <DifficultyBadge difficulty={problem.difficulty} />
      </div>
      <div className="w-24 px-4 text-gray-600">
        {problem.acceptanceRate}%
      </div>
    </div>
  );
}
```

### Difficulty Badge

```tsx
// components/DifficultyBadge.tsx
const DIFFICULTY_STYLES = {
  easy: 'text-green-600 bg-green-50',
  medium: 'text-yellow-600 bg-yellow-50',
  hard: 'text-red-600 bg-red-50',
};

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span className={cn('px-2 py-1 rounded text-sm font-medium capitalize', DIFFICULTY_STYLES[difficulty])}>
      {difficulty}
    </span>
  );
}
```

## Deep Dive: Resizable Panels

### Split Pane Layout

```tsx
// components/ProblemView.tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

export function ProblemView() {
  const { currentProblem } = useProblemStore();

  if (!currentProblem) return <div>Loading...</div>;

  return (
    <PanelGroup direction="horizontal" className="h-full">
      {/* Problem Description */}
      <Panel defaultSize={40} minSize={25}>
        <div className="h-full overflow-auto p-6">
          <h1 className="text-2xl font-bold mb-4">{currentProblem.title}</h1>
          <DifficultyBadge difficulty={currentProblem.difficulty} />
          <div
            className="prose mt-6"
            dangerouslySetInnerHTML={{ __html: currentProblem.descriptionHtml }}
          />
        </div>
      </Panel>

      <PanelResizeHandle className="w-2 bg-gray-200 hover:bg-blue-400 transition-colors" />

      {/* Editor + Results */}
      <Panel defaultSize={60} minSize={30}>
        <PanelGroup direction="vertical">
          {/* Code Editor */}
          <Panel defaultSize={60} minSize={30}>
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between p-2 border-b">
                <LanguageSelector />
                <div className="flex gap-2">
                  <button
                    onClick={handleRun}
                    className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200"
                  >
                    Run
                  </button>
                  <button
                    onClick={handleSubmit}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    Submit
                  </button>
                </div>
              </div>
              <CodeEditor
                language={currentLanguage}
                value={code[currentProblem.slug] || currentProblem.starterCode[currentLanguage]}
                onChange={(code) => setCode(currentProblem.slug, code)}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="h-2 bg-gray-200 hover:bg-blue-400 transition-colors" />

          {/* Test Results */}
          <Panel defaultSize={40} minSize={20}>
            <TestResults
              submission={activeSubmission}
              status={status}
              isPolling={isPolling}
            />
          </Panel>
        </PanelGroup>
      </Panel>
    </PanelGroup>
  );
}
```

## Performance Optimizations

### 1. Code Draft Debouncing

```tsx
// hooks/useCodeDraft.ts
import { useEffect, useRef } from 'react';
import { useProblemStore } from '../stores/problemStore';

export function useCodeDraft(problemSlug: string) {
  const setCode = useProblemStore((state) => state.setCode);
  const draftRef = useRef<string>('');

  const saveWithDebounce = useCallback(
    debounce((code: string) => {
      setCode(problemSlug, code);
    }, 500),
    [problemSlug, setCode]
  );

  const handleChange = useCallback((code: string) => {
    draftRef.current = code;
    saveWithDebounce(code);
  }, [saveWithDebounce]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (draftRef.current) {
        setCode(problemSlug, draftRef.current);
      }
    };
  }, [problemSlug]);

  return handleChange;
}
```

### 2. Lazy Loading Problem Details

```tsx
// routes/problem.tsx
import { lazy, Suspense } from 'react';

const CodeEditor = lazy(() => import('../components/CodeEditor'));

export function ProblemRoute() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <CodeEditor />
    </Suspense>
  );
}
```

### 3. Service Worker for Offline Problems

```typescript
// service-worker.ts
const CACHE_NAME = 'leetcode-problems-v1';
const PROBLEM_URL_PATTERN = /\/api\/v1\/problems\/[\w-]+$/;

self.addEventListener('fetch', (event) => {
  if (PROBLEM_URL_PATTERN.test(event.request.url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request).then((response) => {
            cache.put(event.request, response.clone());
            return response;
          });
          return cached || fetchPromise;
        });
      })
    );
  }
});
```

## Accessibility (a11y)

### Keyboard Shortcuts

```tsx
// hooks/useKeyboardShortcuts.ts
import { useEffect } from 'react';

export function useKeyboardShortcuts() {
  const { submitCode } = useProblemStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd + Enter to submit
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitCode();
      }

      // Ctrl/Cmd + ' to run
      if ((e.ctrlKey || e.metaKey) && e.key === "'") {
        e.preventDefault();
        runCode();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [submitCode]);
}
```

### ARIA Labels

```tsx
<button
  onClick={handleSubmit}
  aria-label="Submit code for evaluation"
  aria-busy={isSubmitting}
  disabled={isSubmitting}
  className="px-4 py-2 bg-green-500 text-white rounded"
>
  {isSubmitting ? 'Submitting...' : 'Submit'}
</button>

<div
  role="status"
  aria-live="polite"
  aria-label={`Test ${status.current_test} of ${status.test_cases_total} running`}
>
  {/* Status content */}
</div>
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| CodeMirror 6 | Small bundle, mobile-friendly | Less IDE-like than Monaco |
| Zustand with persist | Auto-save drafts, simple API | Extra dependency |
| Polling vs WebSocket | Simpler, works behind firewalls | 1s latency |
| Virtualized list | Handles 1000+ problems | More complex implementation |
| Resizable panels | Flexible layout | Adds library dependency |

## Future Frontend Enhancements

1. **Monaco Editor Option**: For power users who want IDE features
2. **WebSocket Updates**: Real-time submission status without polling
3. **Collaborative Editing**: Pair programming mode
4. **Code Playback**: Step-through execution visualization
5. **Mobile App**: React Native version for on-the-go practice
