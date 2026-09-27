# Activity and route reload update

The client-side routes now include static-host fallbacks through `public/_redirects` and `vercel.json`, so direct reloads of `/launch-pool`, `/buy`, `/how-it-works`, `/docs`, `/terms`, and `/privacy-policy` return the app shell instead of a not-found response.

In live mode, the landing page now indexes `DualInjected`, `EthZapped`, and `PlatformCut` events from the deployed router for all users. The feed derives wallet addresses, token addresses, ETH paired, and burned platform-token amounts from confirmed on-chain logs. The protocol counters are computed from the same indexed data and refresh every 15 seconds.

Set `VITE_ACTIVITY_START_BLOCK` to the router deployment block for a complete historical scan. The default zero value scans from block zero in RPC-sized chunks. In simulation mode, the existing simChain metrics and activity feed remain active.

Validation: direct browser navigation to `/docs` and `/privacy-policy` loaded successfully, `npm run typecheck` passed, and `npm run build` completed successfully. Existing dependency annotation and large-chunk warnings remain unchanged.
