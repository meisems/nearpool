# Mutable platform-token update

The router now permits deployment with the platform token unset (`address(0)`) and exposes an owner-only `setPlatformToken(address newToken)` function. The setter rejects the zero address, emits `PlatformTokenUpdated`, and refuses changes while a buyback pool is active so the pool key cannot silently point at the wrong token.

If a buyback pool was configured during testing, the owner must call `clearBuybackPool()` first, then call `setPlatformToken(realToken)`, then call `setBuybackPool()` again with the real token pool key and a new minimum-output guard.

The frontend ABI now includes `platformTokenSet`, `setPlatformToken`, and `clearBuybackPool`. The frontend still needs its public `VITE_PLATFORM_TOKEN_ADDRESS` updated after the real token launches so the UI displays the correct token and reads the correct holder balance.

Validation: `npm run typecheck` passed and `npm run build` completed successfully. Foundry was not installed in the sandbox, so Solidity compilation must still be run locally with `forge build` before deployment.
