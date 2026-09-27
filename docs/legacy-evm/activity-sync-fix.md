# Fix: activity feed showed different (stale) data per browser

## Root cause

1. **`src/lib/liveActivity.ts`** fetched real on-chain transactions and live
   ETH/PONS prices in a single `Promise.all`. If the free CoinGecko or
   Dexscreener price API rate-limited or was blocked (common in in-app
   webviews like Facebook's), the whole sync threw — discarding the
   successfully-fetched real transactions too. Each browser was then stuck
   showing whatever it happened to have cached in its own `localStorage`,
   which naturally diverges between browsers/devices and looks stale or
   "made up" over time.
2. All three upstream calls (block explorer, CoinGecko, Dexscreener) were
   made directly from the browser to third-party domains, so different
   browsers/networks/webviews could get blocked or throttled differently
   even when the sync logic worked.

## Fix

- Decoupled the transaction fetch from the price fetch in
  `syncLiveActivityInternal`: a price-API failure now only affects the
  estimated-buyback figure, never the transaction/pool list.
- Added same-origin proxy endpoints (`/api/explorer`, `/api/price/eth`,
  `/api/price/pons/:address`) in `server.mjs`, backed by a short shared
  in-memory cache with stale-on-error fallback, so every visitor converges
  on one real, recently-fetched snapshot instead of each browser hitting
  third parties independently.
- Added matching rewrites in `render.yaml` and `vercel.json` for static
  hosting deployments that don't run `server.mjs`.

## Follow-up: own transactions missing + unrelated transactions showing up

### Root cause

The activity feed identifies a "ponspool transaction" purely by shape: a
single-sided ETH mint on Uniswap's shared V3/V4 position manager, with the
LP position sent to the shared `0x…dEaD` burn address. That pattern isn't
unique to ponspool — any project locking liquidity the same way decodes
identically, so unrelated transactions could appear in the feed. Meanwhile,
a user's own transaction had no fast path to appear before the next
explorer sync/verification cycle caught up.

### Fix

- **`src/lib/liveActivity.ts`** now verifies each candidate transaction
  before showing it: it must either (a) have a matching payment to
  ponspool's fee vault in a nearby block (the non-holder fee flow), or (b)
  the sender must have held the required platform-token threshold at that
  exact historical block, read directly on-chain (the holder-exempt flow —
  mirrors the deployed router's own gating rule). Anything matching neither
  is dropped as an unrelated liquidity lock.
- The user's own just-confirmed transaction (already receipt-verified, see
  `confirmedActivity.ts`) is now merged to the top of the feed immediately
  on their own screen, then reconciled with the verified synced row once
  the next sync cycle picks it up — so it's never missing while waiting on
  explorer indexing.

### Known limitation

This is an indexing-layer heuristic, not a cryptographic guarantee — there
is no unique on-chain marker tying a transaction to ponspool specifically.
A fully precise fix would mean wiring the already-written-but-unused
`PonspoolRouter` contract (`contracts/PonspoolRouter.sol`) into the
injection flow so every transaction goes through one dedicated, taggable
contract address instead of calling Uniswap directly. That requires a new
contract deploy/verification and is out of scope for this pass.

## Follow-up 2: still inconsistent across browsers + wrong token names

### Root cause

1. The historical-holder verification added in follow-up 1 read a wallet's
   token balance pinned to a specific past block (`balanceOf` with
   `blockNumber`). Many RPC endpoints — including likely this chain's —
   only serve current state and reject that kind of historical read. Every
   fee-exempt holder's real transaction then silently failed verification
   and was dropped from the *shared* feed, while the connected browser
   still showed its own transactions via the local optimistic merge —
   reproducing the same "different per browser" symptom from a new cause.
2. The activity feed showed "Uncurated Asset $TK71" for every token instead
   of its real name, because it only ever called a synchronous local
   fallback that knows two hardcoded tokens. It never checked the Pons
   Family launch catalog or did a live on-chain `name()/symbol()` read —
   both of which the token-paste flow already does successfully.

### Fix

- `wasQualifyingHolderAt` now falls back to a *current*-balance read when
  the historical read fails, instead of assuming "not a holder".
- `src/lib/ponsCatalog.ts` gained a shared, cached `usePonsLaunchToken()`
  hook that looks a token address up in the same launch catalog the token
  picker searches.
- `src/components/Landing.tsx`'s `TxRow` now resolves each row's
  name/symbol/logo the same way the paste flow does: catalog first, then
  a live on-chain read (`useTokenMeta`, the same hook the paste flow uses),
  and only the generic placeholder if both come back empty.

## Follow-up 3 (the actual root cause): Render was running as a static site

### Root cause

`render.yaml` declared `runtime: static`. Render's static-site rewrite
rules are documented as purely **path**-based substitution (e.g.
`/blog/posts/:postid → /blog/:postid`) — there's no documented mechanism
for forwarding an incoming request's **query string** to a fixed external
destination. So every call to `/api/explorer?module=account&action=txlist&address=...`
was actually being rewritten to bare `https://robinhoodchain.blockscout.com/api`
with **no query parameters at all**. Blockscout's Etherscan-compatible API
responds `200 OK` with an error body (`{"status":"0","result":"..."}`) for
that — a "successful" HTTP response that decoded to an empty result every
time, for every browser. The shared activity sync has therefore never
actually returned real data since the proxy endpoints were introduced;
every "platform activity" entry anyone ever saw came from that browser's
own local cache of its own past transactions (via the `confirmedActivity`
optimistic merge), never from the real shared feed. This is also why
`server.mjs` — which has correct, full request proxying — made no
difference: **Render's static-site mode never executes it.**

### Fix

`render.yaml` now declares a real Node web service (`runtime: node`,
`startCommand: node server.mjs`) instead of a static site. `server.mjs`
already reads `process.env.PORT` and binds `0.0.0.0`, matching what Render
web services require, and `package.json` already has `"start": "node
server.mjs"` — no code changes were needed, only the deployment type.

### Action required (not just a file change)

Render generally can't convert an existing **Static Site** into a **Web
Service** in place — they're different resource types. In the Render
dashboard:
1. Create a **new Web Service** from the same repo.
2. Build command: `npm ci && npm run build`. Start command: `node server.mjs`.
3. Copy every environment variable from the old static site's Environment
   tab into the new service (`VITE_FEE_VAULT_ADDRESS` and any other
   `VITE_*` overrides you've set) — a new service starts with none of them.
4. Once the new service is live and verified, point your domain at it and
   delete/suspend the old static site.

No new environment variable is required by this fix itself. Optional:
setting `NODE_VERSION` (e.g. `20.11.0`) on the new service pins the Node
version explicitly, since `package.json` doesn't declare an `engines`
field and server.mjs needs Node 18+ (native `fetch`, `AbortSignal.timeout`).

`vercel.json` was left as-is — Vercel's rewrite engine genuinely does
forward query strings to external destinations, so that config isn't
affected by this issue if you ever deploy there instead.

## Files changed

| File | Change |
| --- | --- |
| `src/lib/liveActivity.ts` | Route explorer/price calls through same-origin proxy; stop a price-fetch failure from discarding real transaction data; verify each candidate transaction against a fee-vault payment or holder balance before showing it (with a current-balance fallback when a historical read isn't supported); merge the user's own just-confirmed transaction into the feed immediately. |
| `src/lib/ponsCatalog.ts` | Add a shared, cached `usePonsLaunchToken()` hook for looking up a token's curated name/symbol/logo by address. |
| `src/components/Landing.tsx` | `TxRow` now resolves token name/symbol/logo via the Pons launch catalog, then a live on-chain read, before falling back to the generic placeholder. |
| `server.mjs` | Add cached `/api/explorer`, `/api/price/eth`, `/api/price/pons/:address` proxy endpoints. |
| `render.yaml` | **Switch from a Render Static Site to a Render Web Service running `node server.mjs`** — the actual root cause fix. Requires creating a new service in the Render dashboard (see above), not just redeploying. |
| `vercel.json` | Add matching rewrite rules for Vercel hosting (unaffected by the Render issue). |

