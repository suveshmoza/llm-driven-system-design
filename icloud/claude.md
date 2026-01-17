# Design iCloud Sync - Development with Claude

## Project Context

Building a file and photo synchronization service to understand sync protocols, conflict resolution, and cross-device consistency.

**Key Learning Goals:**
- Build bidirectional sync protocols
- Design conflict resolution systems
- Implement chunk-based file transfer
- Handle offline-first architecture

---

## Key Challenges to Explore

### 1. Sync Consistency

**Challenge**: Multiple devices editing same file

**Approaches:**
- Version vectors for causality
- Operational transformation
- CRDTs for mergeable types
- Last-write-wins with conflict copies

### 2. Efficient Transfer

**Problem**: Minimize bandwidth for large files

**Solutions:**
- Content-defined chunking
- Rolling hash for delta detection
- Deduplication across files
- Compression before upload

### 3. Photo Optimization

**Challenge**: TB of photos, limited device storage

**Solutions:**
- Thumbnail/preview on device
- Full-res in cloud
- Smart caching (recently viewed)
- Predictive prefetch

---

## Development Phases

### Phase 1: Basic Sync
- [ ] File metadata tracking
- [ ] Change detection
- [ ] Upload/download
- [ ] Version tracking

### Phase 2: Conflict Resolution
- [ ] Version vectors
- [ ] Conflict detection
- [ ] Automatic merge
- [ ] Conflict copies

### Phase 3: Optimization
- [ ] Chunked transfer
- [ ] Delta sync
- [ ] Deduplication
- [ ] Compression

### Phase 4: Photos
- [ ] Photo library sync
- [ ] Derivative generation
- [ ] Optimized storage
- [ ] Shared albums

---

## Resources

- [Dropbox Sync Engine](https://dropbox.tech/infrastructure/how-we-designed-dropbox-atf)
- [Vector Clocks](https://en.wikipedia.org/wiki/Vector_clock)
- [Content-Defined Chunking](https://restic.readthedocs.io/en/latest/100_references.html#design)
