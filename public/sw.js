// PURPOSE: Retire the legacy PWA service worker that could pin old HTML and
// hashed asset URLs, causing blank screens after frontend rebuilds.

/**
 * Clear every service-worker cache created by older builds.
 *
 * @returns {Promise<void>}
 */
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await clearAllCaches();
    await self.registration.unregister();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', () => {
  // Intentionally noop: let the network serve the latest HTML/assets.
});
