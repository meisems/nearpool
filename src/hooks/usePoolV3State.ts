import { useReadContract } from "wagmi";
import { LEGACY_V3, v3FactoryAbi, v3PoolAbi, WETH_ADDRESS, ZERO_ADDRESS } from "../config/contracts";
import { ROBINHOOD_CHAIN_ID } from "../lib/constants";

export const V3_FEE_TIERS = [500, 3000, 10000] as const;

type Slot0 = readonly [bigint, number, number, number, number, number, boolean];

export interface PoolV3State {
  enabled: boolean;
  isLoading: boolean;
  exists: boolean;
  feeTier?: number;
  poolAddress?: `0x${string}`;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

/**
 * A V3 pool is usable for minting only when it is initialized and has
 * non-zero liquidity. A factory address alone is not enough: Robinhood Chain
 * can contain an empty pool shell at a lower fee tier while a usable pool for
 * the same token exists at another tier.
 */
export function usePoolV3State(token: `0x${string}` | undefined): PoolV3State {
  const enabled = !!token;
  const poolReads = V3_FEE_TIERS.map((fee) => useReadContract({
    chainId: ROBINHOOD_CHAIN_ID,
    address: LEGACY_V3.factory,
    abi: v3FactoryAbi,
    functionName: "getPool",
    args: [WETH_ADDRESS as `0x${string}`, token ?? (ZERO_ADDRESS as `0x${string}`), fee],
    query: { enabled },
  }));

  // These hooks are created for all fixed fee tiers, not conditionally, so
  // React's hook ordering remains stable while factory results arrive.
  const slotReads = V3_FEE_TIERS.map((_, index) => useReadContract({
    chainId: ROBINHOOD_CHAIN_ID,
    address: poolReads[index].data as `0x${string}` | undefined,
    abi: v3PoolAbi,
    functionName: "slot0",
    query: { enabled: enabled && !!poolReads[index].data && (poolReads[index].data as string).toLowerCase() !== ZERO_ADDRESS.toLowerCase() },
  }));
  const liquidityReads = V3_FEE_TIERS.map((_, index) => useReadContract({
    chainId: ROBINHOOD_CHAIN_ID,
    address: poolReads[index].data as `0x${string}` | undefined,
    abi: v3PoolAbi,
    functionName: "liquidity",
    query: { enabled: enabled && !!poolReads[index].data && (poolReads[index].data as string).toLowerCase() !== ZERO_ADDRESS.toLowerCase() },
  }));

  const match = V3_FEE_TIERS.map((fee, index) => ({
    fee,
    address: poolReads[index].data as `0x${string}` | undefined,
    slot: slotReads[index].data as Slot0 | undefined,
    liquidity: liquidityReads[index].data as bigint | undefined,
  })).find(({ address, slot, liquidity }) =>
    !!address &&
    address.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
    !!slot &&
    slot[0] > 0n &&
    (liquidity ?? 0n) > 0n,
  );

  const isLoading = enabled && (
    poolReads.some((read) => read.isLoading) ||
    slotReads.some((read) => read.isLoading) ||
    liquidityReads.some((read) => read.isLoading)
  );

  return {
    enabled,
    isLoading,
    exists: !!match,
    feeTier: match?.fee,
    poolAddress: match?.address,
    sqrtPriceX96: match?.slot?.[0] ?? 0n,
    tick: match?.slot?.[1] ?? 0,
    liquidity: match?.liquidity ?? 0n,
  };
}
