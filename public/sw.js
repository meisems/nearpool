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
const CACHE_NAME = "nearpool-shell-v2";
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
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached || caches.match(request))),
    );
    return;
  }

  // Vite's hashed build output (/assets/*.js, *.css) is immutable by
  // filename — safe to serve from cache first, refilling in the
  // background so the next navigation picks up any change.
  if (/\.(?:js|css|woff2?|png|jpg|jpeg|svg|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
