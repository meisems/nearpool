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
  FEE_AMOUNT,
  FEE_ENABLED,
  FEE_RECEIVER_ID,
  FT_STORAGE_DEPOSIT_FALLBACK,
  GAS,
  LP_LOCK_ACCOUNT_ID,
  LP_STORAGE_DEPOSIT,
  POOL_CREATION_DEPOSIT,
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
import { getNativeBalance, rpcProvider, viewMethod, type NativeBalance } from "./near";
import { bestDclQuote, dclQuote, dclSwapArgs, type DclPool } from "./dcl";
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

/** Drop the cached pool list (e.g. right after creating a pool). */
export function invalidatePoolIndex() {
  poolIndex = null;
}

function simplePoolIndex(): Promise<RefPool[]> {
  if (!poolIndex || Date.now() - poolIndex.at > POOL_INDEX_TTL_MS) {
    const pools = loadAllSimplePools();
    pools.catch(() => {
      poolIndex = null;
    });
    poolIndex = { at: Date.now(), pools };
  }
  return poolIndex.pools;
}

const byReserveOf = (tokenId: string) => (a: RefPool, b: RefPool) => {
  const ra = a.reserves[a.tokenIds.indexOf(tokenId)];
  const rb = b.reserves[b.tokenIds.indexOf(tokenId)];
  return rb > ra ? 1 : rb < ra ? -1 : 0;
};

/**
 * Every Ref SIMPLE_POOL containing both tokens, deepest first (by reserve of
 * `tokenA`). Scans `get_pools` on-chain; the index is cached for 5 minutes.
 */
export async function findPoolsForPair(tokenA: string, tokenB: string): Promise<RefPool[]> {
  const pools = await simplePoolIndex();
  return pools
    .filter((pool) => pool.tokenIds.length === 2 && pool.tokenIds.includes(tokenA) && pool.tokenIds.includes(tokenB))
    .sort(byReserveOf(tokenA));
}

/**
 * Every two-token Ref SIMPLE_POOL holding `tokenId`: pools paired with NEAR
 * first, then deepest first by the token's own reserve. Empty pools last.
 */
export async function findPoolsForToken(tokenId: string): Promise<RefPool[]> {
  const pools = await simplePoolIndex();
  const deepest = byReserveOf(tokenId);
  return pools
    .filter((pool) => pool.tokenIds.length === 2 && pool.tokenIds.includes(tokenId) && pool.tokenIds[0] !== pool.tokenIds[1])
    .sort((a, b) => {
      const emptyA = a.sharesTotalSupply === 0n;
      const emptyB = b.sharesTotalSupply === 0n;
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      const nearA = a.tokenIds.includes(WRAP_NEAR_CONTRACT_ID);
      const nearB = b.tokenIds.includes(WRAP_NEAR_CONTRACT_ID);
      if (nearA !== nearB) return nearA ? -1 : 1;
      return deepest(a, b);
    });
}

/** The other token in a two-token pool. */
export const counterToken = (pool: RefPool, tokenId: string): string =>
  pool.tokenIds[0] === tokenId ? pool.tokenIds[1] : pool.tokenIds[0];

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

export type PlanStep = "storage" | "wrap" | "deposit" | "inject" | "swap" | "fee" | "lock";

export interface PlannedCall {
  step: PlanStep;
  /** Omitted for function calls; "transfer" sends `deposit` as a plain NEAR transfer. */
  action?: "transfer";
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
    actions: tx.calls.map((call) =>
      call.action === "transfer"
        ? actionCreators.transfer(call.deposit)
        : actionCreators.functionCall(call.methodName, call.args, call.gas, call.deposit),
    ),
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

function assertNativeBudget(snapshot: Pick<AccountSnapshot, "native">, calls: PlannedCall[]) {
  const needed = totalAttachedDeposit(calls) + NEAR_GAS_RESERVE;
  if (needed > snapshot.native.available) {
    throw new PlanError(
      "insufficient-near",
      `needs ${fmtNear(needed)} incl. storage and a gas reserve; wallet has ${fmtNear(snapshot.native.available)}`,
    );
  }
}

/**
 * Ref account storage (register or top up) and `register_tokens` for
 * non-whitelisted tokens, for the token entries a batch will add to the
 * user's Ref account.
 */
function refAccountCalls(snapshot: AccountSnapshot, newEntries: TokenAccountState[]): PlannedCall[] {
  const accountId = snapshot.accountId;
  const calls: PlannedCall[] = [];
  if (!snapshot.refStorage) {
    calls.push({
      step: "storage",
      receiverId: REF_FINANCE_CONTRACT_ID,
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: false },
      gas: GAS.STORAGE_DEPOSIT,
      deposit: REF_ACCOUNT_REGISTRATION_DEPOSIT,
      label: `register ${accountId} on Ref Finance · ${fmtNear(REF_ACCOUNT_REGISTRATION_DEPOSIT)}`,
    });
  } else {
    const needed = BigInt(newEntries.length) * REF_STORAGE_PER_TOKEN;
    if (needed > snapshot.refStorage.available) {
      const topUp = maxBig(REF_STORAGE_TOP_UP, needed - snapshot.refStorage.available);
      calls.push({
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
  const needsRegistration = newEntries.filter((t) => !t.whitelisted).map((t) => t.tokenId);
  if (needsRegistration.length > 0) {
    calls.push({
      step: "storage",
      receiverId: REF_FINANCE_CONTRACT_ID,
      methodName: "register_tokens",
      args: { token_ids: needsRegistration },
      gas: GAS.REGISTER_TOKENS,
      deposit: ONE_YOCTO,
      label: `register ${needsRegistration.length} non-whitelisted token${needsRegistration.length > 1 ? "s" : ""} in your Ref account`,
    });
  }
  return calls;
}

/* ---------------------------------------------------------------- platform fee */

export interface PlatformFee {
  receiverId: string;
  amount: bigint;
}

let feeCheck: Promise<PlatformFee | null> | null = null;

/**
 * The configured interface fee, or null when disabled — or when the
 * receiver account doesn't exist on-chain, since a transfer to a missing
 * named account would make every batch fail. Checked once per page load.
 */
export function getPlatformFee(): Promise<PlatformFee | null> {
  if (!FEE_ENABLED) return Promise.resolve(null);
  if (!feeCheck) {
    feeCheck = rpcProvider
      .viewAccount(FEE_RECEIVER_ID)
      .then(() => ({ receiverId: FEE_RECEIVER_ID, amount: FEE_AMOUNT }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/does not exist|UNKNOWN_ACCOUNT|doesn't exist/i.test(message)) {
          console.error(`fee receiver ${FEE_RECEIVER_ID} does not exist on-chain; fee disabled`);
          return null;
        }
        // Transient RPC failure: don't cache, keep charging the configured fee.
        feeCheck = null;
        return { receiverId: FEE_RECEIVER_ID, amount: FEE_AMOUNT };
      });
  }
  return feeCheck;
}

/** Fee transfer, always placed last so a batch that fails earlier normally isn't charged. */
function feeCall(fee: PlatformFee): PlannedCall {
  return {
    step: "fee",
    action: "transfer",
    receiverId: fee.receiverId,
    methodName: "transfer",
    args: {},
    gas: 0n,
    deposit: fee.amount,
    label: `nearpool fee · ${fmtNear(fee.amount)} → ${fee.receiverId}`,
  };
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
  /** Interface fee appended as the final transfer, if any. */
  fee?: PlatformFee | null;
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
  /** Interface fee included in this batch (0 when none). */
  fee: bigint;
  steps: PlanStep[];
  /** Set for NEAR-only injections: how the NEAR was split and swapped. */
  zap?: ZapQuote;
}

export function planInjection(snapshot: AccountSnapshot, intent: InjectionIntent): InjectionPlan {
  const { pool, amounts, slippageBps, useRefDeposits, payWithNative, existingShares, fee } = intent;
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
  const newRefEntries = tokens.filter((t, i) => splits[i].toDeposit > 0n && !t.registeredOnRefAccount);
  const refCalls = refAccountCalls(snapshot, newRefEntries);

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

  const calls = [...refCalls, ...tokenCalls, injectCall, ...(fee ? [feeCall(fee)] : [])];
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
    fee: fee?.amount ?? 0n,
    steps: [...new Set(calls.map((c) => c.step))],
  };
}

/* ---------------------------------------------------------------- swap */

/** An ordered swap path: `path[i]` → `path[i + 1]` through `pools[i]`. */
export interface SwapRoute {
  pools: RefPool[];
  path: string[];
}

/** Exact output of a route for `amountIn`, hop by hop (0 if any hop can't fill). */
export function quoteRoute(route: SwapRoute, amountIn: bigint): bigint {
  let amount = amountIn;
  for (let i = 0; i < route.pools.length; i++) {
    const pool = route.pools[i];
    const inIdx = pool.tokenIds.indexOf(route.path[i]);
    const outIdx = pool.tokenIds.indexOf(route.path[i + 1]);
    if (inIdx < 0 || outIdx < 0) return 0n;
    amount = estimateSwapOut(amount, pool.reserves[inIdx], pool.reserves[outIdx], pool.totalFeeBps);
    if (amount <= 0n) return 0n;
  }
  return amount;
}

/** Output at spot prices with no fee or impact — the reference for price impact. */
export function spotQuoteRoute(route: SwapRoute, amountIn: bigint): bigint {
  let amount = amountIn;
  for (let i = 0; i < route.pools.length; i++) {
    const pool = route.pools[i];
    const inIdx = pool.tokenIds.indexOf(route.path[i]);
    const outIdx = pool.tokenIds.indexOf(route.path[i + 1]);
    if (inIdx < 0 || outIdx < 0 || pool.reserves[inIdx] <= 0n) return 0n;
    amount = (amount * pool.reserves[outIdx]) / pool.reserves[inIdx];
  }
  return amount;
}

/** Highest-output route for `amountIn`, or null if none can fill it. */
export function bestRoute(routes: SwapRoute[], amountIn: bigint): { route: SwapRoute; out: bigint } | null {
  let best: { route: SwapRoute; out: bigint } | null = null;
  for (const route of routes) {
    const out = quoteRoute(route, amountIn);
    if (out > 0n && (!best || out > best.out)) best = { route, out };
  }
  return best;
}

const MAX_ROUTE_CANDIDATES = 40;

/**
 * Candidate routes from `tokenIn` to `tokenOut` over Ref simple pools:
 * every direct pool, plus two-hop routes through any token both sides are
 * paired with (deepest pool per leg). Lets tokens that only trade against,
 * say, USDC be bought with NEAR.
 */
export async function findSwapRoutes(tokenIn: string, tokenOut: string): Promise<SwapRoute[]> {
  if (tokenIn === tokenOut) return [];
  const pools = (await simplePoolIndex()).filter((p) => p.tokenIds.length === 2 && p.sharesTotalSupply > 0n);
  const holding = (token: string) => pools.filter((p) => p.tokenIds.includes(token));
  const reserveOf = (pool: RefPool, token: string) => pool.reserves[pool.tokenIds.indexOf(token)] ?? 0n;
  const deepestFor = (candidates: RefPool[], token: string) =>
    candidates.reduce<RefPool | null>((best, p) => (!best || reserveOf(p, token) > reserveOf(best, token) ? p : best), null);

  const routes: SwapRoute[] = [];
  const fromIn = holding(tokenIn);
  for (const pool of fromIn.filter((p) => p.tokenIds.includes(tokenOut))) routes.push({ pools: [pool], path: [tokenIn, tokenOut] });

  // Two hops: tokenIn → X → tokenOut. Iterate from the (usually smaller) tokenOut side.
  const byMiddle = new Map<string, RefPool[]>();
  for (const pool of holding(tokenOut)) {
    const middle = counterToken(pool, tokenOut);
    if (middle === tokenIn) continue;
    byMiddle.set(middle, [...(byMiddle.get(middle) ?? []), pool]);
  }
  const twoHop: Array<{ route: SwapRoute; depth: bigint }> = [];
  for (const [middle, outPools] of byMiddle) {
    const first = deepestFor(fromIn.filter((p) => p.tokenIds.includes(middle)), middle);
    const second = deepestFor(outPools, middle);
    if (!first || !second) continue;
    const depth = reserveOf(first, middle) < reserveOf(second, middle) ? reserveOf(first, middle) : reserveOf(second, middle);
    twoHop.push({ route: { pools: [first, second], path: [tokenIn, middle, tokenOut] }, depth });
  }
  twoHop.sort((a, b) => (b.depth > a.depth ? 1 : b.depth < a.depth ? -1 : 0));
  routes.push(...twoHop.slice(0, MAX_ROUTE_CANDIDATES).map((c) => c.route));
  return routes;
}

export interface SwapIntent {
  /** Pools in hop order; one pool for a direct swap. */
  pools: RefPool[];
  /** Tokens in hop order: [tokenIn, (middle), tokenOut]. */
  path: string[];
  amountIn: bigint;
  slippageBps: number;
  payWithNative: boolean;
  fee?: PlatformFee | null;
}

export interface SwapPlan {
  calls: PlannedCall[];
  transactions: PlannedTransaction[];
  expectedOut: bigint;
  minAmountOut: bigint;
  wrapAmount: bigint;
  fee: bigint;
  steps: PlanStep[];
}

/**
 * Ref "instant swap": one `ft_transfer_call` whose message chains the hops;
 * the output is sent straight back to the wallet. Slippage is enforced on
 * the final hop (intermediate hops only need to fill).
 */
export function planSwap(snapshot: AccountSnapshot, intent: SwapIntent): SwapPlan {
  const { pools, path, amountIn, slippageBps, payWithNative, fee } = intent;
  const accountId = snapshot.accountId;
  if (pools.length === 0 || pools.length > 2 || path.length !== pools.length + 1) {
    throw new PlanError("unsupported-pool", "invalid swap route");
  }
  const tokenIn = path[0];
  const tokenOut = path[path.length - 1];
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    if (pool.kind !== SIMPLE_POOL) throw new PlanError("unsupported-pool", `pool #${pool.id} is not a simple pool`);
    if (!pool.tokenIds.includes(path[i]) || !pool.tokenIds.includes(path[i + 1])) {
      throw new PlanError("unsupported-pool", `pool #${pool.id} doesn't hold this pair`);
    }
  }
  if (amountIn <= 0n) throw new PlanError("zero-amount", "enter an amount");

  const expectedOut = quoteRoute({ pools, path }, amountIn);
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

  const last = pools.length - 1;
  calls.push({
    step: "swap",
    receiverId: tokenIn,
    methodName: "ft_transfer_call",
    args: {
      receiver_id: REF_FINANCE_CONTRACT_ID,
      amount: amountIn.toString(),
      msg: JSON.stringify({
        force: 0,
        actions: pools.map((pool, i) => ({
          pool_id: pool.id,
          token_in: path[i],
          token_out: path[i + 1],
          min_amount_out: i === last ? minAmountOut.toString() : "0",
        })),
      }),
    },
    gas: pools.length > 1 ? GAS.SWAP_MULTI_HOP : GAS.SWAP,
    deposit: ONE_YOCTO,
    label: `swap via ${pools.map((p) => `#${p.id}`).join(" → ")} · min ${fmtAmount(minAmountOut, outState.metadata.decimals)} ${displaySymbol(tokenOut, outState.metadata)}`,
  });

  if (fee) calls.push(feeCall(fee));
  assertNativeBudget(snapshot, calls);
  return {
    calls,
    transactions: groupCalls(calls),
    expectedOut,
    minAmountOut,
    wrapAmount,
    fee: fee?.amount ?? 0n,
    steps: [...new Set(calls.map((c) => c.step))],
  };
}

/* ---------------------------------------------------------------- NEAR-only injection (zap) */

/**
 * Run `route` for `amountIn` against pool reserves in `state` (pool id →
 * reserves), updating them as Ref would, so a later hop or the target pool
 * sees the post-swap price. Returns the output (0 if a hop can't fill).
 */
function runRoute(route: SwapRoute, amountIn: bigint, state: Map<number, bigint[]>): bigint {
  let amount = amountIn;
  for (let i = 0; i < route.pools.length; i++) {
    const pool = route.pools[i];
    const reserves = state.get(pool.id) ?? [...pool.reserves];
    const inIdx = pool.tokenIds.indexOf(route.path[i]);
    const outIdx = pool.tokenIds.indexOf(route.path[i + 1]);
    if (inIdx < 0 || outIdx < 0) return 0n;
    const out = estimateSwapOut(amount, reserves[inIdx], reserves[outIdx], pool.totalFeeBps);
    if (out <= 0n) return 0n;
    const next = [...reserves];
    next[inIdx] += amount;
    next[outIdx] -= out;
    state.set(pool.id, next);
    amount = out;
  }
  return amount;
}

export interface ZapQuote {
  /** NEAR (yocto) put in, split across the pool's sides. */
  nearIn: bigint;
  /** NEAR allocated to each side, in pool token order. */
  spend: bigint[];
  /** Route that buys each side with wNEAR; null for a wNEAR side. */
  routes: (SwapRoute | null)[];
  /** Expected amount of each side after the swaps, pool order. */
  amounts: bigint[];
  /** Target pool reserves after the swaps (a route may pass through it). */
  reserves: bigint[];
  /** Set when the non-NEAR side is bought from a Rhea DCL pool instead of a Ref route. */
  dcl?: { side: number; poolId: string; fee: number };
}

/**
 * Split `nearIn` so that, after buying the pool's non-NEAR side(s), the
 * amounts match the pool's ratio. A route through the target pool itself is
 * accounted for (the swap moves its price first). An empty pool takes a
 * 50/50 split at market prices, which sets its starting price.
 */
export function quoteZap(pool: RefPool, nearIn: bigint, routes: (SwapRoute | null)[]): ZapQuote | null {
  if (pool.tokenIds.length !== 2 || routes.length !== 2 || nearIn <= 1n) return null;
  for (let i = 0; i < 2; i++) {
    const side = pool.tokenIds[i];
    const route = routes[i];
    if (side === WRAP_NEAR_CONTRACT_ID ? route !== null : !route || route.path[0] !== WRAP_NEAR_CONTRACT_ID || route.path[route.path.length - 1] !== side) {
      return null;
    }
  }
  const evaluate = (toFirst: bigint) => {
    const spend = [toFirst, nearIn - toFirst];
    const state = new Map<number, bigint[]>();
    const amounts = spend.map((amount, i) => (routes[i] ? runRoute(routes[i]!, amount, state) : amount));
    const reserves = state.get(pool.id) ?? [...pool.reserves];
    return { spend, amounts, reserves };
  };

  const empty = pool.sharesTotalSupply === 0n || pool.reserves.some((r) => r === 0n);
  let result = evaluate(nearIn / 2n);
  if (!empty) {
    // Smallest share for side 0 where amounts[0] / reserves[0] ≥ amounts[1] / reserves[1].
    let lo = 1n;
    let hi = nearIn - 1n;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const r = evaluate(mid);
      if (r.amounts[0] * r.reserves[1] >= r.amounts[1] * r.reserves[0]) hi = mid;
      else lo = mid + 1n;
    }
    result = evaluate(lo);
  }
  if (result.amounts.some((a) => a <= 0n)) return null;
  return { nearIn, routes, ...result };
}

export interface ZapIntent {
  /** Target pool, freshly read. */
  pool: RefPool;
  quote: ZapQuote;
  slippageBps: number;
  existingShares: bigint;
  fee?: PlatformFee | null;
}

/**
 * Add liquidity with NEAR only, in one approval:
 * wrap and deposit the NEAR into Ref, buy the other side(s) with Ref `swap`
 * on the deposit, then `add_liquidity` from the deposits. The swaps and
 * `add_liquidity` share one transaction, so if a swap misses its minimum
 * nothing is added and the wNEAR stays in your Ref balance. The token side
 * uses each swap's minimum output; anything received above it (and any
 * unused NEAR) stays in your Ref balance.
 */
export function planZapInjection(snapshot: AccountSnapshot, intent: ZapIntent): InjectionPlan {
  const { pool, quote, slippageBps, existingShares, fee } = intent;
  const accountId = snapshot.accountId;
  if (pool.kind !== SIMPLE_POOL) {
    throw new PlanError("unsupported-pool", `pool #${pool.id} is a ${pool.kind.toLowerCase().replace(/_/g, " ")}; only simple pools are supported`);
  }
  if (quote.nearIn <= 0n) throw new PlanError("zero-amount", "enter an amount");
  const state = (id: string) => {
    const t = snapshot.tokens[id];
    if (!t) throw new Error(`missing account state for ${id}`);
    return t;
  };
  const wnear = state(WRAP_NEAR_CONTRACT_ID);

  // What add_liquidity takes: the NEAR side as allocated, bought sides at their swap minimum.
  const minOuts = quote.amounts.map((a, i) => (quote.routes[i] ? applySlippage(a, slippageBps) : a));
  const amounts = minOuts;
  if (amounts.some((a) => a <= 0n)) throw new PlanError("zero-amount", "amount too small");
  const supply = pool.sharesTotalSupply;
  const estimate = estimateAddLiquidity(amounts, quote.reserves, supply);
  if (estimate.shares <= 0n) throw new PlanError("no-liquidity", "amount is too small to mint any LP shares");
  const minAmounts = estimate.initializesPool ? [...amounts] : minAmountsFor(estimate.usedAmounts, slippageBps);

  // Ref account entries this batch creates: wNEAR, every token a route touches, both pool tokens.
  const touched = new Set<string>([WRAP_NEAR_CONTRACT_ID, ...pool.tokenIds]);
  for (const route of quote.routes) route?.path.forEach((id) => touched.add(id));
  const newEntries = [...touched].map(state).filter((t) => !t.registeredOnRefAccount);
  const refCalls = refAccountCalls(snapshot, newEntries);

  // Wrap (shortfall only) and deposit all the NEAR into Ref as wNEAR.
  const wrapsHere = quote.nearIn > wnear.walletBalance;
  const fundCalls = [...tokenStorageCalls(wnear, accountId, { user: wrapsHere, ref: true })];
  const funding = fundingCalls(wnear, quote.nearIn, true);
  fundCalls.push(...funding.calls);

  const swapCalls: PlannedCall[] = [];
  quote.routes.forEach((route, side) => {
    if (!route) return;
    const last = route.pools.length - 1;
    const sym = displaySymbol(route.path[last + 1], snapshot.tokens[route.path[last + 1]]?.metadata);
    swapCalls.push({
      step: "swap",
      receiverId: REF_FINANCE_CONTRACT_ID,
      methodName: "swap",
      args: {
        actions: route.pools.map((p, i) => ({
          pool_id: p.id,
          token_in: route.path[i],
          token_out: route.path[i + 1],
          ...(i === 0 ? { amount_in: quote.spend[side].toString() } : {}),
          min_amount_out: i === last ? minOuts[side].toString() : "0",
        })),
      },
      gas: GAS.REF_SWAP,
      deposit: ONE_YOCTO,
      label: `buy ${sym} with ${fmtAmount(quote.spend[side], NEAR_DECIMALS)} NEAR in Ref · min ${fmtAmount(minOuts[side], state(route.path[last + 1]).metadata.decimals)} ${sym}`,
    });
  });

  const lpDeposit = existingShares > 0n ? ONE_YOCTO : LP_STORAGE_DEPOSIT;
  const injectCall: PlannedCall = {
    step: "inject",
    receiverId: REF_FINANCE_CONTRACT_ID,
    methodName: "add_liquidity",
    args: { pool_id: pool.id, amounts: amounts.map(String), min_amounts: minAmounts.map(String) },
    gas: GAS.ADD_LIQUIDITY,
    deposit: lpDeposit,
    label: `add liquidity to pool #${pool.id}${existingShares > 0n ? "" : ` · ${fmtNear(lpDeposit)} LP storage, unused part refunded`}`,
  };

  const calls = [...refCalls, ...fundCalls, ...swapCalls, injectCall, ...(fee ? [feeCall(fee)] : [])];
  assertNativeBudget(snapshot, calls);
  const transactions = groupCalls(calls);
  // The swaps and add_liquidity must land in one transaction to stay all-or-nothing.
  if (!transactions.some((tx) => tx.calls.includes(injectCall) && swapCalls.every((c) => tx.calls.includes(c)))) {
    throw new PlanError("unsupported-pool", "this route needs too much gas for one transaction");
  }
  return {
    calls,
    transactions,
    usedAmounts: estimate.usedAmounts,
    minAmounts,
    expectedShares: estimate.shares,
    walletDeposits: pool.tokenIds.map((id) => (id === WRAP_NEAR_CONTRACT_ID ? quote.nearIn : 0n)),
    refDepositsUsed: [0n, 0n],
    wrapAmount: funding.wrap,
    fee: fee?.amount ?? 0n,
    steps: [...new Set(calls.map((c) => c.step))],
    zap: quote,
  };
}

/* ---------------------------------------------------------------- NEAR only via Rhea DCL */

/**
 * Split for a NEAR-only deposit into a NEAR/token Ref pool when the token is
 * bought from a Rhea DCL pool (e.g. NearPaid coins). An empty target pool
 * gets half the NEAR spent, which sets its price at the DCL market rate;
 * otherwise the spend is sized from a first quote so the amounts match the
 * pool's ratio, then quoted exactly.
 */
export async function quoteZapViaDcl(pool: RefPool, nearIn: bigint, dclPools: DclPool[]): Promise<ZapQuote | null> {
  const nearSide = pool.tokenIds.indexOf(WRAP_NEAR_CONTRACT_ID);
  if (pool.tokenIds.length !== 2 || nearSide < 0 || nearIn <= 1n || dclPools.length === 0) return null;
  const side = nearSide === 0 ? 1 : 0;
  const token = pool.tokenIds[side];
  const half = nearIn / 2n;
  const probe = await bestDclQuote(dclPools, WRAP_NEAR_CONTRACT_ID, token, half);
  if (!probe) return null;
  let spend = half;
  let out = probe.out;
  const empty = pool.sharesTotalSupply === 0n || pool.reserves.some((r) => r === 0n);
  if (!empty) {
    // out(s) ≈ s·out0/s0; want out(s)/(nearIn − s) = rToken/rNear.
    const rNear = pool.reserves[nearSide];
    const rToken = pool.reserves[side];
    spend = (nearIn * rToken * half) / (probe.out * rNear + rToken * half);
    if (spend <= 0n || spend >= nearIn) return null;
    out = await dclQuote(probe.pool.id, WRAP_NEAR_CONTRACT_ID, token, spend);
    if (out <= 0n) return null;
  }
  const spendBySide = [0n, 0n];
  spendBySide[side] = spend;
  spendBySide[nearSide] = nearIn - spend;
  const amounts = [0n, 0n];
  amounts[side] = out;
  amounts[nearSide] = nearIn - spend;
  return {
    nearIn,
    spend: spendBySide,
    routes: [null, null],
    amounts,
    reserves: [...pool.reserves],
    dcl: { side, poolId: probe.pool.id, fee: probe.pool.fee },
  };
}

/**
 * NEAR-only deposit buying the token from a Rhea DCL pool:
 * register (Ref account; wallet and Ref on the token) → wrap → DCL swap
 * (token lands in the wallet) → deposit wNEAR and the token into Ref →
 * `add_liquidity`. The token side uses the swap's minimum output; anything
 * above it stays in the wallet. If the swap misses its minimum, the later
 * token deposit and `add_liquidity` fail and the wNEAR stays deposited in
 * your Ref balance (withdrawable).
 */
export function planZapViaDcl(snapshot: AccountSnapshot, intent: ZapIntent): InjectionPlan {
  const { pool, quote, slippageBps, existingShares, fee } = intent;
  const dcl = quote.dcl;
  if (!dcl) throw new Error("not a DCL quote");
  const accountId = snapshot.accountId;
  if (pool.kind !== SIMPLE_POOL) {
    throw new PlanError("unsupported-pool", `pool #${pool.id} is a ${pool.kind.toLowerCase().replace(/_/g, " ")}; only simple pools are supported`);
  }
  const side = dcl.side;
  const nearSide = side === 0 ? 1 : 0;
  const state = (id: string) => {
    const t = snapshot.tokens[id];
    if (!t) throw new Error(`missing account state for ${id}`);
    return t;
  };
  const wnear = state(WRAP_NEAR_CONTRACT_ID);
  const token = state(pool.tokenIds[side]);
  const sym = displaySymbol(token.tokenId, token.metadata);

  const minOut = applySlippage(quote.amounts[side], slippageBps);
  const amounts = [0n, 0n];
  amounts[side] = minOut;
  amounts[nearSide] = quote.spend[nearSide];
  if (amounts.some((a) => a <= 0n)) throw new PlanError("zero-amount", "amount too small");
  const estimate = estimateAddLiquidity(amounts, pool.reserves, pool.sharesTotalSupply);
  if (estimate.shares <= 0n) throw new PlanError("no-liquidity", "amount is too small to mint any LP shares");
  const minAmounts = estimate.initializesPool ? [...amounts] : minAmountsFor(estimate.usedAmounts, slippageBps);

  const refCalls = refAccountCalls(snapshot, [wnear, token].filter((t) => !t.registeredOnRefAccount));
  // The wallet receives the bought token; Ref receives it as a deposit.
  const tokenPrep = tokenStorageCalls(token, accountId, { user: true, ref: true });

  const wrapCalls: PlannedCall[] = [];
  const wrap = maxBig(quote.nearIn - wnear.walletBalance, 0n);
  wrapCalls.push(...tokenStorageCalls(wnear, accountId, { user: wrap > 0n, ref: true }));
  if (wrap > 0n) {
    wrapCalls.push({
      step: "wrap",
      receiverId: WRAP_NEAR_CONTRACT_ID,
      methodName: "near_deposit",
      args: {},
      gas: GAS.NEAR_DEPOSIT,
      deposit: wrap,
      label: `wrap ${fmtAmount(wrap, NEAR_DECIMALS)} NEAR → wNEAR`,
    });
  }
  const swapCall: PlannedCall = {
    step: "swap",
    receiverId: WRAP_NEAR_CONTRACT_ID,
    methodName: "ft_transfer_call",
    args: dclSwapArgs(dcl.poolId, token.tokenId, quote.spend[side], minOut),
    gas: GAS.DCL_SWAP,
    deposit: ONE_YOCTO,
    label: `buy ${sym} with ${fmtAmount(quote.spend[side], NEAR_DECIMALS)} NEAR on Rhea (${dcl.fee / 10_000}% pool) · min ${fmtAmount(minOut, token.metadata.decimals)} ${sym}`,
  };
  const deposit = (t: TokenAccountState, amount: bigint): PlannedCall => ({
    step: "deposit",
    receiverId: t.tokenId,
    methodName: "ft_transfer_call",
    args: { receiver_id: REF_FINANCE_CONTRACT_ID, amount: amount.toString(), msg: "" },
    gas: GAS.FT_TRANSFER_CALL,
    deposit: ONE_YOCTO,
    label: `deposit ${fmtAmount(amount, t.metadata.decimals)} ${displaySymbol(t.tokenId, t.metadata)} into Ref`,
  });
  const lpDeposit = existingShares > 0n ? ONE_YOCTO : LP_STORAGE_DEPOSIT;
  const injectCall: PlannedCall = {
    step: "inject",
    receiverId: REF_FINANCE_CONTRACT_ID,
    methodName: "add_liquidity",
    args: { pool_id: pool.id, amounts: amounts.map(String), min_amounts: minAmounts.map(String) },
    gas: GAS.ADD_LIQUIDITY,
    deposit: lpDeposit,
    label: `add liquidity to pool #${pool.id}${existingShares > 0n ? "" : ` · ${fmtNear(lpDeposit)} LP storage, unused part refunded`}`,
  };

  const calls = [
    ...refCalls,
    ...tokenPrep,
    ...wrapCalls,
    swapCall,
    deposit(wnear, amounts[nearSide]),
    deposit(token, minOut),
    injectCall,
    ...(fee ? [feeCall(fee)] : []),
  ];
  assertNativeBudget(snapshot, calls);
  const walletDeposits = [0n, 0n];
  walletDeposits[nearSide] = amounts[nearSide];
  walletDeposits[side] = minOut;
  return {
    calls,
    transactions: groupCalls(calls),
    usedAmounts: estimate.usedAmounts,
    minAmounts,
    expectedShares: estimate.shares,
    walletDeposits,
    refDepositsUsed: [0n, 0n],
    wrapAmount: wrap,
    fee: fee?.amount ?? 0n,
    steps: [...new Set(calls.map((c) => c.step))],
    zap: quote,
  };
}

export interface DclSwapIntent {
  tokenIn: string;
  tokenOut: string;
  poolId: string;
  poolFee: number;
  amountIn: bigint;
  /** Quoted output for `amountIn`. */
  expectedOut: bigint;
  slippageBps: number;
  payWithNative: boolean;
  fee?: PlatformFee | null;
}

/** Swap through a Rhea DCL pool (single pool); output goes straight to the wallet. */
export function planDclSwap(snapshot: AccountSnapshot, intent: DclSwapIntent): SwapPlan {
  const { tokenIn, tokenOut, poolId, poolFee, amountIn, expectedOut, slippageBps, payWithNative, fee } = intent;
  const accountId = snapshot.accountId;
  if (amountIn <= 0n) throw new PlanError("zero-amount", "enter an amount");
  if (expectedOut <= 0n) throw new PlanError("no-liquidity", "the pool has no depth for this trade");
  const minAmountOut = applySlippage(expectedOut, slippageBps);
  const inState = snapshot.tokens[tokenIn];
  const outState = snapshot.tokens[tokenOut];
  if (!inState || !outState) throw new Error("missing account state for swap tokens");

  const calls: PlannedCall[] = [...tokenStorageCalls(outState, accountId, { user: true, ref: false })];
  let wrapAmount = 0n;
  if (tokenIn === WRAP_NEAR_CONTRACT_ID && payWithNative) {
    wrapAmount = maxBig(amountIn - inState.walletBalance, 0n);
    calls.push(...tokenStorageCalls(inState, accountId, { user: wrapAmount > 0n, ref: false }));
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
    args: dclSwapArgs(poolId, tokenOut, amountIn, minAmountOut),
    gas: GAS.DCL_SWAP,
    deposit: ONE_YOCTO,
    label: `swap on Rhea (${poolFee / 10_000}% pool) · min ${fmtAmount(minAmountOut, outState.metadata.decimals)} ${displaySymbol(tokenOut, outState.metadata)}`,
  });
  if (fee) calls.push(feeCall(fee));
  assertNativeBudget(snapshot, calls);
  return {
    calls,
    transactions: groupCalls(calls),
    expectedOut,
    minAmountOut,
    wrapAmount,
    fee: fee?.amount ?? 0n,
    steps: [...new Set(calls.map((c) => c.step))],
  };
}

/* ---------------------------------------------------------------- permanent LP lock */

/** Ref multi-fungible-token id of a pool's LP shares. */
export const lpTokenId = (poolId: number) => `:${poolId}`;

/** LP shares of `poolId` locked forever (held by the unowned lock account). */
export async function getLockedShares(poolId: number): Promise<bigint> {
  return getPoolShares(poolId, LP_LOCK_ACCOUNT_ID);
}

/** Whether the lock account already has an LP record in the pool (Ref panics on a second `mft_register`). */
export async function isLockAccountRegistered(poolId: number): Promise<boolean> {
  if ((await getLockedShares(poolId)) > 0n) return true;
  return !!(await viewMethod<boolean | null>(REF_FINANCE_CONTRACT_ID, "mft_has_registered", {
    token_id: lpTokenId(poolId),
    account_id: LP_LOCK_ACCOUNT_ID,
  }));
}

export interface LockIntent {
  poolId: number;
  /** LP shares to lock. */
  shares: bigint;
  /** The wallet's current LP shares in the pool. */
  available: bigint;
  lockRegistered: boolean;
}

export interface LockPlan {
  calls: PlannedCall[];
  transactions: PlannedTransaction[];
  shares: bigint;
}

/**
 * Lock LP shares forever: `mft_transfer` them to LP_LOCK_ACCOUNT_ID, an
 * account nobody controls (registering it in the pool first if needed).
 * Irreversible; the shares' trading fees stay locked with them.
 */
export function planLockShares(native: NativeBalance, intent: LockIntent): LockPlan {
  const { poolId, shares, available, lockRegistered } = intent;
  if (shares <= 0n) throw new PlanError("zero-amount", "enter an amount");
  if (shares > available) throw new PlanError("insufficient-token", "more than your LP shares in this pool");
  const calls: PlannedCall[] = [];
  if (!lockRegistered) {
    calls.push({
      step: "storage",
      receiverId: REF_FINANCE_CONTRACT_ID,
      methodName: "mft_register",
      args: { token_id: lpTokenId(poolId), account_id: LP_LOCK_ACCOUNT_ID },
      gas: GAS.MFT,
      deposit: LP_STORAGE_DEPOSIT,
      label: `register the lock account in pool #${poolId} · ${fmtNear(LP_STORAGE_DEPOSIT)} storage, unused part refunded`,
    });
  }
  calls.push({
    step: "lock",
    receiverId: REF_FINANCE_CONTRACT_ID,
    methodName: "mft_transfer",
    args: { token_id: lpTokenId(poolId), receiver_id: LP_LOCK_ACCOUNT_ID, amount: shares.toString(), memo: "nearpool: LP locked forever" },
    gas: GAS.MFT,
    deposit: ONE_YOCTO,
    label: `lock ${fmtAmount(shares, NEAR_DECIMALS)} LP shares of pool #${poolId} forever`,
  });
  assertNativeBudget({ native }, calls);
  return { calls, transactions: groupCalls(calls), shares };
}

/* ---------------------------------------------------------------- pool creation */

/** Swap-fee tiers offered for new pools, in basis points. */
export const POOL_FEE_TIERS = [5, 20, 30, 100] as const;

export interface CreatePoolIntent {
  tokenIds: [string, string];
  /** Pool swap fee in basis points. */
  feeBps: number;
  fee?: PlatformFee | null;
}

export interface CreatePoolPlan {
  calls: PlannedCall[];
  transactions: PlannedTransaction[];
  fee: bigint;
}

/**
 * Ref `add_simple_pool({ tokens, fee })`. The attached deposit pays the new
 * pool's storage; Ref refunds whatever isn't used. The pool starts empty —
 * its first liquidity sets the price.
 */
export function planCreatePool(native: NativeBalance, intent: CreatePoolIntent): CreatePoolPlan {
  const { tokenIds, feeBps, fee } = intent;
  if (tokenIds[0] === tokenIds[1]) throw new PlanError("unsupported-pool", "pick two different tokens");
  if (!Number.isInteger(feeBps) || feeBps <= 0 || feeBps >= 10_000) throw new PlanError("unsupported-pool", "invalid pool fee");
  const calls: PlannedCall[] = [
    {
      step: "inject",
      receiverId: REF_FINANCE_CONTRACT_ID,
      methodName: "add_simple_pool",
      args: { tokens: tokenIds, fee: feeBps },
      gas: GAS.ADD_SIMPLE_POOL,
      deposit: POOL_CREATION_DEPOSIT,
      label: `create pool · ${(feeBps / 100).toFixed(2)}% fee · ${fmtNear(POOL_CREATION_DEPOSIT)} storage, unused part refunded`,
    },
  ];
  if (fee) calls.push(feeCall(fee));
  assertNativeBudget({ native }, calls);
  return { calls, transactions: groupCalls(calls), fee: fee?.amount ?? 0n };
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
