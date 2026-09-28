# Deploying nearpool on Cloudflare Workers

nearpool is a static Vite build (`dist/`) plus a small Worker
(`worker/index.ts`) that serves two APIs:

- `/api/rpc`: a NEAR RPC proxy, so a keyed provider such as Lava stays secret;
- `/api/activity/*`: the shared activity feed, stored in **D1**.

Everything else (wallet connection, RPC reads, transactions) happens in the
browser. The site works without the feed, which only fills the landing page.

Workers serves `dist/` as static assets. Only `/api/*` runs Worker code
(`run_worker_first`). Unknown paths fall back to `index.html`, so client
routes such as `/swap` and `/t/usdt.tether-token.near` load directly.

---

## 0. Prerequisites

```bash
npm install
npx wrangler login          # opens a browser to authorize wrangler
```

Node 20 or newer is required (22 recommended).

## 1. Create the D1 database

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

## 2. Deploy from your machine

```bash
npm run cf:deploy           # wrangler deploy (runs `npm run build` first via [build])
```

Your site is live at `https://nearpool.<your-subdomain>.workers.dev`.

## 3. Deploy from GitHub (Workers Builds)

1. Dashboard → **Workers & Pages → Create → Import a repository** and pick
   `meisems/nearpool`.
2. Build command: leave empty (or `npm run build`) — `wrangler.toml` has a
   `[build]` step, so `wrangler deploy` always builds `dist/` first.
3. Deploy command: `npx wrangler deploy` (non-production branches use
   `npx wrangler versions upload`, which builds the same way).
4. Add the build variables from [Environment variables](#environment-variables)
   if you need to override the defaults.

Each push to the production branch redeploys. Other branches get preview
URLs. Node 22 is pinned in `.node-version`, which Workers Builds reads.

If a build fails, open **View logs** on the failed build (the GitHub check
links to it). The usual causes:

- **D1 database not found**: `database_id` in `wrangler.toml` must be a
  database in the same Cloudflare account as the Worker.
- **Worker name mismatch**: the Worker in the dashboard must be named
  `nearpool`, the `name` in `wrangler.toml`.
- **Custom commands**: in **Settings → Builds**, leave the root directory
  empty, set the build command to empty or `npm run build`, and the deploy
  command to `npx wrangler deploy`.

Moving off Pages: in the dashboard, open the old `nearpool` **Pages**
project → **Settings → Builds → Disconnect** (or delete the project) so it
stops building every push. Point any custom domain at the Worker instead.

## 4. Custom domain

Dashboard → your Worker → **Settings → Domains & Routes → Add → Custom
domain**, then enter e.g. `nearpool.xyz`. Cloudflare creates the DNS record
and certificate.

---

## Environment variables

### Build time (browser bundle)

These live in `wrangler.toml` under `[vars]` (the `VITE_*` entries).
`vite.config.js` reads them when `npm run build` runs and compiles them into
the site, so they are public: never put an API key in one. Edit the file and
redeploy to change them. A variable with the same name set in your shell or
in the Worker's **Settings → Builds → Variables and secrets** overrides the
file.

| Variable | Default |
| --- | --- |
| `VITE_NEAR_RPC_URL` | `/api/rpc` in `wrangler.toml` (the Worker's proxy); `https://rpc.mainnet.near.org` if unset |
| `VITE_NEAR_FALLBACK_RPC_URLS` | `https://free.rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.fastnear.com` |
| `VITE_REF_CONTRACT_ID` | `v2.ref-finance.near` |
| `VITE_WRAP_NEAR_CONTRACT_ID` | `wrap.near` |
| `VITE_EXPLORER_URL` | `https://nearblocks.io` |
| `VITE_FEE_RECEIVER` | `nearpoolpf.near` — receives the interface fee |
| `VITE_FEE_NEAR` | `0.1` — fee per injection or swap; `0` disables it |
| `VITE_WALLETCONNECT_PROJECT_ID` | set in `wrangler.toml`; adds WalletConnect QR pairing. In the Reown dashboard (cloud.reown.com), add your site's domain to the project's allowlist |

The public `rpc.mainnet.near.org` endpoint is heavily rate limited. For
production, put a dedicated RPC (FastNEAR, Lava, Ankr, etc.) in
`VITE_NEAR_RPC_URL`; the fallbacks cover outages.

### Runtime (Worker)

Used by `/api/rpc` (the RPC proxy) and the activity feed. Plain values go in
`[vars]` in `wrangler.toml`; secrets via `npx wrangler secret put`.

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
2. Store it as a secret: `npx wrangler secret put NEAR_RPC_URL` and paste
   the URL (or the Worker's **Settings → Variables and Secrets → Add**, type
   **Secret**).
3. `VITE_NEAR_RPC_URL = "/api/rpc"` is already set in `wrangler.toml`, so
   the site sends its RPC calls to the proxy. Redeploy after adding the
   secret. Without the secret, the proxy uses the public endpoints.

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
