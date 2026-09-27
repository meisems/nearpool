# nearpool

Non-custodial liquidity injector for [Ref Finance](https://app.ref.finance) on NEAR mainnet.
Paste any token's contract address (or a nearblocks / Ref link, or a pool ID), pick its pool,
type one side, and nearpool sizes the other side from live reserves, then batches every step
into a single wallet approval:

1. **Checking storage** — NEP-145 registrations for you and Ref on both tokens, Ref account
   storage (register / top up) and `register_tokens` for non-whitelisted tokens.
2. **Wrapping NEAR** — `near_deposit` on `wrap.near`, only for the shortfall your wNEAR and Ref
   balances don't cover.
3. **Depositing to Ref** — `ft_transfer_call` per token (50 TGas, 1 yoctoNEAR). Existing Ref
   deposits are spent first.
4. **Injecting LP** — `add_liquidity` on `v2.ref-finance.near` (100 TGas) with slippage-guarded
   `min_amounts`.

No pool yet? Create one from the token page (Ref `add_simple_pool`), then add the first liquidity,
which sets the price. Tokens can be tracked (saved per browser): price, change since tracking,
pool depth and your position. Swaps route directly or through one intermediate token (e.g.
NEAR → USDC → token) using Ref's multi-step instant swap.

Routes: `/` paste box, `/t/<token>?pool=<id>` token page, `/pool/<id>`, `/track`, `/swap?out=<token>`.

## Stack

- React 18 + Vite + Tailwind v4 + Framer Motion
- `@near-wallet-selector` (Meteor, HERE, Nightly, Sender) with `modal-ui`
- `near-api-js` failover RPC provider for reads
- Native `bigint` fixed-point math everywhere (no floats in transaction amounts)

## Layout

| Path | Purpose |
| --- | --- |
| `src/config/near.ts` | Network, contract IDs, RPC fallbacks, gas and storage constants, common pairs |
| `src/context/NearWalletContext.tsx` | Wallet selector provider: `selector`, `modal`, `accounts`, `accountId`, `wallet`, `signIn`, `signOut`, `viewMethod`, `signAndSendTransactions` |
| `src/lib/near.ts` | RPC provider, `viewMethod`, native balance, execution-outcome parsing |
| `src/lib/refFinance.ts` | Ref view calls, on-chain pool discovery, injection/swap planners, error mapping |
| `src/utils/zapMath.ts` | Proportional quoting, share estimation, slippage, swap output — mirrors Ref's integer math |
| `src/hooks/useNearInjection.ts` | Pipeline state machine; observes progress on-chain and verifies every receipt |
| `src/hooks/useRefSwap.ts` | Instant swap execution |
| `src/hooks/useTokenMarket.ts`, `useWatchlist.ts` | Price / depth / position per token; tracked-token store |
| `src/lib/tokenInput.ts` | Parses pasted addresses, pool IDs and nearblocks / Ref links |
| `src/components/InjectPanel.tsx`, `pages/index.tsx` | Add-liquidity panel; home, token, tracked, swap and docs pages |
| `server.mjs` | Node hosting + shared activity feed (each post re-verified against NEAR RPC) |
| `worker/`, `functions/` | Same activity feed for Cloudflare Workers / Pages, stored in D1 (`migrations/`) |

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # math + transaction-planner checks
npm run typecheck
npm run build && npm start   # production server on :10000 (serves dist/ + /api/activity)
```

### Deploying

- **Cloudflare Workers or Pages** — see [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md)
  (`npm run cf:deploy` / `npm run cf:pages:deploy`; activity feed on D1).
- **Node hosts (Render etc.)** — `render.yaml` runs `server.mjs`; activity feed on Turso.

### Environment (all optional)

| Variable | Default |
| --- | --- |
| `VITE_NEAR_RPC_URL` | `https://rpc.mainnet.near.org`. Use `/api/rpc` with a keyed provider (see DEPLOY_CLOUDFLARE.md) |
| `VITE_NEAR_FALLBACK_RPC_URLS` | `https://free.rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.fastnear.com` |
| `VITE_REF_CONTRACT_ID` | `v2.ref-finance.near` |
| `VITE_WRAP_NEAR_CONTRACT_ID` | `wrap.near` |
| `VITE_FEE_RECEIVER` | `nearpoolpf.near` (interface fee recipient) |
| `VITE_FEE_NEAR` | `0.1` NEAR per injection or swap; `0` disables |
| `VITE_EXPLORER_URL` | `https://nearblocks.io` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | unset → in-memory activity feed (server only) |

## Notes

- Only Ref **simple pools** with two tokens are supported; stable/rated pools use a different
  `add_stable_liquidity` flow.
- First-time LPs attach 0.01 NEAR to `add_liquidity` so Ref can store the new share record; Ref
  refunds whatever it doesn't use. Existing LPs attach exactly 1 yoctoNEAR.
- LP shares live in your Ref account. Rounding dust from `add_liquidity` stays in your Ref deposit
  and is spent first on the next injection.

The pre-migration EVM (Robinhood Chain / Uniswap) reports are archived in `docs/legacy-evm/`.
