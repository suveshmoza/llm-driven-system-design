# Design Spotlight - Universal Search

## Overview

A simplified Spotlight-like platform demonstrating local and cloud search, indexing, and intelligent suggestions. This educational project focuses on building a universal search system across files, apps, contacts, and web content.

## Key Features

### 1. Local Search
- File content indexing
- App search
- Contacts and emails
- Messages and notes

### 2. Cloud Search
- iCloud Drive
- Mail attachments
- Safari history
- Third-party apps

### 3. Siri Suggestions
- App suggestions
- Contact suggestions
- Recent activity
- Proactive intelligence

### 4. Natural Language
- Date queries ("photos from last week")
- Calculations
- Unit conversions
- Web queries

### 5. Privacy
- On-device indexing
- No search logs to Apple
- Private browsing exclusion
- Encryption at rest

## Implementation Status

- [ ] Initial architecture design
- [ ] File system indexing
- [ ] Content extraction
- [ ] Search ranking
- [ ] Cloud integration
- [ ] Natural language processing
- [ ] Siri Suggestions
- [ ] Documentation

## Key Technical Challenges

1. **Indexing Performance**: Real-time indexing without battery drain
2. **Content Extraction**: Parse diverse file formats
3. **Ranking**: Relevance across heterogeneous content
4. **Privacy**: Powerful search without cloud dependencies
5. **Latency**: Instant results as user types

## Architecture

See [architecture.md](./architecture.md) for detailed system design documentation.

## Development Notes

See [claude.md](./claude.md) for development insights and design decisions.
