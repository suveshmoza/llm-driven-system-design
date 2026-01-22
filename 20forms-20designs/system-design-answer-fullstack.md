# 20 Forms, 40 Designs - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Problem Statement

Design a platform that renders identical forms across 41 React design systems for comparison. This answer covers the end-to-end architecture, emphasizing the integration between:
- Shell application (host) and library applications (iframes)
- Build orchestration and deployment pipeline
- State management and URL synchronization

## Requirements Clarification

### Functional Requirements
1. **Form Comparison**: Display 20 common forms across 41 design system libraries
2. **Library Selection**: Toggle visibility of any library combination
3. **Theme Support**: Light/dark mode for supported libraries
4. **Deep Linking**: Shareable URLs to specific form/library comparisons

### Non-Functional Requirements
1. **CSS Isolation**: Zero style bleed between design systems
2. **Build Time**: Under 5 minutes for full 42-app build
3. **Load Time**: Fast navigation between comparisons
4. **Static Hosting**: No server required (GitHub Pages)

### Scale Estimates
- 42 applications (1 shell + 41 libraries)
- ~150KB gzipped average per library app
- Read-only workload (static assets)
- 1K-10K daily visitors

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Monorepo Structure                               │
│  apps/                                                                   │
│  ├── shell/          (Host application - Vite + React)                  │
│  ├── mui/            (MUI forms - Vite + React + MUI)                   │
│  ├── chakra/         (Chakra forms - Vite + React + Chakra)             │
│  └── ... (39 more)                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ Build Pipeline
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions CI/CD                             │
│  1. Checkout → 2. Install → 3. Parallel Build (4 concurrent)            │
│  4. Assemble dist/ → 5. Deploy to GitHub Pages                          │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Browser (Shell Application)                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Control Panel                                  │  │
│  │  [Form: Login ▼]  [Libraries: ✓MUI ✓Chakra ...]  [🌙/☀️]          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Preview Grid                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │  │
│  │  │   <iframe>   │  │   <iframe>   │  │   <iframe>   │             │  │
│  │  │  src="/mui/  │  │ src="/chakra │  │ src="/antd/  │             │  │
│  │  │  ?form=login │  │ ?form=login" │  │ ?form=login" │             │  │
│  │  │  &theme=dark"│  │ &theme=dark" │  │ &theme=dark" │             │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Zustand Store                                  │  │
│  │  selectedForm | selectedLibraries[] | theme                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Static Data Structures

```typescript
// shared/types.ts - Used across shell and for reference

interface Form {
  id: string;      // 'login', 'signup', 'checkout', etc.
  name: string;    // 'User Login', 'Sign Up', etc.
  fields: Field[];
}

interface Field {
  name: string;
  type: 'text' | 'email' | 'password' | 'select' | 'checkbox';
  label: string;
  required: boolean;
}

interface Library {
  id: string;           // 'mui', 'chakra', 'antd'
  name: string;         // 'Material UI', 'Chakra UI'
  supportsTheme: boolean;
  url: string;          // Documentation URL
}

// Data files
const FORMS: Form[] = [
  { id: 'login', name: 'User Login', fields: [...] },
  { id: 'signup', name: 'Sign Up', fields: [...] },
  // ... 18 more forms
];

const LIBRARIES: Library[] = [
  { id: 'mui', name: 'Material UI', supportsTheme: true, url: '...' },
  { id: 'chakra', name: 'Chakra UI', supportsTheme: true, url: '...' },
  // ... 39 more libraries
];
```

### URL State Format

```
Shell URL:      /?form=login&theme=dark&libs=mui,chakra,antd
Library iframe: /mui/?form=login&theme=dark
```

## Deep Dive: Shell-Iframe Communication

### URL-Based Configuration

The shell communicates with library apps via URL query parameters:

```typescript
// Shell: Constructing iframe URLs
function PreviewCard({ library }: { library: Library }) {
  const { selectedForm, theme } = useComparisonStore();

  const iframeUrl = useMemo(() => {
    const params = new URLSearchParams({
      form: selectedForm,
      theme: library.supportsTheme ? theme : 'light',
    });
    return `/${library.id}/?${params}`;
  }, [library.id, selectedForm, theme, library.supportsTheme]);

  return (
    <iframe
      src={iframeUrl}
      title={`${library.name} - ${selectedForm}`}
    />
  );
}
```

```typescript
// Library app: Reading configuration
function App() {
  const params = new URLSearchParams(window.location.search);
  const formId = params.get('form') || 'login';
  const theme = params.get('theme') || 'light';

  return (
    <ThemeProvider theme={theme === 'dark' ? darkTheme : lightTheme}>
      <CssBaseline />
      <FormRouter formId={formId} />
    </ThemeProvider>
  );
}
```

### Why URL Parameters Over postMessage?

| Factor | URL Parameters | postMessage |
|--------|---------------|-------------|
| Deep linking | Automatic | Manual state sync |
| Browser history | Works natively | Requires custom handling |
| Debugging | Visible in DevTools | Hidden |
| Complexity | Simple | Coordination logic needed |
| Bookmarkable | Yes | No |

## Deep Dive: State Management Flow

### Zustand Store

```typescript
// stores/comparisonStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ComparisonState {
  selectedForm: string;
  selectedLibraries: Set<string>;
  theme: 'light' | 'dark';

  // Actions
  setForm: (formId: string) => void;
  toggleLibrary: (libraryId: string) => void;
  toggleTheme: () => void;
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set) => ({
      selectedForm: 'login',
      selectedLibraries: new Set(['mui', 'chakra']),
      theme: 'light',

      setForm: (formId) => set({ selectedForm: formId }),

      toggleLibrary: (libraryId) => set((state) => {
        const newSet = new Set(state.selectedLibraries);
        if (newSet.has(libraryId)) {
          newSet.delete(libraryId);
        } else {
          newSet.add(libraryId);
        }
        return { selectedLibraries: newSet };
      }),

      toggleTheme: () => set((state) => ({
        theme: state.theme === 'light' ? 'dark' : 'light'
      })),
    }),
    {
      name: 'comparison-store',
    }
  )
);
```

### URL Synchronization

```typescript
// hooks/useUrlSync.ts
function useUrlSync() {
  const { selectedForm, selectedLibraries, theme, setForm, toggleTheme } = useComparisonStore();

  // Read from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlForm = params.get('form');
    const urlTheme = params.get('theme');
    const urlLibs = params.get('libs')?.split(',');

    if (urlForm) setForm(urlForm);
    if (urlTheme === 'dark' && theme === 'light') toggleTheme();
    if (urlLibs) {
      // Sync library selection from URL
    }
  }, []);

  // Write to URL on state change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        form: selectedForm,
        theme,
        libs: Array.from(selectedLibraries).join(','),
      });
      window.history.replaceState(null, '', `?${params}`);
    }, 300);

    return () => clearTimeout(timer);
  }, [selectedForm, selectedLibraries, theme]);
}
```

## Deep Dive: Build Pipeline

### Parallel Build with Memory Management

```javascript
// scripts/build-all.mjs
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const BATCH_SIZE = 4;  // Concurrent builds
const BUILD_TIMEOUT = 120000;  // 2 min per app

const libraries = [
  'shell', 'mui', 'chakra', 'antd', 'blueprint',
  // ... 37 more
];

async function buildWithRetry(lib, attempt = 1) {
  try {
    console.log(`[Build] ${lib} (attempt ${attempt})`);
    await execAsync(`cd apps/${lib} && bun run build`, {
      timeout: BUILD_TIMEOUT,
    });
    return { lib, success: true };
  } catch (error) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 2000));
      return buildWithRetry(lib, attempt + 1);
    }
    return { lib, success: false, error: error.message };
  }
}

async function buildAll() {
  const results = [];

  for (let i = 0; i < libraries.length; i += BATCH_SIZE) {
    const batch = libraries.slice(i, i + BATCH_SIZE);
    console.log(`\nBuilding batch: ${batch.join(', ')}`);

    const batchResults = await Promise.all(batch.map(buildWithRetry));
    results.push(...batchResults);

    // Force GC between batches
    if (global.gc) global.gc();
  }

  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.error(`\n${failed.length} builds failed`);
    process.exit(1);
  }

  console.log(`\nAll ${results.length} builds succeeded`);
}

buildAll();
```

### Deployment Assembly

```javascript
// scripts/copy-builds-to-dist.mjs
import { cp, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';

async function assembleDistribution() {
  // Clean dist
  if (existsSync('dist')) {
    await rm('dist', { recursive: true });
  }
  await mkdir('dist');

  // Copy shell as root
  await cp('apps/shell/dist', 'dist', { recursive: true });

  // Copy each library to subdirectory
  for (const lib of libraries.filter(l => l !== 'shell')) {
    const src = `apps/${lib}/dist`;
    const dest = `dist/${lib}`;
    if (existsSync(src)) {
      await cp(src, dest, { recursive: true });
    }
  }
}

assembleDistribution();
```

## Deep Dive: CSS Isolation Strategy

### The Problem

When multiple design systems coexist:

```jsx
// This breaks!
<MuiThemeProvider>
  <MuiButton>Save</MuiButton>
</MuiThemeProvider>
<ChakraProvider>
  <ChakraButton>Cancel</ChakraButton>
</ChakraProvider>
```

**Issues:**
- MUI's `CssBaseline` resets Chakra's defaults
- CSS custom properties (`--chakra-colors-blue-500`) conflict
- Both fight over `body` and `html` styles

### The Solution: Iframe Isolation

```html
<!-- Each library in separate browsing context -->
<iframe src="/mui/?form=login">
  <!-- Own document, own stylesheets, own CSS cascade -->
</iframe>

<iframe src="/chakra/?form=login">
  <!-- Cannot affect or be affected by MUI -->
</iframe>
```

### Why Other Approaches Failed

| Approach | Issue |
|----------|-------|
| Single SPA | Styles clash immediately |
| CSS Modules | Only scopes class names, not resets/variables |
| Shadow DOM | CSS custom properties leak, React context breaks |
| **Iframe** | Complete isolation (chosen) |

## Deep Dive: Library App Structure

### Vite Configuration

```typescript
// apps/mui/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/20forms-20designs/mui/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
```

### Form Router

```typescript
// apps/mui/src/FormRouter.tsx
import { lazy, Suspense } from 'react';

const forms: Record<string, React.LazyExoticComponent<any>> = {
  login: lazy(() => import('./forms/LoginForm')),
  signup: lazy(() => import('./forms/SignupForm')),
  checkout: lazy(() => import('./forms/CheckoutForm')),
  // ... 17 more forms
};

export function FormRouter({ formId }: { formId: string }) {
  const FormComponent = forms[formId] || forms.login;

  return (
    <Suspense fallback={<div className="animate-pulse h-64 bg-gray-100" />}>
      <FormComponent onSubmit={(data: unknown) => console.log('Submit:', data)} />
    </Suspense>
  );
}
```

### Standardized Form Interface

```typescript
// All 41 libraries implement the same interface
interface LoginFormProps {
  onSubmit: (data: { email: string; password: string }) => void;
}

// MUI implementation
function LoginForm({ onSubmit }: LoginFormProps) {
  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <TextField label="Email address" type="email" required fullWidth />
      <TextField label="Password" type="password" required fullWidth />
      <Button type="submit" variant="contained" fullWidth>Sign in</Button>
    </Box>
  );
}

// Chakra implementation
function LoginForm({ onSubmit }: LoginFormProps) {
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FormControl isRequired>
        <FormLabel>Email address</FormLabel>
        <Input type="email" />
      </FormControl>
      <FormControl isRequired>
        <FormLabel>Password</FormLabel>
        <Input type="password" />
      </FormControl>
      <Button type="submit" colorScheme="blue" width="100%">Sign in</Button>
    </form>
  );
}
```

## Lazy Loading Strategy

### Intersection Observer for Iframes

```tsx
// components/PreviewCard.tsx
function PreviewCard({ library }: { library: Library }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="min-h-[400px]">
      {!isVisible && <Skeleton />}
      {isVisible && (
        <iframe
          src={iframeUrl}
          className={isLoaded ? 'opacity-100' : 'opacity-0'}
          onLoad={() => setIsLoaded(true)}
        />
      )}
    </div>
  );
}
```

### Performance Impact

| Scenario | Initial Load | Memory |
|----------|-------------|--------|
| Eager (41 iframes) | 6MB + 41 React apps | ~500MB |
| Lazy (3-6 visible) | 450KB + 3 React apps | ~75MB |

## CI/CD Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Cache dependencies
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ hashFiles('**/bun.lockb') }}

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build all apps
        run: node --expose-gc scripts/build-all.mjs

      - name: Assemble dist
        run: node scripts/copy-builds-to-dist.mjs

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist-${{ github.sha }}
          path: dist/
          retention-days: 14

  deploy:
    needs: build
    runs-on: ubuntu-latest

    steps:
      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          name: dist-${{ github.sha }}
          path: dist/

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## Caching Strategy

### Content-Hashed Assets

```
dist/
├── index.html                    # no-cache (always fresh)
├── assets/
│   ├── shell-a1b2c3d4.js        # immutable (1 year cache)
│   └── shell-e5f6g7h8.css       # immutable (1 year cache)
├── mui/
│   ├── index.html               # no-cache
│   └── assets/
│       └── mui-m3n4o5p6.js      # immutable
```

### Cache Headers

| Asset Type | Cache-Control | TTL |
|------------|---------------|-----|
| `*.html` | `no-cache, must-revalidate` | 0 |
| `*-[hash].js` | `public, max-age=31536000, immutable` | 1 year |
| `*-[hash].css` | `public, max-age=31536000, immutable` | 1 year |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Iframe isolation | Complete CSS isolation | Duplicated React bundles (~40KB x 41) |
| URL-based communication | Deep linking, history | Limited to string data |
| Batched parallel builds | Memory efficient (~2GB) | Slower than unlimited parallel |
| Static hosting | Free, simple, CDN | No server-side logic |
| Zustand with persistence | Survives refresh | Storage sync complexity |
| Lazy loading iframes | Fast initial load | Brief loading states on scroll |

## Scalability Path

### Current: Static Site

```
GitHub Repo → GitHub Actions → GitHub Pages (Fastly CDN)
```

### Future: Enhanced Features

1. **More Libraries**: Add new design systems as they emerge
2. **Visual Regression**: Screenshot comparison per library
3. **Bundle Analysis**: Display library sizes for comparison
4. **Mobile Viewport**: Compare form responsiveness
5. **Accessibility Audit**: WCAG compliance scoring per form

## Future Enhancements

1. **Incremental Builds**: Only rebuild changed apps using file hashing
2. **Drag & Drop Ordering**: Rearrange libraries in comparison view
3. **Side-by-Side Diff**: Highlight visual differences
4. **Export Comparison**: Generate shareable image/PDF
5. **Form Validation Demo**: Show validation behavior differences
6. **Animation Comparison**: Display transition/animation differences
