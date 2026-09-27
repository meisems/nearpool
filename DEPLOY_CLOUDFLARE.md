# Deploying nearpool on Cloudflare

nearpool is a static Vite build (`dist/`) plus one small API: the shared
activity feed at `/api/activity/*`. On Cloudflare the API runs as a Worker
(or a Pages Function) and stores posts in **D1**. Everything else (wallet
connection, RPC reads, transactions) happens in the browser, so the site
works without the API; only the landing-page feed needs it.

You can deploy with either product. Both use the same code in
`worker/activity.ts`.

| | **Workers** (recommended) | **Pages** |
| --- | --- | --- |
| Config | `wrangler.toml` | Pages dashboard + `functions/` |
| API entry | `worker/index.ts` | `functions/api/[[path]].ts` |
| SPA fallback | `not_found_handling = "single-page-application"` | automatic (no top-level `404.html`) |
| Headers | `public/_headers` | `public/_headers` |
| Deploy | `npm run cf:deploy` | `npm run cf:pages:deploy` or Git integration |

Cloudflare now steers new projects to Workers with static assets. Pages
still works if you already use it.

---

## 0. Prerequisites

```bash
npm install
npx wrangler login          # opens a browser to authorize wrangler
```

Node 20 or newer is required (22 recommended).

## 1. Create the D1 database (both options)

```bash
npx wrangler d1 create nearpool-activity
```

Copy the `database_id` it prints into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "nearpool-activity"
database_id = "<paste here>"
migrations_dir = "migrations"
```

Create the table on the remote database:

```bash
npx wrangler d1 migrations apply nearpool-activity --remote
```

> Skipping D1 is allowed. The feed then returns an empty list and
> `/api/activity/publish` answers `503`. Injections still work; they just
> aren't listed on the landing page.

---

## Option A — Cloudflare Workers (static assets)

### Deploy from your machine

```bash
npm run cf:deploy           # vite build → wrangler deploy
```

wrangler uploads `dist/` as static assets and `worker/index.ts` as the
Worker. Only `/api/*` runs Worker code (`run_worker_first`). Every other
path is served from the asset store, and unknown paths fall back to
`index.html` so client routes like `/swap` and token pages such as
`/t/usdt.tether-token.near` load directly.

Your site is live at `https://nearpool.<your-subdomain>.workers.dev`.

### Deploy from GitHub (Workers Builds)

1. Dashboard → **Workers & Pages → Create → Import a repository** and pick
   `meisems/nearpool`.
2. Build command: `npm run build`
3. Deploy command: `npx wrangler deploy`
4. Add the build variables from [Environment variables](#environment-variables)
   if you need to override the defaults.

Each push to the production branch redeploys. Other branches get preview
URLs.

### Custom domain

Dashboard → your Worker → **Settings → Domains & Routes → Add → Custom
domain**, then enter e.g. `nearpool.xyz`. Cloudflare creates the DNS record
and certificate.

---

## Option B — Cloudflare Pages

### Deploy from GitHub

1. Dashboard → **Workers & Pages → Create → Pages → Connect to Git** and pick
   `meisems/nearpool`.
2. Build settings:
   - Framework preset: **None** (or Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION = 22`
3. Save and deploy. Pages detects `functions/` automatically.
4. Bind D1: **Settings → Bindings → Add → D1 database**. Variable name `DB`,
   database `nearpool-activity`. Redeploy so the binding takes effect.

### Deploy from your machine

```bash
npm run cf:pages:deploy     # vite build → wrangler pages deploy dist
```

The first run creates the `nearpool` Pages project. Bind D1 in the dashboard
as in step 4 above.

> `wrangler.toml` is written for the Workers deployment (it has no
> `pages_build_output_dir`), so production Pages deploys don't take bindings
> or variables from it and wrangler may print a warning saying so. Configure
> the Pages project's bindings and variables in the dashboard.

---

## Environment variables

### Build time (browser bundle)

These are inlined by Vite when `npm run build` runs, so set them wherever
the build happens: your shell for local deploys, or **Settings → Variables**
(Build) for Git-connected projects. Changing them requires a rebuild.

| Variable | Default |
| --- | --- |
| `VITE_NEAR_RPC_URL` | `https://rpc.mainnet.near.org` |
| `VITE_NEAR_FALLBACK_RPC_URLS` | `https://free.rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.fastnear.com` |
| `VITE_REF_CONTRACT_ID` | `v2.ref-finance.near` |
| `VITE_WRAP_NEAR_CONTRACT_ID` | `wrap.near` |
| `VITE_EXPLORER_URL` | `https://nearblocks.io` |
| `VITE_FEE_RECEIVER` | `nearpoolpf.near` — receives the interface fee |
| `VITE_FEE_NEAR` | `0.1` — fee per injection or swap; `0` disables it |

The public `rpc.mainnet.near.org` endpoint is heavily rate limited. For
production, put a dedicated RPC (FastNEAR, Lava, Ankr, etc.) in
`VITE_NEAR_RPC_URL`; the fallbacks cover outages.

### Runtime (activity API)

Used by the Worker / Pages Function to verify published transactions.
Workers: `[vars]` in `wrangler.toml`. Pages: **Settings → Variables and
Secrets**.

| Variable | Default |
| --- | --- |
| `NEAR_RPC_URL` | `https://rpc.mainnet.near.org` |
| `NEAR_FALLBACK_RPC_URLS` | same list as above |
| `REF_CONTRACT_ID` | `v2.ref-finance.near` |

If your RPC URL contains an API key, store it as a secret instead of a
plain var: `npx wrangler secret put NEAR_RPC_URL` (Workers) or mark it
**Encrypt** in the Pages dashboard.

---

## Local testing with Cloudflare's runtime

```bash
npx wrangler d1 migrations apply nearpool-activity --local
npm run cf:dev              # build + wrangler dev on http://localhost:8787
```

For the Pages flavour:

```bash
npm run build
npx wrangler pages dev dist --d1 DB=nearpool-activity
```

`pages dev` keeps its own local D1 copy. If publishing returns
`no such table: nearpool_activity`, run the SQL in
`migrations/0001_activity.sql` against it, or use the Workers flavour above.

`npm run dev` (plain Vite on :3000) is still the fastest loop for UI work;
the feed is simply empty there.

---

## Checking a deployment

```bash
curl https://<your-host>/api/activity/posts          # {"posts":[...]}
curl -I -H "accept: text/html" https://<your-host>/t/usdt.tether-token.near   # 200, text/html (SPA fallback, dotted route)
curl -I https://<your-host>/sw.js                    # Cache-Control: no-cache
```

Then connect a wallet, make a small injection, and it should appear in the
landing-page feed within about 15 seconds.

## Notes

- **Caching.** `public/_headers` makes `/assets/*` immutable for a year
  (the filenames are content-hashed) and keeps `sw.js` and the manifest
  uncached so visitors never get stuck on an old service worker.
- **Routes.** `/` (paste a token), `/t/<token>` (token page, `?pool=<id>`
  to pick a pool), `/pool/<id>`, `/track`, `/swap`. Older `/inject`,
  `/launch-pool` and `/buy` links redirect in the client.
- **Other hosts.** `server.mjs` and `render.yaml` remain for Node hosting
  (Render etc.), using Turso instead of D1. `vercel.json` serves the static
  site only.
