import { DCL_CONTRACT_ID, DCL_FEE_TIERS } from "../config/near";
import { viewMethod } from "./near";

/**
 * Rhea (Ref) concentrated-liquidity pools, `dclv2.ref-labs.near`. Launchpads
 * such as NearPaid put a coin's whole supply here, so it can be bought only
 * through these pools. Pool ids are `tokenA|tokenB|fee` with the two tokens
 * sorted (Ref SDK `getDCLPoolId`).
 */

export interface DclPool {
  id: string;
  /** Fee in hundredths of a basis point (10000 = 1%). */
  fee: number;
}

export const dclPoolId = (a: string, b: string, fee: number) => `${[a, b].sort().join("|")}|${fee}`;

/** Every DCL pool between two tokens, one lookup per fee tier. */
export async function findDclPools(a: string, b: string): Promise<DclPool[]> {
  const found = await Promise.all(
    DCL_FEE_TIERS.map(async (fee): Promise<DclPool | null> => {
      const id = dclPoolId(a, b, fee);
      try {
        const pool = await viewMethod<{ state?: string } | null>(DCL_CONTRACT_ID, "get_pool", { pool_id: id });
        return pool && (pool.state === undefined || pool.state === "Running") ? { id, fee } : null;
      } catch {
        return null; // missing pool: some versions panic instead of returning null
      }
    }),
  );
  return found.filter((p): p is DclPool => p !== null);
}

/** Exact output of swapping `amountIn` through `poolId` (0 when it can't fill). */
export async function dclQuote(poolId: string, tokenIn: string, tokenOut: string, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  try {
    const result = await viewMethod<{ amount: string } | null>(DCL_CONTRACT_ID, "quote", {
      pool_ids: [poolId],
      input_token: tokenIn,
      output_token: tokenOut,
      input_amount: amountIn.toString(),
      tag: null,
    });
    return result && /^\d+$/.test(result.amount) ? BigInt(result.amount) : 0n;
  } catch {
    return 0n;
  }
}

/** The DCL pool giving the most `tokenOut` for `amountIn`, or null. */
export async function bestDclQuote(
  pools: DclPool[],
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<{ pool: DclPool; out: bigint } | null> {
  const quotes = await Promise.all(pools.map(async (pool) => ({ pool, out: await dclQuote(pool.id, tokenIn, tokenOut, amountIn) })));
  return quotes.reduce<{ pool: DclPool; out: bigint } | null>((best, q) => (q.out > 0n && (!best || q.out > best.out) ? q : best), null);
}

/**
 * `ft_transfer_call` of `tokenIn` into the DCL contract with a `Swap`
 * message; the output is sent straight back to the wallet, which must be
 * registered on `tokenOut`.
 */
export function dclSwapArgs(poolId: string, tokenOut: string, amountIn: bigint, minOut: bigint) {
  return {
    receiver_id: DCL_CONTRACT_ID,
    amount: amountIn.toString(),
    msg: JSON.stringify({ Swap: { pool_ids: [poolId], output_token: tokenOut, min_output_amount: minOut.toString() } }),
  };
}
