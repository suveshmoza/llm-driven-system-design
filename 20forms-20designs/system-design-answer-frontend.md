# 20 Forms, 40 Designs - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a platform that renders identical forms across 41 React design systems for comparison. Key challenges include:
- Complete CSS isolation between competing design systems
- Efficient iframe-based architecture for side-by-side comparison
- Responsive preview grid with lazy loading
- Theme synchronization across isolated applications

## Requirements Clarification

### Functional Requirements
1. **Form Comparison Grid**: Display multiple design system forms side-by-side
2. **Library Selection**: Toggle visibility of any library combination
3. **Form Selection**: Switch between 20 different form types
4. **Theme Toggle**: Light/dark mode for supported libraries
5. **Deep Linking**: Shareable URLs to specific comparisons

### Non-Functional Requirements
1. **CSS Isolation**: Zero style bleed between design systems
2. **Performance**: Smooth scrolling with 41 potential iframes
3. **Responsive Design**: Works on desktop and tablet
4. **Accessibility**: Keyboard navigation, screen reader support

### UI/UX Requirements
- Clean control panel for form/library selection
- Visual feedback for selected libraries
- Loading states for iframe content
- Graceful handling of missing themes

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Shell Application (Host)                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         Header / Controls                          │ │
│  │  ┌─────────────────┐ ┌──────────────────────┐ ┌─────────────────┐ │ │
│  │  │  FormSelector   │ │  LibraryMultiSelect  │ │  ThemeToggle    │ │ │
│  │  │  [Login ▼]      │ │  [✓ MUI ✓ Chakra...] │ │  [🌙 / ☀️]      │ │ │
│  │  └─────────────────┘ └──────────────────────┘ └─────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         Preview Grid                               │ │
│  │  ┌──────────────────────┐  ┌──────────────────────┐               │ │
│  │  │    PreviewCard       │  │    PreviewCard       │               │ │
│  │  │  ┌────────────────┐  │  │  ┌────────────────┐  │               │ │
│  │  │  │ Library: MUI   │  │  │  │ Library: Chakra│  │               │ │
│  │  │  └────────────────┘  │  │  └────────────────┘  │               │ │
│  │  │  ┌────────────────┐  │  │  ┌────────────────┐  │               │ │
│  │  │  │    <iframe>    │  │  │  │    <iframe>    │  │               │ │
│  │  │  │ /mui/?form=    │  │  │  │ /chakra/?form= │  │               │ │
│  │  │  │  login&theme=  │  │  │  │  login&theme=  │  │               │ │
│  │  │  │  dark          │  │  │  │  dark          │  │               │ │
│  │  │  └────────────────┘  │  │  └────────────────┘  │               │ │
│  │  └──────────────────────┘  └──────────────────────┘               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                       Zustand Store                                │ │
│  │  selectedForm | selectedLibraries[] | theme | isLoading           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: CSS Isolation Problem

### Why This Is the Core Challenge

When multiple design systems coexist in one React app:

```jsx
// This breaks everything!
<div>
  <MuiThemeProvider>
    <MuiButton>MUI Button</MuiButton>
  </MuiThemeProvider>
  <ChakraProvider>
    <ChakraButton>Chakra Button</ChakraButton>
  </ChakraProvider>
</div>
```

**What goes wrong:**
1. MUI's `CssBaseline` resets Chakra's default styles
2. Chakra's global styles override MUI's typography
3. CSS custom properties (`--chakra-colors-blue-500`) conflict
4. Both libraries fight over `body` and `html` styles

### Isolation Strategies Evaluated

| Approach | Isolation Level | Why It Fails |
|----------|-----------------|--------------|
| Single SPA | None | Styles clash immediately |
| CSS Modules | Class names only | Doesn't isolate resets, CSS variables |
| Shadow DOM | Partial | CSS custom properties leak through, React context breaks |
| **Iframe** | **Complete** | True separate browsing contexts |

### The Iframe Solution

```html
<!-- Each library runs in complete isolation -->
<iframe src="/mui/?form=login&theme=dark">
  <!-- Separate document -->
  <!-- Separate <head> with own stylesheets -->
  <!-- Separate CSS cascade -->
  <!-- Own JavaScript runtime -->
</iframe>

<iframe src="/chakra/?form=login&theme=dark">
  <!-- Cannot affect or be affected by MUI -->
</iframe>
```

**Why iframes work:**
- Separate `document` objects
- Independent CSS cascades
- No shared JavaScript global scope
- Clean React tree per library

## Deep Dive: State Management with Zustand

### Store Design

```typescript
// stores/comparisonStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Library {
  id: string;
  name: string;
  supportsTheme: boolean;
}

interface ComparisonState {
  // Selection state
  selectedForm: string;
  selectedLibraries: Set<string>;
  theme: 'light' | 'dark';

  // Data
  forms: Form[];
  libraries: Library[];

  // Actions
  setForm: (formId: string) => void;
  toggleLibrary: (libraryId: string) => void;
  selectAllLibraries: () => void;
  clearAllLibraries: () => void;
  toggleTheme: () => void;

  // Computed
  getSelectedLibraryList: () => Library[];
  getIframeUrl: (libraryId: string) => string;
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set, get) => ({
      selectedForm: 'login',
      selectedLibraries: new Set(['mui', 'chakra']),
      theme: 'light',
      forms: FORMS_DATA,
      libraries: LIBRARIES_DATA,

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

      selectAllLibraries: () => set((state) => ({
        selectedLibraries: new Set(state.libraries.map(l => l.id))
      })),

      clearAllLibraries: () => set({ selectedLibraries: new Set() }),

      toggleTheme: () => set((state) => ({
        theme: state.theme === 'light' ? 'dark' : 'light'
      })),

      getSelectedLibraryList: () => {
        const { libraries, selectedLibraries } = get();
        return libraries.filter(l => selectedLibraries.has(l.id));
      },

      getIframeUrl: (libraryId) => {
        const { selectedForm, theme } = get();
        return `/${libraryId}/?form=${selectedForm}&theme=${theme}`;
      },
    }),
    {
      name: 'comparison-store',
      partialize: (state) => ({
        selectedForm: state.selectedForm,
        selectedLibraries: Array.from(state.selectedLibraries),
        theme: state.theme,
      }),
    }
  )
);
```

### Why Zustand Over Context?

| Factor | Zustand | React Context |
|--------|---------|---------------|
| Boilerplate | Minimal | Significant |
| Re-renders | Selective via selectors | All consumers |
| Persistence | Plugin included | Manual implementation |
| Devtools | Built-in | Requires setup |
| URL sync | Easy integration | Complex |

## Deep Dive: Preview Grid Component

### Responsive Grid Layout

```tsx
// components/PreviewGrid.tsx
function PreviewGrid() {
  const selectedLibraries = useComparisonStore(state => state.getSelectedLibraryList());

  if (selectedLibraries.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        Select at least one library to compare
      </div>
    );
  }

  return (
    <div className={cn(
      'grid gap-4 p-4',
      // Responsive columns based on selection count
      selectedLibraries.length === 1 && 'grid-cols-1 max-w-2xl mx-auto',
      selectedLibraries.length === 2 && 'grid-cols-1 md:grid-cols-2',
      selectedLibraries.length >= 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
      selectedLibraries.length >= 6 && 'xl:grid-cols-4',
    )}>
      {selectedLibraries.map(library => (
        <PreviewCard key={library.id} library={library} />
      ))}
    </div>
  );
}
```

### Preview Card with Lazy Loading

```tsx
// components/PreviewCard.tsx
function PreviewCard({ library }: { library: Library }) {
  const getIframeUrl = useComparisonStore(state => state.getIframeUrl);
  const theme = useComparisonStore(state => state.theme);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }  // Load slightly before visible
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="border rounded-lg overflow-hidden bg-white shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="font-medium">{library.name}</span>
          {!library.supportsTheme && theme === 'dark' && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
              Light only
            </span>
          )}
        </div>
        <a
          href={library.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm"
        >
          Docs
        </a>
      </div>

      {/* Iframe Container */}
      <div className="relative h-[400px]">
        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
          </div>
        )}

        {isVisible && (
          <iframe
            src={getIframeUrl(library.id)}
            title={`${library.name} form preview`}
            className={cn(
              'w-full h-full border-0',
              !isLoaded && 'opacity-0'
            )}
            onLoad={() => setIsLoaded(true)}
          />
        )}
      </div>
    </div>
  );
}
```

### Why Lazy Loading Matters

With 41 potential iframes:
- Eager loading: 41 network requests, 41 React apps initializing
- Lazy loading: Only visible iframes load, ~3-6 at a time

```
Without lazy loading:
  Initial load: 41 × 150KB = 6MB + 41 React hydrations

With lazy loading:
  Initial load: 3 × 150KB = 450KB + 3 React hydrations
  Subsequent: Load on scroll
```

## Deep Dive: Library Application Architecture

### URL-Based Configuration

Each library app reads configuration from URL parameters:

```typescript
// apps/mui/src/App.tsx
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { FormRouter } from './FormRouter';

const lightTheme = createTheme({ palette: { mode: 'light' } });
const darkTheme = createTheme({ palette: { mode: 'dark' } });

function App() {
  const params = new URLSearchParams(window.location.search);
  const formId = params.get('form') || 'login';
  const themeMode = params.get('theme') || 'light';

  const theme = themeMode === 'dark' ? darkTheme : lightTheme;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div className="p-4">
        <FormRouter formId={formId} />
      </div>
    </ThemeProvider>
  );
}
```

### Form Router Pattern

```typescript
// apps/mui/src/FormRouter.tsx
import { lazy, Suspense } from 'react';

const forms = {
  login: lazy(() => import('./forms/LoginForm')),
  signup: lazy(() => import('./forms/SignupForm')),
  checkout: lazy(() => import('./forms/CheckoutForm')),
  contact: lazy(() => import('./forms/ContactForm')),
  // ... 16 more forms
};

function FormRouter({ formId }: { formId: string }) {
  const FormComponent = forms[formId] || forms.login;

  return (
    <Suspense fallback={<FormSkeleton />}>
      <FormComponent onSubmit={(data) => console.log('Submit:', data)} />
    </Suspense>
  );
}
```

### Form Standardization

All 41 implementations follow the same interface:

```typescript
// Shared interface across all libraries
interface LoginFormProps {
  onSubmit: (data: { email: string; password: string }) => void;
}

// MUI implementation
function LoginForm({ onSubmit }: LoginFormProps) {
  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <TextField
        label="Email address"
        type="email"
        required
        fullWidth
        margin="normal"
      />
      <TextField
        label="Password"
        type="password"
        required
        fullWidth
        margin="normal"
      />
      <Button type="submit" variant="contained" fullWidth>
        Sign in
      </Button>
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
      <FormControl isRequired mt={4}>
        <FormLabel>Password</FormLabel>
        <Input type="password" />
      </FormControl>
      <Button type="submit" colorScheme="blue" width="100%" mt={6}>
        Sign in
      </Button>
    </form>
  );
}
```

## Deep Dive: Control Panel Components

### Form Selector

```tsx
// components/FormSelector.tsx
function FormSelector() {
  const selectedForm = useComparisonStore(state => state.selectedForm);
  const setForm = useComparisonStore(state => state.setForm);
  const forms = useComparisonStore(state => state.forms);

  return (
    <div className="relative">
      <label htmlFor="form-select" className="block text-sm font-medium text-gray-700 mb-1">
        Form Type
      </label>
      <select
        id="form-select"
        value={selectedForm}
        onChange={(e) => setForm(e.target.value)}
        className="w-full p-2 border rounded-md bg-white focus:ring-2 focus:ring-blue-500"
      >
        {forms.map(form => (
          <option key={form.id} value={form.id}>
            {form.name}
          </option>
        ))}
      </select>
    </div>
  );
}
```

### Library Multi-Select

```tsx
// components/LibrarySelector.tsx
function LibrarySelector() {
  const libraries = useComparisonStore(state => state.libraries);
  const selectedLibraries = useComparisonStore(state => state.selectedLibraries);
  const toggleLibrary = useComparisonStore(state => state.toggleLibrary);
  const selectAll = useComparisonStore(state => state.selectAllLibraries);
  const clearAll = useComparisonStore(state => state.clearAllLibraries);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700">
          Libraries ({selectedLibraries.size} selected)
        </label>
        <div className="space-x-2">
          <button
            onClick={selectAll}
            className="text-xs text-blue-600 hover:underline"
          >
            Select All
          </button>
          <button
            onClick={clearAll}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border rounded-md">
        {libraries.map(library => (
          <button
            key={library.id}
            onClick={() => toggleLibrary(library.id)}
            className={cn(
              'px-3 py-1 text-sm rounded-full border transition-colors',
              selectedLibraries.has(library.id)
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
            )}
          >
            {library.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Theme Toggle

```tsx
// components/ThemeToggle.tsx
function ThemeToggle() {
  const theme = useComparisonStore(state => state.theme);
  const toggleTheme = useComparisonStore(state => state.toggleTheme);

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg border hover:bg-gray-50 transition-colors"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <MoonIcon className="w-5 h-5" />
      ) : (
        <SunIcon className="w-5 h-5" />
      )}
    </button>
  );
}
```

## Performance Optimizations

### 1. Selective Store Subscriptions

```tsx
// Only re-render when specific slice changes
function FormSelector() {
  // Only subscribes to selectedForm, not entire store
  const selectedForm = useComparisonStore(state => state.selectedForm);
  // ...
}
```

### 2. Iframe Caching

```tsx
// Keep iframes in DOM but hide when not selected
function PreviewGrid() {
  const allLibraries = useComparisonStore(state => state.libraries);
  const selectedIds = useComparisonStore(state => state.selectedLibraries);

  return (
    <div className="grid">
      {allLibraries.map(library => (
        <div
          key={library.id}
          className={selectedIds.has(library.id) ? 'block' : 'hidden'}
        >
          <PreviewCard library={library} />
        </div>
      ))}
    </div>
  );
}
```

### 3. Debounced URL Updates

```tsx
// Debounce URL updates to prevent history spam
function useUrlSync() {
  const { selectedForm, selectedLibraries, theme } = useComparisonStore();

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

## Accessibility (a11y)

### Semantic Structure

```tsx
<main role="application" aria-label="Design System Comparison">
  <header>
    <nav aria-label="Comparison controls">
      {/* Form selector, library selector, theme toggle */}
    </nav>
  </header>

  <section aria-label="Form previews">
    <div role="grid" aria-label="Library comparison grid">
      {libraries.map(lib => (
        <article
          key={lib.id}
          role="gridcell"
          aria-label={`${lib.name} form preview`}
        >
          <iframe title={`${lib.name} ${formName} form`} />
        </article>
      ))}
    </div>
  </section>
</main>
```

### Keyboard Navigation

```tsx
function useKeyboardNav() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Skip if in form input
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case 't':
          toggleTheme();
          break;
        case 'a':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            selectAllLibraries();
          }
          break;
        case 'Escape':
          clearAllLibraries();
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Iframe isolation | Complete CSS isolation | Heavier than shared app |
| Lazy loading iframes | Fast initial load | Scroll jank possible |
| URL query params | Deep linking, history | Limited to simple data |
| Zustand with persistence | Survives refresh | Storage sync complexity |
| CSS Grid layout | Responsive, flexible | IE11 not supported |
| Separate React apps per library | Clean isolation | Duplicated React bundles |

## Future Frontend Enhancements

1. **Drag & Drop Ordering**: Rearrange libraries in comparison view
2. **Side-by-Side Diff View**: Highlight visual differences between libraries
3. **Screenshot Export**: Generate comparison image for sharing
4. **Mobile Preview**: Show how forms look at mobile breakpoints
5. **Accessibility Audit**: Display WCAG compliance per library
6. **Animation Comparison**: Show transition/animation behavior differences
