# Google Search - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a web search engine that:
- Delivers instant search results with minimal perceived latency
- Provides autocomplete suggestions as users type
- Renders search result pages with snippets and highlights
- Supports advanced search syntax with visual feedback

## Requirements Clarification

### Functional Requirements
1. **Search Box**: Autocomplete with query suggestions
2. **Results Page**: Display ranked results with titles, URLs, snippets
3. **Query Highlighting**: Bold matched terms in snippets
4. **Advanced Search**: Support for phrases, exclusions, site filters
5. **Pagination**: Navigate through result pages

### Non-Functional Requirements
1. **Perceived Performance**: Results visible within 500ms of query submission
2. **Responsiveness**: Desktop, tablet, and mobile layouts
3. **Accessibility**: Screen reader support, keyboard navigation
4. **Offline Resilience**: Show cached results when offline

### UI/UX Requirements
- Clean, distraction-free interface
- Instant feedback on user actions
- Clear visual hierarchy for results
- Error states for failed searches

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        React Application                                 │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      TanStack Router                               │  │
│  │    /                → Home (Search Box)                           │  │
│  │    /search?q=       → Search Results                              │  │
│  │    /advanced        → Advanced Search Form                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Components                                     │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐  │   │
│  │  │  SearchBox     │  │  ResultsList   │  │  Pagination        │  │   │
│  │  │  - Input       │  │  - ResultCard  │  │  - PageNumbers     │  │   │
│  │  │  - Suggestions │  │  - Snippet     │  │  - Prev/Next       │  │   │
│  │  │  - History     │  │  - HighlightedText │                   │  │   │
│  │  └────────────────┘  └────────────────┘  └────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Zustand Store                                  │  │
│  │  query | results[] | suggestions[] | isLoading | page | error     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: Search Box with Autocomplete

### Component Architecture

```tsx
// components/SearchBox.tsx
function SearchBox() {
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isOpen, setIsOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Debounced suggestion fetching
  const debouncedFetch = useMemo(
    () => debounce(async (query: string) => {
      if (query.length < 2) {
        setSuggestions([])
        return
      }

      try {
        const results = await api.getSuggestions(query)
        setSuggestions(results)
        setIsOpen(true)
      } catch (error) {
        console.error('Failed to fetch suggestions:', error)
      }
    }, 150),
    []
  )

  useEffect(() => {
    debouncedFetch(inputValue)
    return () => debouncedFetch.cancel()
  }, [inputValue, debouncedFetch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        const query = selectedIndex >= 0
          ? suggestions[selectedIndex]
          : inputValue
        if (query.trim()) {
          navigate({ to: '/search', search: { q: query } })
        }
        break
      case 'Escape':
        setIsOpen(false)
        setSelectedIndex(-1)
        break
    }
  }

  return (
    <div className="relative w-full max-w-2xl">
      <div className="relative">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          className="w-full pl-12 pr-4 py-3 text-lg border rounded-full
                     shadow-sm hover:shadow-md focus:shadow-md
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search the web..."
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="suggestions-list"
          aria-activedescendant={
            selectedIndex >= 0 ? `suggestion-${selectedIndex}` : undefined
          }
        />
      </div>

      {/* Suggestions dropdown */}
      {isOpen && suggestions.length > 0 && (
        <ul
          id="suggestions-list"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-white
                     border rounded-lg shadow-lg overflow-hidden z-50"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              id={`suggestion-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              className={cn(
                'px-4 py-2 cursor-pointer flex items-center gap-3',
                index === selectedIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
              )}
              onClick={() => {
                navigate({ to: '/search', search: { q: suggestion } })
              }}
            >
              <SearchIcon className="w-4 h-4 text-gray-400" />
              <HighlightMatch text={suggestion} query={inputValue} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

### Debouncing Strategy

```typescript
// hooks/useDebounce.ts
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

// Alternative: debounce function
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout>

  const debounced = ((...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T & { cancel: () => void }

  debounced.cancel = () => clearTimeout(timeoutId)

  return debounced
}
```

### Why 150ms Debounce?

| Delay | Pros | Cons |
|-------|------|------|
| 50ms | Feels instant | Too many API calls |
| **150ms** | Good balance | Slight delay |
| 300ms | Fewer API calls | Noticeable lag |

**Decision**: 150ms provides responsive feel while reducing API calls by ~80% compared to no debouncing.

## Deep Dive: Search Results Rendering

### Results List Component

```tsx
// components/ResultsList.tsx
function ResultsList() {
  const { results, isLoading, error, query } = useSearchStore()

  if (isLoading) {
    return <ResultsSkeleton count={10} />
  }

  if (error) {
    return <SearchError error={error} query={query} />
  }

  if (results.length === 0) {
    return <NoResults query={query} />
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        About {formatNumber(results.total)} results
        ({results.latencyMs / 1000} seconds)
      </p>

      <ol className="space-y-8" aria-label="Search results">
        {results.items.map((result, index) => (
          <ResultCard
            key={result.id}
            result={result}
            query={query}
            position={index + 1}
          />
        ))}
      </ol>
    </div>
  )
}

function ResultCard({ result, query, position }: ResultCardProps) {
  return (
    <li className="max-w-2xl">
      {/* URL breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
        <img
          src={`https://www.google.com/s2/favicons?domain=${result.host}`}
          alt=""
          className="w-4 h-4"
          loading="lazy"
        />
        <span className="truncate">{result.displayUrl}</span>
      </div>

      {/* Title link */}
      <h3 className="text-xl">
        <a
          href={result.url}
          className="text-blue-700 hover:underline visited:text-purple-700"
          onClick={() => trackClick(result.id, query, position)}
        >
          <HighlightedText text={result.title} terms={query.split(' ')} />
        </a>
      </h3>

      {/* Snippet */}
      <p className="text-sm text-gray-700 mt-1 line-clamp-2">
        <HighlightedText text={result.snippet} terms={query.split(' ')} />
      </p>
    </li>
  )
}
```

### Snippet Highlighting

```tsx
// components/HighlightedText.tsx
interface HighlightedTextProps {
  text: string
  terms: string[]
}

function HighlightedText({ text, terms }: HighlightedTextProps) {
  if (!terms.length) return <>{text}</>

  // Build regex from terms (escape special chars)
  const pattern = terms
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  const regex = new RegExp(`(${pattern})`, 'gi')
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = terms.some(
          t => t.toLowerCase() === part.toLowerCase()
        )
        return isMatch ? (
          <mark key={i} className="bg-transparent font-semibold">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}
```

### Loading Skeleton

```tsx
function ResultsSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="max-w-2xl space-y-2">
          <div className="h-4 bg-gray-200 rounded w-48" />
          <div className="h-6 bg-gray-200 rounded w-96" />
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </div>
      ))}
    </div>
  )
}
```

## Deep Dive: State Management

### Search Store

```typescript
// stores/searchStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SearchState {
  query: string
  results: SearchResults | null
  isLoading: boolean
  error: Error | null
  page: number
  searchHistory: string[]

  // Actions
  setQuery: (query: string) => void
  search: (query: string, page?: number) => Promise<void>
  clearResults: () => void
  addToHistory: (query: string) => void
  clearHistory: () => void
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      query: '',
      results: null,
      isLoading: false,
      error: null,
      page: 1,
      searchHistory: [],

      setQuery: (query) => set({ query }),

      search: async (query, page = 1) => {
        set({ isLoading: true, error: null, query, page })

        try {
          const results = await api.search({ q: query, page })
          set({ results, isLoading: false })

          // Add to history
          get().addToHistory(query)
        } catch (error) {
          set({
            error: error as Error,
            isLoading: false,
            results: null
          })
        }
      },

      clearResults: () => set({ results: null, query: '' }),

      addToHistory: (query) => {
        const history = get().searchHistory
        const filtered = history.filter(h => h !== query)
        set({
          searchHistory: [query, ...filtered].slice(0, 10)
        })
      },

      clearHistory: () => set({ searchHistory: [] }),
    }),
    {
      name: 'search-history',
      partialize: (state) => ({ searchHistory: state.searchHistory }),
    }
  )
)
```

### URL-Driven Search

```tsx
// routes/search.tsx
import { createFileRoute, useSearch } from '@tanstack/react-router'

interface SearchParams {
  q: string
  page?: number
}

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: (search.q as string) || '',
    page: Number(search.page) || 1,
  }),
  component: SearchPage,
})

function SearchPage() {
  const { q, page } = useSearch({ from: '/search' })
  const { search, results, isLoading } = useSearchStore()

  // Trigger search when URL params change
  useEffect(() => {
    if (q) {
      search(q, page)
    }
  }, [q, page, search])

  return (
    <div className="min-h-screen">
      <SearchHeader />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <ResultsList />
        {results && <Pagination totalPages={results.totalPages} />}
      </main>
    </div>
  )
}
```

## Deep Dive: Performance Optimizations

### 1. Virtualized Results (Long Lists)

```tsx
// For very long result lists (image search, infinite scroll)
import { useVirtualizer } from '@tanstack/react-virtual'

function VirtualizedResults() {
  const { results } = useSearchStore()
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: results?.items.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // Estimated height per result
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="h-[80vh] overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const result = results!.items[virtualRow.index]
          return (
            <div
              key={result.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ResultCard result={result} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

### 2. Prefetching Next Page

```tsx
function Pagination({ totalPages }: { totalPages: number }) {
  const { page } = useSearch({ from: '/search' })
  const navigate = useNavigate()

  // Prefetch next page on hover
  const prefetchNextPage = () => {
    if (page < totalPages) {
      const nextPageQuery = new URLSearchParams(window.location.search)
      nextPageQuery.set('page', String(page + 1))
      // Trigger prefetch via router or custom logic
      api.prefetchSearch(nextPageQuery.toString())
    }
  }

  return (
    <nav aria-label="Search results pagination" className="flex justify-center gap-2 mt-8">
      <button
        onClick={() => navigate({ search: { page: page - 1 } })}
        disabled={page === 1}
        className="px-4 py-2 border rounded disabled:opacity-50"
      >
        Previous
      </button>

      <span className="px-4 py-2">
        Page {page} of {totalPages}
      </span>

      <button
        onClick={() => navigate({ search: { page: page + 1 } })}
        onMouseEnter={prefetchNextPage}
        disabled={page === totalPages}
        className="px-4 py-2 border rounded disabled:opacity-50"
      >
        Next
      </button>
    </nav>
  )
}
```

### 3. Request Deduplication

```typescript
// services/api.ts
const inflightRequests = new Map<string, Promise<any>>()

async function fetchWithDedup<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key)!
  }

  const promise = fetcher().finally(() => {
    inflightRequests.delete(key)
  })

  inflightRequests.set(key, promise)
  return promise
}

export const api = {
  search: async (params: SearchParams) => {
    const key = `search:${JSON.stringify(params)}`
    return fetchWithDedup(key, () =>
      fetch(`/api/search?${new URLSearchParams(params as any)}`)
        .then(res => res.json())
    )
  },

  getSuggestions: async (query: string) => {
    const key = `suggest:${query}`
    return fetchWithDedup(key, () =>
      fetch(`/api/suggest?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
    )
  },
}
```

## Accessibility (a11y)

### ARIA Labels and Roles

```tsx
function SearchPage() {
  return (
    <div>
      <header role="banner">
        <SearchBox />
      </header>

      <main role="main" aria-live="polite">
        {isLoading && (
          <div role="status" aria-label="Loading search results">
            <ResultsSkeleton />
          </div>
        )}

        {results && (
          <section aria-label="Search results">
            <h1 className="sr-only">
              Search results for "{query}"
            </h1>
            <ResultsList />
          </section>
        )}
      </main>

      <nav aria-label="Pagination">
        <Pagination />
      </nav>
    </div>
  )
}
```

### Keyboard Navigation

```tsx
function useSearchKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Focus search box with /
      if (e.key === '/' && !isInputFocused()) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[role="combobox"]')?.focus()
      }

      // Navigate results with j/k
      if (e.key === 'j') {
        focusNextResult()
      }
      if (e.key === 'k') {
        focusPrevResult()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
}
```

## Responsive Design

### Mobile-First Layout

```tsx
function SearchHeader() {
  return (
    <header className="sticky top-0 bg-white border-b z-40">
      <div className="flex items-center gap-4 px-4 py-3
                      md:px-6 lg:px-8">
        {/* Logo - hidden on mobile during search */}
        <a href="/" className="hidden md:block">
          <Logo className="h-8" />
        </a>

        {/* Search box - full width on mobile */}
        <div className="flex-1 max-w-2xl">
          <SearchBox compact />
        </div>

        {/* Settings - icon only on mobile */}
        <button className="p-2 md:px-4 md:py-2">
          <SettingsIcon className="w-5 h-5 md:hidden" />
          <span className="hidden md:inline">Settings</span>
        </button>
      </div>
    </header>
  )
}
```

### Breakpoint Strategy

```css
/* tailwind.config.js */
module.exports = {
  theme: {
    screens: {
      'sm': '640px',   /* Mobile landscape */
      'md': '768px',   /* Tablet */
      'lg': '1024px',  /* Desktop */
      'xl': '1280px',  /* Wide desktop */
    }
  }
}
```

| Breakpoint | Layout Changes |
|------------|----------------|
| < 640px | Full-width search, stacked results |
| 640-768px | Side padding, compact header |
| 768-1024px | Fixed-width results, sidebar |
| > 1024px | Full desktop layout |

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| 150ms debounce | Reduces API calls | Slight typing lag |
| URL-driven search | Shareable links, back button | More complex state sync |
| Client-side highlighting | Fast rendering | May differ from server |
| History in localStorage | Persists across sessions | Privacy considerations |
| Skeleton loading | Better perceived perf | Extra UI complexity |

## Future Frontend Enhancements

1. **Voice Search**: Web Speech API for voice input
2. **Image Search**: Drag-and-drop image upload with preview
3. **Instant Answers**: Rich cards for calculations, definitions
4. **Dark Mode**: Theme toggle with system preference detection
5. **Offline Mode**: Service worker caching for recent searches
