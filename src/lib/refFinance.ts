/**
 * Ref Finance (v2.ref-finance.near) engine: typed view calls, pool
 * discovery, and the transaction planners for liquidity injection and
 * single-hop instant swaps.
 *
 * Planners are pure: they take a fresh on-chain snapshot plus the user's
 * intent and return an ordered list of function calls. The hook layer turns
 * those into wallet-selector transactions, so the exact calls a user signs
 * are also what the review panel renders.
 */
import { actionCreators, type Transaction } from "@near-wallet-selector/core";
import {
  COMMON_TOKENS,
  FT_STORAGE_DEPOSIT_FALLBACK,
  GAS,
  LP_STORAGE_DEPOSIT,
  MAX_GAS_PER_TX,
  NEAR_DECIMALS,
  NEAR_GAS_RESERVE,
  ONE_YOCTO,
  REF_ACCOUNT_REGISTRATION_DEPOSIT,
  REF_FINANCE_CONTRACT_ID,
  REF_STORAGE_PER_TOKEN,
  REF_STORAGE_TOP_UP,
  WRAP_NEAR_CONTRACT_ID,
} from "../config/near";
import { getNativeBalance, viewMethod, type NativeBalance } from "./near";
import { fmtAmount } from "./format";
import {
  applySlippage,
  estimateAddLiquidity,
  estimateSwapOut,
  maxBig,
  minAmountsFor,
  minBig,
  splitFunding,
} from "../utils/zapMath";

/* ================================================================ types */

/** Raw `get_pool` / `get_pools` response. U128 values arrive as strings. */
export interface RefPoolView {
  pool_kind: string;
  token_account_ids: string[];
  amounts: string[];
  total_fee: number;
  shares_total_supply: string;
  amp: number;
}

export interface RefPool {
  id: number;
  kind: string;
  tokenIds: string[];
  reserves: bigint[];
  /** Swap fee in basis points (Ref `total_fee`). */
  totalFeeBps: number;
  sharesTotalSupply: bigint;
}

/** NEP-148 `ft_metadata`. */
export interface FtMetadata {
  spec: string;
  name: string;
  symbol: string;
  icon: string | null;
  reference: string | null;
  reference_hash: string | null;
  decimals: number;
}

/** NEP-145 `storage_balance_of` (null when the account isn't registered). */
export interface StorageBalanceView {
  total: string;
  available: string;
}

/** NEP-145 `storage_balance_bounds`. */
export interface StorageBalanceBoundsView {
  min: string;
  max: string | null;
}

export interface StorageBalance {
  total: bigint;
  available: bigint;
}

export const SIMPLE_POOL = "SIMPLE_POOL";

export function parsePool(id: number, view: RefPoolView): RefPool {
  return {
    id,
    kind: view.pool_kind,
    tokenIds: view.token_account_ids,
    reserves: view.amounts.map((a) => BigInt(a)),
    totalFeeBps: view.total_fee,
    sharesTotalSupply: BigInt(view.shares_total_supply),
  };
}

const toStorageBalance = (view: StorageBalanceView | null): StorageBalance | null =>
  view ? { total: BigInt(view.total), available: BigInt(view.available) } : null;

/* ================================================================ reads */

export async function getPool(poolId: number): Promise<RefPool> {
  const view = await viewMethod<RefPoolView | null>(REF_FINANCE_CONTRACT_ID, "get_pool", { pool_id: poolId });
  if (!view) throw new Error(`pool #${poolId} does not exist on Ref Finance`);
  return parsePool(poolId, view);
}

export async function getNumberOfPools(): Promise<number> {
  return viewMethod<number>(REF_FINANCE_CONTRACT_ID, "get_number_of_pools");
}

export async function getPools(fromIndex: number, limit: number): Promise<RefPool[]> {
  const views = await viewMethod<RefPoolView[]>(REF_FINANCE_CONTRACT_ID, "get_pools", { from_index: fromIndex, limit });
  return views.map((view, i) => parsePool(fromIndex + i, view));
}

/** Internal Ref balances. Includes registered tokens with a zero balance. */
export async function getDeposits(accountId: string): Promise<Record<string, bigint>> {
  const raw = await viewMethod<Record<string, string> | null>(REF_FINANCE_CONTRACT_ID, "get_deposits", { account_id: accountId });
  const out: Record<string, bigint> = {};
  for (const [token, amount] of Object.entries(raw ?? {})) out[token] = BigInt(amount);
  return out;
}

export async function getPoolShares(poolId: number, accountId: string): Promise<bigint> {
  const raw = await viewMethod<string | null>(REF_FINANCE_CONTRACT_ID, "get_pool_shares", { pool_id: poolId, account_id: accountId });
  return BigInt(raw ?? "0");
}

/** NEP-145 storage balance of `accountId` on `contractId` (a token or Ref itself). */
export async function getStorageBalance(contractId: string, accountId: string): Promise<StorageBalance | null> {
  return toStorageBalance(await viewMethod<StorageBalanceView | null>(contractId, "storage_balance_of", { account_id: accountId }));
}

const boundsCache = new Map<string, Promise<bigint>>();
/** Minimum NEP-145 registration deposit for a token (falls back to 0.0125 NEAR). */
export function getStorageMinimum(contractId: string): Promise<bigint> {
  let cached = boundsCache.get(contractId);
  if (!cached) {
    cached = viewMethod<StorageBalanceBoundsView | null>(contractId, "storage_balance_bounds")
      .then((bounds) => (bounds?.min ? BigInt(bounds.min) : FT_STORAGE_DEPOSIT_FALLBACK))
      .catch(() => FT_STORAGE_DEPOSIT_FALLBACK);
    boundsCache.set(contractId, cached);
  }
  return cached;
}

const metadataCache = new Map<string, Promise<FtMetadata>>();
export function getFtMetadata(tokenId: string): Promise<FtMetadata> {
  let cached = metadataCache.get(tokenId);
  if (!cached) {
    cached = viewMethod<FtMetadata | null>(tokenId, "ft_metadata").then((meta) => {
      if (!meta || typeof meta.decimals !== "number") throw new Error(`${tokenId} is not a NEP-141 token`);
      return meta;
    });
    // Don't cache failures — a transient RPC error shouldn't poison the token.
    cached.catch(() => metadataCache.delete(tokenId));
    metadataCache.set(tokenId, cached);
  }
  return cached;
}

export async function getFtBalance(tokenId: string, accountId: string): Promise<bigint> {
  const raw = await viewMethod<string | null>(tokenId, "ft_balance_of", { account_id: accountId });
  return BigInt(raw ?? "0");
}

let whitelistCache: { at: number; value: Promise<Set<string>> } | null = null;
/** Globally whitelisted Ref tokens (cached for 10 minutes). */
export function getWhitelistedTokens(): Promise<Set<string>> {
  if (!whitelistCache || Date.now() - whitelistCache.at > 10 * 60_000) {
    const value = viewMethod<string[]>(REF_FINANCE_CONTRACT_ID, "get_whitelisted_tokens").then((ids) => new Set(ids));
    value.catch(() => {
      whitelistCache = null;
    });
    whitelistCache = { at: Date.now(), value };
  }
  return whitelistCache.value;
}

/** User-facing symbol: wrap.near is presented as NEAR since users can pay with native NEAR. */
export function displaySymbol(tokenId: string, meta?: Pick<FtMetadata, "symbol"> | null): string {
  if (tokenId === WRAP_NEAR_CONTRACT_ID) return "NEAR";
  return meta?.symbol ?? COMMON_TOKENS.find((t) => t.id === tokenId)?.symbol ?? tokenId.split(".")[0].slice(0, 8).toUpperCase();
}

/* ================================================================ pool discovery */

const POOL_PAGE_SIZE = 200;
const POOL_INDEX_TTL_MS = 5 * 60_000;
let poolIndex: { at: number; pools: Promise<RefPool[]> } | null = null;

async function loadAllSimplePools(): Promise<RefPool[]> {
  const total = await getNumberOfPools();
  const pages: number[] = [];
  for (let from = 0; from < total; from += POOL_PAGE_SIZE) pages.push(from);
  const results: RefPool[] = [];
  // Four pages in flight keeps public RPCs from rate limiting the scan.
  for (let i = 0; i < pages.length; i += 4) {
    const batch = await Promise.all(pages.slice(i, i + 4).map((from) => getPools(from, POOL_PAGE_SIZE)));
    for (const page of batch) results.push(...page.filter((pool) => pool.kind === SIMPLE_POOL));
  }
  return results;
}

/**
 * Every Ref SIMPLE_POOL containing both tokens, deepest first (by reserve of
 * `tokenA`). Scans `get_pools` on-chain; the index is cached for 5 minutes.
 */
export async function findPoolsForPair(tokenA: string, tokenB: string): Promise<RefPool[]> {
  if (!poolIndex || Date.now() - poolIndex.at > POOL_INDEX_TTL_MS) {
    const pools = loadAllSimplePools();
    pools.catch(() => {
      poolIndex = null;
    });
    poolIndex = { at: Date.now(), pools };
  }
  const pools = await poolIndex.pools;
  return pools
    .filter((pool) => pool.tokenIds.length === 2 && pool.tokenIds.includes(tokenA) && pool.tokenIds.includes(tokenB))
    .sort((a, b) => {
      const ra = a.reserves[a.tokenIds.indexOf(tokenA)];
      const rb = b.reserves[b.tokenIds.indexOf(tokenA)];
      return rb > ra ? 1 : rb < ra ? -1 : 0;
    });
}

/* ================================================================ account snapshot */

export interface TokenAccountState {
  tokenId: string;
  metadata: FtMetadata;
  /** Wallet (on-token) balance. */
  walletBalance: bigint;
  /** Balance already deposited inside Ref. */
  refDeposit: bigint;
  /** Whether the token appears in the user's Ref account (even at zero balance). */
  registeredOnRefAccount: boolean;
  userStorage: StorageBalance | null;
  refStorageOnToken: StorageBalance | null;
  storageMinimum: bigint;
  whitelisted: boolean;
}

export interface AccountSnapshot {
  accountId: string;
  native: NativeBalance;
  refStorage: StorageBalance | null;
  tokens: Record<string, TokenAccountState>;
  fetchedAt: number;
}

/**
 * Everything the planners need about an account, read in parallel. Called
 * right before planning ("checking storage") so the plan never relies on a
 * stale snapshot.
 */
export async function loadAccountSnapshot(accountId: string, tokenIds: string[]): Promise<AccountSnapshot> {
  const unique = [...new Set(tokenIds)];
  const [native, refStorage, deposits, whitelist] = await Promise.all([
    getNativeBalance(accountId),
    getStorageBalance(REF_FINANCE_CONTRACT_ID, accountId),
    getDeposits(accountId),
    getWhitelistedTokens(),
  ]);
  const tokenStates = await Promise.all(
    unique.map(async (tokenId): Promise<TokenAccountState> => {
      const [metadata, walletBalance, userStorage, refStorageOnToken, storageMinimum] = await Promise.all([
        getFtMetadata(tokenId),
        getFtBalance(tokenId, accountId),
        getStorageBalance(tokenId, accountId),
        getStorageBalance(tokenId, REF_FINANCE_CONTRACT_ID),
        getStorageMinimum(tokenId),
      ]);
      return {
        tokenId,
        metadata,
        walletBalance,
        refDeposit: deposits[tokenId] ?? 0n,
        registeredOnRefAccount: tokenId in deposits,
        userStorage,
        refStorageOnToken,
        storageMinimum,
        whitelisted: whitelist.has(tokenId),
      };
    }),
  );
  const tokens: Record<string, TokenAccountState> = {};
  for (const state of tokenStates) tokens[state.tokenId] = state;
  return { accountId, native, refStorage, tokens, fetchedAt: Date.now() };
}

/* ================================================================ planning */

export type PlanStep = "storage" | "wrap" | "deposit" | "inject" | "swap";

export interface PlannedCall {
  step: PlanStep;
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: bigint;
  deposit: bigint;
  /** Human description for the review panel. */
  label: string;
}

export interface PlannedTransaction {
  receiverId: string;
  calls: PlannedCall[];
}

/** Raised when a plan can't be built; `code` lets the UI pick its copy. */
export class PlanError extends Error {
  constructor(
    readonly code: "insufficient-near" | "insufficient-token" | "unsupported-pool" | "zero-amount" | "no-liquidity",
    message: string,
  ) {
    super(message);
    this.name = "PlanError";
  }
}

/**
 * Group consecutive calls to the same receiver into one transaction (NEAR
 * transactions have exactly one receiver), splitting when a transaction
 * would exceed the 300 TGas prepaid limit.
 */
export function groupCalls(calls: PlannedCall[]): PlannedTransaction[] {
  const txs: PlannedTransaction[] = [];
  for (const call of calls) {
    const last = txs[txs.length - 1];
    const lastGas = last ? last.calls.reduce((sum, c) => sum + c.gas, 0n) : 0n;
    if (last && last.receiverId === call.receiverId && lastGas + call.gas <= MAX_GAS_PER_TX) {
      last.calls.push(call);
    } else {
      txs.push({ receiverId: call.receiverId, calls: [call] });
    }
  }
  return txs;
}

/** Convert planned transactions into wallet-selector `Transaction`s. */
export function toWalletTransactions(signerId: string, txs: PlannedTransaction[]): Transaction[] {
  return txs.map((tx) => ({
    signerId,
    receiverId: tx.receiverId,
    actions: tx.calls.map((call) => actionCreators.functionCall(call.methodName, call.args, call.gas, call.deposit)),
  }));
}

export const totalAttachedDeposit = (calls: PlannedCall[]) => calls.reduce((sum, c) => sum + c.deposit, 0n);

const fmtNear = (yocto: bigint) => `${fmtAmount(yocto, NEAR_DECIMALS)} NEAR`;

/**
 * Storage calls shared by injection and swap planning: the user's own
 * registration on a token they will hold, and Ref's registration on a token
 * it will receive via `ft_transfer_call`.
 */
function tokenStorageCalls(
  token: TokenAccountState,
  accountId: string,
  opts: { user: boolean; ref: boolean },
): PlannedCall[] {
  const calls: PlannedCall[] = [];
  const symbol = displaySymbol(token.tokenId, token.metadata);
  if (opts.user && !token.userStorage) {
    calls.push({
      step: "storage",
      receiverId: token.tokenId,
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      gas: GAS.STORAGE_DEPOSIT,
      deposit: token.storageMinimum,
      label: `register ${accountId} on ${symbol} · ${fmtNear(token.storageMinimum)}`,
    });
  }
  if (opts.ref && !token.refStorageOnToken) {
    calls.push({
      step: "storage",
      receiverId: token.tokenId,
      methodName: "storage_deposit",
      args: { account_id: REF_FINANCE_CONTRACT_ID, registration_only: true },
      gas: GAS.STORAGE_DEPOSIT,
      deposit: token.storageMinimum,
      label: `register Ref Finance on ${symbol} · ${fmtNear(token.storageMinimum)}`,
    });
  }
  return calls;
}

/** Wallet-side funding for one token: optional wrap, then the Ref deposit. */
function fundingCalls(token: TokenAccountState, amount: bigint, payWithNative: boolean): { calls: PlannedCall[]; wrap: bigint } {
  const symbol = displaySymbol(token.tokenId, token.metadata);
  const calls: PlannedCall[] = [];
  let wrap = 0n;
  if (token.tokenId === WRAP_NEAR_CONTRACT_ID && payWithNative) {
    wrap = maxBig(amount - token.walletBalance, 0n);
    if (wrap > 0n) {
      calls.push({
        step: "wrap",
        receiverId: WRAP_NEAR_CONTRACT_ID,
        methodName: "near_deposit",
        args: {},
        gas: GAS.NEAR_DEPOSIT,
        deposit: wrap,
        label: `wrap ${fmtAmount(wrap, NEAR_DECIMALS)} NEAR → wNEAR`,
      });
    }
  } else if (amount > token.walletBalance) {
    throw new PlanError("insufficient-token", `not enough ${symbol} in your wallet`);
  }
  calls.push({
    step: "deposit",
    receiverId: token.tokenId,
    methodName: "ft_transfer_call",
    args: { receiver_id: REF_FINANCE_CONTRACT_ID, amount: amount.toString(), msg: "" },
    gas: GAS.FT_TRANSFER_CALL,
    deposit: ONE_YOCTO,
    label: `deposit ${fmtAmount(amount, token.metadata.decimals)} ${symbol} into Ref`,
  });
  return { calls, wrap };
}

function assertNativeBudget(snapshot: AccountSnapshot, calls: PlannedCall[]) {
  const needed = totalAttachedDeposit(calls) + NEAR_GAS_RESERVE;
  if (needed > snapshot.native.available) {
    throw new PlanError(
      "insufficient-near",
      `needs ${fmtNear(needed)} incl. storage and a gas reserve; wallet has ${fmtNear(snapshot.native.available)}`,
    );
  }
}

/* ---------------------------------------------------------------- injection */

export interface InjectionIntent {
  pool: RefPool;
  /** Desired amounts in the pool's token order. */
  amounts: bigint[];
  slippageBps: number;
  /** Spend existing Ref internal balances before pulling from the wallet. */
  useRefDeposits: boolean;
  /** Wrap native NEAR for the wNEAR leg when the wallet lacks wNEAR. */
  payWithNative: boolean;
  /** Current LP shares the user holds in the pool. */
  existingShares: bigint;
}

export interface InjectionPlan {
  calls: PlannedCall[];
  transactions: PlannedTransaction[];
  usedAmounts: bigint[];
  minAmounts: bigint[];
  expectedShares: bigint;
  /** Per token (pool order): deposited from wallet in this batch. */
  walletDeposits: bigint[];
  /** Per token (pool order): taken from pre-existing Ref deposits. */
  refDepositsUsed: bigint[];
  wrapAmount: bigint;
  steps: PlanStep[];
}

export function planInjection(snapshot: AccountSnapshot, intent: InjectionIntent): InjectionPlan {
  const { pool, amounts, slippageBps, useRefDeposits, payWithNative, existingShares } = intent;
  const accountId = snapshot.accountId;
  if (pool.kind !== SIMPLE_POOL) {
    throw new PlanError("unsupported-pool", `pool #${pool.id} is a ${pool.kind.toLowerCase().replace(/_/g, " ")}; only simple pools are supported`);
  }
  if (amounts.length !== pool.tokenIds.length || amounts.some((a) => a <= 0n)) {
    throw new PlanError("zero-amount", "both token amounts must be greater than zero");
  }

  const estimate = estimateAddLiquidity(amounts, pool.reserves, pool.sharesTotalSupply);
  if (estimate.shares <= 0n) throw new PlanError("no-liquidity", "amounts are too small to mint any LP shares");
  const minAmounts = estimate.initializesPool ? [...amounts] : minAmountsFor(estimate.usedAmounts, slippageBps);

  const tokens = pool.tokenIds.map((id) => {
    const state = snapshot.tokens[id];
    if (!state) throw new Error(`missing account state for ${id}`);
    return state;
  });
  const splits = tokens.map((token, i) => splitFunding(amounts[i], token.refDeposit, useRefDeposits));

  /* Step A — Ref account storage + per-account token registration. */
  const refCalls: PlannedCall[] = [];
  const newRefEntries = tokens.filter((t, i) => splits[i].toDeposit > 0n && !t.registeredOnRefAccount);
  if (!snapshot.refStorage) {
    refCalls.push({
      step: "storage",
      receiverId: REF_FINANCE_CONTRACT_ID,
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: false },
      gas: GAS.STORAGE_DEPOSIT,
      deposit: REF_ACCOUNT_REGISTRATION_DEPOSIT,
      label: `register ${accountId} on Ref Finance · ${fmtNear(REF_ACCOUNT_REGISTRATION_DEPOSIT)}`,
    });
  } else {
    const needed = BigInt(newRefEntries.length) * REF_STORAGE_PER_TOKEN;
    if (needed > snapshot.refStorage.available) {
      const topUp = maxBig(REF_STORAGE_TOP_UP, needed - snapshot.refStorage.available);
      refCalls.push({
        step: "storage",
        receiverId: REF_FINANCE_CONTRACT_ID,
        methodName: "storage_deposit",
        args: { account_id: accountId, registration_only: false },
        gas: GAS.STORAGE_DEPOSIT,
        deposit: topUp,
        label: `top up Ref storage · ${fmtNear(topUp)}`,
      });
    }
  }
  const needsRegistration = newRefEntries.filter((t) => !t.whitelisted).map((t) => t.tokenId);
  if (needsRegistration.length > 0) {
    refCalls.push({
      step: "storage",
      receiverId: REF_FINANCE_CONTRACT_ID,
      methodName: "register_tokens",
      args: { token_ids: needsRegistration },
      gas: GAS.REGISTER_TOKENS,
      deposit: ONE_YOCTO,
      label: `register ${needsRegistration.length} non-whitelisted token${needsRegistration.length > 1 ? "s" : ""} in your Ref account`,
    });
  }

  /* Steps A (token storage), B (wrap) and C (deposit), per token. */
  const tokenCalls: PlannedCall[] = [];
  let wrapAmount = 0n;
  tokens.forEach((token, i) => {
    const { toDeposit } = splits[i];
    if (toDeposit <= 0n) return;
    const wrapsHere = token.tokenId === WRAP_NEAR_CONTRACT_ID && payWithNative && toDeposit > token.walletBalance;
    tokenCalls.push(...tokenStorageCalls(token, accountId, { user: wrapsHere, ref: true }));
    const funding = fundingCalls(token, toDeposit, payWithNative);
    wrapAmount += funding.wrap;
    tokenCalls.push(...funding.calls);
  });

  /* Step D — inject. */
  const lpDeposit = existingShares > 0n ? ONE_YOCTO : LP_STORAGE_DEPOSIT;
  const injectCall: PlannedCall = {
    step: "inject",
    receiverId: REF_FINANCE_CONTRACT_ID,
    methodName: "add_liquidity",
    args: {
      pool_id: pool.id,
      amounts: amounts.map((a) => a.toString()),
      min_amounts: minAmounts.map((a) => a.toString()),
    },
    gas: GAS.ADD_LIQUIDITY,
    deposit: lpDeposit,
    label: `add liquidity to pool #${pool.id}${existingShares > 0n ? "" : ` · ${fmtNear(lpDeposit)} LP storage, unused part refunded`}`,
  };

  const calls = [...refCalls, ...tokenCalls, injectCall];
  assertNativeBudget(snapshot, calls);

  return {
    calls,
    transactions: groupCalls(calls),
    usedAmounts: estimate.usedAmounts,
    minAmounts,
    expectedShares: estimate.shares,
    walletDeposits: splits.map((s) => s.toDeposit),
    refDepositsUsed: splits.map((s) => s.fromRef),
    wrapAmount,
    steps: [...new Set(calls.map((c) => c.step))],
  };
}

/* ---------------------------------------------------------------- swap */

export interface SwapIntent {
  pool: RefPool;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  slippageBps: number;
  payWithNative: boolean;
}

export interface SwapPlan {
  calls: PlannedCall[];
  transactions: PlannedTransaction[];
  expectedOut: bigint;
  minAmountOut: bigint;
  wrapAmount: bigint;
  steps: PlanStep[];
}

/** Single-hop Ref "instant swap": the output is sent straight back to the wallet. */
export function planSwap(snapshot: AccountSnapshot, intent: SwapIntent): SwapPlan {
  const { pool, tokenIn, tokenOut, amountIn, slippageBps, payWithNative } = intent;
  const accountId = snapshot.accountId;
  if (pool.kind !== SIMPLE_POOL) throw new PlanError("unsupported-pool", `pool #${pool.id} is not a simple pool`);
  if (amountIn <= 0n) throw new PlanError("zero-amount", "enter an amount");
  const inIdx = pool.tokenIds.indexOf(tokenIn);
  const outIdx = pool.tokenIds.indexOf(tokenOut);
  if (inIdx < 0 || outIdx < 0) throw new PlanError("unsupported-pool", `pool #${pool.id} doesn't hold this pair`);

  const expectedOut = estimateSwapOut(amountIn, pool.reserves[inIdx], pool.reserves[outIdx], pool.totalFeeBps);
  if (expectedOut <= 0n) throw new PlanError("no-liquidity", "the pool has no depth for this trade");
  const minAmountOut = applySlippage(expectedOut, slippageBps);

  const inState = snapshot.tokens[tokenIn];
  const outState = snapshot.tokens[tokenOut];
  if (!inState || !outState) throw new Error("missing account state for swap tokens");

  const calls: PlannedCall[] = [];
  // Output is delivered with ft_transfer, so the wallet must be registered on tokenOut.
  calls.push(...tokenStorageCalls(outState, accountId, { user: true, ref: false }));
  const wrapsHere = tokenIn === WRAP_NEAR_CONTRACT_ID && payWithNative && amountIn > inState.walletBalance;
  calls.push(...tokenStorageCalls(inState, accountId, { user: wrapsHere, ref: true }));

  let wrapAmount = 0n;
  if (tokenIn === WRAP_NEAR_CONTRACT_ID && payWithNative) {
    wrapAmount = maxBig(amountIn - inState.walletBalance, 0n);
    if (wrapAmount > 0n) {
      calls.push({
        step: "wrap",
        receiverId: WRAP_NEAR_CONTRACT_ID,
        methodName: "near_deposit",
        args: {},
        gas: GAS.NEAR_DEPOSIT,
        deposit: wrapAmount,
        label: `wrap ${fmtAmount(wrapAmount, NEAR_DECIMALS)} NEAR → wNEAR`,
      });
    }
  } else if (amountIn > inState.walletBalance) {
    throw new PlanError("insufficient-token", `not enough ${displaySymbol(tokenIn, inState.metadata)} in your wallet`);
  }

  calls.push({
    step: "swap",
    receiverId: tokenIn,
    methodName: "ft_transfer_call",
    args: {
      receiver_id: REF_FINANCE_CONTRACT_ID,
      amount: amountIn.toString(),
      msg: JSON.stringify({
        force: 0,
        actions: [{ pool_id: pool.id, token_in: tokenIn, token_out: tokenOut, min_amount_out: minAmountOut.toString() }],
      }),
    },
    gas: GAS.SWAP,
    deposit: ONE_YOCTO,
    label: `swap on pool #${pool.id} · min ${fmtAmount(minAmountOut, outState.metadata.decimals)} ${displaySymbol(tokenOut, outState.metadata)}`,
  });

  assertNativeBudget(snapshot, calls);
  return {
    calls,
    transactions: groupCalls(calls),
    expectedOut,
    minAmountOut,
    wrapAmount,
    steps: [...new Set(calls.map((c) => c.step))],
  };
}

/* ================================================================ errors */

const REF_ERRORS: Array<[RegExp, string]> = [
  [/E10|account not registered/i, "your account isn't registered on Ref Finance yet — retry and the storage step will register it"],
  [/E11|insufficient \$NEAR storage|ERR_STORAGE_DEPOSIT|storage deposit/i, "not enough storage deposit on Ref — retry to top it up"],
  [/E12|token not whitelisted/i, "this token isn't registered in your Ref account — retry to register it"],
  [/E22|not enough tokens in deposit/i, "your Ref deposit didn't cover the amounts — a token deposit was refunded"],
  [/E68|slippage|ERR86_MIN_AMOUNT|min amount/i, "the pool price moved beyond your slippage tolerance"],
  [/E31|zero amount|E32/i, "an amount is too small for this pool"],
  [/E85|no pool|invalid pool/i, "that pool doesn't exist"],
  [/Exceeded the prepaid gas|GasExceeded|GasLimitExceeded/i, "a step ran out of gas — nothing was lost, retry"],
  [/NotEnoughBalance|LackBalanceForState|not enough balance/i, "not enough NEAR to cover deposits and gas"],
  [/The account .* is not registered|not registered/i, "a required NEP-145 storage registration is missing"],
];

/** Map raw wallet / RPC / contract errors to a readable sentence. */
export function explainNearError(error: unknown): { message: string; rejected: boolean } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  if (/user (rejected|cancel|denied|closed)|rejected by user|cancelled|canceled|user reject|wallet closed|popup closed/i.test(raw)) {
    return { message: "request rejected in wallet — nothing was sent", rejected: true };
  }
  for (const [pattern, message] of REF_ERRORS) if (pattern.test(raw)) return { message, rejected: false };
  return { message: raw.length > 160 ? `${raw.slice(0, 157)}…` : raw || "transaction failed", rejected: false };
}

/** Clamp helper re-exported for UI balance math. */
export { minBig };
