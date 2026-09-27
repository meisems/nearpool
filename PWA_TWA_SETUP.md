# PWA + TWA setup added

## What was added

**`public/manifest.webmanifest`** — the web app manifest. Name, icons (both
`any` and properly padded `maskable` variants), `display: standalone`,
theme/background colors matching the app's dark theme, and `start_url:
"/?source=pwa"` so you can tell PWA/TWA launches apart from regular browser
visits in analytics.

**`public/sw.js`** — a hand-written service worker (no build-tool
dependency like Workbox needed). Deliberately conservative:
- Never caches anything under `/api/` — on-chain reads, prices, and the
  shared activity feed always hit the network live. Caching those would
  quietly reintroduce the cross-browser staleness bug that was just fixed.
- Navigations (page loads) are network-first with a cached-shell fallback,
  so the app still opens if you're offline or your connection drops.
- Hashed static assets (`/assets/*.js`, `*.css`, fonts, images) are
  cache-first with a background refresh, since Vite's filenames change
  whenever their content does.

**`public/logo-mark-maskable-192.png` / `-512.png`** — new icon variants.
Your existing `logo-mark-*.png` icons have their artwork extending almost
to the edge of the canvas (as close as 14px from the bottom edge on the
512px version) — fine for a normal icon, but Android crops maskable icons
into a circle/squircle/rounded-square depending on the launcher, and
content that close to the edge gets clipped. The new maskable versions
recenter the same artwork with generous padding on your app's dark
background so it survives that crop cleanly. The manifest references your
original icons for `purpose: "any"` and the new ones for `purpose:
"maskable"`.

**`public/.well-known/assetlinks.json`** — placeholder Digital Asset Links
file, required for a TWA to open without a browser URL bar. **You must
edit this before shipping the Android app** — see below.

**`index.html`** — links the manifest, adds `apple-mobile-web-app-*` and
`mobile-web-app-capable` meta tags for iOS/Android install prompts.

**`src/main.tsx`** — registers `sw.js` after the app mounts, production
builds only (registering it in dev would fight with Vite's own HMR/caching
and cause confusing "why isn't my change showing up" bugs).

**`server.mjs`** — two fixes needed for this to actually work in
production, both verified:
1. Added the `.webmanifest` → `application/manifest+json` MIME type — some
   browsers refuse to treat a manifest served as `application/octet-stream`
   as valid.
2. **Important bug caught along the way:** the static file handler applied
   `Cache-Control: public, max-age=31536000, immutable` (one year) to
   *every* file except `index.html` — including what would have been
   `sw.js`, the manifest, and `assetlinks.json`. Caching a service worker
   file for a year means visitors could get stuck on a stale worker
   indefinitely, since the browser's own periodic update check is the only
   other thing that would notice a change, and CDNs/proxies don't always
   respect that. Narrowed the year-long immutable cache to only
   `dist/assets/*` (Vite's actual content-hashed output); everything else
   is now `no-cache`, so it's always revalidated.

## Verified, not just written

Ran the real production build and the real `server.mjs` (not a simulation):
- `dist/.well-known/assetlinks.json` — confirmed Vite's `public/` copy step
  does include dotfiles/dot-directories, so this isn't silently dropped.
- Checked actual response headers for `/manifest.webmanifest`, `/sw.js`,
  and `/.well-known/assetlinks.json` — all `no-cache` with correct
  content-types; confirmed a real hashed `/assets/*.js` file still gets the
  year-long immutable cache (so that optimization wasn't lost).
- Headless-browser tested the full install/offline flow: the service
  worker registers and reaches `active` state, the manifest `<link>`
  resolves, and — the actual point of a service worker — going fully
  offline and reloading the app still serves the cached shell rather than
  a browser error page.

## Action required on your end: fill in the real TWA identity

`public/.well-known/assetlinks.json` currently has placeholder values:

```json
"package_name": "REPLACE_WITH_YOUR_ANDROID_PACKAGE_NAME",
"sha256_cert_fingerprints": ["REPLACE_WITH_YOUR_APP_SIGNING_SHA256_FINGERPRINT"]
```

These can only be filled in once the Android wrapper app exists, since they
identify *that specific app's signing key* — not something derivable from
the web app alone. Typical path:

1. Generate the Android TWA project with
   [PWABuilder](https://www.pwabuilder.com/) (paste your deployed URL — it
   reads the manifest you now have) or Google's
   [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap).
2. Get the package name you chose (e.g. `com.yourcompany.ponspool`) and the
   SHA-256 fingerprint of the signing key (`keytool -list -v -keystore
   your.keystore` — look for `SHA256:`; use the *upload*/release key's
   fingerprint, not just the debug key, once you're ready for production).
3. Put both into `assetlinks.json` in place of the placeholders and
   redeploy.
4. Verify it with Google's
   [Statement List Generator/Tester](https://developers.google.com/digital-asset-links/tools/generator)
   or by visiting `https://yourdomain.com/.well-known/assetlinks.json`
   directly and confirming it returns valid JSON with no redirects (it
   must be served from the exact origin, over HTTPS, with no redirect —
   which the fix above guarantees since it's `no-cache` and served
   directly, not proxied).

Until that file has real values, the TWA will still open as a normal
Chrome Custom Tab with a URL bar instead of a seamless full-screen app —
everything else (installability as a PWA on desktop/mobile Chrome, offline
shell) works today without this step.

## Files changed/added
- `public/manifest.webmanifest` (new)
- `public/sw.js` (new)
- `public/logo-mark-maskable-192.png` (new)
- `public/logo-mark-maskable-512.png` (new)
- `public/.well-known/assetlinks.json` (new — placeholder, needs real values)
- `index.html`
- `src/main.tsx`
- `server.mjs`
