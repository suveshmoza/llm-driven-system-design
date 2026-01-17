# Design Spotlight - Development with Claude

## Project Context

Building a universal search system to understand indexing, content extraction, and on-device intelligence.

**Key Learning Goals:**
- Build incremental indexing systems
- Design multi-source search ranking
- Implement content extraction pipelines
- Handle on-device ML for suggestions

---

## Key Challenges to Explore

### 1. Indexing Performance

**Challenge**: Real-time indexing without battery drain

**Approaches:**
- Incremental updates
- Idle-time processing
- Content-addressed deduplication
- Prioritized indexing

### 2. Content Extraction

**Problem**: Diverse file formats

**Solutions:**
- Pluggable extractors
- Format detection
- Metadata extraction
- Preview generation

### 3. Ranking Quality

**Challenge**: Relevance across heterogeneous content

**Solutions:**
- Type-specific boosting
- Recency weighting
- Usage signals
- Name vs content weighting

---

## Development Phases

### Phase 1: File Indexing
- [ ] File watcher
- [ ] Content extraction
- [ ] Inverted index
- [ ] Basic search

### Phase 2: Multi-Source
- [ ] App providers
- [ ] Contacts/Calendar
- [ ] Messages
- [ ] Result merging

### Phase 3: Intelligence
- [ ] Special queries (math, conversions)
- [ ] Natural language
- [ ] Date parsing
- [ ] Web fallback

### Phase 4: Suggestions
- [ ] Usage tracking
- [ ] Time patterns
- [ ] Proactive suggestions
- [ ] Continue reading

---

## Resources

- [Apache Lucene](https://lucene.apache.org/)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [Content Extraction with Apache Tika](https://tika.apache.org/)
