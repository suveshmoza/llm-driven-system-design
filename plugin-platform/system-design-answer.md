# Plugin Platform - System Design Interview Answer

## Opening Statement (1 minute)

"I'll design a web-based plugin platform that enables developers to build, publish, and distribute extensions that extend core application functionality. The core challenge is running untrusted third-party code safely in the browser while providing a rich, versioned API that balances capability with security.

This involves three key technical challenges: designing a secure sandboxing system using Web Workers for isolation, building a versioned extension API with a permission model that protects user data, and implementing a marketplace that scales to thousands of extensions with millions of users."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Install**: Users can add extensions from a marketplace
- **Run**: Execute extensions in isolated sandboxed environment
- **Publish**: Developers can submit extensions for review
- **Manage**: Enable, disable, update, configure extensions
- **Discover**: Browse, search, and review extensions

### Non-Functional Requirements
- **Security**: Extensions cannot access arbitrary user data
- **Performance**: < 500ms extension activation
- **Scale**: 10,000+ extensions, 1M+ users
- **Reliability**: Platform works even if extension crashes

### Scale Estimates
- **Extensions**: 10,000+
- **Daily active users**: 1M+
- **Extension installations**: 100M+ total
- **API calls/day**: 100M+

### Key Questions I'd Ask
1. What platform capabilities should extensions access?
2. How strict should the review process be?
3. Should extensions be able to communicate with each other?

## High-Level Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Web Application                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  Core App     │  │  Extension    │  │  Extension    │       │
│  │  (Main Thread)│  │  Host         │  │  Manager      │       │
│  │               │  │               │  │               │       │
│  │ - UI          │  │ - API Proxy   │  │ - Install     │       │
│  │ - Commands    │  │ - Messaging   │  │ - Lifecycle   │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
           │                    │
           │               Web Workers (Sandboxed)
           │          ┌────────┴────────┐
           │          ▼                 ▼
           │   ┌───────────────┐ ┌───────────────┐
           │   │ Extension A   │ │ Extension B   │
           │   │ (Isolated)    │ │ (Isolated)    │
           │   └───────────────┘ └───────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend Services                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  Extension    │  │  Marketplace  │  │  User         │       │
│  │  Registry     │  │  Service      │  │  Service      │       │
│  │               │  │               │  │               │       │
│  │ - Metadata    │  │ - Search      │  │ - Auth        │       │
│  │ - Versions    │  │ - Rankings    │  │ - Settings    │       │
│  │ - Downloads   │  │ - Reviews     │  │ - Installs    │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **Extension Host**: Manages Web Worker lifecycle and message passing
2. **Extension Manager**: Handles installation, updates, enable/disable
3. **Extension Registry**: Stores metadata, versions, bundle URLs
4. **Marketplace Service**: Search, rankings, reviews
5. **Security Scanner**: Analyzes extensions before publication

## Deep Dive: Web Worker Sandboxing (8 minutes)

The key security mechanism is running each extension in an isolated Web Worker with a controlled API surface.

### Extension Host Implementation

```javascript
class ExtensionHost {
  constructor() {
    this.workers = new Map();    // extensionId -> Worker
    this.pendingRequests = new Map();
    this.platformAPI = this.createPlatformAPI();
  }

  async loadExtension(extension) {
    // Create isolated Web Worker for extension
    const worker = new Worker('/extension-worker.js', {
      type: 'module',
      name: extension.id
    });

    // Set up message channel
    worker.onmessage = (e) => this.handleMessage(extension.id, e.data);
    worker.onerror = (e) => this.handleError(extension.id, e);

    // Initialize extension with limited API
    worker.postMessage({
      type: 'init',
      extensionId: extension.id,
      manifest: extension.manifest,
      permissions: extension.permissions,
      code: extension.bundleUrl
    });

    this.workers.set(extension.id, {
      worker,
      permissions: extension.permissions,
      state: 'initializing'
    });

    // Timeout for unresponsive extensions
    setTimeout(() => {
      const ext = this.workers.get(extension.id);
      if (ext && ext.state === 'initializing') {
        console.warn(`Extension ${extension.id} failed to initialize`);
        this.unloadExtension(extension.id);
      }
    }, 5000);
  }

  async handleMessage(extensionId, message) {
    if (message.type === 'api-response') {
      // Extension responding to our call
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        this.pendingRequests.delete(message.requestId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.type === 'platform-api') {
      // Extension calling platform API
      await this.handlePlatformAPICall(extensionId, message);
    } else if (message.type === 'initialized') {
      const ext = this.workers.get(extensionId);
      if (ext) ext.state = 'active';
    }
  }

  async handlePlatformAPICall(extensionId, message) {
    const { requestId, api, method, args } = message;
    const ext = this.workers.get(extensionId);

    try {
      // Check permissions before allowing API call
      const hasPermission = this.checkPermission(ext.permissions, api, method);
      if (!hasPermission) {
        throw new Error(`Permission denied: ${api}.${method}`);
      }

      // Execute the API call
      const result = await this.platformAPI[api][method](extensionId, ...args);

      ext.worker.postMessage({
        type: 'platform-api-response',
        requestId,
        result
      });
    } catch (error) {
      ext.worker.postMessage({
        type: 'platform-api-response',
        requestId,
        error: error.message
      });
    }
  }

  checkPermission(permissions, api, method) {
    // Define which permissions are required for each API
    const permissionMap = {
      'storage': { required: 'storage' },
      'network': { required: 'network' },
      'clipboard': { required: 'clipboard' },
      'ui': { required: null },  // Always allowed
    };

    const requirement = permissionMap[api];
    if (!requirement) return false;
    if (requirement.required === null) return true;

    return permissions.includes(requirement.required);
  }
}
```

### Extension Runtime (Inside Web Worker)

```javascript
// extension-worker.js - Runs inside Web Worker
class ExtensionRuntime {
  constructor() {
    this.extensionId = null;
    this.permissions = [];
    this.pendingRequests = new Map();
  }

  init(config) {
    this.extensionId = config.extensionId;
    this.permissions = config.permissions;

    // Dynamically import extension code
    import(config.code).then(module => {
      if (module.activate) {
        module.activate(this.createAPI());
      }
      self.postMessage({ type: 'initialized' });
    }).catch(error => {
      self.postMessage({ type: 'error', error: error.message });
    });
  }

  createAPI() {
    return {
      // UI API (always allowed)
      ui: {
        showMessage: (message, type) =>
          this.callPlatformAPI('ui', 'showMessage', [message, type]),
        createPanel: (options) =>
          this.callPlatformAPI('ui', 'createPanel', [options]),
        registerCommand: (id, callback) =>
          this.registerCommand(id, callback)
      },

      // Storage API (requires 'storage' permission)
      storage: {
        get: (key) =>
          this.callPlatformAPI('storage', 'get', [key]),
        set: (key, value) =>
          this.callPlatformAPI('storage', 'set', [key, value]),
        delete: (key) =>
          this.callPlatformAPI('storage', 'delete', [key])
      },

      // Network API (requires 'network' permission)
      network: {
        fetch: async (url, options) => {
          if (!this.permissions.includes('network')) {
            throw new Error('Network permission required');
          }
          return this.callPlatformAPI('network', 'fetch', [url, options]);
        }
      },

      // Events API
      events: {
        on: (event, handler) => this.registerEventHandler(event, handler),
        off: (event, handler) => this.unregisterEventHandler(event, handler)
      }
    };
  }

  async callPlatformAPI(api, method, args) {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      self.postMessage({
        type: 'platform-api',
        requestId,
        api,
        method,
        args
      });

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('API call timeout'));
        }
      }, 10000);
    });
  }
}

// Initialize runtime
const runtime = new ExtensionRuntime();
self.onmessage = (e) => {
  if (e.data.type === 'init') {
    runtime.init(e.data);
  } else if (e.data.type === 'platform-api-response') {
    const pending = runtime.pendingRequests.get(e.data.requestId);
    if (pending) {
      runtime.pendingRequests.delete(e.data.requestId);
      if (e.data.error) {
        pending.reject(new Error(e.data.error));
      } else {
        pending.resolve(e.data.result);
      }
    }
  }
};
```

### Why Web Workers?

| Isolation Method | Security | DOM Access | Performance |
|------------------|----------|------------|-------------|
| Web Workers | Strong | None (good!) | Separate thread |
| iframes | Medium | Own DOM | Main thread |
| Same-thread | None | Full | Main thread |

Web Workers provide the strongest isolation because they have no DOM access by default and run on a separate thread, preventing a misbehaving extension from freezing the UI.

## Deep Dive: Extension API Design (6 minutes)

### Versioned API with Deprecation

```javascript
// API versioning strategy
const API_VERSIONS = {
  'v1': {
    storage: {
      get: (extensionId, key) => getStorageV1(extensionId, key),
      set: (extensionId, key, value) => setStorageV1(extensionId, key, value)
    }
  },
  'v2': {
    storage: {
      get: async (extensionId, key) => {
        // V2 supports multiple keys
        if (Array.isArray(key)) {
          return getMultipleV2(extensionId, key);
        }
        return getStorageV1(extensionId, key);
      },
      set: (extensionId, key, value) => setStorageV1(extensionId, key, value),
      // New in v2
      getAll: (extensionId) => getAllStorageV2(extensionId)
    }
  }
};

function getPlatformAPI(apiVersion) {
  const version = API_VERSIONS[apiVersion] || API_VERSIONS['v1'];
  return version;
}
```

### Permission Model

```javascript
// Extension manifest.json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "minPlatformVersion": "2.0",
  "permissions": [
    "storage",           // Local storage for extension data
    "network",           // Make HTTP requests
    "clipboard",         // Read/write clipboard
    "notifications"      // Show system notifications
  ],
  "optionalPermissions": [
    "webcam",            // Access webcam (requires runtime prompt)
    "microphone"         // Access microphone
  ]
}
```

### Permission Request Flow

```javascript
async function requestPermission(extensionId, permission) {
  // Check if already granted
  const granted = await db.query(`
    SELECT 1 FROM extension_permissions
    WHERE extension_id = $1 AND permission = $2
  `, [extensionId, permission]);

  if (granted.rows.length > 0) {
    return true;
  }

  // Prompt user
  const approved = await showPermissionDialog(extensionId, permission);

  if (approved) {
    await db.query(`
      INSERT INTO extension_permissions (extension_id, permission, granted_at)
      VALUES ($1, $2, NOW())
    `, [extensionId, permission]);
  }

  return approved;
}
```

## Deep Dive: Marketplace and Publishing (5 minutes)

### Extension Publishing Flow

```javascript
class MarketplaceService {
  async publishExtension(authorId, manifest, bundle) {
    // 1. Validate manifest
    this.validateManifest(manifest);

    // 2. Security scan
    const scanResult = await this.securityScanner.scan(bundle);
    if (scanResult.hasIssues) {
      throw new Error(`Security issues: ${scanResult.issues.join(', ')}`);
    }

    // 3. Upload bundle to CDN
    const bundleUrl = await this.cdn.upload(
      `extensions/${manifest.id}/${manifest.version}/bundle.js`,
      bundle
    );

    // 4. Create or update extension record
    const extension = await db.query(`
      INSERT INTO extensions (id, author_id, name, description, category, icon_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = $3, description = $4, updated_at = NOW()
      RETURNING *
    `, [manifest.id, authorId, manifest.name, manifest.description,
        manifest.category, manifest.icon]);

    // 5. Add version
    await db.query(`
      INSERT INTO extension_versions
        (extension_id, version, bundle_url, changelog, min_platform_version, permissions)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [manifest.id, manifest.version, bundleUrl, manifest.changelog,
        manifest.minPlatformVersion, manifest.permissions]);

    // 6. Update search index
    await this.updateSearchIndex(extension.rows[0]);

    return extension.rows[0];
  }

  async searchExtensions(query, options = {}) {
    const { category, sortBy = 'popularity', limit = 20 } = options;

    // Elasticsearch query
    const esQuery = {
      bool: {
        must: [
          { match: { status: 'published' } },
          query ? {
            multi_match: {
              query,
              fields: ['name^3', 'description', 'tags^2']
            }
          } : { match_all: {} }
        ]
      }
    };

    if (category) {
      esQuery.bool.must.push({ term: { category } });
    }

    const sortOptions = {
      popularity: [{ install_count: 'desc' }],
      rating: [{ average_rating: 'desc' }],
      recent: [{ published_at: 'desc' }]
    };

    return elasticsearch.search({
      index: 'extensions',
      body: {
        query: esQuery,
        sort: sortOptions[sortBy],
        size: limit
      }
    });
  }
}
```

### Security Scanner

```javascript
class SecurityScanner {
  async scan(bundle) {
    const issues = [];

    // Check for dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/g,                  // eval()
      /new\s+Function\s*\(/g,        // new Function()
      /document\./g,                 // DOM access (shouldn't be possible in worker)
      /window\./g,                   // Global access
      /localStorage/g,               // Direct storage access
      /XMLHttpRequest/g,             // Direct network (should use API)
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(bundle)) {
        issues.push(`Detected pattern: ${pattern.source}`);
      }
    }

    // Check bundle size
    if (bundle.length > 5 * 1024 * 1024) { // 5MB
      issues.push('Bundle exceeds size limit');
    }

    return {
      hasIssues: issues.length > 0,
      issues
    };
  }
}
```

## Trade-offs and Alternatives (5 minutes)

### 1. Web Workers vs. iframes

**Chose: Web Workers**
- Pro: No DOM access (stronger isolation)
- Pro: Separate thread (can't block UI)
- Pro: Clean message-passing API
- Con: Can't render UI directly
- Trade-off: Extensions use API to request UI, platform renders it

### 2. postMessage vs. Shared Memory

**Chose: postMessage**
- Pro: Clear security boundary
- Pro: Easy to audit all communication
- Con: Serialization overhead
- Alternative: SharedArrayBuffer (faster, harder to audit)

### 3. CDN-Hosted vs. Platform-Stored Bundles

**Chose: CDN-hosted**
- Pro: Fast global distribution
- Pro: Reduces platform load
- Pro: Version immutability
- Con: CDN costs
- Alternative: Platform storage (simpler, slower)

### 4. Elasticsearch vs. PostgreSQL FTS

**Chose: Elasticsearch**
- Pro: Better relevance ranking
- Pro: Faceting and aggregations
- Pro: Scales independently
- Con: Operational complexity
- Alternative: PostgreSQL FTS (simpler, sufficient for smaller scale)

### 5. Eager vs. Lazy Extension Loading

**Chose: Lazy loading**
- Pro: Faster initial page load
- Pro: Only load extensions user activates
- Con: Delay on first extension use
- Trade-off: User perceives faster app startup

## Database Schema

```sql
CREATE TABLE extensions (
  id VARCHAR(100) PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  icon_url VARCHAR(500),
  status VARCHAR(20) DEFAULT 'draft',  -- draft, review, published, suspended
  install_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE extension_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_id VARCHAR(100) REFERENCES extensions(id),
  version VARCHAR(50) NOT NULL,
  bundle_url VARCHAR(500) NOT NULL,
  changelog TEXT,
  min_platform_version VARCHAR(20),
  permissions TEXT[],
  published_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (extension_id, version)
);

CREATE TABLE user_extensions (
  user_id UUID REFERENCES users(id),
  extension_id VARCHAR(100) REFERENCES extensions(id),
  version VARCHAR(50) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  installed_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, extension_id)
);

CREATE TABLE extension_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_id VARCHAR(100) REFERENCES extensions(id),
  user_id UUID REFERENCES users(id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (extension_id, user_id)
);
```

## Closing Summary (1 minute)

"The plugin platform is built around three security-first principles:

1. **Web Worker sandboxing** - Each extension runs in an isolated Web Worker with no direct DOM access. All capabilities are exposed through a controlled API with permission checking on every call.

2. **Message-based API with permissions** - Extensions communicate with the platform via postMessage, which creates an auditable security boundary. Permissions are declared in the manifest and checked at runtime.

3. **CDN-hosted immutable bundles** - Extension code is scanned for security issues, then hosted on CDN with version-specific URLs, ensuring users always get the exact code that was reviewed.

The main trade-off is capability vs. security. We chose strict sandboxing and permission requirements because user trust is essential for platform adoption. Future improvements would include an extension signing system, runtime behavioral analysis, and a more sophisticated review process using automated code analysis."
