# 20 Forms, 40 Designs - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

---

## 📋 Problem Statement

Design the backend infrastructure for a platform that renders identical forms across 41 React design systems for comparison. Key challenges include build orchestration for 42 separate applications, static file deployment, and CI/CD pipeline design.

---

## 🎯 Requirements Clarification

### Functional Requirements

1. **Build Orchestration**: Compile 42 Vite applications efficiently
2. **Static Deployment**: Serve 42 apps as static files
3. **URL Routing**: Each library accessible at its own path (`/mui/`, `/chakra/`)
4. **Query Parameter Handling**: Pass form/theme configuration via URL

### Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| Build Time | < 5 minutes | Developer productivity |
| Availability | 99.9% | CDN-backed static hosting |
| Latency | < 100ms globally | Edge caching |
| Cost | $0/month | Public repo, free hosting |

### Scale Estimates

| Metric | Value |
|--------|-------|
| Total applications | 42 |
| Average app size (gzipped) | 150KB |
| Total dist size | ~18MB |
| Daily visitors | 1K-10K |
| Peak concurrent users | 100 |

> "This is a read-only static workload - the entire system can be served from CDN edge nodes with no origin servers."

---

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      GitHub Actions CI/CD                            │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Push to main ──▶ Install ──▶ Parallel Build ──▶ Deploy        │ │
│  └────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GitHub Pages (Fastly CDN)                         │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  dist/                                                          │ │
│  │  ├── index.html        (Shell app - no-cache)                  │ │
│  │  ├── assets/           (Content-hashed, immutable)             │ │
│  │  ├── mui/index.html    (MUI app)                               │ │
│  │  ├── chakra/           (Chakra app)                            │ │
│  │  └── ... (39 more libraries)                                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │ Edge POP │      │ Edge POP │      │ Edge POP │
        │ (US-East)│      │ (EU-West)│      │ (AP-East)│
        └──────────┘      └──────────┘      └──────────┘
```

---

## 🔧 Deep Dive: Build Orchestration

### The Memory Challenge

Building 42 Vite applications simultaneously causes out-of-memory errors on CI runners:

```
42 apps × 500MB RAM = 21GB RAM ──▶ OOM crash
```

### Build Strategy Trade-offs

| Strategy | Time | Memory | Result |
|----------|------|--------|--------|
| ❌ Sequential | 21 min | 500MB | Too slow |
| ❌ All parallel | N/A | 21GB | OOM crash |
| ✅ Batch of 4 | 3 min | 2GB | Optimal |
| ⚠️ Batch of 8 | 2 min | 4GB | CI memory limit |

> "Batching 4 concurrent builds balances speed with GitHub Actions memory constraints. We can build all 42 apps in under 3 minutes."

### Batched Build Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Build Orchestration Script                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Batch 1: [shell, mui, chakra, antd]                                │
│     │                                                                │
│     ├── Build in parallel (4 concurrent)                            │
│     ├── Wait for all to complete                                    │
│     └── Force garbage collection                                    │
│                                                                      │
│  Batch 2: [blueprint, evergreen, carbon, gestalt]                   │
│     │                                                                │
│     └── (repeat process)                                            │
│                                                                      │
│  ... (8 more batches)                                               │
│                                                                      │
│  Final: Copy all builds to dist/                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Retry Logic

| Failure Type | Detection | Recovery |
|--------------|-----------|----------|
| Single app timeout | 2-minute timeout | Retry up to 2× |
| OOM during batch | Process exit code | Reduce batch size to 2 |
| Dependency fail | Install exit code | Retry with cache clear |
| All apps fail | Zero successes | Block deploy, alert |

> "Adding retry logic with 2 attempts handles flaky builds without significantly extending worst-case build time."

---

## 📁 Deep Dive: Static Deployment Architecture

### Directory Structure After Build

```
┌─────────────────────────────────────────────────────────────────────┐
│  dist/                                                               │
├─────────────────────────────────────────────────────────────────────┤
│  index.html                    Shell entry (no-cache)               │
│  assets/                                                             │
│  ├── shell-[hash].js          Content-hashed (immutable, 1 year)   │
│  ├── shell-[hash].css         Content-hashed (immutable)           │
│  └── vendor-[hash].js         Shared React chunk                   │
│                                                                      │
│  mui/                                                                │
│  ├── index.html               MUI entry (no-cache)                 │
│  └── assets/                                                         │
│      ├── mui-[hash].js        Content-hashed                       │
│      └── mui-[hash].css       Content-hashed                       │
│                                                                      │
│  chakra/                       (same pattern)                        │
│  antd/                         (same pattern)                        │
│  ... (39 more library directories)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Vite Base Path Configuration

Each library app needs its own base path for correct asset loading:

| App | Base Path | Resolved Asset URL |
|-----|-----------|-------------------|
| Shell | `/20forms-20designs/` | `/20forms-20designs/assets/shell-abc.js` |
| MUI | `/20forms-20designs/mui/` | `/20forms-20designs/mui/assets/mui-def.js` |
| Chakra | `/20forms-20designs/chakra/` | `/20forms-20designs/chakra/assets/chakra-ghi.js` |

### Asset Assembly Script

```
┌─────────────────────────────────────────────────────────────────────┐
│                      copy-builds-to-dist.mjs                         │
├─────────────────────────────────────────────────────────────────────┤
│  1. Clean dist/ directory                                           │
│  2. Copy apps/shell/dist ──▶ dist/ (root)                           │
│  3. For each library (except shell):                                │
│     Copy apps/{lib}/dist ──▶ dist/{lib}/                            │
│  4. Log any missing builds                                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 💾 Deep Dive: CDN and Caching Strategy

### Cache Header Configuration

| Asset Type | Cache-Control | TTL | Reasoning |
|------------|---------------|-----|-----------|
| `*.html` | `no-cache, must-revalidate` | 0 | Always fetch latest |
| `*-[hash].js` | `public, max-age=31536000, immutable` | 1 year | Hash changes on update |
| `*-[hash].css` | `public, max-age=31536000, immutable` | 1 year | Hash changes on update |
| Images/fonts | `public, max-age=604800` | 1 week | Rarely change |

> "Content-hashed filenames provide perfect cache invalidation. When code changes, the hash changes, and browsers fetch the new file. HTML files are never cached to ensure users always get the latest asset references."

### CDN Edge Behavior

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Request Flow                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User Request ──▶ Nearest Edge POP ──▶ Cache Check                  │
│                                              │                       │
│                        ┌─────────────────────┴─────────────────────┐│
│                        ▼                                           ▼│
│                  ┌──────────┐                              ┌──────────┐
│                  │   HIT    │                              │   MISS   │
│                  │  <10ms   │                              │          │
│                  └────┬─────┘                              └────┬─────┘
│                       │                                         │     │
│                       ▼                                         ▼     │
│                Return cached                           Fetch from    │
│                   asset                                 origin       │
│                                                            │         │
│                                                            ▼         │
│                                                      Cache + Return  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### GitHub Pages CDN Features

| Feature | Behavior |
|---------|----------|
| Global POPs | Assets served from nearest edge location |
| Origin Shield | Reduces origin hits during cache misses |
| Purge on Deploy | `gh-pages` push triggers global cache invalidation |
| HTTPS | Automatic TLS certificates |

---

## 🚀 Deep Dive: CI/CD Pipeline

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────┐
│                      GitHub Actions Workflow                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Trigger: Push to main or PR                                        │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  BUILD JOB (15 min timeout)                                     ││
│  │  ├── Checkout code                                              ││
│  │  ├── Setup Bun runtime                                          ││
│  │  ├── Restore dependency cache (key: bun.lockb hash)             ││
│  │  ├── Restore build cache (key: git SHA)                         ││
│  │  ├── Install dependencies (frozen lockfile)                     ││
│  │  ├── Build all apps (batched, with retries)                     ││
│  │  ├── Copy builds to dist/                                       ││
│  │  ├── Check bundle size budgets                                  ││
│  │  └── Upload artifacts (14-day retention)                        ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              ▼ (only on main branch)                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  DEPLOY JOB                                                     ││
│  │  ├── Download build artifacts                                   ││
│  │  └── Deploy to GitHub Pages                                     ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Caching Strategy

| Cache Type | Key | Purpose |
|------------|-----|---------|
| Dependencies | `bun.lockb` hash | Skip `bun install` if unchanged |
| Build outputs | Git SHA | Incremental builds |
| Artifacts | `dist-{sha}` | Enable rollbacks |

### Rollback Strategies

| Method | Steps | Use When |
|--------|-------|----------|
| Git reset | Reset gh-pages branch to previous commit | Quick rollback needed |
| Artifact restore | Download previous artifact, redeploy | Need specific version |
| Per-app rebuild | Rebuild single broken app, merge to dist | One library broke |

> "Keeping 14 days of build artifacts enables fast rollbacks without rebuilding. For critical issues, we can reset the gh-pages branch in under a minute."

---

## 📊 Performance Monitoring

### Bundle Size Budgets

| Metric | Budget | Warning | Action if Exceeded |
|--------|--------|---------|-------------------|
| Shell JS (gzipped) | 50KB | 40KB | Review dependencies |
| Shell CSS (gzipped) | 10KB | 8KB | Audit styles |
| Library JS (gzipped) | 150KB | 120KB | Check library version |
| Total dist size | 25MB | 20MB | Audit all bundles |

### Load Time Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Shell FCP | < 1.5s | Lighthouse |
| Shell LCP | < 2.5s | Lighthouse |
| Iframe load | < 500ms | Performance API |
| Time to Interactive | < 3.0s | Lighthouse |

### Budget Enforcement

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Bundle Budget Check                             │
├─────────────────────────────────────────────────────────────────────┤
│  For each pattern in budgets:                                       │
│    Find matching files                                              │
│    Measure gzipped size                                             │
│    Compare against budget                                           │
│    If over budget ──▶ Fail CI with error message                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 💰 Cost Analysis

### Hosting Platform Comparison

| Platform | Free Tier | Our Usage | Monthly Cost |
|----------|-----------|-----------|--------------|
| GitHub Pages | Unlimited (public) | ~18MB static | $0 |
| GitHub Actions | 2000 min/month | ~100 min/month | $0 |
| Cloudflare Analytics | 500K events/month | ~10K events | $0 |

**Total: $0/month**

### When to Consider Paid Hosting

| Trigger | Platform | Monthly Cost |
|---------|----------|--------------|
| Traffic > 100GB/month | Cloudflare Pages | $0 (unlimited) |
| Custom headers needed | Netlify Pro | $19 |
| Password protection | Vercel Pro | $20 |
| Server-side logic | Any paid tier | Varies |

> "For a learning project with moderate traffic, free tiers are sufficient. GitHub Pages with Fastly CDN provides excellent global performance at zero cost."

---

## ⚖️ Trade-offs Summary

| Decision | Chosen | Alternative | Why Chosen |
|----------|--------|-------------|------------|
| Build batching | 4 concurrent | All parallel | Prevents OOM on CI runners |
| Asset hashing | Content hash in filename | Query string versioning | Better cache behavior |
| Hosting | GitHub Pages | Netlify/Vercel | Zero cost, sufficient features |
| Artifact retention | 14 days | 7 days / 30 days | Balance storage and rollback needs |
| Retry logic | 2 attempts | 1 / 3 attempts | Handle flaky builds without long delays |
| HTML caching | no-cache | Short TTL | Always serve latest asset references |

---

## 🔮 Future Enhancements

| Enhancement | Complexity | Value |
|-------------|------------|-------|
| Incremental builds (only changed apps) | Medium | Faster CI |
| Preview deployments for PRs | Low | Better review flow |
| Lighthouse CI integration | Low | Automated perf tracking |
| Dependency vulnerability scanning | Low | Security |
| Build cache sharing across branches | Medium | Faster PR builds |

---

## 🎤 Interview Wrap-up

> "We've designed a zero-cost static hosting architecture that builds 42 React applications in under 3 minutes using batched parallel builds. Content-hashed assets ensure perfect cache invalidation, while GitHub Pages with Fastly CDN provides global edge delivery. The system handles failures gracefully with retry logic and maintains 14 days of artifacts for easy rollbacks. The entire infrastructure costs $0/month for a public repository."
