// nearpool service worker
//
// Purpose: make the app installable (PWA on desktop/mobile, and wrappable
// as an Android TWA) and give it light offline resilience. Deliberately
// does NOT cache anything under /api/ — on-chain reads, prices, and the
// shared activity feed must always come from the network. Caching those
// would silently reintroduce the "different browsers see different
// transactions" bug this app just got fixed for.
//
// Bump CACHE_NAME whenever this file's caching behavior changes; the
// activate handler clears any cache that doesn't match the current name.
const CACHE_NAME = "nearpool-shell-v3";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(SHELL_URL))
      .catch(() => {
        // Offline (or first-load network hiccup) during install — fine,
        // the fetch handler below will populate the cache on first
        // successful navigation instead.
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin (RPC, fonts, CDNs) — pass through untouched
  if (url.pathname.startsWith("/api/")) return; // always live, never cached

  // SPA navigations: network-first so visitors always get the latest
  // build when online, falling back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached || caches.match(request))),
    );
    return;
  }

  // Static files: network-first as well, cache only as an offline fallback.
  // Serving cached JS first could keep a browser on an old build after a
  // redeploy until a manual refresh.
  if (/\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});
