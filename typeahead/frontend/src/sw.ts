/**
 * Service Worker for typeahead offline support.
 * Uses stale-while-revalidate strategy for API requests.
 */

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'typeahead-v1';
const API_CACHE_NAME = 'typeahead-api-v1';

// URLs to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// API routes to apply stale-while-revalidate
const SWR_API_PATTERNS = [
  '/api/v1/suggestions',
  '/api/v1/analytics/trending',
  '/api/v1/analytics/summary',
];

// Cache TTLs (in milliseconds)
const API_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

/**
 * Check if a URL matches our stale-while-revalidate patterns.
 */
function shouldApplySWR(url: URL): boolean {
  return SWR_API_PATTERNS.some((pattern) => url.pathname.startsWith(pattern));
}

/**
 * Check if cached response is still fresh.
 */
function isCacheValid(response: Response): boolean {
  const cachedAt = response.headers.get('sw-cached-at');
  if (!cachedAt) return false;

  const age = Date.now() - parseInt(cachedAt, 10);
  return age < API_CACHE_TTL;
}

/**
 * Clone response and add cache timestamp header.
 */
async function cacheWithTimestamp(
  cache: Cache,
  request: Request,
  response: Response
): Promise<void> {
  const headers = new Headers(response.headers);
  headers.set('sw-cached-at', Date.now().toString());

  const cachedResponse = new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  await cache.put(request, cachedResponse);
}

/**
 * Stale-while-revalidate fetch handler.
 * Returns cached response immediately while fetching fresh data in background.
 */
async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // Start network request
  const fetchPromise = fetch(request)
    .then(async (networkResponse) => {
      if (networkResponse.ok) {
        await cacheWithTimestamp(cache, request, networkResponse);
      }
      return networkResponse.clone();
    })
    .catch((error) => {
      console.warn('[SW] Network request failed:', error);
      return null;
    });

  // If we have a valid cached response, return it immediately
  if (cachedResponse && isCacheValid(cachedResponse)) {
    // Revalidate in background
    fetchPromise.catch(() => {});
    return cachedResponse;
  }

  // If cache is stale or missing, wait for network
  const networkResponse = await fetchPromise;

  if (networkResponse) {
    return networkResponse;
  }

  // Fallback to stale cache if network failed
  if (cachedResponse) {
    return cachedResponse;
  }

  // No cache and no network - return error
  return new Response(JSON.stringify({ error: 'Offline and no cached data' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Network-first fetch for non-SWR requests.
 */
async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw new Error('Network error and no cache available');
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Apply stale-while-revalidate for API endpoints
  if (shouldApplySWR(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Network-first for other requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CLEAR_API_CACHE') {
    caches.delete(API_CACHE_NAME);
  }
});

export {};
