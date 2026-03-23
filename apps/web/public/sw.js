// ---------------------------------------------------------------------------
// Prometheus Service Worker
// ---------------------------------------------------------------------------
// Provides: app shell caching, API response caching (stale-while-revalidate),
// background sync for queued offline operations, and push notification handling.
// ---------------------------------------------------------------------------

const CACHE_VERSION = "v1";
const STATIC_CACHE = `prometheus-static-${CACHE_VERSION}`;
const API_CACHE = `prometheus-api-${CACHE_VERSION}`;
const APP_SHELL_CACHE = `prometheus-shell-${CACHE_VERSION}`;

// Static assets to precache on install (app shell)
const APP_SHELL_URLS = ["/", "/offline"];

// Patterns for cache strategies
const API_PATTERN = /\/api\//;
const STATIC_EXTENSIONS =
  /\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$/;

// ---------------------------------------------------------------------------
// Install — precache app shell
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate — clean up old caches
// ---------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
  const currentCaches = [STATIC_CACHE, API_CACHE, APP_SHELL_CACHE];

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !currentCaches.includes(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch — routing strategies
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (mutations go through normally or via background sync)
  if (request.method !== "GET") {
    return;
  }

  // Skip SSE and WebSocket upgrade requests
  if (
    request.headers.get("accept") === "text/event-stream" ||
    request.headers.get("upgrade") === "websocket"
  ) {
    return;
  }

  // API requests → NetworkFirst with stale-while-revalidate
  if (API_PATTERN.test(url.pathname)) {
    event.respondWith(networkFirstStrategy(request, API_CACHE));
    return;
  }

  // Static assets → CacheFirst
  if (STATIC_EXTENSIONS.test(url.pathname)) {
    event.respondWith(cacheFirstStrategy(request, STATIC_CACHE));
    return;
  }

  // Navigation requests (HTML pages) → NetworkFirst with app shell fallback
  if (request.mode === "navigate") {
    event.respondWith(navigationStrategy(request));
    return;
  }

  // Default: network with cache fallback
  event.respondWith(networkFirstStrategy(request, STATIC_CACHE));
});

// ---------------------------------------------------------------------------
// Cache strategies
// ---------------------------------------------------------------------------

/**
 * NetworkFirst: try the network, fall back to cache, update cache on success.
 */
async function networkFirstStrategy(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return new Response("Offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

/**
 * CacheFirst: serve from cache if available, otherwise fetch and cache.
 */
async function cacheFirstStrategy(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    // Stale-while-revalidate: return cache immediately, update in background
    const fetchPromise = fetch(request)
      .then((response) => {
        if (response.ok) {
          caches.open(cacheName).then((cache) => cache.put(request, response));
        }
      })
      .catch(() => {
        // Revalidation failed silently — cached version is still good
      });
    // Don't await — fire and forget
    const _revalidate = fetchPromise;
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response("Offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

/**
 * Navigation strategy: network first, fall back to cached app shell.
 */
async function navigationStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline — serve the cached page or the root shell
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    const shell = await caches.match("/");
    if (shell) {
      return shell;
    }
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/html" },
    });
  }
}

// ---------------------------------------------------------------------------
// Background Sync — replay queued operations
// ---------------------------------------------------------------------------

self.addEventListener("sync", (event) => {
  if (event.tag.startsWith("prometheus-")) {
    event.waitUntil(replayOfflineOperations(event.tag));
  }
});

/**
 * Replay operations stored in IndexedDB while the user was offline.
 */
async function replayOfflineOperations(tag) {
  const db = await openOfflineDB();
  const tx = db.transaction("operations", "readwrite");
  const store = tx.objectStore("operations");

  return new Promise((resolve, reject) => {
    const request = store.getAll();

    request.onsuccess = async () => {
      const operations = request.result.filter((op) => op.tag === tag);

      for (const op of operations) {
        try {
          const apiUrl = self.location.origin;
          await fetch(`${apiUrl}/api/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(op.data),
          });

          // Remove successful operation
          const deleteTx = db.transaction("operations", "readwrite");
          deleteTx.objectStore("operations").delete(op.id);
        } catch {
          // Will retry on next sync event
          break;
        }
      }

      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Open the offline operations IndexedDB.
 */
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("prometheus-offline", 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("operations")) {
        db.createObjectStore("operations", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Push Notifications — task completion alerts
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Prometheus",
      body: event.data.text(),
    };
  }

  const title = payload.title || "Prometheus";
  const options = {
    body: payload.body || "You have a new notification",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: payload.tag || "prometheus-notification",
    data: {
      url: payload.url || "/",
      sessionId: payload.sessionId,
      type: payload.type,
    },
    actions: payload.actions || [],
    requireInteraction: payload.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------------
// Notification Click — navigate to relevant page
// ---------------------------------------------------------------------------

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing tab if one is open
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Otherwise open a new tab
        return self.clients.openWindow(url);
      })
  );
});
