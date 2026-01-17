# Design Spotlight - Architecture

## System Overview

Spotlight is a universal search system with on-device indexing and intelligent suggestions. Core challenges involve real-time indexing, content extraction, and privacy-preserving search.

**Learning Goals:**
- Build incremental indexing systems
- Design multi-source search ranking
- Implement content extraction pipelines
- Handle on-device ML for suggestions

---

## Requirements

### Functional Requirements

1. **Search**: Find files, apps, contacts, messages
2. **Index**: Real-time content indexing
3. **Suggest**: Proactive app and content suggestions
4. **Calculate**: Math, conversions, definitions
5. **Web**: Fall back to web search

### Non-Functional Requirements

- **Latency**: < 100ms for local results
- **Privacy**: All indexing on-device
- **Efficiency**: < 5% CPU during indexing
- **Storage**: Minimal index size

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Spotlight UI                                │
│              (Search bar, Results list, Previews)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Query Engine                                 │
│         (Parse, Route, Rank, Merge results)                    │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Local Index  │    │ App Providers │    │  Cloud Search │
│               │    │               │    │               │
│ - Files       │    │ - Contacts    │    │ - iCloud      │
│ - Apps        │    │ - Calendar    │    │ - Mail        │
│ - Messages    │    │ - Notes       │    │ - Safari      │
└───────────────┘    └───────────────┘    └───────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Indexing Service                             │
│       (File watcher, Content extraction, Tokenization)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Indexing Service

**Real-Time File Indexing:**
```javascript
class IndexingService {
  constructor() {
    this.index = new SearchIndex()
    this.contentExtractors = new Map()
    this.pendingQueue = []
    this.isIndexing = false
  }

  async initialize() {
    // Register content extractors
    this.registerExtractor('pdf', new PDFExtractor())
    this.registerExtractor('docx', new WordExtractor())
    this.registerExtractor('txt', new TextExtractor())
    this.registerExtractor('html', new HTMLExtractor())
    this.registerExtractor('image', new ImageMetadataExtractor())

    // Watch file system for changes
    this.fileWatcher = new FileWatcher({
      paths: ['/Users', '/Applications'],
      ignorePaths: ['Library/Caches', 'node_modules', '.git']
    })

    this.fileWatcher.on('created', (path) => this.queueForIndexing(path, 'add'))
    this.fileWatcher.on('modified', (path) => this.queueForIndexing(path, 'update'))
    this.fileWatcher.on('deleted', (path) => this.removeFromIndex(path))

    // Start background processing
    this.startBackgroundIndexing()
  }

  async queueForIndexing(path, action) {
    this.pendingQueue.push({ path, action, queuedAt: Date.now() })

    // Process immediately if not busy
    if (!this.isIndexing) {
      this.processQueue()
    }
  }

  async processQueue() {
    this.isIndexing = true

    while (this.pendingQueue.length > 0) {
      // Check system load before processing
      if (await this.isSystemBusy()) {
        await this.sleep(5000) // Wait 5 seconds
        continue
      }

      const item = this.pendingQueue.shift()
      await this.indexFile(item.path)

      // Yield to other processes
      await this.sleep(10)
    }

    this.isIndexing = false
  }

  async indexFile(path) {
    const stats = await fs.stat(path)

    // Skip large files
    if (stats.size > 50 * 1024 * 1024) return // > 50MB

    // Get file extension
    const ext = this.getExtension(path)
    const extractor = this.contentExtractors.get(ext) || this.contentExtractors.get('txt')

    try {
      // Extract content
      const content = await extractor.extract(path)

      // Tokenize
      const tokens = this.tokenize(content.text)

      // Create index entry
      const entry = {
        path,
        name: content.name || path.split('/').pop(),
        type: content.type || 'file',
        content: tokens,
        metadata: content.metadata || {},
        modifiedAt: stats.mtime,
        size: stats.size
      }

      // Add to index
      await this.index.upsert(path, entry)

    } catch (error) {
      console.error(`Failed to index ${path}:`, error)
    }
  }

  tokenize(text) {
    if (!text) return []

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1)
      .slice(0, 10000) // Limit tokens per file
  }
}
```

### 2. Search Index

**Inverted Index with Prefix Support:**
```javascript
class SearchIndex {
  constructor() {
    this.invertedIndex = new Map() // term -> Set<docId>
    this.documents = new Map() // docId -> document
    this.prefixIndex = new Trie() // For prefix matching
  }

  async upsert(docId, document) {
    // Remove old entry if exists
    await this.remove(docId)

    // Store document
    this.documents.set(docId, document)

    // Index each token
    for (const token of document.content) {
      // Full term index
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set())
      }
      this.invertedIndex.get(token).add(docId)

      // Prefix index (for typeahead)
      this.prefixIndex.insert(token, docId)
    }

    // Index name specially (higher weight)
    const nameTokens = document.name.toLowerCase().split(/[\s._-]+/)
    for (const token of nameTokens) {
      this.prefixIndex.insert(token, docId)
    }
  }

  async remove(docId) {
    const doc = this.documents.get(docId)
    if (!doc) return

    // Remove from inverted index
    for (const token of doc.content) {
      const docSet = this.invertedIndex.get(token)
      if (docSet) {
        docSet.delete(docId)
        if (docSet.size === 0) {
          this.invertedIndex.delete(token)
        }
      }
    }

    // Remove from prefix index
    this.prefixIndex.removeDoc(docId)

    // Remove document
    this.documents.delete(docId)
  }

  async search(query, options = {}) {
    const { limit = 20, types = null } = options
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0)

    if (tokens.length === 0) return []

    // Get matching docs for each token
    const matchingSets = tokens.map(token => {
      // Check for prefix match (last token)
      if (token === tokens[tokens.length - 1] && token.length < 4) {
        return this.prefixIndex.getDocsWithPrefix(token)
      }
      return this.invertedIndex.get(token) || new Set()
    })

    // Intersect for AND semantics
    let resultSet = matchingSets[0]
    for (let i = 1; i < matchingSets.length; i++) {
      resultSet = new Set([...resultSet].filter(x => matchingSets[i].has(x)))
    }

    // Get documents and score
    const results = []
    for (const docId of resultSet) {
      const doc = this.documents.get(docId)
      if (!doc) continue

      // Filter by type if specified
      if (types && !types.includes(doc.type)) continue

      const score = this.calculateScore(doc, tokens)
      results.push({ ...doc, score })
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, limit)
  }

  calculateScore(doc, queryTokens) {
    let score = 0

    // Name match is most important
    const nameLower = doc.name.toLowerCase()
    for (const token of queryTokens) {
      if (nameLower.includes(token)) {
        score += 10
        if (nameLower.startsWith(token)) {
          score += 5 // Prefix match bonus
        }
      }
    }

    // Recency boost
    const daysSinceModified = (Date.now() - doc.modifiedAt) / (24 * 60 * 60 * 1000)
    score += Math.max(0, 5 - daysSinceModified * 0.1)

    // Type boost (apps and contacts higher than random files)
    const typeBoost = {
      'application': 3,
      'contact': 2,
      'message': 2,
      'file': 1
    }
    score += typeBoost[doc.type] || 1

    return score
  }
}
```

### 3. Query Router

**Multi-Source Query Processing:**
```javascript
class QueryEngine {
  constructor() {
    this.localIndex = new SearchIndex()
    this.providers = new Map()
    this.specialHandlers = new Map()
  }

  async query(queryString, options = {}) {
    const parsedQuery = this.parseQuery(queryString)

    // Check for special queries first
    const specialResult = await this.handleSpecialQuery(parsedQuery)
    if (specialResult) {
      return specialResult
    }

    // Query all sources in parallel
    const [localResults, providerResults, cloudResults] = await Promise.all([
      this.localIndex.search(queryString, options),
      this.queryProviders(queryString),
      this.queryCloud(queryString)
    ])

    // Merge and rank
    const merged = this.mergeResults([
      ...localResults,
      ...providerResults,
      ...cloudResults
    ])

    // Add web search fallback
    if (merged.length < 3) {
      merged.push({
        type: 'web_search',
        name: `Search the web for "${queryString}"`,
        action: { type: 'open_url', url: `https://www.google.com/search?q=${encodeURIComponent(queryString)}` }
      })
    }

    return merged
  }

  parseQuery(queryString) {
    // Detect query type
    const query = {
      raw: queryString,
      tokens: queryString.toLowerCase().split(/\s+/),
      type: 'search'
    }

    // Math expression
    if (/^[\d\s+\-*/().%^]+$/.test(queryString)) {
      query.type = 'math'
      query.expression = queryString
    }

    // Unit conversion
    const conversionMatch = queryString.match(/^([\d.]+)\s*(\w+)\s+(?:to|in)\s+(\w+)$/i)
    if (conversionMatch) {
      query.type = 'conversion'
      query.value = parseFloat(conversionMatch[1])
      query.fromUnit = conversionMatch[2]
      query.toUnit = conversionMatch[3]
    }

    // Date query
    if (/photos?\s+from\s+/i.test(queryString)) {
      query.type = 'date_filter'
      query.dateFilter = this.parseDateFilter(queryString)
    }

    return query
  }

  async handleSpecialQuery(query) {
    if (query.type === 'math') {
      try {
        const result = this.safeEval(query.expression)
        return [{
          type: 'calculation',
          name: `${query.expression} = ${result}`,
          score: 100
        }]
      } catch (e) {
        return null
      }
    }

    if (query.type === 'conversion') {
      const result = this.convert(query.value, query.fromUnit, query.toUnit)
      if (result) {
        return [{
          type: 'conversion',
          name: `${query.value} ${query.fromUnit} = ${result.value} ${result.unit}`,
          score: 100
        }]
      }
    }

    return null
  }

  async queryProviders(queryString) {
    const results = []

    for (const [name, provider] of this.providers) {
      try {
        const providerResults = await provider.search(queryString)
        results.push(...providerResults)
      } catch (error) {
        console.error(`Provider ${name} failed:`, error)
      }
    }

    return results
  }

  mergeResults(results) {
    // Deduplicate by path/id
    const seen = new Set()
    const unique = []

    for (const result of results) {
      const key = result.path || result.id || result.name
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(result)
      }
    }

    // Sort by score
    unique.sort((a, b) => (b.score || 0) - (a.score || 0))

    return unique
  }
}
```

### 4. Siri Suggestions

**Proactive Intelligence:**
```javascript
class SiriSuggestions {
  constructor() {
    this.usagePatterns = new Map()
    this.timeOfDayPatterns = new Map()
  }

  async getSuggestions(context) {
    const { timeOfDay, location, recentActivity } = context
    const suggestions = []

    // Time-based app suggestions
    const timeApps = await this.getTimeBasedApps(timeOfDay)
    suggestions.push(...timeApps.map(app => ({
      type: 'app_suggestion',
      name: app.name,
      reason: 'Based on your routine',
      score: app.score
    })))

    // Location-based suggestions
    if (location) {
      const locationSuggestions = await this.getLocationSuggestions(location)
      suggestions.push(...locationSuggestions)
    }

    // Recent contacts (likely to contact)
    const frequentContacts = await this.getFrequentContacts()
    suggestions.push(...frequentContacts.slice(0, 4).map(contact => ({
      type: 'contact_suggestion',
      name: contact.name,
      reason: 'Frequently contacted',
      score: contact.score
    })))

    // Continue reading/watching
    const continueItems = await this.getContinueItems(recentActivity)
    suggestions.push(...continueItems)

    // Sort and return top suggestions
    suggestions.sort((a, b) => b.score - a.score)
    return suggestions.slice(0, 8)
  }

  async getTimeBasedApps(timeOfDay) {
    const hour = new Date().getHours()
    const dayOfWeek = new Date().getDay()

    // Get app usage patterns for this time
    const patterns = await this.getUsagePatterns()

    // Score apps based on historical usage at this time
    const scored = patterns.map(pattern => {
      const hourlyUsage = pattern.hourlyUsage[hour] || 0
      const dayUsage = pattern.dailyUsage[dayOfWeek] || 0

      return {
        name: pattern.appName,
        bundleId: pattern.bundleId,
        score: hourlyUsage * 0.6 + dayUsage * 0.4
      }
    })

    return scored.filter(s => s.score > 0.1).slice(0, 4)
  }

  async recordAppLaunch(bundleId, context) {
    const hour = new Date().getHours()
    const dayOfWeek = new Date().getDay()

    // Update usage patterns
    await db.query(`
      INSERT INTO app_usage_patterns
        (bundle_id, hour, day_of_week, count, last_used)
      VALUES ($1, $2, $3, 1, NOW())
      ON CONFLICT (bundle_id, hour, day_of_week)
      DO UPDATE SET count = app_usage_patterns.count + 1, last_used = NOW()
    `, [bundleId, hour, dayOfWeek])
  }
}
```

---

## Database Schema

```sql
-- File Index (on-device SQLite)
CREATE TABLE indexed_files (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  content_hash TEXT,
  tokens TEXT, -- JSON array of tokens
  metadata TEXT, -- JSON
  size INTEGER,
  modified_at INTEGER,
  indexed_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_files_name ON indexed_files(name);
CREATE INDEX idx_files_type ON indexed_files(type);

-- Inverted Index (on-device)
CREATE TABLE inverted_index (
  term TEXT,
  doc_path TEXT,
  position INTEGER,
  PRIMARY KEY (term, doc_path, position)
);

CREATE INDEX idx_inverted_term ON inverted_index(term);

-- App Usage Patterns (for Siri Suggestions)
CREATE TABLE app_usage_patterns (
  bundle_id TEXT,
  hour INTEGER,
  day_of_week INTEGER,
  count INTEGER DEFAULT 0,
  last_used INTEGER,
  PRIMARY KEY (bundle_id, hour, day_of_week)
);

-- Recent Activity
CREATE TABLE recent_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT, -- 'file', 'app', 'contact', 'url'
  item_id TEXT,
  item_name TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_activity_time ON recent_activity(timestamp DESC);
```

---

## Key Design Decisions

### 1. On-Device Indexing

**Decision**: All indexing and search happens locally

**Rationale**:
- Privacy protection (no search logs sent)
- Works offline
- Low latency

### 2. Incremental Indexing

**Decision**: Watch for file changes, index incrementally

**Rationale**:
- No need for full re-index
- Lower resource usage
- Real-time updates

### 3. Multi-Source Fusion

**Decision**: Query multiple sources and merge results

**Rationale**:
- Unified search experience
- Apps provide their own data
- Consistent ranking

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Indexing | On-device | Cloud | Privacy |
| Storage | SQLite FTS | Custom | Simplicity, proven |
| Ranking | Multi-signal | Pure text match | Relevance |
| Updates | Incremental | Full re-index | Performance |
