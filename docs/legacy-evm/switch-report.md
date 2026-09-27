# V3/V4 Liquidity Engine Switching

The CreatorTerminal now has a visible Uniswap V3 / Uniswap V4 engine selector. V4 remains available for every token. V3 is enabled only when the token address is present in `VITE_LEGACY_V3_TOKENS`, so creators can switch between both engines for explicitly compatible tokens while incompatible tokens remain V4-only.

When V3 is selected, the existing legacy V3 position-manager route is used. The V3 flow is forced to dual-asset mode because the current implementation does not have a V3 zap route. When V4 is selected, the existing PonspoolRouter and raw V4 `modifyLiquidities` path are used.

The compatibility list is intentionally explicit. The supplied repository did not contain a reliable on-chain registry or authoritative list of all PonsFamily V1 tokens, so addresses must be supplied as a comma-separated `VITE_LEGACY_V3_TOKENS` value. This avoids incorrectly offering V3 for tokens that cannot be minted through the configured V3 position manager.

Validation: `npm run build` completed successfully. Only the existing Rollup chunk-size warning remains.
