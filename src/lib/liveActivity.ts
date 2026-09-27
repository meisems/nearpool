import { getAccount, getPublicClient } from "wagmi/actions";
import { decodeAbiParameters, decodeFunctionData, erc20Abi, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { config } from "./wagmi";
import {
  FEE_VAULT,
  BURN_ADDRESS,
  LEGACY_V3,
  V4_POSITION_MANAGER,
  PLATFORM_TOKEN_ADDRESS,
  PONSFAMILY_FACTORY_ADDRESS,
  PONSPOOL_TOKEN_ADDRESS,
  REQUIRED_HOLD_AMOUNT,
  ROBINHOOD_CHAIN_ID,
  WETH_ADDRESS,
} from "./constants";
import { v3MintAbi, v4ModifyLiquiditiesAbi } from "../config/contracts";
import { listConfirmedInjections, subscribeConfirmedInjections } from "./confirmedActivity";

type ReadOnlyClient = Pick<PublicClient, "readContract">;

/** A user-facing liquidity injection — what the landing page tx feed shows. */
export interface PlatformTx {
  hash: string;
  user: string;
  token: string;
  ethIn: bigint;
  tokenIn: bigint;
  kind: "buy" | "sell" | "inject" | "zap";
  minedAtBlock: number;
  /** Unix seconds from the confirmed block, when available. */
  timestamp?: number;
}

export interface ProtocolMetrics {
  poolsSeeded: number;
  ethPaired: bigint;
  ponsBurned: bigint;
}

const STORAGE_KEY = "ponspool.live-activity";
const EVENT_NAME = "ponspool:live-activity";
const START_BLOCK = BigInt(import.meta.env.VITE_ACTIVITY_START_BLOCK || "0");
let activeSync: Promise<LiveActivitySnapshot | null> | null = null;
let lastSyncFailureAt = 0;

export interface LiveActivitySnapshot {
  rows: PlatformTx[];
  metrics: ProtocolMetrics;
  syncedAt: number;
}

type StoredSnapshot = Omit<LiveActivitySnapshot, "rows" | "metrics" | "syncedAt"> & {
  rows: Array<Omit<PlatformTx, "tokenIn" | "ethIn"> & { tokenIn: string; ethIn: string }>;
  metrics: { poolsSeeded: number; ethPaired: string; ponsBurned: string };
  syncedAt: number;
};

function readCached(): LiveActivitySnapshot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as StoredSnapshot | null;
    if (!raw) return null;
    return {
      rows: raw.rows.filter((row) => row.kind === "buy" || row.kind === "sell" || row.kind === "inject" || row.kind === "zap").map((row) => ({ ...row, tokenIn: BigInt(row.tokenIn), ethIn: BigInt(row.ethIn) })),
      metrics: { poolsSeeded: raw.metrics.poolsSeeded, ethPaired: BigInt(raw.metrics.ethPaired), ponsBurned: BigInt(raw.metrics.ponsBurned) },
      syncedAt: raw.syncedAt,
    };
  } catch {
    return null;
  }
}

function writeCached(snapshot: LiveActivitySnapshot) {
  try {
    const stored: StoredSnapshot = {
      rows: snapshot.rows.map((row) => ({ ...row, tokenIn: row.tokenIn.toString(), ethIn: row.ethIn.toString() })),
      metrics: { poolsSeeded: snapshot.metrics.poolsSeeded, ethPaired: snapshot.metrics.ethPaired.toString(), ponsBurned: snapshot.metrics.ponsBurned.toString() },
      syncedAt: snapshot.syncedAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    /* Storage can be unavailable in privacy-restricted browsers. */
  }
}

function mergeWithLocalConfirmed(rows: PlatformTx[]): PlatformTx[] {
  const account = getAccount(config).address;
  const local = account ? listConfirmedInjections(20).map((item): PlatformTx => ({
    hash: item.hash,
    user: account,
    token: item.token,
    ethIn: item.ethIn,
    tokenIn: 0n,
    kind: item.mode === "zap" ? "zap" : "inject",
    minedAtBlock: Number.MAX_SAFE_INTEGER,
    timestamp: Math.floor(item.confirmedAt / 1000),
  })) : [];
  const seen = new Set(rows.map((row) => row.hash.toLowerCase()));
  const additions = local.filter((row) => !seen.has(row.hash.toLowerCase()));
  return [...additions, ...rows].filter((row) => row.kind === "buy" || row.kind === "sell" || row.kind === "inject" || row.kind === "zap");
}

function mergeSnapshot(snapshot: LiveActivitySnapshot): LiveActivitySnapshot {
  const rows = mergeWithLocalConfirmed(snapshot.rows);
  if (rows === snapshot.rows) return snapshot;
  return {
    ...snapshot,
    rows,
    metrics: {
      ...snapshot.metrics,
      poolsSeeded: rows.length,
      ethPaired: rows.reduce((sum, row) => sum + row.ethIn, 0n),
    },
  };
}

async function fetchSharedPosts(): Promise<PlatformTx[]> {
  try {
    const response = await fetch("/api/activity/posts", { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json() as { posts?: Array<Omit<PlatformTx, "ethIn" | "tokenIn"> & { ethIn: string; tokenIn?: string }> };
    return (payload.posts ?? []).map((post) => ({
      ...post,
      ethIn: BigInt(post.ethIn),
      tokenIn: BigInt(post.tokenIn ?? "0"),
    }));
  } catch {
    return [];
  }
}

export function cachedLiveActivity(): LiveActivitySnapshot | null {
  const cached = readCached();
  if (!cached) return null;
  return mergeSnapshot(cached);
}

export function subscribeLiveActivity(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  const onLocal = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT_NAME, onLocal);
  // A just-confirmed injection is available locally before Blockscout indexes
  // it. Forward that event so the homepage immediately merges it into the
  // feed instead of waiting for the next successful explorer sync.
  const unsubscribeConfirmed = subscribeConfirmedInjections(listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT_NAME, onLocal);
    unsubscribeConfirmed();
  };
}

function isV3PositionManager(to: string | undefined): boolean {
  return !!to && to.toLowerCase() === LEGACY_V3.positionManager.toLowerCase();
}

function decodeV3Mint(input: string): { token: Address; ethIn: bigint } | null {
  try {
    const decoded = decodeFunctionData({ abi: v3MintAbi, data: input as `0x${string}` });
    if (decoded.functionName !== "mint") return null;
    const params = decoded.args[0] as {
      token0: Address;
      token1: Address;
      amount0Desired: bigint;
      amount1Desired: bigint;
      recipient: Address;
    };
    const wethIsToken0 = params.token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
    const token = (wethIsToken0 ? params.token1 : params.token0) as Address;
    const ethIn = wethIsToken0 ? params.amount0Desired : params.amount1Desired;
    // The production flow is ETH-only. Ignore unrelated V3 mints with a
    // non-zero creator-token leg so the public feed remains protocol-specific.
    if (ethIn <= 0n || (wethIsToken0 ? params.amount1Desired : params.amount0Desired) !== 0n) return null;
    if (params.recipient.toLowerCase() !== BURN_ADDRESS.toLowerCase()) return null;
    return { token, ethIn };
  } catch {
    return null;
  }
}

function isV4PositionManager(to: string | undefined): boolean {
  return !!to && to.toLowerCase() === V4_POSITION_MANAGER.toLowerCase();
}

function decodeV4Mint(input: string, txValue: string): { token: Address; ethIn: bigint } | null {
  try {
    const decoded = decodeFunctionData({ abi: v4ModifyLiquiditiesAbi, data: input as Hex });
    if (decoded.functionName !== "modifyLiquidities") return null;
    const unlockData = decoded.args[0] as Hex;
    const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], unlockData);
    // Either MINT_POSITION (0x02) + SETTLE_PAIR (0x0d), or
    // INITIALIZE_POOL (0x01) + MINT_POSITION + SETTLE_PAIR.
    const initialized = actions.toLowerCase().startsWith("0x01020d");
    if (!initialized && !actions.toLowerCase().startsWith("0x020d")) return null;
    const mintParam = params[initialized ? 1 : 0];
    if (!mintParam) return null;
    const [mint] = decodeAbiParameters([{
      type: "tuple",
      components: [
        { name: "poolKey", type: "tuple", components: [
          { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
        ] },
        { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
        { name: "liquidity", type: "uint256" }, { name: "amount0Max", type: "uint128" },
        { name: "amount1Max", type: "uint128" }, { name: "owner", type: "address" },
        { name: "hookData", type: "bytes" },
      ],
    }], mintParam);
    const mintData = mint as any;
    const poolKey = mintData.poolKey as { currency0: Address; currency1: Address };
    const amount0Max = BigInt(mintData.amount0Max ?? 0n);
    const amount1Max = BigInt(mintData.amount1Max ?? 0n);
    if (poolKey.currency0.toLowerCase() !== "0x0000000000000000000000000000000000000000" || amount0Max <= 0n || amount1Max !== 0n) return null;
    if (mintData.owner.toLowerCase() !== BURN_ADDRESS.toLowerCase()) return null;
    const ethIn = BigInt(txValue || "0");
    return ethIn > 0n ? { token: poolKey.currency1, ethIn } : null;
  } catch {
    return null;
  }
}

async function fetchFeeVaultPayers(fromBlock: bigint, latest: bigint): Promise<Map<string, number[]>> {
  const url = new URL("/api/explorer", window.location.origin);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", FEE_VAULT);
  url.searchParams.set("startblock", fromBlock.toString());
  url.searchParams.set("endblock", latest.toString());
  url.searchParams.set("sort", "asc");
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`fee-vault explorer request failed (${response.status})`);
  const payload = await response.json() as { result?: unknown };
  const map = new Map<string, number[]>();
  if (!Array.isArray(payload.result)) return map;
  for (const item of payload.result) {
    const tx = item as { from?: string; to?: string; value?: string; blockNumber?: string; isError?: string };
    if (!tx.from || tx.to?.toLowerCase() !== FEE_VAULT.toLowerCase() || tx.isError === "1") continue;
    if (!(BigInt(tx.value ?? "0") > 0n)) continue;
    const key = tx.from.toLowerCase();
    const arr = map.get(key) ?? [];
    arr.push(Number(tx.blockNumber ?? 0));
    map.set(key, arr);
  }
  return map;
}

// A fee-vault payment and the position-manager mint are two separate
// sequential user-signed transactions, so allow some slack between them
// rather than requiring the same block.
const FEE_PAYMENT_WINDOW_BLOCKS = 200;

function hasNearbyFeePayment(payerBlocks: number[] | undefined, mintBlock: number): boolean {
  if (!payerBlocks?.length) return false;
  return payerBlocks.some((block) => block <= mintBlock && mintBlock - block <= FEE_PAYMENT_WINDOW_BLOCKS);
}

async function wasQualifyingHolderAt(client: ReadOnlyClient, user: Address, block: bigint): Promise<boolean> {
  try {
    const balance = await client.readContract({
      address: PLATFORM_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user],
      blockNumber: block,
    });
    return balance >= REQUIRED_HOLD_AMOUNT;
  } catch (historicalError) {
    // Many RPC endpoints (including non-archive nodes, which is common for
    // newer chains) only serve current state and reject a balanceOf pinned
    // to a past block — every historical read would then fail, silently
    // dropping every fee-exempt holder's real transaction from the shared
    // feed. Current balance is an imperfect but far better fallback than
    // treating "the RPC can't answer this" as "not a holder".
    try {
      const currentBalance = await client.readContract({
        address: PLATFORM_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [user],
      });
      return currentBalance >= REQUIRED_HOLD_AMOUNT;
    } catch (currentError) {
      console.warn("Holder balance check failed for both historical and current block.", historicalError, currentError);
      return false;
    }
  }
}

// Cap how many unmatched candidates get an extra historical-balance RPC
// read per sync cycle — recent activity is what the feed shows anyway, so
// older unverifiable candidates beyond this cap are simply dropped rather
// than paying for an unbounded number of extra chain reads.
const HOLDER_VERIFICATION_CAP = 80;

/**
 * Uniswap's V3/V4 position managers and the 0x…dEaD burn address are shared,
 * generic infrastructure — any project that locks liquidity the same way
 * (single-sided ETH mint, LP sent to the dead address) decodes identically
 * to a ponspool injection, even though it has nothing to do with ponspool.
 * This verifies each candidate actually went through ponspool's fee model:
 * either the sender paid the fee vault nearby (non-holder flow), or the
 * sender held the required platform-token threshold at that exact block
 * (holder-exempt flow — mirrors the router's own on-chain gate). Anything
 * that matches neither is someone else's unrelated liquidity lock.
 */
async function verifyPonspoolRows(client: ReadOnlyClient, candidates: PlatformTx[], fromBlock: bigint, latest: bigint): Promise<PlatformTx[]> {
  const feeVaultPayers = await fetchFeeVaultPayers(fromBlock, latest).catch((error) => {
    console.warn("Fee-vault correlation unavailable this cycle; falling back to holder checks only.", error);
    return new Map<string, number[]>();
  });

  const sorted = [...candidates].sort((a, b) => b.minedAtBlock - a.minedAtBlock);
  const verified: PlatformTx[] = [];
  let holderChecksUsed = 0;

  for (const row of sorted) {
    if (hasNearbyFeePayment(feeVaultPayers.get(row.user.toLowerCase()), row.minedAtBlock)) {
      verified.push(row);
      continue;
    }
    if (holderChecksUsed >= HOLDER_VERIFICATION_CAP) continue;
    holderChecksUsed += 1;
    if (await wasQualifyingHolderAt(client, row.user as Address, BigInt(row.minedAtBlock))) {
      verified.push(row);
    }
  }
  return verified;
}

async function fetchV3Mints(client: ReadOnlyClient, fromBlock: bigint, latest: bigint): Promise<PlatformTx[]> {
  const fetchFor = async (positionManager: Address) => {
    // Same-origin proxy (see server.mjs / render.yaml / vercel.json) instead of
    // calling the block explorer directly from the browser. Different browsers
    // and in-app webviews (Facebook, Instagram, etc.) apply different
    // cross-origin and third-party-request policies, so two visitors hitting
    // the explorer straight from the client can legitimately get different
    // results. Routing everyone through our own domain, backed by a short
    // shared cache, guarantees every visitor sees the same on-chain data.
    const url = new URL("/api/explorer", window.location.origin);
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "txlist");
    url.searchParams.set("address", positionManager);
    url.searchParams.set("startblock", fromBlock.toString());
    url.searchParams.set("endblock", latest.toString());
    url.searchParams.set("page", "1");
    url.searchParams.set("offset", "1000");
    url.searchParams.set("sort", "desc");
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Uniswap activity explorer request failed (${response.status})`);
    const payload = await response.json() as { result?: unknown };
    if (!Array.isArray(payload.result)) return [];
    const rows: PlatformTx[] = [];
    for (const item of payload.result) {
      const tx = item as { hash?: string; from?: Address; to?: string; input?: string; value?: string; blockNumber?: string; timeStamp?: string; isError?: string };
      if (!tx.hash || !tx.from || tx.isError === "1") continue;
      const decoded = isV3PositionManager(tx.to)
        ? decodeV3Mint(tx.input ?? "0x")
        : isV4PositionManager(tx.to)
          ? decodeV4Mint(tx.input ?? "0x", tx.value ?? "0")
          : null;
      if (!decoded) continue;
      // Retained only as legacy decoder code; this function is no longer called
      // by the trade-only sync path below.
      rows.push({ hash: tx.hash, user: tx.from, token: decoded.token, kind: "buy", ethIn: decoded.ethIn, tokenIn: 0n, minedAtBlock: Number(tx.blockNumber ?? 0), timestamp: Number(tx.timeStamp ?? 0) || undefined });
    }
    return rows;
  };
  const [v3Rows, v4Rows] = await Promise.all([fetchFor(LEGACY_V3.positionManager), fetchFor(V4_POSITION_MANAGER)]);
  return verifyPonspoolRows(client, [...v3Rows, ...v4Rows], fromBlock, latest);
}

/** Pons v2 CurveBuy is shared by ponsfamily.com and ponspool. */
async function fetchPonsPoolBuys(client: PublicClient, fromBlock: bigint, latest: bigint): Promise<PlatformTx[]> {
  try {
    const launch = await client.readContract({
      address: PONSFAMILY_FACTORY_ADDRESS,
      abi: [{ type: "function", name: "getLaunchedToken", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "launch", type: "tuple", components: [
        { name: "token", type: "address" }, { name: "curve", type: "address" }, { name: "deployer", type: "address" },
        { name: "creatorFeeRecipient", type: "address" }, { name: "pairToken", type: "address" }, { name: "graduationThreshold", type: "uint256" },
        { name: "poolFee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "creatorTaxBps", type: "uint16" },
        { name: "buybackEnabled", type: "bool" }, { name: "phase", type: "uint8" }, { name: "sweptQuote", type: "uint256" },
        { name: "sweptTokens", type: "uint256" }, { name: "sweptAt", type: "uint256" }, { name: "exists", type: "bool" },
      ] }] }],
      functionName: "getLaunchedToken",
      args: [PONSPOOL_TOKEN_ADDRESS],
    }) as { curve: Address; pairToken: Address; exists: boolean };
    if (!launch.exists || !launch.curve || launch.pairToken.toLowerCase() !== "0x0000000000000000000000000000000000000000") return [];
    const [buyLogs, sellLogs] = await Promise.all([
      client.getLogs({
      address: launch.curve,
      event: parseAbiItem("event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)"),
      fromBlock,
      toBlock: latest,
      }),
      client.getLogs({
        address: launch.curve,
        event: parseAbiItem("event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)"),
        fromBlock,
        toBlock: latest,
      }),
    ]);
    const timestamps = new Map<bigint, number>();
    const logs = [...buyLogs, ...sellLogs];
    await Promise.all([...new Set(logs.map((log) => log.blockNumber).filter((block): block is bigint => block !== undefined))].map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        timestamps.set(blockNumber, Number(block.timestamp));
      } catch {
        /* The row remains valid if an RPC cannot return its block timestamp. */
      }
    }));
    const buyRows = buyLogs.flatMap((log) => {
      const { buyer, quoteIn, tokensOut } = log.args;
      if (!log.transactionHash || !buyer || quoteIn === undefined || tokensOut === undefined) return [];
      return [{
        hash: log.transactionHash,
        user: buyer,
        token: PONSPOOL_TOKEN_ADDRESS,
        ethIn: quoteIn,
        tokenIn: tokensOut,
        kind: "buy" as const,
        minedAtBlock: Number(log.blockNumber ?? 0n),
        timestamp: log.blockNumber === undefined ? undefined : timestamps.get(log.blockNumber),
      }];
    });
    const sellRows = sellLogs.flatMap((log) => {
      const { seller, quoteOut, tokensIn } = log.args;
      if (!log.transactionHash || !seller || quoteOut === undefined || tokensIn === undefined) return [];
      return [{
        hash: log.transactionHash,
        user: seller,
        token: PONSPOOL_TOKEN_ADDRESS,
        ethIn: quoteOut,
        tokenIn: tokensIn,
        kind: "sell" as const,
        minedAtBlock: Number(log.blockNumber ?? 0n),
        timestamp: log.blockNumber === undefined ? undefined : timestamps.get(log.blockNumber),
      }];
    });
    return [...buyRows, ...sellRows];
  } catch (error) {
    console.warn("PonsFamily/PonsPool buy sync unavailable this cycle.", error);
    return [];
  }
}

async function fetchLivePrices(): Promise<{ ethUsd: number; ponsUsd: number }> {
  // Also same-origin proxied — CoinGecko/Dexscreener are free, aggressively
  // rate-limited public APIs. Every visitor's browser hitting them directly
  // means some fraction get 429'd or silently blocked at any moment; routing
  // through our own cached proxy means everyone shares one real, fresh result.
  const [ethResponse, ponsResponse] = await Promise.all([
    fetch("/api/price/eth"),
    fetch(`/api/price/pons/${PLATFORM_TOKEN_ADDRESS}`),
  ]);
  if (!ethResponse.ok || !ponsResponse.ok) throw new Error("live price request failed");
  const ethPayload = await ethResponse.json() as { ethereum?: { usd?: number } };
  const ponsPayload = await ponsResponse.json() as { pairs?: Array<{ priceUsd?: string; liquidity?: { usd?: number } }> };
  const ethUsd = Number(ethPayload.ethereum?.usd ?? 0);
  const bestPair = [...(ponsPayload.pairs ?? [])].sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];
  const ponsUsd = Number(bestPair?.priceUsd ?? 0);
  if (!Number.isFinite(ethUsd) || !Number.isFinite(ponsUsd) || ethUsd <= 0 || ponsUsd <= 0) throw new Error("live price unavailable");
  return { ethUsd, ponsUsd };
}

async function estimateBuybackPons(fromBlock: bigint, latest: bigint, prices: { ethUsd: number; ponsUsd: number }): Promise<bigint> {
  const url = new URL("/api/explorer", window.location.origin);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", FEE_VAULT);
  url.searchParams.set("startblock", fromBlock.toString());
  url.searchParams.set("endblock", latest.toString());
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "1000");
  url.searchParams.set("sort", "asc");
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`fee-vault explorer request failed (${response.status})`);
  const payload = await response.json() as { result?: unknown };
  if (!Array.isArray(payload.result)) return 0n;
  const scale = 100_000_000n;
  const ethUsd = BigInt(Math.round(prices.ethUsd * Number(scale)));
  const ponsUsd = BigInt(Math.round(prices.ponsUsd * Number(scale)));
  return payload.result.reduce((sum, item) => {
    const tx = item as { to?: string; value?: string; isError?: string };
    if (tx.to?.toLowerCase() !== FEE_VAULT.toLowerCase() || tx.isError === "1") return sum;
    try { return sum + (BigInt(tx.value ?? "0") * ethUsd) / ponsUsd; } catch { return sum; }
  }, 0n);
}

async function syncLiveActivityInternal(): Promise<LiveActivitySnapshot | null> {
  const client = await getPublicClient(config, { chainId: ROBINHOOD_CHAIN_ID });
  if (!client) return null;
  const latest = await client.getBlockNumber();
  if (START_BLOCK > latest) return null;

  const previous = readCached();
  const sharedRows = await fetchSharedPosts();

  // Real on-chain transactions are the one thing that must never go missing.
  // Previously this was bundled into a single Promise.all with the price
  // lookup below, so a rate-limited/blocked price API silently wiped out
  // successfully-fetched real transactions too — leaving each browser stuck
  // showing whatever stale snapshot happened to already be in its own
  // localStorage. That's why different browsers appeared to show different
  // (and increasingly "made up" looking) activity. Now a price failure only
  // affects the estimated-buyback figure, never the transaction feed.
  let rows: PlatformTx[];
  try {
    rows = [...sharedRows, ...(await fetchPonsPoolBuys(client, START_BLOCK, latest))];
  } catch (error) {
    console.warn("Live transaction sync failed; keeping last known snapshot.", error);
    if (previous || sharedRows.length) {
      const mergedRows = mergeWithLocalConfirmed([...sharedRows, ...(previous?.rows ?? [])]);
      return {
        rows: mergedRows,
        metrics: previous?.metrics ?? {
          poolsSeeded: mergedRows.length,
          ethPaired: mergedRows.reduce((sum, row) => sum + row.ethIn, 0n),
          ponsBurned: 0n,
        },
        syncedAt: Date.now(),
      };
    }
    return previous;
  }
  rows = mergeWithLocalConfirmed([...sharedRows, ...rows]);
  rows.sort((a, b) => b.minedAtBlock - a.minedAtBlock);

  let ponsBurned = previous?.metrics.ponsBurned ?? 0n;
  try {
    const prices = await fetchLivePrices();
    ponsBurned = await estimateBuybackPons(START_BLOCK, latest, prices);
  } catch (error) {
    console.warn("Buyback estimate unavailable this cycle; keeping previous figure.", error);
  }

  const snapshot: LiveActivitySnapshot = {
    rows: rows.slice(0, 40),
    metrics: {
      poolsSeeded: rows.length,
      ethPaired: rows.reduce((sum, row) => sum + row.ethIn, 0n),
      // Statistical estimate: fee-vault ETH × ETH/USD ÷ PONS/USD.
      // The actual wallet burn is performed manually and is independently verifiable.
      ponsBurned,
    },
    syncedAt: Date.now(),
  };
  writeCached(snapshot);
  return snapshot;
}

export function syncLiveActivity(): Promise<LiveActivitySnapshot | null> {
  if (activeSync) return activeSync;
  activeSync = syncLiveActivityInternal()
    .then((snapshot) => (snapshot ? mergeSnapshot(snapshot) : snapshot))
    .catch((error) => {
      if (Date.now() - lastSyncFailureAt > 60_000) {
        lastSyncFailureAt = Date.now();
        console.warn("Public activity sync unavailable; using cached activity.", error);
      }
      return null;
    })
    .finally(() => {
      activeSync = null;
    });
  return activeSync;
}

export const EMPTY_LIVE_METRICS: ProtocolMetrics = { poolsSeeded: 0, ethPaired: 0n, ponsBurned: 0n };
