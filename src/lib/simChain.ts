/**
 * In-memory Robinhood Chain node behind an EIP-1193 provider. viem's `custom`
 * transport talks to it, so every wagmi hook runs the real client code path.
 *
 * Contract architecture: the PonspoolRouter wrapper executes atomic zaps and
 * dual injections on Uniswap V4. The holder gate is enforced inside the
 * router; non-holder cuts are market-bought into $PONSPOOL via a direct V4
 * PoolManager swap (no V2 pair) and burned to 0x...dEaD in the same
 * transaction.
 *
 * VITE_USE_SEEDED_DATA=false strips every curated artifact: the demo token
 * registry, pre-seeded pair depth, baseline metrics and sandbox drips.
 */
import {
  encodeFunctionResult, keccak256, toHex, getAddress, numberToHex,
  parseEther, parseUnits, erc20Abi, toFunctionSelector,
} from "viem";
import {
  DEX_FACTORY_ADDRESS,
  DEX_ROUTER_ADDRESS,
  WETH_ADDRESS,
  PLATFORM_TOKEN_ADDRESS,
  PONSPOOL_ROUTER_ADDRESS,
  REQUIRED_HOLD_AMOUNT,
  ROUTER_FEE_BPS,
  ROBINHOOD_CHAIN_ID,
  ZERO_ADDRESS,
  USE_SEEDED_DATA,
} from "./constants";
import { PONSPOOL_ROUTER_ABI } from "../config/contracts";
import { calculateV2ZapSwapAmount, getAmountOut } from "../utils/zapMath";

/* ------------------------------------------------------------------ types */

interface RegToken {
  symbol: string;
  name: string;
  decimals: number;
}

interface PairState {
  a: string; // token0 (sorted)
  b: string; // token1
  reserveA: bigint;
  reserveB: bigint;
  lpSupply: bigint;
  initialized: boolean;
}

export type SimTxKind = "approve" | "inject" | "swap" | "zap" | "transfer";

export interface SimTx {
  hash: string;
  from: string;
  to: string;
  kind: SimTxKind;
  value: bigint;
  minedAtBlock: number;
  meta?: Record<string, unknown>;
}

export interface TxOutcome {
  kind: SimTxKind;
  version: 4;
  mode: "dual" | "zap";
  token: string;
  ethIn: bigint;
  tokenIn: bigint;
  swapIn?: bigint;
  lpMinted?: bigint;
  positionId?: bigint;
  pair: string;
  feeEth: bigint;
  burnedPons: bigint;
  recipient: string;
}

export interface ProtocolMetrics {
  poolsSeeded: number;
  ethPaired: bigint;
  ponsBurned: bigint;
}

export type ChainEvent =
  | { type: "block"; block: number }
  | { type: "tx"; tx: SimTx }
  | { type: "faucet"; to: string; asset: "eth" | "pons" | "token"; amount: bigint; symbol?: string }
  | { type: "metrics"; metrics: ProtocolMetrics };

/* ------------------------------------------------------- token registry */

const PONS = PLATFORM_TOKEN_ADDRESS.toLowerCase();
const WETH = WETH_ADDRESS.toLowerCase();

const SEEDED = USE_SEEDED_DATA;

const REGISTRY: Record<string, RegToken> = SEEDED
  ? {
      ["0x6b175474e89094c44da98b954eedeac495271d0f"]: { symbol: "HOOD", name: "Robinhood Inu", decimals: 18 },
      ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]: { symbol: "NECK", name: "Necklace Protocol", decimals: 18 },
      ["0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce"]: { symbol: "FEZR", name: "Fez Reserve", decimals: 9 },
      ["0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"]: { symbol: "MIST", name: "Mist Token", decimals: 18 },
      [PONS]: { symbol: "PONSPOOL", name: "PonsPool", decimals: 18 },
      [WETH]: { symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    }
  : {
      [PONS]: { symbol: "PONSPOOL", name: "PonsPool", decimals: 18 },
      [WETH]: { symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    };

const PAIR_SEEDS: Array<{ a: string; b: string; rA: bigint; rB: bigint; lp: bigint; init: boolean }> = SEEDED
  ? [
      { a: PONS, b: WETH, rA: parseUnits("4200000000", 18), rB: parseEther("42"), lp: parseEther("420"), init: true },
      { a: "0x6b175474e89094c44da98b954eedeac495271d0f", b: WETH, rA: parseUnits("8400000000", 18), rB: parseEther("42"), lp: parseEther("1842"), init: true },
      { a: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", b: WETH, rA: parseUnits("1250000", 18), rB: parseEther("12.5"), lp: parseEther("312"), init: true },
      { a: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", b: WETH, rA: parseUnits("700000000", 9), rB: parseEther("7"), lp: parseEther("96"), init: true },
      { a: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", b: WETH, rA: 0n, rB: 0n, lp: 0n, init: false },
      { a: "0x6b175474e89094c44da98b954eedeac495271d0f", b: PONS, rA: parseUnits("8400000000", 18), rB: parseUnits("4200000", 18), lp: parseEther("588"), init: true },
    ]
  : [];

/* ---------------------------------------------------------- world state */

const pairByKey: Record<string, PairState> = {};
const pairByAddress: Record<string, string> = {};
const pairAddrByKey: Record<string, string> = {};
const allowances: Record<string, bigint> = {};
const tokenBalances: Record<string, bigint> = {};
const lpBalances: Record<string, bigint> = {};
const ethBalances: Record<string, bigint> = {};
const nonces: Record<string, number> = {};
const txs: Record<string, SimTx> = {};

const world = { block: 61_204 };

const metrics: ProtocolMetrics = SEEDED
  ? { poolsSeeded: 1_284, ethPaired: parseEther("12458.2"), ponsBurned: parseUnits("8420000", 18) }
  : { poolsSeeded: 0, ethPaired: 0n, ponsBurned: 0n };

let lastOutcome: TxOutcome | null = null;
/** Result of the most recent router execution — read by the injection hook. */
export function lastTxOutcome(): TxOutcome | null {
  return lastOutcome;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function pairAddressFor(key: string): string {
  if (!pairAddrByKey[key]) {
    pairAddrByKey[key] = getAddress("0x" + keccak256(toHex(`ponspool:pair:${key}`)).slice(26));
  }
  return pairAddrByKey[key];
}

function ensurePair(aIn: string, bIn: string): PairState {
  const a = aIn.toLowerCase();
  const b = bIn.toLowerCase();
  const key = pairKey(a, b);
  if (!pairByKey[key]) {
    const seed = PAIR_SEEDS.find((s) => pairKey(s.a, s.b) === key);
    let state: PairState;
    if (seed) {
      const [x, y] = seed.a <= seed.b ? [seed.a, seed.b] : [seed.b, seed.a];
      const flip = seed.a !== x;
      state = { a: x, b: y, reserveA: flip ? seed.rB : seed.rA, reserveB: flip ? seed.rA : seed.rB, lpSupply: seed.lp, initialized: seed.init };
    } else if (!SEEDED) {
      // Unseeded sandbox: pairs exist only once created — start uninitialized.
      const [x, y] = a <= b ? [a, b] : [b, a];
      state = { a: x, b: y, reserveA: 0n, reserveB: 0n, lpSupply: 0n, initialized: false };
    } else {
      // Uncurated address, seeded mode on: deterministically synthesize a
      // pool from the pair key so detection never depends on liquidity or
      // market-cap data being available — every valid ERC-20 resolves.
      const s = parseInt(key.slice(-10), 16) || 7;
      const rEth = parseEther(String(3 + (s % 37)));
      const price = 10n ** BigInt(3 + (s % 6));
      const rOther = rEth * price;
      const ethIsA = a === WETH || (b !== WETH && a !== PONS);
      state = ethIsA
        ? { a, b, reserveA: rEth, reserveB: rOther, lpSupply: rEth, initialized: true }
        : { a, b, reserveA: rOther, reserveB: rEth, lpSupply: rEth, initialized: true };
    }
    pairByKey[key] = state;
    pairByAddress[pairAddressFor(key).toLowerCase()] = key;
  }
  return pairByKey[key];
}

PAIR_SEEDS.forEach((s) => ensurePair(s.a, s.b));

export const UNCURATED_ASSET_NAME = "Uncurated Asset";

export interface RegistryTokenSummary {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
}

/**
 * Every token the sandbox ships with out of the box — the same catalogue a
 * real Uniswap-style token picker draws its default/browsable list from, so
 * people can see what's on Robinhood Chain without already knowing an
 * address. Curated demo tokens only (see also: paste-an-address live lookup
 * in useTokenMeta for anything not in this list).
 */
export function listRegistryTokens(): RegistryTokenSummary[] {
  return Object.entries(REGISTRY).map(([address, meta]) => ({
    address: getAddress(address) as `0x${string}`,
    symbol: meta.symbol,
    name: meta.name,
    decimals: meta.decimals,
  }));
}

function metaFor(addrLower: string): RegToken | null {
  const reg = REGISTRY[addrLower];
  if (reg) return reg;
  if (!/^0x[0-9a-f]{40}$/.test(addrLower)) return null;
  return { symbol: ("TK" + addrLower.slice(-2)).toUpperCase(), name: UNCURATED_ASSET_NAME, decimals: 18 };
}

/** Public lookup for a token's display name/symbol/decimals — used by tx history UI. */
export function tokenInfo(address: string): RegToken | null {
  return metaFor(address.toLowerCase());
}

/** Reserves of token/WETH oriented as { rEth, rTok }. */
function orientedReserves(token: string): { pair: PairState; rEth: bigint; rTok: bigint } {
  const pair = ensurePair(token, WETH);
  const ethFirst = pair.a === WETH;
  return { pair, rEth: ethFirst ? pair.reserveA : pair.reserveB, rTok: ethFirst ? pair.reserveB : pair.reserveA };
}

function addReserves(pair: PairState, dEth: bigint, dTok: bigint) {
  if (pair.a === WETH) { pair.reserveA += dEth; pair.reserveB += dTok; }
  else { pair.reserveB += dEth; pair.reserveA += dTok; }
}

function creditLp(pair: PairState, to: string, amount: bigint) {
  const key = `lp|${pairKey(pair.a, pair.b)}|${to}`;
  lpBalances[key] = (lpBalances[key] ?? 0n) + amount;
}

/* ------------------------------------------------------------ faucet */

const FAUCET_ETH = parseEther("4.2");
const FAUCET_PONS = parseUnits("400", 18); // deliberately below the holder gate

function defaultTokenCredit(token: string, decimals: number): bigint {
  if (token === PONS) return FAUCET_PONS;
  if (token === WETH) return parseEther("0.5");
  return parseUnits("100000000", decimals);
}

function tokenBalanceOf(token: string, owner: string): bigint {
  const key = `${token}|${owner}`;
  if (tokenBalances[key] !== undefined) return tokenBalances[key];
  if (owner === ZERO_ADDRESS) return 0n;
  if (!SEEDED) return 0n; // unseeded: nothing materializes unannounced
  const meta = metaFor(token);
  const credit = defaultTokenCredit(token, meta?.decimals ?? 18);
  tokenBalances[key] = credit;
  if (token === PONS) emit({ type: "faucet", to: owner, asset: "pons", amount: credit });
  else emit({ type: "faucet", to: owner, asset: "token", amount: credit, symbol: meta?.symbol });
  return credit;
}

function setTokenBalance(token: string, owner: string, v: bigint) {
  tokenBalances[`${token}|${owner}`] = v;
}

/** Sandbox dispensary — tops an address up to the holder gate. Disabled when seeding is off. */
export function dispensePass(owner: string) {
  if (!SEEDED) return;
  const key = `${PONS}|${owner.toLowerCase()}`;
  const current = tokenBalances[key] ?? 0n;
  if (current >= REQUIRED_HOLD_AMOUNT) return;
  const topUp = REQUIRED_HOLD_AMOUNT - current;
  tokenBalances[key] = REQUIRED_HOLD_AMOUNT;
  emit({ type: "faucet", to: owner, asset: "pons", amount: topUp });
}

function ethBalanceOf(owner: string): bigint {
  if (ethBalances[owner] !== undefined) return ethBalances[owner];
  if (owner === ZERO_ADDRESS) return 0n;
  if (!SEEDED) return 0n;
  ethBalances[owner] = FAUCET_ETH;
  emit({ type: "faucet", to: owner, asset: "eth", amount: FAUCET_ETH });
  return FAUCET_ETH;
}

/* ------------------------------------------------------------ metrics */

export function getMetrics(): ProtocolMetrics {
  return { ...metrics };
}

function bumpMetrics(patch: Partial<ProtocolMetrics>) {
  Object.assign(metrics, patch);
  emit({ type: "metrics", metrics: getMetrics() });
}

/* --------------------------------------------------- platform tx feed */

/** A user-facing liquidity injection/zap — what the landing page tx feed shows. */
export interface PlatformTx {
  hash: string;
  user: string;
  token: string;
  ethIn: bigint;
  tokenIn: bigint;
  kind: "inject" | "zap";
  minedAtBlock: number;
  /** Unix seconds from the confirmed block, when available. */
  timestamp?: number;
}

function toPlatformTx(tx: SimTx): PlatformTx | null {
  if (tx.kind !== "inject" && tx.kind !== "zap") return null;
  const m = tx.meta;
  if (!m) return null;
  return {
    hash: tx.hash,
    user: String(m.recipient ?? tx.from),
    token: String(m.token ?? ""),
    ethIn: (m.ethIn as bigint | undefined) ?? 0n,
    tokenIn: (m.tokenIn as bigint | undefined) ?? 0n,
    kind: tx.kind,
    minedAtBlock: tx.minedAtBlock,
  };
}

/** Most recent liquidity injections/zaps across the platform, newest first. */
export function listPlatformTransactions(limit = 20): PlatformTx[] {
  return Object.values(txs)
    .map(toPlatformTx)
    .filter((t): t is PlatformTx => t !== null)
    .sort((a, b) => b.minedAtBlock - a.minedAtBlock)
    .slice(0, limit);
}

/* ------------------------------------------------------------- pub/sub */

const listeners = new Set<(e: ChainEvent) => void>();

export function subscribeChain(fn: (e: ChainEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e: ChainEvent) {
  listeners.forEach((fn) => fn(e));
}

const g = globalThis as unknown as { __ponspoolTimer?: ReturnType<typeof setInterval> };
if (!g.__ponspoolTimer) {
  g.__ponspoolTimer = setInterval(() => {
    world.block += 1;
    emit({ type: "block", block: world.block });
  }, 3600);
}

export function currentBlock() {
  return world.block;
}

/* ------------------------------------------------------------- helpers */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => 90 + Math.random() * 220;

let txCounter = 0;
function makeHash(): string {
  txCounter += 1;
  return keccak256(toHex(`ponspool:tx:${txCounter}:${world.block}`));
}

function blockHash(b: number): string {
  return keccak256(toHex(`ponspool:block:${b}`));
}

/* ----------------------------------------------------------- selectors */

const SEL = {
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  transfer: "0xa9059cbb",
  symbol: "0x95d89b41",
  name: "0x06fdde03",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  getPair: "0xe6a43905",
  getReserves: "0x0902f1ac",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  addLiquidityETH: "0xf305d71b",
  swapEthForTokens: "0xfb3bdb41", // swapExactETHForTokensSupportingFeeOnTransferTokens
};

const RSEL: Record<string, string> = {};
for (const item of PONSPOOL_ROUTER_ABI) {
  if (item.type === "function") RSEL[toFunctionSelector(item)] = item.name;
}

const routerViewAbi = [
  {
    type: "function", name: "isHolder", stateMutability: "view",
    inputs: [{ name: "who", type: "address" }], outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "feeBps", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "requiredHoldAmount", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const factoryAbi = [
  {
    type: "function", name: "getPair", stateMutability: "view",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const pairAbi = [
  {
    type: "function", name: "getReserves", stateMutability: "view", inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

function addr(payload: string, startWord: number): string {
  return ("0x" + payload.slice(10 + startWord * 64 + 24, 10 + (startWord + 1) * 64)).toLowerCase();
}
function word(payload: string, startWord: number): bigint {
  return BigInt("0x" + payload.slice(10 + startWord * 64, 10 + (startWord + 1) * 64));
}

/* ------------------------------------------------- position counters */

let v4PositionId = 7000n;

/* ------------------------------------------- PonspoolRouter engine */

/**
 * Strict on-chain gate + buyback-and-burn. Mirrors _handleFeeAndBurn, which
 * now settles against the V4 PONS/ETH pool via a direct PoolManager swap
 * (unlock → swap → settle → take(DEAD)) instead of a V2 pair. The reserve
 * bookkeeping below is version-agnostic — it approximates whichever pool
 * ($PONSPOOL/ETH, V4 in production) the burn actually swaps through.
 */
function routerGate(from: string, totalEth: bigint): { fee: bigint; net: bigint; burned: bigint } {
  if (tokenBalanceOf(PONS, from) >= REQUIRED_HOLD_AMOUNT) return { fee: 0n, net: totalEth, burned: 0n };
  const fee = (totalEth * BigInt(ROUTER_FEE_BPS)) / 10_000n;
  if (fee === 0n) return { fee: 0n, net: totalEth, burned: 0n };
  // Instant market buy of $PONSPOOL with the cut, delivered to 0x...dEaD.
  const { pair, rEth, rTok } = orientedReserves(PONS);
  const bought = getAmountOut(fee, rEth, rTok);
  addReserves(pair, fee, -bought);
  bumpMetrics({ ponsBurned: metrics.ponsBurned + bought });
  return { fee, net: totalEth - fee, burned: bought };
}

function runRouterEndpoint(fnName: string, payload: string, value: bigint, from: string): TxOutcome {
  const { fee, net, burned } = routerGate(from, value);
  const finish = (o: TxOutcome): TxOutcome => {
    lastOutcome = o;
    bumpMetrics({ poolsSeeded: metrics.poolsSeeded + 1, ethPaired: metrics.ethPaired + o.ethIn });
    return o;
  };

  switch (fnName) {
    /* -------------------------------------------------- V4 ----- */
    case "injectV4": {
      const c0 = addr(payload, 0);
      const c1 = addr(payload, 1);
      const token = c0 === WETH || c0 === ZERO_ADDRESS ? c1 : c0;
      const { pair } = orientedReserves(token);
      if (!pair.initialized) throw { code: 3, message: "execution reverted: NO_PAIR" };
      const desired = word(payload, 7); // liquidityDelta stands in for the token leg
      const have = tokenBalanceOf(token, from);
      const tokenIn = desired > 0n && desired <= have ? desired : have / 2n;
      setTokenBalance(token, from, have - tokenIn);
      addReserves(pair, net, tokenIn);
      v4PositionId += 1n;
      return finish({ kind: "inject", version: 4, mode: "dual", token, ethIn: net, tokenIn, positionId: v4PositionId, pair: pairAddressFor(pairKey(pair.a, pair.b)), feeEth: fee, burnedPons: burned, recipient: from });
    }
    case "zapEthV4": {
      const c0 = addr(payload, 0);
      const c1 = addr(payload, 1);
      const token = c0 === WETH || c0 === ZERO_ADDRESS ? c1 : c0;
      const { pair, rEth, rTok } = orientedReserves(token);
      if (!pair.initialized) throw { code: 3, message: "execution reverted: NO_PAIR" };
      const swapIn = calculateV2ZapSwapAmount(rEth, net);
      const out = getAmountOut(swapIn, rEth, rTok);
      addReserves(pair, swapIn, -out);
      addReserves(pair, net - swapIn, out);
      v4PositionId += 1n;
      return finish({ kind: "zap", version: 4, mode: "zap", token, ethIn: net, swapIn, tokenIn: out, positionId: v4PositionId, pair: pairAddressFor(pairKey(pair.a, pair.b)), feeEth: fee, burnedPons: burned, recipient: from });
    }
    default:
      throw { code: 3, message: "execution reverted: UNKNOWN_ROUTER_CALL" };
  }
}

/* ----------------------------------------------------------- eth_call */

function handleCall(toLower: string, payload: string): string {
  const sel = payload.slice(0, 10).toLowerCase();

  if (toLower === DEX_FACTORY_ADDRESS.toLowerCase()) {
    if (sel === SEL.getPair) {
      const state = ensurePair(addr(payload, 0), addr(payload, 1));
      const out = state.initialized ? pairAddressFor(pairKey(state.a, state.b)) : ZERO_ADDRESS;
      return encodeFunctionResult({ abi: factoryAbi, functionName: "getPair", result: out as `0x${string}` });
    }
    return "0x";
  }

  if (toLower === PONSPOOL_ROUTER_ADDRESS.toLowerCase()) {
    if (sel === toFunctionSelector(routerViewAbi[0])) {
      const holder = tokenBalanceOf(PONS, addr(payload, 0)) >= REQUIRED_HOLD_AMOUNT;
      return encodeFunctionResult({ abi: routerViewAbi, functionName: "isHolder", result: holder });
    }
    if (sel === toFunctionSelector(routerViewAbi[1])) {
      return encodeFunctionResult({ abi: routerViewAbi, functionName: "feeBps", result: BigInt(ROUTER_FEE_BPS) });
    }
    if (sel === toFunctionSelector(routerViewAbi[2])) {
      return encodeFunctionResult({ abi: routerViewAbi, functionName: "requiredHoldAmount", result: REQUIRED_HOLD_AMOUNT });
    }
    return "0x";
  }

  const pairKeyHit = pairByAddress[toLower];
  if (pairKeyHit) {
    const p = pairByKey[pairKeyHit];
    if (sel === SEL.getReserves) {
      return encodeFunctionResult({
        abi: pairAbi, functionName: "getReserves",
        result: [p.reserveA, p.reserveB, world.block % 4_294_967_296] as unknown as readonly [bigint, bigint, number],
      });
    }
    if (sel === SEL.token0) return encodeFunctionResult({ abi: pairAbi, functionName: "token0", result: getAddress(p.a) });
    if (sel === SEL.token1) return encodeFunctionResult({ abi: pairAbi, functionName: "token1", result: getAddress(p.b) });
    if (sel === SEL.totalSupply) return encodeFunctionResult({ abi: pairAbi, functionName: "totalSupply", result: p.lpSupply });
    if (sel === SEL.symbol) return encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: "PP-LP" });
    if (sel === SEL.name) return encodeFunctionResult({ abi: erc20Abi, functionName: "name", result: "PonsPool LP" });
    if (sel === SEL.decimals) return encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: 18 });
    if (sel === SEL.balanceOf) {
      const key = `lp|${pairKeyHit}|${addr(payload, 0)}`;
      return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: lpBalances[key] ?? 0n });
    }
    return "0x";
  }

  const meta = metaFor(toLower);
  if (!meta) return "0x";

  switch (sel) {
    case SEL.symbol:
      return encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: meta.symbol });
    case SEL.name:
      return encodeFunctionResult({ abi: erc20Abi, functionName: "name", result: meta.name });
    case SEL.decimals:
      return encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: meta.decimals });
    case SEL.totalSupply:
      return encodeFunctionResult({ abi: erc20Abi, functionName: "totalSupply", result: parseUnits("1000000000", meta.decimals) });
    case SEL.balanceOf:
      return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: tokenBalanceOf(toLower, addr(payload, 0)) });
    case SEL.allowance: {
      const key = `${toLower}|${addr(payload, 0)}|${addr(payload, 1)}`;
      return encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: allowances[key] ?? 0n });
    }
    default:
      return "0x";
  }
}

/* ---------------------------------------------------- eth_sendTransaction */

function handleSend(p: Record<string, unknown>): string {
  const from = String(p.from).toLowerCase();
  const to = String(p.to ?? "").toLowerCase();
  const value = p.value ? BigInt(String(p.value)) : 0n;
  const payload = String(p.data ?? "0x");
  const sel = payload === "0x" ? "" : payload.slice(0, 10).toLowerCase();

  nonces[from] = (nonces[from] ?? 0) + 1;
  const hash = makeHash();
  const tx: SimTx = { hash, from, to, kind: "transfer", value, minedAtBlock: world.block + 1 };

  const spendEth = (amount: bigint) => {
    const bal = ethBalanceOf(from);
    if (bal < amount) throw { code: 3, message: "execution reverted: INSUFFICIENT_ETH" };
    ethBalances[from] = bal - amount;
  };

  /* ------------------------------- PonspoolRouter — atomic engine --- */
  if (to === PONSPOOL_ROUTER_ADDRESS.toLowerCase()) {
    const fnName = RSEL[sel];
    if (!fnName) throw { code: 3, message: "execution reverted: UNKNOWN_ROUTER_CALL" };
    spendEth(value);
    const outcome = runRouterEndpoint(fnName, payload, value, from);
    tx.kind = outcome.kind;
    tx.meta = { ...outcome };
    txs[hash] = tx;
    emit({ type: "tx", tx });
    return hash;
  }

  /* ---------------------------------------------- ERC-20 basics ----- */
  if (sel === SEL.approve) {
    allowances[`${to}|${from}|${addr(payload, 1)}`] = word(payload, 2);
    tx.kind = "approve";
    txs[hash] = tx;
    emit({ type: "tx", tx });
    return hash;
  }

  const pairKeyHit = pairByAddress[to];
  if (pairKeyHit && sel === SEL.transfer) {
    const recipient = addr(payload, 0);
    const amount = word(payload, 1);
    const key = `lp|${pairKeyHit}|${from}`;
    const have = lpBalances[key] ?? 0n;
    if (have < amount) throw { code: 3, message: "execution reverted: INSUFFICIENT_LP" };
    lpBalances[key] = have - amount;
    creditLp(pairByKey[pairKeyHit], recipient, amount);
    tx.kind = "transfer";
    txs[hash] = tx;
    emit({ type: "tx", tx });
    return hash;
  }

  /* ---------------------------------------- Uniswap V2 router ------- */
  if (to === DEX_ROUTER_ADDRESS.toLowerCase()) {
    if (sel === SEL.addLiquidityETH) {
      const token = addr(payload, 0);
      const amountTokenMin = word(payload, 1);
      const { pair, rEth, rTok } = orientedReserves(token);
      if (!pair.initialized) throw { code: 3, message: "execution reverted: UNINITIALIZED_PAIR" };
      const ethIn = value;
      const tokenIn = (ethIn * rTok) / rEth;
      const want = tokenIn > amountTokenMin ? amountTokenMin : tokenIn;
      const have = tokenBalanceOf(token, from);
      if (have < want) throw { code: 3, message: "execution reverted: INSUFFICIENT_TOKEN" };
      spendEth(ethIn);

      const lpMinted = (ethIn * pair.lpSupply) / rEth;
      setTokenBalance(token, from, have - want);
      addReserves(pair, ethIn, want);
      pair.lpSupply += lpMinted;
      creditLp(pair, from, lpMinted);

      tx.kind = "inject";
      tx.meta = { version: 2, token, ethIn, tokenIn: want, lpMinted, pair: pairAddressFor(pairKey(pair.a, pair.b)) };
      bumpMetrics({ poolsSeeded: metrics.poolsSeeded + 1, ethPaired: metrics.ethPaired + ethIn });
      txs[hash] = tx;
      emit({ type: "tx", tx });
      return hash;
    }
    if (sel === SEL.swapEthForTokens) {
      const amountOutMin = word(payload, 0);
      const offsetWords = Number(word(payload, 1)) / 32;
      const pathLen = Number(word(payload, offsetWords));
      const tokenOut = addr(payload, offsetWords + pathLen);
      const { pair, rEth, rTok } = orientedReserves(tokenOut);
      if (!pair.initialized) throw { code: 3, message: "execution reverted: UNINITIALIZED_PAIR" };
      const out = getAmountOut(value, rEth, rTok);
      if (out < amountOutMin) throw { code: 3, message: "execution reverted: INSUFFICIENT_OUTPUT_AMOUNT" };
      spendEth(value);
      addReserves(pair, value, -out);
      setTokenBalance(tokenOut, from, tokenBalanceOf(tokenOut, from) + out);
      tx.kind = "swap";
      tx.meta = { ethIn: value, tokenOut, out };
      txs[hash] = tx;
      emit({ type: "tx", tx });
      return hash;
    }
    throw { code: 3, message: "execution reverted: UNKNOWN_V2_CALL" };
  }

  throw { code: 3, message: "execution reverted: UNKNOWN_CALL" };
}

function receiptFor(hash: string) {
  const tx = txs[hash];
  if (!tx || world.block < tx.minedAtBlock) return null;
  return {
    transactionHash: tx.hash,
    transactionIndex: "0x0",
    blockHash: blockHash(tx.minedAtBlock),
    blockNumber: numberToHex(tx.minedAtBlock),
    from: getAddress(tx.from),
    to: tx.to ? getAddress(tx.to) : null,
    cumulativeGasUsed: numberToHex(181_000),
    gasUsed: numberToHex(tx.kind === "inject" || tx.kind === "zap" ? 168_210 : 51_240),
    contractAddress: null,
    logs: [],
    logsBloom: "0x" + "0".repeat(512),
    status: "0x1",
    effectiveGasPrice: numberToHex(parseUnits("1.1", 9)),
    type: "0x2",
  };
}

/* ------------------------------------------------------- EIP-1193 node */

const GWEI = parseUnits("1", 9);

const knownContracts = new Set<string>([
  DEX_FACTORY_ADDRESS.toLowerCase(), DEX_ROUTER_ADDRESS.toLowerCase(),
  PONSPOOL_ROUTER_ADDRESS.toLowerCase(), WETH, PONS,
  ...Object.keys(REGISTRY),
  ...Object.values(pairAddrByKey).map((a) => a.toLowerCase()),
]);

export const simProvider = {
  async request({ method, params }: { method: string; params?: unknown[] }) {
    await sleep(latency());
    const prm = (params ?? []) as unknown[];

    switch (method) {
      case "eth_chainId":
        return numberToHex(ROBINHOOD_CHAIN_ID);
      case "net_version":
        return String(ROBINHOOD_CHAIN_ID);
      case "eth_blockNumber":
        return numberToHex(world.block);
      case "eth_accounts":
        return [];
      case "eth_syncing":
        return false;
      case "eth_getBalance":
        return numberToHex(ethBalanceOf(String(prm[0]).toLowerCase()));
      case "eth_getTransactionCount": {
        const a = String(prm[0]).toLowerCase();
        return numberToHex(nonces[a] ?? 0);
      }
      case "eth_getCode": {
        const a = String(prm[0]).toLowerCase();
        return knownContracts.has(a) || pairByAddress[a] ? "0x6080604052" : "0x";
      }
      case "eth_call": {
        const call = (prm[0] ?? {}) as { to?: string; payload?: string; data?: string };
        if (!call.to) return "0x";
        return handleCall(String(call.to).toLowerCase(), call.data ?? call.payload ?? "0x");
      }
      case "eth_estimateGas":
        return numberToHex(210_000);
      case "eth_gasPrice":
        return numberToHex(GWEI + GWEI / 5n);
      case "eth_maxPriorityFeePerGas":
        return numberToHex(GWEI / 5n);
      case "eth_feeHistory": {
        const count = Math.min(Number(prm[0]) || 4, 8);
        return {
          oldestBlock: numberToHex(Math.max(world.block - count + 1, 1)),
          baseFeePerGas: Array.from({ length: count + 1 }, () => numberToHex(GWEI)),
          gasUsedRatio: Array.from({ length: count }, () => 0.42),
        };
      }
      case "eth_sendTransaction":
        return handleSend((prm[0] ?? {}) as Record<string, unknown>);
      case "eth_getTransactionReceipt":
        return receiptFor(String(prm[0]));
      case "eth_getBlockByNumber": {
        const b = prm[0] === "latest" ? world.block : Number(prm[0]);
        return {
          number: numberToHex(b), hash: blockHash(b), parentHash: blockHash(b - 1),
          timestamp: numberToHex(Math.floor(Date.now() / 1000)), gasLimit: numberToHex(30_000_000),
          gasUsed: numberToHex(8_400_000), miner: ZERO_ADDRESS, difficulty: "0x0", extraData: "0x",
          logsBloom: "0x" + "0".repeat(512), nonce: "0x0000000000000000", receiptsRoot: "0x",
          sha3Uncles: "0x", size: "0x400", stateRoot: "0x", totalDifficulty: "0x0",
          transactions: [], transactionsRoot: "0x", uncles: [], baseFeePerGas: numberToHex(GWEI),
        };
      }
      default:
        return null;
    }
  },
};
