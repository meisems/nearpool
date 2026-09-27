import { useReadContract } from "wagmi";
import { pairAbi } from "../lib/abi";

export interface PairReserves {
  enabled: boolean;
  isLoading: boolean;
  /** Reserve of the base side (WETH or $PONSPOOL). */
  reserveBase: bigint;
  /** Reserve of the opposite side. */
  reserveQuote: bigint;
  lpSupply: bigint;
}

/**
 * Reads getReserves() on the pair and orients the reserves by comparing
 * token0() against the base token. Also pulls LP totalSupply for share math.
 */
export function usePairReserves(
  pair: `0x${string}` | undefined,
  base: `0x${string}` | undefined,
): PairReserves {
  const enabled = !!pair;

  const reserves = useReadContract({
    address: pair,
    abi: pairAbi,
    functionName: "getReserves",
    query: { enabled, refetchInterval: 12_000 },
  });
  const token0 = useReadContract({
    address: pair,
    abi: pairAbi,
    functionName: "token0",
    query: { enabled },
  });
  const supply = useReadContract({
    address: pair,
    abi: pairAbi,
    functionName: "totalSupply",
    query: { enabled },
  });

  const raw = reserves.data as readonly [bigint, bigint, number] | undefined;
  let reserveBase = 0n;
  let reserveQuote = 0n;
  if (raw) {
    const baseIsZero = (token0.data as `0x${string}` | undefined)?.toLowerCase() === base?.toLowerCase();
    reserveBase = baseIsZero ? raw[0] : raw[1];
    reserveQuote = baseIsZero ? raw[1] : raw[0];
  }

  return {
    enabled,
    isLoading: enabled && (reserves.isLoading || token0.isLoading),
    reserveBase,
    reserveQuote,
    lpSupply: (supply.data as bigint | undefined) ?? 0n,
  };
}
