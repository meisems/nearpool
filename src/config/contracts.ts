/**
 * Canonical Ponspool configuration and contract surfaces.
 *
 * The production target is Robinhood Chain (chain ID 4663). All reads and
 * writes go through the real Robinhood Chain RPC and real Uniswap V3/V4
 * contracts — there is no simulated or seeded data path.
 */

import { getAddress } from "viem";

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const clean = (value: string | undefined) => (value ?? "").trim().replace(/^['"]|['"]$/g, "");
const str = (key: string, fallback: string) => clean(env[key]) || fallback;
const num = (key: string, fallback: number) => {
  const value = Number(clean(env[key]));
  return Number.isFinite(value) && clean(env[key]) !== "" ? value : fallback;
};
const normalizeAddress = (value: string, fallback: string) => {
  try {
    // Environment values often arrive with a non-EIP-55 mixed-case spelling.
    // Lowercase first, then let viem produce a canonical checksum address.
    return getAddress((value || fallback).toLowerCase());
  } catch {
    return getAddress(fallback.toLowerCase());
  }
};
const addressEnv = (key: string, fallback: string) => normalizeAddress(clean(env[key]), fallback);
const bool = (key: string, fallback: boolean) => {
  const value = clean(env[key]).toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
};

export const CHAIN_ID = num("VITE_CHAIN_ID", 4663);
export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
// Keep browser RPC traffic same-origin so an upstream provider cannot break the
// app with an invalid or duplicated Access-Control-Allow-Origin header. Treat
// the old public default as unset so existing deployments pick up the proxy.
const configuredRpc = clean(env["VITE_RPC_URL"]);
export const RPC_URL = !configuredRpc || configuredRpc.replace(/\/+$/, "") === "https://rpc.mainnet.chain.robinhood.com"
  ? "/api/rpc"
  : configuredRpc;
export const EXPLORER_URL = str("VITE_EXPLORER_URL", "https://robinhoodchain.blockscout.com");
export const WALLETCONNECT_PROJECT_ID = str("VITE_WALLETCONNECT_PROJECT_ID", "");
export const HAS_WALLETCONNECT = WALLETCONNECT_PROJECT_ID.length > 0;
export const USE_SEEDED_DATA = bool("VITE_USE_SEEDED_DATA", false);
export const CURVE_CAP_ETH = num("VITE_CURVE_CAP_ETH", 120);
export const PLATFORM_TOKEN = addressEnv("VITE_PLATFORM_TOKEN_ADDRESS", "0x51dF0c0F2a7e8329B05a5C0e6539cD26f8E4a7B3");
export const PONSFAMILY_LAUNCHPAD = addressEnv("VITE_PONSFAMILY_LAUNCHPAD_ADDRESS", "0x9C4be2D57a21F04c88F71bE5120f41d9e3Dc65a4");
// Pons v2 resolves each launch's curve from the factory. Keep the token and
// factory configurable so deployments never bake a launch address into code.
export const PONSPOOL_TOKEN = addressEnv(
  "VITE_PONSPOOL_TOKEN_ADDRESS",
  clean(env["VITE_PLATFORM_TOKEN_ADDRESS"]) || "0x0000000000000000000000000000000000000000",
);
export const PONSFAMILY_FACTORY = addressEnv("VITE_PONSFAMILY_FACTORY_ADDRESS", "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
export const FEE_VAULT = addressEnv("VITE_FEE_VAULT_ADDRESS", "0xFEE527b1A04d9E9d5C0c1D3b8f8A2c54D6e7B901");
export const WETH = addressEnv("VITE_WETH_ADDRESS", "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const MIN_HOLD_TOKENS = num("VITE_MIN_HOLD_FEE_EXEMPTION", 500_000);
// Retained for backwards compatibility with older Render deployments that
// still set VITE_LEGACY_ACTIVITY_ROUTER_ADDRESS. Not called by the current
// injection flow, which invokes Uniswap V3/V4 directly.
export const PONSPOOL_ROUTER = addressEnv("VITE_LEGACY_ACTIVITY_ROUTER_ADDRESS", "0xA0b2C3d4E5f60718293a4B5c6D7e8F90a1B2c3D4");
const PLACEHOLDER_ROUTER = "0xA0b2C3d4E5f60718293a4B5c6D7e8F90a1B2c3D4";
export const IS_DEPLOYMENT_CONFIGURED =
  // Uniswap V3/V4 addresses have verified Robinhood Chain defaults above;
  // Render only needs to provide the project's fee-vault destination. The
  // legacy router variable is accepted for existing Render configurations.
  (clean(env["VITE_PONSPOOL_ROUTER_ADDRESS"]) !== "" ||
    (clean(env["VITE_FEE_VAULT_ADDRESS"]) !== "" &&
      FEE_VAULT.toLowerCase() !== "0xfee527b1a04d9e9d5c0c1d3b8f8a2c54d6e7b901"));
export const IS_LEGACY_ACTIVITY_CONFIGURED = clean(env["VITE_LEGACY_ACTIVITY_ROUTER_ADDRESS"]) !== "";
export type SyncMode = "auto" | "relay" | "chain" | "local";
export const SYNC_MODE = str("VITE_SYNC_MODE", "auto") as SyncMode;
export const SYNC_TOPIC = str("VITE_SYNC_TOPIC", "ponsvault-membrane-9f3k2-4663");
export const GUN_RELAYS = str("VITE_GUN_RELAYS", "https://relay.peer.ink/gun").split(",").map((s) => s.trim()).filter(Boolean);

export const AMM = {
  v2Factory: addressEnv("VITE_V2_FACTORY_ADDRESS", "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f"),
  v2Router: addressEnv("VITE_V2_ROUTER_ADDRESS", "0x89e5db8b5aa49aa85ac63f691524311aeb649eba"),
  v3Factory: addressEnv("VITE_V3_FACTORY_ADDRESS", "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"),
  v3SwapRouter: addressEnv("VITE_V3_SWAP_ROUTER_ADDRESS", "0xcaf681a66d020601342297493863e78c959e5cb2"),
  v3QuoterV2: addressEnv("VITE_V3_QUOTER_ADDRESS", "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7"),
  v3PosMgr: addressEnv("VITE_V3_POSITION_MANAGER_ADDRESS", "0x73991a25c818bf1f1128deaab1492d45638de0d3"),
  v4PoolMgr: addressEnv("VITE_V4_POOL_MANAGER_ADDRESS", "0x8366a39cc670b4001a1121b8f6a443a643e40951"),
  v4PosMgr: addressEnv("VITE_V4_POSITION_MANAGER_ADDRESS", "0x58daec3116aae6d93017baaea7749052e8a04fa7"),
  v4Quoter: addressEnv("VITE_V4_QUOTER_ADDRESS", "0x8dc178efb8111bb0973dd9d722ebeff267c98f94"),
  v4UnivRouter: addressEnv("VITE_V4_UNIVERSAL_ROUTER_ADDRESS", "0x8876789976decbfcbbbe364623c63652db8c0904"),
  permit2: addressEnv("VITE_PERMIT2_ADDRESS", "0x000000000022D473030F116dDEE9F6B43aC78BA3"),
} as const;

/** V1 tokens remain available through the deployed V3 position manager only. */
export const LEGACY_V3 = {
  factory: AMM.v3Factory as `0x${string}`,
  positionManager: AMM.v3PosMgr as `0x${string}`,
  swapRouter: AMM.v3SwapRouter as `0x${string}`,
  quoterV2: AMM.v3QuoterV2 as `0x${string}`,
} as const;

/** V4 permanent-lock destination; override for the deployed locker on the target chain. */
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;


export const TICK_SPACING: Record<number, number> = { 500: 10, 3000: 60, 10000: 200 };
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const WETH_ADDRESS = WETH as `0x${string}`;
export const PONSPOOL_ROUTER_ADDRESS = PONSPOOL_ROUTER as `0x${string}`;
export const PLATFORM_TOKEN_ADDRESS = PLATFORM_TOKEN as `0x${string}`;
export const REQUIRED_HOLD_AMOUNT = BigInt(MIN_HOLD_TOKENS) * 10n ** 18n;
export const DEX_FACTORY_ADDRESS = AMM.v2Factory as `0x${string}`;
export const DEX_ROUTER_ADDRESS = AMM.v2Router as `0x${string}`;
export const V4_POSITION_MANAGER = AMM.v4PosMgr as `0x${string}`;
export const V4_POOL_MANAGER = AMM.v4PoolMgr as `0x${string}`;
export const PERMIT2_ADDRESS = AMM.permit2 as `0x${string}`;
export const V4_APPROVED_HOOKS = addressEnv("VITE_V4_APPROVED_HOOKS", "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
export const ROUTER_FEE_BPS = 100;
export const ROUTER_FEE_BPS_MIN = 70;
export const ROUTER_FEE_BPS_MAX = 120;
export const SLIPPAGE_DEFAULT_BPS = 50;
export const SLIPPAGE_OPTIONS_BPS = [50, 100] as const;
export const REQUIRED_HOLD_TOKENS = MIN_HOLD_TOKENS;
export const PLATFORM_TOKEN_SYMBOL = "PONSPOOL";
export const PONS_FAMILY_URL = `${EXPLORER_URL}/address/${PONSFAMILY_LAUNCHPAD}`;

export const PONSPOOL_ROUTER_ABI = [
  { type: "function", name: "isHolder", stateMutability: "view", inputs: [{ name: "who", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "requiredHoldAmount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "platformToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "platformTokenSet", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "setPlatformToken", stateMutability: "nonpayable", inputs: [{ name: "newToken", type: "address" }], outputs: [] },
  { type: "function", name: "buybackPoolSet", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "buybackMinOutPerEth", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "initializeV4", stateMutability: "nonpayable", inputs: [{ name: "key", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }, { name: "sqrtPriceX96", type: "uint160" }], outputs: [{ name: "tick", type: "int24" }] },
  { type: "function", name: "setBuybackPool", stateMutability: "nonpayable", inputs: [{ name: "key", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }, { name: "minOutPerEth", type: "uint256" }], outputs: [] },
  { type: "function", name: "clearBuybackPool", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "injectV3", stateMutability: "payable", inputs: [{ name: "token", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "tokenAmount", type: "uint256" }, { name: "tokenAmountMin", type: "uint256" }, { name: "ethAmountMin", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [{ name: "tokenId", type: "uint256" }, { name: "liquidity", type: "uint128" }] },
  { type: "function", name: "injectV4", stateMutability: "payable", inputs: [{ name: "key", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }, { name: "params", type: "tuple", components: [{ name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "liquidityDelta", type: "int256" }, { name: "salt", type: "bytes32" }] }, { name: "hookData", type: "bytes" }, { name: "tokenAmountMax", type: "uint256" }], outputs: [{ name: "deltaId", type: "bytes32" }] },
  { type: "function", name: "zapEthV4", stateMutability: "payable", inputs: [{ name: "key", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }, { name: "params", type: "tuple", components: [{ name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "liquidityDelta", type: "int256" }, { name: "swapEth", type: "uint256" }, { name: "minTokenOut", type: "uint256" }, { name: "recipient", type: "address" }] }, { name: "hookData", type: "bytes" }], outputs: [{ name: "deltaId", type: "bytes32" }] },
  { type: "event", name: "PlatformCut", inputs: [{ name: "payer", type: "address", indexed: true }, { name: "ethSpent", type: "uint256", indexed: false }, { name: "ponsIncinerated", type: "uint256", indexed: false }] },
  { type: "event", name: "DualInjected", inputs: [{ name: "version", type: "uint8", indexed: true }, { name: "token", type: "address", indexed: true }, { name: "recipient", type: "address", indexed: true }, { name: "ethIn", type: "uint256", indexed: false }, { name: "tokenIn", type: "uint256", indexed: false }, { name: "liquidity", type: "uint256", indexed: false }, { name: "positionId", type: "uint256", indexed: false }] },
  { type: "event", name: "EthZapped", inputs: [{ name: "version", type: "uint8", indexed: true }, { name: "token", type: "address", indexed: true }, { name: "recipient", type: "address", indexed: true }, { name: "ethIn", type: "uint256", indexed: false }, { name: "tokenIn", type: "uint256", indexed: false }, { name: "positionId", type: "uint256", indexed: false }] },
] as const;

export const PONSFAMILY_FACTORY_ABI = [
  {
    type: "function", name: "getLaunchedToken", stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "launch", type: "tuple", components: [
      { name: "token", type: "address" }, { name: "curve", type: "address" },
      { name: "deployer", type: "address" }, { name: "creatorFeeRecipient", type: "address" },
      { name: "pairToken", type: "address" }, { name: "graduationThreshold", type: "uint256" },
      { name: "poolFee", type: "uint24" }, { name: "tickSpacing", type: "int24" },
      { name: "creatorTaxBps", type: "uint16" }, { name: "buybackEnabled", type: "bool" },
      { name: "phase", type: "uint8" }, { name: "sweptQuote", type: "uint256" },
      { name: "sweptTokens", type: "uint256" }, { name: "sweptAt", type: "uint256" },
      { name: "exists", type: "bool" },
    ] }],
  },
] as const;

export const PONSFAMILY_CURVE_ABI = [
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "quoteIn", type: "uint256" }, { name: "minTokensOut", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [{ name: "tokensOut", type: "uint256" }] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "tokensIn", type: "uint256" }, { name: "minQuoteOut", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [{ name: "quoteOut", type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ name: "quoteReserve", type: "uint256" }, { name: "tokenReserve", type: "uint256" }] },
  { type: "function", name: "sellableTokens", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "creatorTaxBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "currentSnipeTaxBps", stateMutability: "view", inputs: [{ name: "recipient", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

export const v3FactoryAbi = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ name: "pool", type: "address" }] }] as const;
export const v3PoolAbi = [
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint8" }, { name: "unlocked", type: "bool" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint128" }] },
] as const;

export const v3MintAbi = [{ type: "function", name: "mint", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [{ name: "token0", type: "address" }, { name: "token1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "amount0Desired", type: "uint256" }, { name: "amount1Desired", type: "uint256" }, { name: "amount0Min", type: "uint256" }, { name: "amount1Min", type: "uint256" }, { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }] }], outputs: [{ name: "tokenId", type: "uint256" }, { name: "liquidity", type: "uint128" }, { name: "amount0", type: "uint256" }, { name: "amount1", type: "uint256" }] }] as const;
export const v4ModifyLiquiditiesAbi = [{ type: "function", name: "modifyLiquidities", stateMutability: "payable", inputs: [{ name: "unlockData", type: "bytes" }, { name: "deadline", type: "uint256" }], outputs: [] }] as const;
