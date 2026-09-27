/**
 * Pure checks for the fixed-point math and the Ref Finance transaction planner.
 * Run with `npm test` (bundled by esbuild so `import.meta.env` resolves).
 */
import assert from "node:assert/strict";
import { formatUnits, parseUnits, shortAccount, rawToInput } from "../src/lib/format";
import {
  applySlippage, estimateAddLiquidity, estimateSwapOut, INIT_SHARES_SUPPLY, quoteCounterAmount, splitFunding, swapPriceImpactBps, spotPrice,
} from "../src/utils/zapMath";
import {
  groupCalls, planInjection, planSwap, PlanError, toWalletTransactions, explainNearError,
  type AccountSnapshot, type RefPool, type TokenAccountState, type PlannedCall,
} from "../src/lib/refFinance";
import { findOutcomeFailure, outcomeReturnValue, isValidAccountId } from "../src/lib/near";
import { parseTokenInput } from "../src/lib/tokenInput";

const NEAR = 10n ** 24n;
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const REF = "v2.ref-finance.near";
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log("ok -", name); };

/* ---------------- format */
test("parseUnits/formatUnits exact round trip", () => {
  assert.equal(parseUnits("1.5", 6), 1_500_000n);
  assert.equal(parseUnits("0.000000000000000000000001", 24), 1n);
  assert.equal(parseUnits("1.1234567", 6), null); // too many decimals
  assert.equal(parseUnits("abc", 6), null);
  assert.equal(parseUnits(".", 6), null);
  assert.equal(parseUnits("12.", 6), 12_000_000n);
  assert.equal(formatUnits(1_500_000n, 6), "1.5");
  assert.equal(formatUnits(123456789012345678901234567n, 24), "123.456789012345678901234567");
  assert.equal(formatUnits(5n, 0), "5");
  assert.equal(rawToInput(1_234_567_891n, 6, 2), "1234.56");
});
test("shortAccount", () => {
  assert.equal(shortAccount("user.near"), "user.near");
  assert.equal(shortAccount("a".repeat(64).replace(/a/g, "b")), "bbbb…bbbb");
  assert.ok(shortAccount("averyveryverylongaccountname.near").endsWith(".near"));
  assert.ok(isValidAccountId("wrap.near") && isValidAccountId(USDC) && !isValidAccountId("Bad.near") && !isValidAccountId("a"));
});

/* ---------------- math */
test("counter amount ΔB = ΔA·RB/RA (ceil)", () => {
  assert.equal(quoteCounterAmount(10n * NEAR, 1_000n * NEAR, 5_000_000_000n), 50_000_000n);
  assert.equal(quoteCounterAmount(1n, 3n, 10n), 4n); // 3.33 → 4
  assert.equal(quoteCounterAmount(0n, 3n, 10n), 0n);
});
test("slippage floor", () => {
  assert.equal(applySlippage(10_000n, 50), 9_950n);
  assert.equal(applySlippage(999n, 100), 989n);
  assert.throws(() => applySlippage(1n, -1));
});
test("add liquidity mirrors Ref simple pool", () => {
  const reserves = [1_000n * NEAR, 5_000_000_000n];
  const total = 2_000n * NEAR;
  const amounts = [10n * NEAR, quoteCounterAmount(10n * NEAR, reserves[0], reserves[1])];
  const est = estimateAddLiquidity(amounts, reserves, total);
  assert.equal(est.shares, 20n * NEAR);
  assert.deepEqual(est.usedAmounts, [10n * NEAR, 50_000_000n]);
  assert.equal(est.poolShareBps, 99); // 20/2020
  const empty = estimateAddLiquidity([1n, 2n], [0n, 0n], 0n);
  assert.equal(empty.shares, INIT_SHARES_SUPPLY);
  assert.ok(empty.initializesPool);
  // Unbalanced input: the scarcer side binds, the excess is not used.
  const unbalanced = estimateAddLiquidity([10n * NEAR, 100_000_000n], reserves, total);
  assert.deepEqual(unbalanced.usedAmounts, [10n * NEAR, 50_000_000n]);
});
test("swap out mirrors Ref fee formula", () => {
  // 1000/1000 pool, 30 bps fee, 10 in → 10*9970*1000/(10000*1000+10*9970)
  assert.equal(estimateSwapOut(10n, 1000n, 1000n, 30), (10n * 9970n * 1000n) / (10000n * 1000n + 99700n));
  assert.equal(estimateSwapOut(10n * NEAR, 1000n * NEAR, 1000n * NEAR, 30), 9871580343970612988504609n);
  assert.ok(swapPriceImpactBps(10n * NEAR, 9871580343970612988504609n, 1000n * NEAR, 1000n * NEAR) > 100);
  assert.ok(Math.abs(spotPrice(1_000n * NEAR, 24, 5_000_000_000n, 6) - 0.2) < 1e-12);
});
test("funding split", () => {
  assert.deepEqual(splitFunding(10n, 4n, true), { fromRef: 4n, toDeposit: 6n });
  assert.deepEqual(splitFunding(10n, 40n, true), { fromRef: 10n, toDeposit: 0n });
  assert.deepEqual(splitFunding(10n, 40n, false), { fromRef: 0n, toDeposit: 10n });
});

/* ---------------- planner fixtures */
const pool: RefPool = { id: 42, kind: "SIMPLE_POOL", tokenIds: ["wrap.near", USDC], reserves: [1_000n * NEAR, 5_000_000_000n], totalFeeBps: 30, sharesTotalSupply: 2_000n * NEAR };
const token = (tokenId: string, decimals: number, over: Partial<TokenAccountState> = {}): TokenAccountState => ({
  tokenId, metadata: { spec: "ft-1.0.0", name: tokenId, symbol: tokenId === "wrap.near" ? "wNEAR" : "USDC", icon: null, reference: null, reference_hash: null, decimals },
  walletBalance: 0n, refDeposit: 0n, registeredOnRefAccount: false, userStorage: { total: 1n, available: 0n }, refStorageOnToken: { total: 1n, available: 0n },
  storageMinimum: 1_250_000_000_000_000_000_000n, whitelisted: true, ...over,
});
const snapshot = (over: Partial<AccountSnapshot> = {}, tokens: Record<string, TokenAccountState> = {}): AccountSnapshot => ({
  accountId: "alice.near", native: { total: 100n * NEAR, storageReserved: NEAR / 100n, available: 100n * NEAR }, refStorage: { total: NEAR / 10n, available: NEAR / 10n },
  tokens: { "wrap.near": token("wrap.near", 24), [USDC]: token(USDC, 6, { walletBalance: 100_000_000n }), ...tokens }, fetchedAt: 0, ...over,
});
const amounts = [10n * NEAR, 50_000_000n];
const methods = (calls: PlannedCall[]) => calls.map((c) => `${c.receiverId === "wrap.near" ? "W" : c.receiverId === REF ? "R" : "U"}:${c.methodName}`);

test("fresh user: register Ref, register on wrap, wrap, deposit both, inject", () => {
  const snap = snapshot({ refStorage: null }, {
    "wrap.near": token("wrap.near", 24, { userStorage: null, refStorageOnToken: null }),
    [USDC]: token(USDC, 6, { walletBalance: 100_000_000n, refStorageOnToken: null }),
  });
  const plan = planInjection(snap, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 0n });
  assert.deepEqual(methods(plan.calls), [
    "R:storage_deposit",
    "W:storage_deposit", "W:storage_deposit", "W:near_deposit", "W:ft_transfer_call",
    "U:storage_deposit", "U:ft_transfer_call",
    "R:add_liquidity",
  ]);
  assert.equal(plan.transactions.length, 4);
  assert.deepEqual(plan.transactions.map((t) => t.receiverId), [REF, "wrap.near", USDC, REF]);
  const [refReg, userOnWrap, refOnWrap, wrap, depW, refOnUsdc, depU, inject] = plan.calls;
  assert.deepEqual(refReg.args, { account_id: "alice.near", registration_only: false });
  assert.equal(refReg.deposit, NEAR / 10n);
  assert.deepEqual(userOnWrap.args, { account_id: "alice.near", registration_only: true });
  assert.deepEqual(refOnWrap.args, { account_id: REF, registration_only: true });
  assert.equal(wrap.deposit, 10n * NEAR);
  assert.deepEqual(depW.args, { receiver_id: REF, amount: (10n * NEAR).toString(), msg: "" });
  assert.equal(depW.gas, 50n * 10n ** 12n);
  assert.equal(depW.deposit, 1n);
  assert.deepEqual(refOnUsdc.args, { account_id: REF, registration_only: true });
  assert.equal(depU.args.amount, "50000000");
  assert.equal(inject.gas, 100n * 10n ** 12n);
  assert.equal(inject.deposit, 10n ** 22n); // 0.01 NEAR LP storage for a first-time LP
  assert.deepEqual(inject.args, { pool_id: 42, amounts: [(10n * NEAR).toString(), "50000000"], min_amounts: [(995n * NEAR / 100n).toString(), "49750000"] });
  assert.equal(plan.wrapAmount, 10n * NEAR);
  assert.deepEqual(plan.steps, ["storage", "wrap", "deposit", "inject"]);
});
test("wallet wNEAR partially covers → wrap only the shortfall; no user registration needed", () => {
  const snap = snapshot({}, { "wrap.near": token("wrap.near", 24, { walletBalance: 4n * NEAR, registeredOnRefAccount: true }), [USDC]: token(USDC, 6, { walletBalance: 100_000_000n, registeredOnRefAccount: true }) });
  const plan = planInjection(snap, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 5n });
  assert.deepEqual(methods(plan.calls), ["W:near_deposit", "W:ft_transfer_call", "U:ft_transfer_call", "R:add_liquidity"]);
  assert.equal(plan.wrapAmount, 6n * NEAR);
  assert.equal(plan.calls.at(-1)!.deposit, 1n); // existing LP → 1 yocto
});
test("Ref deposits cover everything → a single add_liquidity tx", () => {
  const snap = snapshot({}, { "wrap.near": token("wrap.near", 24, { refDeposit: 20n * NEAR, registeredOnRefAccount: true }), [USDC]: token(USDC, 6, { refDeposit: 60_000_000n, registeredOnRefAccount: true }) });
  const plan = planInjection(snap, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 1n });
  assert.deepEqual(methods(plan.calls), ["R:add_liquidity"]);
  assert.deepEqual(plan.steps, ["inject"]);
  assert.deepEqual(plan.refDepositsUsed, amounts);
});
test("partial Ref deposit only tops up the difference", () => {
  const snap = snapshot({}, { "wrap.near": token("wrap.near", 24, { walletBalance: 50n * NEAR, refDeposit: 3n * NEAR, registeredOnRefAccount: true }), [USDC]: token(USDC, 6, { walletBalance: 100_000_000n, refDeposit: 50_000_000n, registeredOnRefAccount: true }) });
  const plan = planInjection(snap, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 1n });
  assert.deepEqual(methods(plan.calls), ["W:ft_transfer_call", "R:add_liquidity"]);
  assert.equal(plan.calls[0].args.amount, (7n * NEAR).toString());
});
test("non-whitelisted token → register_tokens; low Ref storage → top-up first", () => {
  const snap = snapshot({ refStorage: { total: NEAR / 100n, available: 0n } }, { [USDC]: token(USDC, 6, { walletBalance: 100_000_000n, whitelisted: false }), "wrap.near": token("wrap.near", 24, { walletBalance: 50n * NEAR, registeredOnRefAccount: true }) });
  const plan = planInjection(snap, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 1n });
  assert.deepEqual(methods(plan.calls).slice(0, 2), ["R:storage_deposit", "R:register_tokens"]);
  assert.deepEqual(plan.calls[1].args, { token_ids: [USDC] });
  assert.equal(plan.calls[1].deposit, 1n);
  assert.equal(plan.calls[0].deposit, 10n ** 22n); // 0.01 NEAR top-up (≥ 1 × 0.0025 needed)
});
test("errors: insufficient NEAR, insufficient token, stable pool, zero amount", () => {
  const poor = snapshot({ native: { total: NEAR, storageReserved: 0n, available: NEAR } });
  assert.throws(() => planInjection(poor, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 0n }), (e: unknown) => e instanceof PlanError && e.code === "insufficient-near");
  const noUsdc = snapshot({}, { [USDC]: token(USDC, 6, { walletBalance: 1n }) });
  assert.throws(() => planInjection(noUsdc, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 0n }), (e: unknown) => e instanceof PlanError && e.code === "insufficient-token");
  const noNative = snapshot();
  assert.throws(() => planInjection(noNative, { pool, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: false, existingShares: 0n }), (e: unknown) => e instanceof PlanError && e.code === "insufficient-token");
  assert.throws(() => planInjection(snapshot(), { pool: { ...pool, kind: "STABLE_SWAP" }, amounts, slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 0n }), (e: unknown) => e instanceof PlanError && e.code === "unsupported-pool");
  assert.throws(() => planInjection(snapshot(), { pool, amounts: [0n, 1n], slippageBps: 50, useRefDeposits: true, payWithNative: true, existingShares: 0n }), (e: unknown) => e instanceof PlanError && e.code === "zero-amount");
});
test("empty pool: min_amounts equal amounts (initial price)", () => {
  const emptyPool = { ...pool, reserves: [0n, 0n], sharesTotalSupply: 0n };
  const snap = snapshot({}, { "wrap.near": token("wrap.near", 24, { walletBalance: 50n * NEAR }) });
  const plan = planInjection(snap, { pool: emptyPool, amounts: [3n * NEAR, 7_000_000n], slippageBps: 100, useRefDeposits: true, payWithNative: true, existingShares: 0n });
  assert.deepEqual(plan.calls.at(-1)!.args.min_amounts, [(3n * NEAR).toString(), "7000000"]);
});
test("swap plan: register output, wrap, instant-swap msg", () => {
  const snap = snapshot({}, { [USDC]: token(USDC, 6, { userStorage: null }) });
  const plan = planSwap(snap, { pool, tokenIn: "wrap.near", tokenOut: USDC, amountIn: 2n * NEAR, slippageBps: 50, payWithNative: true });
  assert.deepEqual(methods(plan.calls), ["U:storage_deposit", "W:near_deposit", "W:ft_transfer_call"]);
  const swap = plan.calls.at(-1)!;
  assert.equal(swap.gas, 180n * 10n ** 12n);
  const msg = JSON.parse(swap.args.msg as string);
  assert.deepEqual(msg, { force: 0, actions: [{ pool_id: 42, token_in: "wrap.near", token_out: USDC, min_amount_out: plan.minAmountOut.toString() }] });
  assert.equal(plan.expectedOut, estimateSwapOut(2n * NEAR, pool.reserves[0], pool.reserves[1], 30));
});
test("grouping splits at 300 TGas and wallet actions serialize", () => {
  const big: PlannedCall = { step: "deposit", receiverId: "x.near", methodName: "m", args: {}, gas: 200n * 10n ** 12n, deposit: 1n, label: "" };
  assert.equal(groupCalls([big, big, { ...big, receiverId: "y.near" }]).length, 3);
  const txs = toWalletTransactions("alice.near", groupCalls([{ ...big, args: { a: 1 } }]));
  const fc = (txs[0].actions[0] as { functionCall: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }).functionCall;
  assert.equal(txs[0].signerId, "alice.near");
  assert.equal(fc.methodName, "m");
  assert.equal(Buffer.from(fc.args).toString(), '{"a":1}');
  assert.equal(fc.gas, 200n * 10n ** 12n);
  assert.equal(fc.deposit, 1n);
});
test("outcome parsing: receipt failure detected, return value decoded", () => {
  const ok = { status: { SuccessValue: Buffer.from('"12345"').toString("base64") }, receipts_outcome: [{ id: "r", outcome: { status: { SuccessValue: "" } } }], transaction_outcome: { id: "h" }, transaction: { hash: "h" } };
  assert.equal(findOutcomeFailure(ok as never), null);
  assert.equal(outcomeReturnValue<string>(ok as never), "12345");
  const refunded = { ...ok, receipts_outcome: [{ id: "r", outcome: { status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: E10: account not registered" } } } } } } }] };
  assert.match(findOutcomeFailure(refunded as never)!, /E10/);
  assert.match(explainNearError(new Error("Smart contract panicked: E68: slippage error")).message, /slippage/);
  assert.ok(explainNearError(new Error("User rejected the request")).rejected);
});
test("paste parser: addresses, pool ids and links", () => {
  assert.deepEqual(parseTokenInput("  Token.V2.Ref-Finance.near "), { kind: "token", tokenId: "token.v2.ref-finance.near" });
  assert.deepEqual(parseTokenInput(USDC), { kind: "token", tokenId: USDC });
  assert.deepEqual(parseTokenInput("#79"), { kind: "pool", poolId: 79 });
  assert.deepEqual(parseTokenInput("79"), { kind: "pool", poolId: 79 });
  assert.deepEqual(parseTokenInput("https://nearblocks.io/token/usdt.tether-token.near"), { kind: "token", tokenId: "usdt.tether-token.near" });
  assert.deepEqual(parseTokenInput("https://nearblocks.io/address/blackdragon.tkn.near?tab=tokens"), { kind: "token", tokenId: "blackdragon.tkn.near" });
  assert.deepEqual(parseTokenInput("https://app.ref.finance/pool/1910"), { kind: "pool", poolId: 1910 });
  assert.deepEqual(parseTokenInput("https://app.ref.finance/#near|usdt.tether-token.near"), { kind: "token", tokenId: "usdt.tether-token.near" });
  assert.deepEqual(parseTokenInput("https://app.ref.finance/?tokenIn=near&tokenOut=usdt.tether-token.near"), { kind: "token", tokenId: "usdt.tether-token.near" });
  assert.deepEqual(parseTokenInput("not a token!"), { kind: "invalid" });
  assert.deepEqual(parseTokenInput(""), { kind: "empty" });
});
console.log(`\n${passed} passed`);
