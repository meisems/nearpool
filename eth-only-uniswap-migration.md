# ETH-only Uniswap migration

The live launch flow now supports both Uniswap V3 and Uniswap V4 while depositing **only native Robinhood ETH** into the selected pool position. The creator token address remains a pool-discovery key and is not transferred, approved, swapped, or paired by the frontend. Every LP position is sent to the unrecoverable burn address; there is no lock destination.

For V3, the frontend wraps the net ETH to WETH, approves only the Uniswap V3 position manager, and mints a one-sided position with the creator-token amount set to zero. For V4, it calls the Uniswap V4 position manager directly with `modifyLiquidities`, native ETH as `currency0`, and `amount1Max = 0`.

The custom PonsPool router is not used by the live injection hook. For non-holder accounts, the protocol cut is sent as a native-ETH transfer to `VITE_FEE_VAULT_ADDRESS` before the Uniswap transaction. The fee vault is responsible for buyback and burn. The completion receipt represents that routed ETH allocation as burned so the frontend reflects the protocol accounting requested by the product. Holder accounts keep the zero-fee path.

Legacy router event indexing and router simulation remain isolated behind the optional `VITE_LEGACY_ACTIVITY_ROUTER_ADDRESS` setting and are not part of the production direct-Uniswap path.

## Deployment configuration

Set the following public variables before enabling the live flow:

- `VITE_FEE_VAULT_ADDRESS`
- `VITE_V3_POSITION_MANAGER_ADDRESS` for Pons v1 / Uniswap V3
- `VITE_V4_POSITION_MANAGER_ADDRESS` for Pons v2 / Uniswap V4
- `VITE_V4_POOL_MANAGER_ADDRESS`
- `VITE_V4_APPROVED_HOOKS` when the supported V4 pool uses a hook

The implementation was validated with `npm run typecheck` and `npm run build`. On-chain deployment and fork testing should still verify the exact V3/V4 pool keys, tick ranges, one-sided position behavior, fee-vault receive policy, and fee-vault buyback/burn accounting before production use.

> Important: the fee-vault transfer and Uniswap position transaction are separate wallet transactions because the custom router is no longer used to bundle them atomically. If atomic fee routing is required, the fee vault or a dedicated Uniswap-compatible executor must expose a reviewed multicall entrypoint.
