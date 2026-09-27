/**
 * Integer-exact liquidity math for Ref Finance simple pools.
 *
 * Everything operates on `bigint` raw units (yoctoNEAR / 10^-decimals of a
 * NEP-141 token). Division always truncates toward zero exactly like the
 * Rust `u128`/`U256` arithmetic in Ref's contract, so previews match what
 * the chain will do rather than drifting through floating point.
 */

/** Ref Finance's fee denominator: `total_fee` is expressed in basis points. */
export const FEE_DIVISOR = 10_000n;
export const BPS_DIVISOR = 10_000n;

/** Shares minted by Ref for the very first deposit into an empty simple pool. */
export const INIT_SHARES_SUPPLY = 10n ** 24n;

/** Ref simple-pool LP shares use 24 decimals. */
export const LP_SHARE_DECIMALS = 24;

export function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("mulDiv: division by zero");
  return (a * b) / denominator;
}

export function mulDivCeil(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("mulDivCeil: division by zero");
  const product = a * b;
  return product === 0n ? 0n : (product - 1n) / denominator + 1n;
}

export const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);

/**
 * Proportional counter-asset amount at the pool's current ratio:
 *
 *   ΔTokenB = ΔTokenA × ReserveB / ReserveA
 *
 * Rounded up by at most one raw unit so the side the user typed stays the
 * binding side in Ref's share calculation (Ref then deposits the exact
 * proportional amount and leaves any dust in the user's Ref balance).
 */
export function quoteCounterAmount(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint {
  if (amountA <= 0n || reserveA <= 0n || reserveB <= 0n) return 0n;
  return mulDivCeil(amountA, reserveB, reserveA);
}

/** Reduce an amount by a slippage tolerance in basis points (floor). */
export function applySlippage(amount: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new RangeError(`invalid slippage: ${slippageBps} bps`);
  }
  return mulDiv(amount, BPS_DIVISOR - BigInt(slippageBps), BPS_DIVISOR);
}

export interface AddLiquidityEstimate {
  /** LP shares Ref will mint. */
  shares: bigint;
  /** Amounts Ref will actually pull from the user's Ref deposits, in pool token order. */
  usedAmounts: bigint[];
  /** Post-deposit ownership of the pool, in basis points of total supply. */
  poolShareBps: number;
  /** True when the pool is empty and this deposit sets the initial price. */
  initializesPool: boolean;
}

/**
 * Mirror of Ref's `SimplePool::add_liquidity`:
 *
 *   fair_supply = min_i(amount_i × total_shares / reserve_i)
 *   used_i      = reserve_i × fair_supply / total_shares
 *
 * For an empty pool every amount is used as-is and INIT_SHARES_SUPPLY is
 * minted.
 */
export function estimateAddLiquidity(amounts: bigint[], reserves: bigint[], totalShares: bigint): AddLiquidityEstimate {
  if (amounts.length !== reserves.length) throw new RangeError("amounts/reserves length mismatch");
  if (amounts.some((a) => a <= 0n)) {
    return { shares: 0n, usedAmounts: amounts.map(() => 0n), poolShareBps: 0, initializesPool: totalShares === 0n };
  }
  if (totalShares === 0n) {
    return { shares: INIT_SHARES_SUPPLY, usedAmounts: [...amounts], poolShareBps: 10_000, initializesPool: true };
  }
  if (reserves.some((r) => r <= 0n)) {
    return { shares: 0n, usedAmounts: amounts.map(() => 0n), poolShareBps: 0, initializesPool: false };
  }
  let fair: bigint | null = null;
  for (let i = 0; i < amounts.length; i++) {
    const candidate = mulDiv(amounts[i], totalShares, reserves[i]);
    fair = fair === null ? candidate : minBig(fair, candidate);
  }
  const shares = fair ?? 0n;
  const usedAmounts = reserves.map((reserve) => mulDiv(reserve, shares, totalShares));
  if (usedAmounts.some((a) => a === 0n)) {
    return { shares: 0n, usedAmounts: amounts.map(() => 0n), poolShareBps: 0, initializesPool: false };
  }
  const poolShareBps = Number(mulDiv(shares, BPS_DIVISOR, totalShares + shares));
  return { shares, usedAmounts, poolShareBps, initializesPool: false };
}

/** `min_amounts` for `add_liquidity`: the expected used amounts minus slippage. */
export function minAmountsFor(usedAmounts: bigint[], slippageBps: number): bigint[] {
  return usedAmounts.map((amount) => applySlippage(amount, slippageBps));
}

/**
 * Mirror of Ref's simple-pool constant-product swap with `total_fee` bps:
 *
 *   in_with_fee = amount_in × (FEE_DIVISOR − fee)
 *   out         = in_with_fee × reserve_out / (FEE_DIVISOR × reserve_in + in_with_fee)
 */
export function estimateSwapOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, totalFeeBps: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inWithFee = amountIn * (FEE_DIVISOR - BigInt(totalFeeBps));
  return (inWithFee * reserveOut) / (FEE_DIVISOR * reserveIn + inWithFee);
}

/** Price impact of a swap in basis points, relative to the pre-trade spot price. */
export function swapPriceImpactBps(amountIn: bigint, amountOut: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn <= 0n || amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0;
  // Spot output without impact or fee: amountIn × reserveOut / reserveIn.
  const spotOut = mulDiv(amountIn, reserveOut, reserveIn);
  if (spotOut <= amountOut) return 0;
  return Number(mulDiv(spotOut - amountOut, BPS_DIVISOR, spotOut));
}

export interface FundingSplit {
  /** Taken from the user's existing Ref internal deposit. */
  fromRef: bigint;
  /** Must be transferred from the wallet into Ref (`ft_transfer_call`). */
  toDeposit: bigint;
}

/** Split a required amount between existing Ref deposits and a fresh wallet deposit. */
export function splitFunding(required: bigint, refDeposit: bigint, useRefDeposit: boolean): FundingSplit {
  const fromRef = useRefDeposit ? minBig(maxBig(refDeposit, 0n), required) : 0n;
  return { fromRef, toDeposit: required - fromRef };
}

/**
 * Spot price of token B denominated in token A as a float, for display
 * only (never fed back into transaction amounts).
 */
export function spotPrice(reserveA: bigint, decimalsA: number, reserveB: bigint, decimalsB: number): number {
  if (reserveA <= 0n || reserveB <= 0n) return 0;
  // Scale to 18 decimals of precision before converting to a float.
  const scaled = mulDiv(reserveA * 10n ** BigInt(decimalsB), 10n ** 18n, reserveB * 10n ** BigInt(decimalsA));
  return Number(scaled) / 1e18;
}
