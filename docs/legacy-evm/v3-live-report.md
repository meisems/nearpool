# Live V3 Compatibility Update

V3 is no longer gated by a hand-maintained legacy-token allowlist. The frontend now probes the configured Uniswap V3 factory with WETH/token across the supported fee tiers (0.05%, 0.30%, and 1.00%). If any fee tier returns a non-zero pool, V3 is enabled for that token automatically.

V4 availability is derived from the live V4 pool state. The engine selector therefore supports four cases: V3-only, V4-only, both engines, or neither until a pool exists. When both pools exist, the creator can switch between Uniswap V3 and V4. When only one exists, the other option is disabled with an explanatory message.

The existing V3 route is used for V3 selection and is forced to dual-asset mode because a V3 ETH-only zap route has not been implemented. V4 continues through PonspoolRouter and the raw `modifyLiquidities` payload path.

Validation: `npm run build` completed successfully. The build retains only the pre-existing Rollup chunk-size warning.
