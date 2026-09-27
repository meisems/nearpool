/**
 * Pure zap mathematics — the single source of truth for single-sided
 * liquidity splits, using the standard Uniswap V3/V4 liquidity formulas.
 */

/* ------------------------------------------------------ integer core */

/** Babylonian integer square root (BigInt). */
export function isqrt(x: bigint): bigint {
  if (x < 2n) return x;
  let y = x;
  let z = (x + 1n) / 2n;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}

/**
 * Uniswap V2 exact zap — zero-dust split of `totalEthToInject`:
 *
 *   a = ( sqrt(R·(R·3988009 + A·3988000)) − 1997·R ) / 1994
 *
 * `a` = ETH leg swapped for project tokens; (A − a) pairs with the proceeds.
 */
export function calculateV2ZapSwapAmount(reserveIn: bigint, totalEthToInject: bigint): bigint {
  if (reserveIn <= 0n || totalEthToInject <= 0n) return 0n;
  const inner = reserveIn * (reserveIn * 3_988_009n + totalEthToInject * 3_988_000n);
  let a = (isqrt(inner) - reserveIn * 1997n) / 1994n;
  if (a < 0n) a = 0n;
  if (a > totalEthToInject) a = totalEthToInject;
  return a;
}

/** AMM output for `amountIn` against reserves, with the 0.30% swap fee. */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const inWithFee = amountIn * 997n;
  return (inWithFee * reserveOut) / (reserveIn * 1000n + inWithFee);
}

/** Price impact of swapping `swapIn` into `reserveIn`, as a percentage. */
export function priceImpactPct(reserveIn: bigint, swapIn: bigint): number {
  if (reserveIn <= 0n || swapIn <= 0n) return 0;
  return Number((swapIn * 10_000n) / reserveIn) / 100;
}

const Q96 = 2n ** 96n;

function sqrtPriceAtTickX96(tick: number): bigint {
  const value = Math.pow(1.0001, tick / 2) * 2 ** 96;
  return BigInt(Math.max(1, Math.floor(value)));
}

/** Approximate V3/V4 liquidity L for a native-ETH/token position. */
export function liquidityForAmounts(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount0: bigint,
  amount1: bigint,
): bigint {
  if (sqrtPriceX96 <= 0n || amount0 < 0n || amount1 < 0n || tickLower >= tickUpper) return 0n;
  const pa = sqrtPriceAtTickX96(tickLower);
  const pb = sqrtPriceAtTickX96(tickUpper);
  if (sqrtPriceX96 <= pa) {
    const denominator = (pb - pa) * Q96;
    return denominator > 0n ? (amount0 * pa * pb) / denominator : 0n;
  }
  if (sqrtPriceX96 < pb) {
    const l0 = (amount0 * sqrtPriceX96 * pb) / ((pb - sqrtPriceX96) * Q96);
    const l1 = (amount1 * Q96) / (sqrtPriceX96 - pa);
    if (l0 === 0n) return l1;
    if (l1 === 0n) return l0;
    return l0 < l1 ? l0 : l1;
  }
  const denominator = pb - pa;
  return denominator > 0n ? (amount1 * Q96) / denominator : 0n;
}

/* ------------------------------------------------- concentrated math */

/** sqrt(1.0001^tick) as a float — good enough for preview ratios. */
export function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

/** Approximate tick for a price (tokenWei per ethWei). */
export function priceToTick(price: number): number {
  if (price <= 0) return 0;
  return Math.round(Math.log(price) / Math.log(1.0001));
}

/** Round a tick to a valid tick for the given fee tier spacing. */
export function toValidTick(tick: number, spacing: number): number {
  return Math.round(tick / spacing) * spacing;
}

export const TICK_SPACING: Record<number, number> = { 500: 10, 3000: 60, 10000: 200 };

export function fullRangeTicks(spacing: number): { tickLower: number; tickUpper: number } {
  const max = Math.floor(887272 / spacing) * spacing;
  return { tickLower: -max, tickUpper: max };
}

/**
 * V3/V4 concentrated-liquidity amount ratios for a position around the
 * current price, derived from the standard liquidity formulas:
 *
 *   amount0 = L·(√Pb − √P) / (√P·√Pb)     amount1 = L·(√P − √Pa)
 *
 * Returns raw-unit ratios { ethRatio, tokenRatio } normalised so that
 * ethRatio + tokenRatio === 1 (value split of the deposit).
 */
export function calculateV3ZapRatios(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
): { ethRatio: number; tokenRatio: number } {
  // Convert the Q64.96 sqrt price to a float (token-per-eth).
  const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
  const pa = tickToSqrtPrice(Math.min(tickLower, tickUpper));
  const pb = tickToSqrtPrice(Math.max(tickLower, tickUpper));

  let amount0 = 0; // token side (token0 orientation)
  let amount1 = 0; // eth side
  if (sqrtP <= pa) {
    amount0 = 1; // all token, position sits above price
  } else if (sqrtP >= pb) {
    amount1 = 1; // all eth, position sits below price
  } else {
    // Normalise L = 1 for the ratio.
    amount0 = (pb - sqrtP) / (sqrtP * pb);
    amount1 = sqrtP - pa;
  }
  // Weight by price so the split is value-denominated.
  const tokenValue = amount0 * sqrtP * sqrtP;
  const ethValue = amount1;
  const total = tokenValue + ethValue;
  if (total <= 0) return { ethRatio: 0.5, tokenRatio: 0.5 };
  return { ethRatio: ethValue / total, tokenRatio: tokenValue / total };
}

/**
 * Solve the concentrated zap split: how much of `totalEth` should swap for
 * tokens so the bought tokens pair exactly with the remaining ETH at the
 * range's required ratio. Bisection — deterministic and dust-free enough.
 */
export function solveConcentratedZapSwap(
  reserveEth: bigint,
  reserveToken: bigint,
  totalEth: bigint,
  tokenPerEth: number,
): bigint {
  if (totalEth <= 0n || reserveEth <= 0n || tokenPerEth <= 0) return 0n;
  let lo = 0n;
  let hi = totalEth;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2n;
    const out = Number(getAmountOut(mid, reserveEth, reserveToken));
    const paired = Number(totalEth - mid) * tokenPerEth;
    if (out < paired) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2n;
}

/** tokenWei per ethWei implied by reserves (float, for preview ratios). */
export function tokenPerEth(reserveEth: bigint, reserveToken: bigint): number {
  if (reserveEth <= 0n) return 0;
  return Number(reserveToken) / Number(reserveEth);
}
