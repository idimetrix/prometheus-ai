"use client";

// ---------------------------------------------------------------------------
// Service Worker Registration for the Next.js web app
// ---------------------------------------------------------------------------

const SW_PATH = "/sw.js";
const SW_SCOPE = "/";

/**
 * Register the service worker. Should be called once from the root layout
 * or a top-level provider after the page has loaded.
 */
export async function registerServiceWorker(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: SW_SCOPE,
    });

    // Listen for updates
    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;
      if (!installingWorker) {
        return;
      }

      installingWorker.addEventListener("statechange", () => {
        if (
          installingWorker.state === "activated" &&
          navigator.serviceWorker.controller
        ) {
          // New service worker activated — could prompt user to refresh
          console.info("[SW] New version available");
        }
      });
    });

    return registration;
  } catch (err) {
    console.error("[SW] Registration failed:", err);
    return undefined;
  }
}

/**
 * Unregister all service workers (useful for development).
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    await registration.unregister();
  }
}

// ---------------------------------------------------------------------------
// Background Sync
// ---------------------------------------------------------------------------

/**
 * Queue an operation for background sync when the user is offline.
 * The service worker will replay these when connectivity is restored.
 */
export async function queueBackgroundSync(
  tag: string,
  data: Record<string, unknown>
): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;

  // Store the data in IndexedDB so the SW can access it
  await storeOfflineOperation(tag, data);

  // Request a background sync
  if ("sync" in registration) {
    await (
      registration as unknown as {
        sync: { register: (tag: string) => Promise<void> };
      }
    ).sync.register(tag);
  }
}

/**
 * Store an offline operation in IndexedDB for later replay.
 */
function storeOfflineOperation(
  tag: string,
  data: Record<string, unknown>
): Promise<void> {
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

    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("operations", "readwrite");
      const store = tx.objectStore("operations");
      store.add({
        tag,
        data,
        createdAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };

    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Push Notifications
// ---------------------------------------------------------------------------

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * Subscribe the user to push notifications for task completion alerts.
 * Returns the PushSubscription object (should be sent to the server).
 */
export async function subscribeToPushNotifications(): Promise<
  PushSubscription | undefined
> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check existing subscription
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      return existing;
    }

    if (!VAPID_PUBLIC_KEY) {
      console.warn("[SW] No VAPID public key configured");
      return undefined;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        VAPID_PUBLIC_KEY
      ) as BufferSource,
    });

    return subscription;
  } catch (err) {
    console.error("[SW] Push subscription failed:", err);
    return undefined;
  }
}

/**
 * Convert a base64-encoded VAPID public key to a Uint8Array.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
