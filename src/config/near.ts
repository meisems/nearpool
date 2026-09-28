/**
 * Canonical NEAR mainnet + Ref Finance configuration.
 *
 * Every contract ID, RPC endpoint, gas budget and storage amount the app
 * uses lives here so the transaction builder, the read layer and the UI
 * always agree. Values can be overridden per deployment through Vite env
 * vars, but the defaults are the production mainnet contracts.
 */

const env = import.meta.env;

export const NETWORK_ID = "mainnet" as const;

/**
 * Primary RPC endpoint. Additional endpoints are used as ordered fallbacks.
 * A path such as "/api/rpc" means this site's own RPC proxy (worker/rpcProxy.ts),
 * which keeps a keyed provider's API key off the client.
 */
function resolveRpcUrl(value: string): string {
  if (value.startsWith("/") && typeof window !== "undefined") return new URL(value, window.location.origin).toString();
  return value;
}
export const NODE_URL: string = resolveRpcUrl(env.VITE_NEAR_RPC_URL || "https://rpc.mainnet.near.org");

const DEFAULT_FALLBACK_RPC_URLS = [
  "https://free.rpc.fastnear.com",
  "https://rpc.mainnet.fastnear.com",
];

/** Comma-separated override: VITE_NEAR_FALLBACK_RPC_URLS="https://a,https://b". */
export const FALLBACK_RPC_URLS: string[] = (
  env.VITE_NEAR_FALLBACK_RPC_URLS
    ? String(env.VITE_NEAR_FALLBACK_RPC_URLS).split(",")
    : DEFAULT_FALLBACK_RPC_URLS
)
  .map((url: string) => url.trim())
  .filter((url: string) => url.length > 0 && url !== NODE_URL);

export const RPC_URLS: string[] = [NODE_URL, ...FALLBACK_RPC_URLS];

/**
 * RPC for Ref Finance reads: pools, deposits, shares, swap quotes. Set it to
 * "/api/rpc" to send these through the Worker's proxy, which uses the
 * NEAR_RPC_URL secret (e.g. Lava). The public RPCs above are the fallbacks.
 * Unset, Ref reads use the same endpoints as everything else.
 */
const configuredPoolRpcUrl = String(env.VITE_POOL_RPC_URL || "").trim();
export const POOL_RPC_URL: string = configuredPoolRpcUrl ? resolveRpcUrl(configuredPoolRpcUrl) : NODE_URL;
// A same-origin proxy owns its server-side fallbacks. Do not append public
// RPC URLs here: the browser may not have CORS access to them, and retrying
// them client-side duplicates rate-limited requests after the proxy fails.
export const POOL_RPC_URLS: string[] = configuredPoolRpcUrl.startsWith("/")
  ? [POOL_RPC_URL]
  : [POOL_RPC_URL, ...RPC_URLS.filter((url) => url !== POOL_RPC_URL)];

export const REF_FINANCE_CONTRACT_ID: string = env.VITE_REF_CONTRACT_ID || "v2.ref-finance.near";
/**
 * Rhea (Ref) concentrated-liquidity contract. Launchpads such as NearPaid
 * list coins here only, so NEAR-only deposits and swaps can buy through it.
 */
export const DCL_CONTRACT_ID: string = env.VITE_DCL_CONTRACT_ID || "dclv2.ref-labs.near";
/** DCL fee tiers (hundredths of a basis point: 10000 = 1%). */
export const DCL_FEE_TIERS = [100, 400, 2000, 10000] as const;
export const WRAP_NEAR_CONTRACT_ID: string = env.VITE_WRAP_NEAR_CONTRACT_ID || "wrap.near";
export const EXPLORER_URL: string = (env.VITE_EXPLORER_URL || "https://nearblocks.io").replace(/\/+$/, "");

export const explorerTxUrl = (txHash: string) => `${EXPLORER_URL}/txns/${txHash}`;
export const explorerAccountUrl = (accountId: string) => `${EXPLORER_URL}/address/${accountId}`;
/**
 * Rhea (formerly Ref Finance) pool page. Link straight to the pool: Rhea's
 * pool list hides low-liquidity pools and unlisted tokens, so a new pool
 * won't show up by searching there.
 */
export const RHEA_APP_URL = "https://app.rhea.finance";
export const refPoolUrl = (poolId: number) => `${RHEA_APP_URL}/pool/${poolId}`;

/* ------------------------------------------------------------ units */

export const NEAR_DECIMALS = 24;
/** 1 NEAR = 10^24 yoctoNEAR. */
export const YOCTO_PER_NEAR = 10n ** 24n;
export const ONE_YOCTO = 1n;

/** 1 TGas = 10^12 gas units. */
export const TGAS = 10n ** 12n;

/* ------------------------------------------------------------ gas */

export const GAS = {
  /** NEP-145 `storage_deposit` on a token contract or Ref. */
  STORAGE_DEPOSIT: 30n * TGAS,
  /** Ref `register_tokens` (adds non-whitelisted tokens to the user's Ref account). */
  REGISTER_TOKENS: 30n * TGAS,
  /** wrap.near `near_deposit`. */
  NEAR_DEPOSIT: 10n * TGAS,
  /** NEP-141 `ft_transfer_call` depositing into Ref's internal balance. */
  FT_TRANSFER_CALL: 50n * TGAS,
  /** Ref `add_liquidity`. */
  ADD_LIQUIDITY: 100n * TGAS,
  /** NEP-141 `ft_transfer_call` carrying a single-hop Ref instant swap. */
  SWAP: 180n * TGAS,
  /** Ref `add_simple_pool`. */
  ADD_SIMPLE_POOL: 50n * TGAS,
  /** Two-hop instant swap (Ref SDK uses up to 300 TGas for routed swaps). */
  SWAP_MULTI_HOP: 280n * TGAS,
  /** Ref `swap` on the user's internal deposits (no cross-contract calls; up to two hops). */
  REF_SWAP: 50n * TGAS,
  /** `ft_transfer_call` into the Rhea DCL contract carrying a `Swap` (Ref SDK: 180 TGas). */
  DCL_SWAP: 180n * TGAS,
  /** Ref `mft_register` / `mft_transfer` of LP shares. */
  MFT: 30n * TGAS,
} as const;

/**
 * Where locked LP shares go: the all-zero implicit account. Its key would be
 * the ed25519 public key 0x00…00, whose private key nobody knows, so shares
 * sent here can never be withdrawn by anyone.
 */
export const LP_LOCK_ACCOUNT_ID = "0".repeat(64);

/** Hard protocol limit for a single transaction's prepaid gas. */
export const MAX_GAS_PER_TX = 300n * TGAS;

/* ------------------------------------------------------------ storage */

/**
 * Fallback NEP-145 registration deposit when a token doesn't expose
 * `storage_balance_bounds` (0.0125 NEAR — the Ref SDK's
 * FT_MINIMUM_STORAGE_BALANCE_LARGE). Unused collateral above the token's
 * real minimum is refunded by `registration_only: true`.
 */
export const FT_STORAGE_DEPOSIT_FALLBACK = 12_500_000_000_000_000_000_000n; // 0.0125 NEAR

/**
 * First-time Ref Finance account registration (Ref SDK:
 * STORAGE_TO_REGISTER_WITH_MFT = 0.1 NEAR). Sent with
 * `registration_only: false` so the surplus stays as storage headroom for
 * the token entries the deposits below will create.
 */
export const REF_ACCOUNT_REGISTRATION_DEPOSIT = 100_000_000_000_000_000_000_000n; // 0.1 NEAR

/** Minimum top-up when an already-registered Ref account is short on storage. */
export const REF_STORAGE_TOP_UP = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

/**
 * Conservative storage headroom required on Ref per token entry that a
 * deposit will add to the user's account (~250 bytes at 10^19 yocto/byte).
 */
export const REF_STORAGE_PER_TOKEN = 2_500_000_000_000_000_000_000n; // 0.0025 NEAR

/**
 * Attached to `add_liquidity` when the user has no LP shares in the pool
 * yet, so Ref can charge the new share record's storage. Ref refunds
 * everything that isn't consumed (`internal_check_storage`). Existing
 * liquidity providers attach exactly 1 yoctoNEAR.
 */
export const LP_STORAGE_DEPOSIT = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

/**
 * Attached to `add_simple_pool` to pay for the new pool's storage. Ref
 * charges the actual storage used and refunds the rest.
 */
export const POOL_CREATION_DEPOSIT = 100_000_000_000_000_000_000_000n; // 0.1 NEAR

/** Native NEAR kept back from "max" inputs and balance checks to pay gas. */
export const NEAR_GAS_RESERVE = 50_000_000_000_000_000_000_000n; // 0.05 NEAR

/** Storage staking cost on NEAR: 10^19 yoctoNEAR per byte. */
export const STORAGE_PRICE_PER_BYTE = 10n ** 19n;

/* ------------------------------------------------------------ platform fee */

/**
 * Interface fee: a plain NEAR transfer appended as the last transaction of
 * every injection, swap and pool creation batch. It's charged by this front
 * end, not by a contract, so it can't be forced on someone calling Ref
 * directly. All fees go to FEE_RECEIVER_ID and fund buyback-and-burn and
 * platform development. Set VITE_FEE_NEAR=0 to disable.
 */
export const FEE_RECEIVER_ID: string = (env.VITE_FEE_RECEIVER || "nearpoolpf.near").trim().toLowerCase();

function parseNearAmount(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,24}))?$/.exec(value.trim());
  if (!match) throw new Error(`invalid VITE_FEE_NEAR: ${value}`);
  return BigInt(match[1]) * YOCTO_PER_NEAR + BigInt((match[2] ?? "").padEnd(24, "0") || "0");
}

/** Fee per injection, swap or pool creation, in yoctoNEAR (default 0.1 NEAR). */
export const FEE_AMOUNT: bigint = parseNearAmount(env.VITE_FEE_NEAR ?? "0.1");

/** False when the fee is configured to zero or no receiver is set. */
export const FEE_ENABLED = FEE_AMOUNT > 0n && FEE_RECEIVER_ID.length > 0;

/* ------------------------------------------------------------ slippage */

export const SLIPPAGE_DEFAULT_BPS = 50;
export const SLIPPAGE_OPTIONS_BPS = [10, 50, 100] as const;
export const SLIPPAGE_MAX_BPS = 5_000;

/* ------------------------------------------------------------ token presets */

export interface TokenPreset {
  id: string;
  symbol: string;
  decimals: number;
}

export const NEAR_TOKEN: TokenPreset = { id: WRAP_NEAR_CONTRACT_ID, symbol: "NEAR", decimals: NEAR_DECIMALS };

export const COMMON_TOKENS: TokenPreset[] = [
  NEAR_TOKEN,
  { id: "nearpool-553815.nearpaid.near", symbol: "NEARPOOL", decimals: 18 },
  { id: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", decimals: 6 },
  { id: "usdt.tether-token.near", symbol: "USDt", decimals: 6 },
  { id: "token.v2.ref-finance.near", symbol: "REF", decimals: 18 },
  { id: "meta-pool.near", symbol: "stNEAR", decimals: 24 },
  { id: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", symbol: "AURORA", decimals: 18 },
];

/**
 * Common pairs offered as one-click shortcuts. Pool IDs are resolved
 * on-chain at runtime (deepest SIMPLE_POOL containing both tokens) rather
 * than hard-coded, so a migrated or re-deployed pool is picked up
 * automatically.
 */
export const COMMON_PAIRS: Array<[string, string]> = [
  [WRAP_NEAR_CONTRACT_ID, "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"],
  [WRAP_NEAR_CONTRACT_ID, "usdt.tether-token.near"],
  [WRAP_NEAR_CONTRACT_ID, "token.v2.ref-finance.near"],
  [WRAP_NEAR_CONTRACT_ID, "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near"],
];

/** Optional: enables WalletConnect (QR pairing with mobile wallets). Get one at cloud.reown.com. */
export const WALLETCONNECT_PROJECT_ID: string = (env.VITE_WALLETCONNECT_PROJECT_ID || "").trim();

export const PROJECT_NAME = "nearpool";
