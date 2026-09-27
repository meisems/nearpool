# Ponspool Remaining-Issues Remediation Report

**Review date:** 2026-09-04  
**Scope:** Latest Ponspool archive and the five remaining issues identified in the prior audit.

## Implemented changes

The router now accepts an explicit approved hook address at deployment. Both liquidity injection and buyback-pool activation validate that hook, while the frontend and V4 pool-state reader use the same `VITE_V4_APPROVED_HOOKS` configuration. This prevents silently reading one pool key and submitting another.

The router now exposes an owner-controlled `initializeV4` entry point that calls the target PoolManager’s `initialize` function with a nonzero initial square-root price. The UI remains fail-closed until the pool is initialized, and clearly reports `v4 pool not initialized` rather than suggesting a deposit can succeed. Initialization must be performed by the deployment operator before public deposits.

The ERC-20 leg is now staged through Permit2-compatible approval: the router pulls the user’s token amount, grants the exact received amount to Permit2 for the PositionManager, and clears the direct PositionManager approval. This must still be verified against the exact deployed PositionManager and Permit2 contracts on Robinhood Chain with a fork test.

Buyback activation now requires a nonzero `minOutPerEth`. Every buyback computes a minimum platform-token output from the ETH input and reverts if the swap returns less. This creates an explicit price-protection bound instead of accepting any full-range fill. The value must be configured from a conservative quote with matching token decimals.

Ownership transfer is now two-step through `transferOwnership` and `acceptOwnership`, reducing the risk of accidentally transferring administrative control to an unusable address. ETH recovery remains owner-controlled and should use a multisignature owner in production.

## Verification

| Check | Result |
|---|---|
| TypeScript typecheck | Passed |
| Vite production build | Passed; only the existing large-chunk warning remains |
| Solidity compilation with solc 0.8.24 | Passed; one unused return-name warning on the intentionally disabled zap function |
| Local runtime smoke test | Passed |
| Browser console | No application exception; WalletConnect development usage request returned HTTP 403 |

## Required pre-deployment actions

A true fork test cannot be substituted by compilation. Before deployment, test the router against the exact Robinhood Chain addresses with the following cases: Permit2 allowance from router to PositionManager; token settlement and unused-token refunds; V4 initialization and duplicate-initialization revert; a nonzero approved hook; buyback output below and above `minOutPerEth`; fee-exempt holder behavior; ownership handoff; and ETH recovery.

Set both deployment values consistently:

```text
APPROVED_HOOKS=<exact hook used by the supported pool>
VITE_V4_APPROVED_HOOKS=<same exact hook>
```

After deploying, set `VITE_PONSPOOL_ROUTER_ADDRESS` to the verified router address and confirm `eth_getCode` is nonempty on chain 4663. Activate the buyback only with the new two-argument call:

```text
setBuybackPool(poolKey, minOutPerEth)
```

The current default approved hook is the zero address. It is safe only if the supported pool is genuinely unhooked. For a PonsFamily pool with a nonzero hook, deploy with that exact verified hook address; do not use a guessed address.

## Important limitation

The V4 action payload and Permit2 path are now structured for standard Uniswap V4 periphery semantics, but no funded fork execution was available in this workspace. Treat the exact PositionManager deployment as an integration boundary and do not approve production funds until the fork tests pass.
