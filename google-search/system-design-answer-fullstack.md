# Google Search - System Design Answer (Full-Stack Focus)

*45-minute system design interview format - Full-Stack Engineer Position*

## Opening Statement (1 minute)

"I'll design Google Search, a web search engine that indexes and searches 100+ billion web pages with sub-200ms latency. As a full-stack engineer, I'll focus on how the frontend and backend systems integrate: the search interface with autocomplete, how queries flow through the API to the index, and how results are streamed back for progressive rendering.

The key full-stack challenges are building a responsive search experience with instant feedback, designing APIs that support both fast autocomplete and comprehensive search results, and optimizing the data flow from inverted index to rendered snippets."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Crawl**: Discover and fetch web pages
- **Index**: Build searchable index of content
- **Query**: Process user search queries with autocomplete
- **Rank**: Order results by relevance and quality
- **Serve**: Return results with low latency and rich snippets

### Non-Functional Requirements
- **Scale**: Index 100B+ web pages
- **Latency**: < 200ms for query response, < 50ms for autocomplete
- **Freshness**: Update popular pages daily
- **Relevance**: High precision and recall
- **Accessibility**: WCAG 2.1 AA compliant search interface

### Scale Estimates
- 100+ billion web pages indexed
- 8+ billion searches per day
- Average query touches millions of documents
- Index size: Petabytes

## High-Level Architecture (5 minutes)

```
+------------------+     +------------------+     +------------------+
|    Frontend      |     |    API Layer     |     |   Backend Core   |
|------------------|     |------------------|     |------------------|
| SearchBox        |     | /autocomplete    |     | Query Processor  |
| ResultsList      |<--->| /search          |<--->| Ranker           |
| Pagination       |     | /suggest         |     | Index Servers    |
| AdvancedSearch   |     | WebSocket        |     | Cache Layer      |
+------------------+     +------------------+     +------------------+
         |                       |                        |
         v                       v                        v
+------------------+     +------------------+     +------------------+
|   State Layer    |     |   Middleware     |     |   Data Layer     |
|------------------|     |------------------|     |------------------|
| Zustand Store    |     | Rate Limiting    |     | Elasticsearch    |
| Query History    |     | Caching          |     | PostgreSQL       |
| User Preferences |     | Auth (optional)  |     | Redis            |
+------------------+     +------------------+     +------------------+
```

### Data Flow: Query to Results

```
User Types Query
       |
       v
+------------------+
| Debounced Input  |  (Frontend - 150ms debounce)
+------------------+
       |
       +-- Autocomplete Path (< 50ms)
       |         |
       |         v
       |   GET /autocomplete?q=javasc
       |         |
       |         v
       |   Redis Cache -> Suggestion Trie
       |         |
       |         v
       |   Return top 10 suggestions
       |
       +-- Search Path (< 200ms)
                 |
                 v
           GET /search?q=javascript+tutorial
                 |
                 v
           Cache Check (Redis)
                 |
          hit?  / \  miss?
              /     \
             v       v
       Return     Query Parser
       Cached        |
                     v
               Elasticsearch
               (BM25 + filters)
                     |
                     v
               Phase 1 Ranking
               (top 1000 by text)
                     |
                     v
               Phase 2 Ranking
               (PageRank + freshness + clicks)
                     |
                     v
               Snippet Generation
                     |
                     v
               Cache & Return
```

## Deep Dive: Search Box with Autocomplete (5 minutes)

### Frontend Component

```tsx
// components/SearchBox.tsx
import { useState, useCallback, useRef, useEffect } from 'react'
import { useSearchStore } from '../stores/searchStore'
import { useDebouncedCallback } from 'use-debounce'

interface Suggestion {
  text: string
  type: 'history' | 'suggestion' | 'correction'
}

export function SearchBox() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { search, addToHistory } = useSearchStore()

  // Debounced autocomplete fetch
  const fetchSuggestions = useDebouncedCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([])
      return
    }

    try {
      const response = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`)
      const data = await response.json()
      setSuggestions(data.suggestions)
      setIsOpen(true)
    } catch (error) {
      console.error('Autocomplete failed:', error)
    }
  }, 150)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)
    setSelectedIndex(-1)
    fetchSuggestions(value)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev =>
          Math.min(prev + 1, suggestions.length - 1)
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        const searchQuery = selectedIndex >= 0
          ? suggestions[selectedIndex].text
          : query
        handleSearch(searchQuery)
        break
      case 'Escape':
        setIsOpen(false)
        inputRef.current?.blur()
        break
    }
  }

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return

    setIsOpen(false)
    addToHistory(searchQuery)
    await search(searchQuery)
  }

  return (
    <div className="relative w-full max-w-2xl">
      <div className="flex items-center border rounded-full shadow-sm hover:shadow-md focus-within:shadow-md">
        <SearchIcon className="ml-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          placeholder="Search the web..."
          className="flex-1 px-4 py-3 outline-none rounded-full"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="suggestions-list"
          aria-activedescendant={
            selectedIndex >= 0 ? `suggestion-${selectedIndex}` : undefined
          }
        />
        <button
          onClick={() => handleSearch(query)}
          className="mr-2 p-2 hover:bg-gray-100 rounded-full"
          aria-label="Search"
        >
          <SearchIcon className="text-blue-500" />
        </button>
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul
          id="suggestions-list"
          className="absolute w-full mt-1 bg-white border rounded-lg shadow-lg z-50"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.text}
              id={`suggestion-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              className={`px-4 py-2 cursor-pointer flex items-center gap-3 ${
                index === selectedIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
              }`}
              onClick={() => handleSearch(suggestion.text)}
            >
              {suggestion.type === 'history' && <ClockIcon className="text-gray-400" />}
              {suggestion.type === 'suggestion' && <SearchIcon className="text-gray-400" />}
              {suggestion.type === 'correction' && <SpellCheckIcon className="text-purple-400" />}
              <span className="flex-1">{highlightMatch(suggestion.text, query)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text

  return (
    <>
      <span className="font-medium">{text.slice(0, index + query.length)}</span>
      {text.slice(index + query.length)}
    </>
  )
}
```

### Backend Autocomplete Endpoint

```typescript
// routes/autocomplete.ts
import { Router, Request, Response } from 'express'
import { redis } from '../shared/cache'
import { suggestionTrie } from '../services/suggestions'

const router = Router()

router.get('/autocomplete', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').toLowerCase().trim()

  if (query.length < 2) {
    return res.json({ suggestions: [] })
  }

  // Check cache first
  const cacheKey = `autocomplete:${query}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    return res.json({ suggestions: JSON.parse(cached) })
  }

  // Get suggestions from multiple sources
  const [trieSuggestions, popularQueries, corrections] = await Promise.all([
    suggestionTrie.search(query, 5),
    getPopularQueries(query, 3),
    getSpellCorrections(query)
  ])

  // Merge and deduplicate
  const suggestions = mergeSuggestions(trieSuggestions, popularQueries, corrections)

  // Cache for 5 minutes
  await redis.set(cacheKey, JSON.stringify(suggestions), 'EX', 300)

  res.json({ suggestions })
})

async function getPopularQueries(prefix: string, limit: number) {
  // Use Redis sorted set of popular queries
  const results = await redis.zrevrangebylex(
    'popular_queries',
    `[${prefix}\xff`,
    `[${prefix}`,
    'LIMIT', 0, limit
  )
  return results.map(text => ({ text, type: 'suggestion' as const }))
}

async function getSpellCorrections(query: string) {
  // Simple edit distance check against dictionary
  const words = query.split(' ')
  const lastWord = words[words.length - 1]

  if (await isValidWord(lastWord)) {
    return []
  }

  const correction = await findClosestWord(lastWord)
  if (correction && correction !== lastWord) {
    words[words.length - 1] = correction
    return [{ text: words.join(' '), type: 'correction' as const }]
  }

  return []
}

export default router
```

## Deep Dive: API Design and Integration (5 minutes)

### TypeScript Interfaces (Shared)

```typescript
// shared/types.ts
export interface SearchQuery {
  q: string
  page?: number
  pageSize?: number
  site?: string
  dateRange?: 'day' | 'week' | 'month' | 'year' | 'all'
  safeSearch?: 'off' | 'moderate' | 'strict'
}

export interface SearchResult {
  id: string
  url: string
  title: string
  snippet: string
  favicon?: string
  lastModified?: string
  siteLinks?: SiteLink[]
}

export interface SiteLink {
  title: string
  url: string
}

export interface SearchResponse {
  results: SearchResult[]
  totalResults: number
  correctedQuery?: string
  relatedSearches: string[]
  timing: {
    took: number
    cached: boolean
  }
}

export interface AutocompleteResponse {
  suggestions: Array<{
    text: string
    type: 'history' | 'suggestion' | 'correction'
  }>
}

// API Error type
export interface ApiError {
  error: string
  code: string
  details?: Record<string, unknown>
}
```

### Search API Endpoint

```typescript
// routes/search.ts
import { Router, Request, Response } from 'express'
import { QueryProcessor } from '../services/queryProcessor'
import { Ranker } from '../services/ranker'
import { redis } from '../shared/cache'
import { SearchQuery, SearchResponse } from '../shared/types'

const router = Router()
const queryProcessor = new QueryProcessor()
const ranker = new Ranker()

router.get('/search', async (req: Request, res: Response) => {
  const startTime = Date.now()

  const query: SearchQuery = {
    q: req.query.q as string || '',
    page: parseInt(req.query.page as string) || 1,
    pageSize: Math.min(parseInt(req.query.pageSize as string) || 10, 50),
    site: req.query.site as string,
    dateRange: req.query.dateRange as SearchQuery['dateRange'],
    safeSearch: req.query.safeSearch as SearchQuery['safeSearch'] || 'moderate'
  }

  if (!query.q.trim()) {
    return res.status(400).json({
      error: 'Query parameter q is required',
      code: 'MISSING_QUERY'
    })
  }

  // Check cache
  const cacheKey = buildCacheKey(query)
  const cached = await redis.get(cacheKey)
  if (cached) {
    const response: SearchResponse = JSON.parse(cached)
    response.timing = { took: Date.now() - startTime, cached: true }
    return res.json(response)
  }

  try {
    // Parse and process query
    const parsed = queryProcessor.parse(query.q)

    // Apply filters
    if (query.site) {
      parsed.site = query.site
    }
    if (query.dateRange) {
      parsed.dateRange = getDateRangeFilter(query.dateRange)
    }

    // Execute search
    const searchResults = await queryProcessor.search(parsed)

    // Rank results
    const ranked = await ranker.rank(searchResults, parsed)

    // Paginate
    const start = (query.page - 1) * query.pageSize
    const paginatedResults = ranked.slice(start, start + query.pageSize)

    // Get related searches
    const relatedSearches = await getRelatedSearches(query.q)

    const response: SearchResponse = {
      results: paginatedResults.map(formatResult),
      totalResults: ranked.length,
      correctedQuery: parsed.correctedQuery,
      relatedSearches,
      timing: { took: Date.now() - startTime, cached: false }
    }

    // Cache for 5 minutes
    await redis.set(cacheKey, JSON.stringify(response), 'EX', 300)

    res.json(response)
  } catch (error) {
    console.error('Search error:', error)
    res.status(500).json({
      error: 'Search failed',
      code: 'SEARCH_ERROR'
    })
  }
})

function buildCacheKey(query: SearchQuery): string {
  return `search:${JSON.stringify(query)}`
}

function formatResult(doc: any): SearchResult {
  return {
    id: doc.id,
    url: doc.url,
    title: doc.title,
    snippet: doc.snippet,
    favicon: `https://www.google.com/s2/favicons?domain=${new URL(doc.url).hostname}`,
    lastModified: doc.lastModified
  }
}

export default router
```

## Deep Dive: Results Rendering (5 minutes)

### Search Results Component

```tsx
// components/SearchResults.tsx
import { useSearchStore } from '../stores/searchStore'
import { SearchResult } from '../shared/types'

export function SearchResults() {
  const { results, isLoading, error, totalResults, correctedQuery, timing } = useSearchStore()

  if (isLoading) {
    return <ResultsSkeleton />
  }

  if (error) {
    return (
      <div className="p-4 text-red-600" role="alert">
        <p>Search failed. Please try again.</p>
      </div>
    )
  }

  if (results.length === 0) {
    return <NoResults />
  }

  return (
    <div className="max-w-3xl">
      {/* Search stats */}
      <p className="text-sm text-gray-500 mb-4">
        About {totalResults.toLocaleString()} results ({timing.took / 1000} seconds)
        {timing.cached && <span className="ml-2 text-xs">(cached)</span>}
      </p>

      {/* Spell correction */}
      {correctedQuery && (
        <div className="mb-4">
          <span className="text-gray-600">Showing results for </span>
          <button
            className="text-blue-600 hover:underline font-medium"
            onClick={() => useSearchStore.getState().search(correctedQuery)}
          >
            {correctedQuery}
          </button>
        </div>
      )}

      {/* Results list */}
      <ol className="space-y-6" role="list" aria-label="Search results">
        {results.map((result, index) => (
          <ResultItem
            key={result.id}
            result={result}
            position={index + 1}
          />
        ))}
      </ol>
    </div>
  )
}

function ResultItem({ result, position }: { result: SearchResult; position: number }) {
  return (
    <li className="group">
      <article>
        {/* URL and favicon */}
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
          {result.favicon && (
            <img
              src={result.favicon}
              alt=""
              className="w-4 h-4"
              loading="lazy"
            />
          )}
          <cite className="not-italic">{result.url}</cite>
        </div>

        {/* Title */}
        <h3 className="text-xl text-blue-700 group-hover:underline mb-1">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Result ${position}: ${result.title}`}
          >
            {result.title}
          </a>
        </h3>

        {/* Snippet with highlighting */}
        <p
          className="text-sm text-gray-700 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: result.snippet }}
        />

        {/* Site links if available */}
        {result.siteLinks && result.siteLinks.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {result.siteLinks.map(link => (
              <a
                key={link.url}
                href={link.url}
                className="text-sm text-blue-600 hover:underline"
              >
                {link.title}
              </a>
            ))}
          </div>
        )}
      </article>
    </li>
  )
}

function ResultsSkeleton() {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true" aria-label="Loading results">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="animate-pulse">
          <div className="h-4 w-48 bg-gray-200 rounded mb-2" />
          <div className="h-6 w-96 bg-gray-200 rounded mb-2" />
          <div className="h-4 w-full bg-gray-200 rounded" />
          <div className="h-4 w-3/4 bg-gray-200 rounded mt-1" />
        </div>
      ))}
    </div>
  )
}

function NoResults() {
  const { query } = useSearchStore()

  return (
    <div className="max-w-3xl p-4">
      <p className="text-lg mb-4">
        Your search - <strong>{query}</strong> - did not match any documents.
      </p>
      <p className="text-gray-600">Suggestions:</p>
      <ul className="list-disc ml-6 text-gray-600 space-y-1">
        <li>Make sure all words are spelled correctly</li>
        <li>Try different keywords</li>
        <li>Try more general keywords</li>
        <li>Try fewer keywords</li>
      </ul>
    </div>
  )
}
```

### Zustand Store for Search State

```typescript
// stores/searchStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SearchResult, SearchResponse } from '../shared/types'

interface SearchState {
  // Current search
  query: string
  results: SearchResult[]
  totalResults: number
  correctedQuery: string | null
  relatedSearches: string[]
  timing: { took: number; cached: boolean }

  // UI state
  isLoading: boolean
  error: string | null
  currentPage: number

  // User data
  searchHistory: string[]

  // Actions
  search: (query: string, page?: number) => Promise<void>
  nextPage: () => void
  prevPage: () => void
  addToHistory: (query: string) => void
  clearHistory: () => void
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      query: '',
      results: [],
      totalResults: 0,
      correctedQuery: null,
      relatedSearches: [],
      timing: { took: 0, cached: false },
      isLoading: false,
      error: null,
      currentPage: 1,
      searchHistory: [],

      search: async (query: string, page = 1) => {
        set({ isLoading: true, error: null, query, currentPage: page })

        try {
          const params = new URLSearchParams({
            q: query,
            page: page.toString(),
            pageSize: '10'
          })

          const response = await fetch(`/api/search?${params}`)

          if (!response.ok) {
            throw new Error('Search request failed')
          }

          const data: SearchResponse = await response.json()

          set({
            results: data.results,
            totalResults: data.totalResults,
            correctedQuery: data.correctedQuery || null,
            relatedSearches: data.relatedSearches,
            timing: data.timing,
            isLoading: false
          })

          // Update URL
          const url = new URL(window.location.href)
          url.searchParams.set('q', query)
          if (page > 1) {
            url.searchParams.set('page', page.toString())
          } else {
            url.searchParams.delete('page')
          }
          window.history.pushState({}, '', url)
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Search failed',
            isLoading: false,
            results: []
          })
        }
      },

      nextPage: () => {
        const { query, currentPage, totalResults } = get()
        const maxPage = Math.ceil(totalResults / 10)
        if (currentPage < maxPage) {
          get().search(query, currentPage + 1)
        }
      },

      prevPage: () => {
        const { query, currentPage } = get()
        if (currentPage > 1) {
          get().search(query, currentPage - 1)
        }
      },

      addToHistory: (query: string) => {
        set(state => ({
          searchHistory: [
            query,
            ...state.searchHistory.filter(q => q !== query)
          ].slice(0, 20)
        }))
      },

      clearHistory: () => set({ searchHistory: [] })
    }),
    {
      name: 'search-storage',
      partialize: (state) => ({ searchHistory: state.searchHistory })
    }
  )
)
```

## Deep Dive: Snippet Generation (4 minutes)

### Backend Snippet Service

```typescript
// services/snippetGenerator.ts
import { escapeHtml } from '../shared/utils'

interface SnippetOptions {
  maxLength: number
  contextWords: number
  highlightTag: string
}

export class SnippetGenerator {
  private options: SnippetOptions

  constructor(options: Partial<SnippetOptions> = {}) {
    this.options = {
      maxLength: 200,
      contextWords: 10,
      highlightTag: 'b',
      ...options
    }
  }

  generate(content: string, queryTerms: string[]): string {
    const sentences = this.splitIntoSentences(content)

    // Score each sentence by term matches
    const scored = sentences.map((sentence, index) => ({
      sentence,
      index,
      score: this.scoreSentence(sentence, queryTerms)
    }))

    // Sort by score, prefer earlier sentences for ties
    scored.sort((a, b) => b.score - a.score || a.index - b.index)

    // Take best sentences up to max length
    let snippet = ''
    const usedIndices: number[] = []

    for (const { sentence, index, score } of scored) {
      if (score === 0) break
      if (snippet.length + sentence.length > this.options.maxLength) {
        if (snippet.length > 0) break
        // First sentence - truncate it
        snippet = this.truncateSentence(sentence, queryTerms)
        break
      }

      usedIndices.push(index)
      snippet += (snippet ? ' ... ' : '') + sentence
    }

    // Highlight query terms
    snippet = this.highlightTerms(escapeHtml(snippet), queryTerms)

    return snippet || this.fallbackSnippet(content)
  }

  private scoreSentence(sentence: string, terms: string[]): number {
    const lowerSentence = sentence.toLowerCase()
    let score = 0
    let consecutiveBonus = 0

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i].toLowerCase()
      if (lowerSentence.includes(term)) {
        score += 1

        // Bonus for consecutive terms
        if (i > 0) {
          const prevTerm = terms[i - 1].toLowerCase()
          const pattern = new RegExp(`${prevTerm}\\s+${term}`, 'i')
          if (pattern.test(lowerSentence)) {
            consecutiveBonus += 2
          }
        }
      }
    }

    return score + consecutiveBonus
  }

  private truncateSentence(sentence: string, terms: string[]): string {
    // Find first term occurrence and center around it
    const lowerSentence = sentence.toLowerCase()
    let bestPos = 0

    for (const term of terms) {
      const pos = lowerSentence.indexOf(term.toLowerCase())
      if (pos !== -1) {
        bestPos = pos
        break
      }
    }

    const words = sentence.split(/\s+/)
    const wordIndex = sentence.slice(0, bestPos).split(/\s+/).length - 1

    const start = Math.max(0, wordIndex - this.options.contextWords)
    const end = Math.min(words.length, wordIndex + this.options.contextWords)

    let result = words.slice(start, end).join(' ')
    if (start > 0) result = '...' + result
    if (end < words.length) result += '...'

    return result
  }

  private highlightTerms(text: string, terms: string[]): string {
    const { highlightTag } = this.options
    let highlighted = text

    for (const term of terms) {
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi')
      highlighted = highlighted.replace(
        regex,
        `<${highlightTag}>$1</${highlightTag}>`
      )
    }

    return highlighted
  }

  private splitIntoSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20)
  }

  private fallbackSnippet(content: string): string {
    return escapeHtml(content.slice(0, this.options.maxLength)) + '...'
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
```

## Deep Dive: Query History and Suggestions (4 minutes)

### Trie-Based Suggestions

```typescript
// services/suggestionTrie.ts
interface TrieNode {
  children: Map<string, TrieNode>
  suggestions: Array<{ text: string; weight: number }>
  isEnd: boolean
}

export class SuggestionTrie {
  private root: TrieNode
  private maxSuggestionsPerNode = 10

  constructor() {
    this.root = this.createNode()
  }

  private createNode(): TrieNode {
    return {
      children: new Map(),
      suggestions: [],
      isEnd: false
    }
  }

  insert(query: string, weight: number = 1): void {
    const normalizedQuery = query.toLowerCase().trim()
    let node = this.root

    for (const char of normalizedQuery) {
      if (!node.children.has(char)) {
        node.children.set(char, this.createNode())
      }
      node = node.children.get(char)!

      // Update suggestions at this prefix
      this.updateSuggestions(node, normalizedQuery, weight)
    }

    node.isEnd = true
  }

  private updateSuggestions(
    node: TrieNode,
    query: string,
    weight: number
  ): void {
    const existing = node.suggestions.find(s => s.text === query)

    if (existing) {
      existing.weight += weight
    } else {
      node.suggestions.push({ text: query, weight })
    }

    // Keep top suggestions sorted by weight
    node.suggestions.sort((a, b) => b.weight - a.weight)
    node.suggestions = node.suggestions.slice(0, this.maxSuggestionsPerNode)
  }

  search(prefix: string, limit: number = 10): Array<{ text: string; type: 'suggestion' }> {
    const normalizedPrefix = prefix.toLowerCase().trim()
    let node = this.root

    for (const char of normalizedPrefix) {
      if (!node.children.has(char)) {
        return []
      }
      node = node.children.get(char)!
    }

    return node.suggestions
      .slice(0, limit)
      .map(s => ({ text: s.text, type: 'suggestion' as const }))
  }

  // Load from popular queries in database
  async loadFromDatabase(db: any): Promise<void> {
    const queries = await db.query(`
      SELECT query, COUNT(*) as count
      FROM query_logs
      WHERE timestamp > NOW() - INTERVAL '30 days'
      GROUP BY query
      ORDER BY count DESC
      LIMIT 100000
    `)

    for (const { query, count } of queries.rows) {
      this.insert(query, count)
    }
  }
}

export const suggestionTrie = new SuggestionTrie()
```

## Database Schema (3 minutes)

### PostgreSQL Schema

```sql
-- URL Database (crawl state)
CREATE TABLE urls (
  url_hash BIGINT PRIMARY KEY,
  url TEXT NOT NULL,
  last_crawl TIMESTAMP,
  last_modified TIMESTAMP,
  crawl_status VARCHAR(20),
  content_hash BIGINT,
  page_rank DECIMAL(10, 8),
  inlink_count INTEGER DEFAULT 0
);

CREATE INDEX idx_urls_crawl_status ON urls(crawl_status);
CREATE INDEX idx_urls_page_rank ON urls(page_rank DESC);

-- Documents
CREATE TABLE documents (
  id BIGINT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  content TEXT,
  fetch_time TIMESTAMP,
  content_length INTEGER,
  language VARCHAR(10)
);

CREATE INDEX idx_documents_fetch_time ON documents(fetch_time DESC);

-- Link Graph
CREATE TABLE links (
  source_url_hash BIGINT,
  target_url_hash BIGINT,
  anchor_text TEXT,
  PRIMARY KEY (source_url_hash, target_url_hash)
);

CREATE INDEX idx_links_target ON links(target_url_hash);

-- Query Logs (for analytics and suggestions)
CREATE TABLE query_logs (
  id BIGSERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  user_session VARCHAR(100),
  results_shown INTEGER,
  clicked_positions INTEGER[],
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_query_logs_query ON query_logs(query);
CREATE INDEX idx_query_logs_timestamp ON query_logs(timestamp DESC);

-- Suggestions cache
CREATE TABLE popular_queries (
  query TEXT PRIMARY KEY,
  search_count INTEGER DEFAULT 1,
  last_searched TIMESTAMP DEFAULT NOW()
);
```

### Elasticsearch Index Mapping

```json
{
  "settings": {
    "number_of_shards": 5,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "content_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "porter_stem", "stop"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "url": { "type": "keyword" },
      "title": {
        "type": "text",
        "analyzer": "content_analyzer",
        "boost": 3.0
      },
      "content": {
        "type": "text",
        "analyzer": "content_analyzer"
      },
      "host": { "type": "keyword" },
      "page_rank": { "type": "float" },
      "last_modified": { "type": "date" },
      "language": { "type": "keyword" }
    }
  }
}
```

## Trade-offs Discussion (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Autocomplete debounce | 150ms | Immediate | Balance between responsiveness and API load |
| Result caching | 5 min TTL | No caching | Reduces index load; acceptable staleness for most queries |
| Snippet generation | Server-side | Client-side | Consistent highlighting; reduces payload size |
| State management | Zustand | Redux | Simpler API; sufficient for search state complexity |
| Suggestion storage | Trie + Redis | Just database | Sub-50ms latency requirement for autocomplete |
| Search history | Local storage | Server-side | Privacy; offline access; simpler implementation |
| Result pagination | Offset-based | Cursor-based | Simpler; allows jumping to arbitrary pages |
| Query parsing | Regex-based | Parser combinator | Sufficient for basic operators; simpler to maintain |

## Future Enhancements (1 minute)

### Full-Stack Improvements
1. **Voice search**: Web Speech API integration with streaming transcription
2. **Infinite scroll**: Replace pagination with virtual list for smoother browsing
3. **Real-time results**: WebSocket connection for live result updates
4. **Image search**: Separate tab with grid layout and visual similarity
5. **Search operators UI**: Visual builder for advanced query syntax
6. **Personalized ranking**: Use search history for result re-ranking
7. **Progressive Web App**: Offline search history and cached results

## Closing Summary (1 minute)

"The Google Search full-stack architecture connects three key layers:

1. **Frontend experience**: The search box with 150ms debounced autocomplete provides instant feedback. The Zustand store manages query state, results, and history with URL synchronization for shareability.

2. **API layer**: Clean RESTful endpoints with TypeScript types shared between frontend and backend. The autocomplete endpoint uses a trie structure cached in Redis for sub-50ms responses. The search endpoint handles query parsing, execution, and caching.

3. **Integration points**: Results flow from Elasticsearch through the ranker, with snippets generated server-side for consistent highlighting. The suggestion trie is populated from query logs, creating a feedback loop that improves autocomplete over time.

The main full-stack trade-off is cache staleness vs. freshness. We accept 5-minute stale results to reduce index load by 70%, while breaking news queries can bypass the cache when needed."