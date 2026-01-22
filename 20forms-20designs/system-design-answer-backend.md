# 20 Forms, 40 Designs - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Problem Statement

Design the backend infrastructure for a platform that renders identical forms across 41 React design systems for comparison. Key challenges include:
- Build orchestration for 42 separate applications
- Static file deployment architecture
- CDN and caching strategies
- CI/CD pipeline for parallel builds

## Requirements Clarification

### Functional Requirements
1. **Build Orchestration**: Compile 42 Vite applications efficiently
2. **Static Deployment**: Serve 42 apps as static files
3. **URL Routing**: Each library accessible at its own path (`/mui/`, `/chakra/`)
4. **Query Parameter Handling**: Pass form/theme configuration via URL

### Non-Functional Requirements
1. **Build Time**: Under 5 minutes for full 42-app build
2. **Availability**: 99.9% uptime via CDN
3. **Latency**: Sub-100ms asset delivery globally
4. **Cost Efficiency**: Zero server costs for hosting

### Scale Estimates
- 42 applications, avg 150KB gzipped each = ~6MB total
- Expected traffic: 1K-10K daily visitors
- Read-only workload (static assets)
- Peak: 100 concurrent users

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions CI/CD                             │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Trigger: Push to main                                             │  │
│  │  1. Checkout → 2. Install → 3. Parallel Build → 4. Deploy         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         GitHub Pages (Fastly CDN)                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  dist/                                                             │  │
│  │  ├── index.html          (Shell app)                              │  │
│  │  ├── assets/             (Shell assets with content hash)         │  │
│  │  ├── mui/index.html      (MUI app)                                │  │
│  │  ├── mui/assets/                                                   │  │
│  │  ├── chakra/index.html   (Chakra app)                             │  │
│  │  └── ... (39 more libraries)                                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Edge POP │ │ Edge POP │ │ Edge POP │
              │ (US-East)│ │ (EU-West)│ │ (AP-East)│
              └──────────┘ └──────────┘ └──────────┘
```

## Deep Dive: Build Orchestration System

### The Memory Challenge

Building 42 Vite applications simultaneously causes out-of-memory errors:

```
42 apps × 500MB RAM = 21GB RAM (crashes)
```

### Batched Parallel Build Solution

```javascript
// scripts/build-all.mjs
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const BATCH_SIZE = 4;  // Concurrent builds
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const BUILD_TIMEOUT_MS = 120000;  // 2 minutes per app

const libraries = [
  'shell', 'mui', 'chakra', 'antd', 'blueprint',
  // ... 37 more libraries
];

async function buildWithRetry(lib, attempt = 1) {
  try {
    console.log(`[Build] ${lib} (attempt ${attempt})`);
    await execAsync(`cd apps/${lib} && bun run build`, {
      timeout: BUILD_TIMEOUT_MS,
    });
    return { lib, success: true };
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      console.warn(`[Retry] ${lib} failed, retrying...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return buildWithRetry(lib, attempt + 1);
    }
    return { lib, success: false, error: error.message };
  }
}

async function buildAll() {
  const results = [];

  for (let i = 0; i < libraries.length; i += BATCH_SIZE) {
    const batch = libraries.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i/BATCH_SIZE) + 1}: ${batch.join(', ')}`);

    const batchResults = await Promise.all(batch.map(buildWithRetry));
    results.push(...batchResults);

    // Force garbage collection between batches
    if (global.gc) global.gc();
  }

  // Summary
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.error(`\n${failed.length} builds failed`);
    process.exit(1);
  }

  console.log(`\nAll ${results.length} builds succeeded`);
}

buildAll();
```

### Build Time Analysis

| Strategy | Time | Memory | Result |
|----------|------|--------|--------|
| Sequential | 21 min | 500MB | Too slow |
| All parallel | N/A | 21GB | OOM crash |
| Batch of 4 | 3 min | 2GB | Optimal |
| Batch of 8 | 2 min | 4GB | CI limit |

**Decision**: Batch size of 4 balances speed with memory constraints.

## Deep Dive: Static Deployment Architecture

### Directory Structure After Build

```
dist/
├── index.html                    # Shell (no-cache)
├── assets/
│   ├── shell-a1b2c3d4.js        # Content-hashed (immutable)
│   ├── shell-e5f6g7h8.css       # Content-hashed (immutable)
│   └── vendor-i9j0k1l2.js       # Shared React chunk
│
├── mui/
│   ├── index.html               # MUI entry (no-cache)
│   └── assets/
│       ├── mui-m3n4o5p6.js      # Content-hashed
│       └── mui-q7r8s9t0.css     # Content-hashed
│
├── chakra/
│   ├── index.html               # Chakra entry (no-cache)
│   └── assets/
│       └── ...
│
└── ... (39 more library directories)
```

### Vite Configuration for Multi-App Deployment

```typescript
// vite.config.ts (template for all library apps)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/20forms-20designs/mui/',  // Library-specific base path
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Content hash in filenames for cache busting
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
```

### Copy Script for Final Assembly

```javascript
// scripts/copy-builds-to-dist.mjs
import { cp, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';

const libraries = ['shell', 'mui', 'chakra', /* ... */];

async function copyBuilds() {
  // Clean dist directory
  if (existsSync('dist')) {
    await rm('dist', { recursive: true });
  }
  await mkdir('dist');

  // Copy shell as root
  await cp('apps/shell/dist', 'dist', { recursive: true });

  // Copy each library to its subdirectory
  for (const lib of libraries.filter(l => l !== 'shell')) {
    const src = `apps/${lib}/dist`;
    const dest = `dist/${lib}`;

    if (existsSync(src)) {
      await cp(src, dest, { recursive: true });
      console.log(`Copied ${lib}`);
    } else {
      console.warn(`Missing build: ${lib}`);
    }
  }
}

copyBuilds();
```

## Deep Dive: CDN and Caching Strategy

### Cache Header Configuration

| Asset Type | Cache-Control | TTL | Reasoning |
|------------|---------------|-----|-----------|
| `*.html` | `no-cache, must-revalidate` | 0 | Always fetch latest |
| `*-[hash].js` | `public, max-age=31536000, immutable` | 1 year | Hash changes on update |
| `*-[hash].css` | `public, max-age=31536000, immutable` | 1 year | Hash changes on update |
| Images/fonts | `public, max-age=604800` | 1 week | Rarely change |

### Netlify Headers Configuration (If Migrating from GitHub Pages)

```
# dist/_headers
/*.html
  Cache-Control: no-cache, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

### CDN Edge Behavior

GitHub Pages uses Fastly CDN:

```
User Request → Nearest Edge POP → Cache Check
                     │
                     ├── HIT: Return cached asset (< 10ms)
                     │
                     └── MISS: Fetch from origin → Cache → Return
```

- **Global POPs**: Assets served from nearest edge location
- **Origin Shield**: Reduces origin hits during cache misses
- **Purge on Deploy**: `gh-pages` push triggers global cache invalidation

## Deep Dive: CI/CD Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Cache dependencies
        uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ hashFiles('**/bun.lockb') }}

      - name: Cache build outputs
        uses: actions/cache@v4
        with:
          path: |
            apps/*/dist
            dist
          key: build-${{ github.sha }}
          restore-keys: build-

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build all apps
        run: node --expose-gc scripts/build-all.mjs

      - name: Copy to dist
        run: node scripts/copy-builds-to-dist.mjs

      - name: Check bundle sizes
        run: node scripts/check-budgets.mjs

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist-${{ github.sha }}
          path: dist/
          retention-days: 14

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
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

### Rollback Strategy

```bash
# List recent deployments
git log --oneline gh-pages -10

# Rollback to previous deployment
git checkout gh-pages
git reset --hard HEAD~1
git push origin gh-pages --force

# Or restore from artifact
# Download artifact from GitHub Actions UI
# Redeploy manually
```

## Performance Monitoring

### Bundle Size Budgets

| Metric | Budget | Warning |
|--------|--------|---------|
| Shell JS (gzipped) | < 50 KB | > 40 KB |
| Shell CSS (gzipped) | < 10 KB | > 8 KB |
| Library JS (gzipped) | < 150 KB | > 120 KB |
| Total dist size | < 25 MB | > 20 MB |

### Budget Enforcement Script

```javascript
// scripts/check-budgets.mjs
import { stat } from 'fs/promises';
import { execSync } from 'child_process';

const budgets = {
  'dist/assets/shell-*.js': 51200,  // 50KB
  'dist/*/assets/*.js': 153600,      // 150KB
};

async function checkBudgets() {
  let failed = false;

  for (const [pattern, maxBytes] of Object.entries(budgets)) {
    const files = execSync(`ls ${pattern} 2>/dev/null || true`)
      .toString().trim().split('\n').filter(Boolean);

    for (const file of files) {
      const gzipSize = parseInt(
        execSync(`gzip -c ${file} | wc -c`).toString().trim()
      );

      if (gzipSize > maxBytes) {
        console.error(`OVER BUDGET: ${file} is ${gzipSize} bytes (max: ${maxBytes})`);
        failed = true;
      }
    }
  }

  if (failed) process.exit(1);
}

checkBudgets();
```

### Real User Monitoring

```typescript
// apps/shell/src/vitals.ts
import { onCLS, onFCP, onLCP, onTTFB } from 'web-vitals';

function sendToAnalytics(metric) {
  console.log(`[Vitals] ${metric.name}: ${metric.value}`);

  if (import.meta.env.PROD) {
    // Send to analytics service
    navigator.sendBeacon('/api/vitals', JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
    }));
  }
}

onCLS(sendToAnalytics);
onFCP(sendToAnalytics);
onLCP(sendToAnalytics);
onTTFB(sendToAnalytics);
```

## Scalability Considerations

### Current: Static Hosting

```
GitHub Repo → GitHub Actions → GitHub Pages (Fastly CDN)
```

**Capacity**: Effectively unlimited for static content

### Future: Enhanced Monitoring

```
                              ┌─────────────────┐
                              │   Cloudflare    │
                              │   Web Analytics │
                              └────────┬────────┘
                                       │
GitHub Pages ────────────────────────────────────► Users
(Origin)                                           (Global)
```

### Cost Analysis

| Platform | Free Tier | Our Usage | Monthly Cost |
|----------|-----------|-----------|--------------|
| GitHub Pages | Unlimited (public) | ~18 MB static | $0 |
| GitHub Actions | 2000 min/month | ~100 min/month | $0 |
| Cloudflare Analytics | 500K events/month | ~10K events | $0 |

**Total**: $0/month

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Batched builds (4 concurrent) | Prevents OOM, 3 min total | Slower than unlimited parallel |
| Content-hashed assets | Perfect cache invalidation | Slightly larger filenames |
| GitHub Pages | Free, simple, CDN included | No custom headers, no server logic |
| Artifact retention (14 days) | Easy rollback | Storage cost if private repo |
| Retry logic (2 attempts) | Handles flaky builds | Longer worst-case build time |

## Future Backend Enhancements

1. **Incremental Builds**: Only rebuild changed apps using file hashing
2. **Build Cache Sharing**: Share Vite cache between CI runs
3. **Preview Deployments**: Deploy PRs to preview URLs
4. **Performance Dashboard**: Track Core Web Vitals over time
5. **Automated Lighthouse**: Run Lighthouse CI on every deployment
6. **Dependency Security**: Automated vulnerability scanning for 42 package.jsons
