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
npm run cf:deploy           # wrangler deploy (runs `npm run build` first via [build])
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
2. Build command: leave empty (or `npm run build`) — `wrangler.toml` has a
   `[build]` step, so `wrangler deploy` always builds `dist/` first.
3. Deploy command: `npx wrangler deploy` (non-production branches use
   `npx wrangler versions upload`, which builds the same way).
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
| `VITE_WALLETCONNECT_PROJECT_ID` | unset — set it (free at cloud.reown.com) to add WalletConnect QR pairing |

The public `rpc.mainnet.near.org` endpoint is heavily rate limited. For
production, put a dedicated RPC (FastNEAR, Lava, Ankr, etc.) in
`VITE_NEAR_RPC_URL`; the fallbacks cover outages.

### Runtime (Worker / Pages Function)

Used by `/api/rpc` (the RPC proxy) and the activity feed. Workers: `[vars]`
in `wrangler.toml`, secrets via `wrangler secret put`. Pages: **Settings →
Variables and Secrets**.

| Variable | Default |
| --- | --- |
| `NEAR_RPC_URL` (**secret**) | `https://rpc.mainnet.near.org` |
| `NEAR_FALLBACK_RPC_URLS` | same list as above |
| `REF_CONTRACT_ID` | `v2.ref-finance.near` |

## Using a keyed RPC (Lava)

Never put an API key in a `VITE_` variable: those are compiled into the
JavaScript every visitor downloads. Keep the key on Cloudflare and let the
site call its own `/api/rpc` proxy (`worker/rpcProxy.ts`), which forwards to
your provider:

1. In the Lava dashboard, copy your **NEAR mainnet HTTPS (JSON-RPC)**
   endpoint — the full URL, including the key.
2. Store it as a secret:
   - Workers: `npx wrangler secret put NEAR_RPC_URL` and paste the URL.
   - Pages: **Settings → Variables and Secrets → Add**, name
     `NEAR_RPC_URL`, type **Secret**.
3. Set the build variable `VITE_NEAR_RPC_URL=/api/rpc` (Workers Builds /
   Pages build settings, or in your shell for `npm run cf:deploy`), then
   redeploy.

Check it: `curl -X POST https://<your-host>/api/rpc -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}'`
should return chain status, and the key must not appear anywhere in the
site's page source or JS.

The proxy only forwards standard NEAR JSON-RPC methods (queries, blocks,
transaction status and submission), rejects browser requests from other
websites, limits request size, and falls back to the public endpoints if
Lava errors or rate-limits. It can't stop someone scripting requests
against `/api/rpc` directly, so also set usage limits / alerts in the Lava
dashboard.

---

## Local testing with Cloudflare's runtime

```bash
npx wrangler d1 migrations apply nearpool-activity --local
npm run cf:dev              # wrangler dev on http://localhost:8787 (builds first)
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
