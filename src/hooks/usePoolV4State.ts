import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { poolManagerAbi } from "../lib/abi";
import { V4_POOL_MANAGER } from "../lib/constants";
import { TICK_SPACING } from "../lib/config";
import {
  buildNativePoolKey,
  computePoolId,
  liquiditySlot,
  parseLiquidity,
  parseSlot0,
  slot0Slot,
  virtualReserves,
  ZERO_BYTES32,
} from "../lib/v4pool";

export interface PoolV4State {
  enabled: boolean;
  isLoading: boolean;
  /** True once the pool has been initialized on-chain (sqrtPriceX96 != 0). */
  exists: boolean;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  /** Virtual ETH reserve at the current tick (currency0 side — native ETH). */
  reserveBase: bigint;
  /** Virtual creator-token reserve at the current tick (currency1 side). */
  reserveQuote: bigint;
  poolId?: `0x${string}`;
}

/**
 * Reads a Uniswap V4 pool's live state (existence, price, liquidity) for the
 * native-ETH ↔ token pool ponspool's router actually targets, via
 * PoolManager.extsload — the only way to read V4 state off-chain since V4
 * has no per-pair contract to call getReserves() on.
 */
export function usePoolV4State(token: `0x${string}` | undefined, feeTier: number): PoolV4State {
  const enabled = !!token;

  const key = useMemo(
    () => (token ? buildNativePoolKey(token, feeTier, TICK_SPACING[feeTier] ?? 60) : undefined),
    [token, feeTier],
  );
  const poolId = useMemo(() => (key ? computePoolId(key) : undefined), [key]);
  const slot0 = useMemo(() => (poolId ? slot0Slot(poolId) : undefined), [poolId]);
  const liqSlot = useMemo(() => (poolId ? liquiditySlot(poolId) : undefined), [poolId]);

  const slot0Read = useReadContract({
    address: V4_POOL_MANAGER,
    abi: poolManagerAbi,
    functionName: "extsload",
    args: [slot0 ?? ZERO_BYTES32],
    query: { enabled: enabled && !!slot0, refetchInterval: 10_000 },
  });
  const liquidityRead = useReadContract({
    address: V4_POOL_MANAGER,
    abi: poolManagerAbi,
    functionName: "extsload",
    args: [liqSlot ?? ZERO_BYTES32],
    query: { enabled: enabled && !!liqSlot, refetchInterval: 10_000 },
  });

  const parsed = parseSlot0(slot0Read.data as `0x${string}` | undefined);
  const liquidity = parseLiquidity(liquidityRead.data as `0x${string}` | undefined);
  const { reserve0, reserve1 } = virtualReserves(parsed.sqrtPriceX96, liquidity);

  return {
    enabled,
    isLoading: enabled && (slot0Read.isLoading || liquidityRead.isLoading),
    exists: parsed.sqrtPriceX96 > 0n,
    sqrtPriceX96: parsed.sqrtPriceX96,
    tick: parsed.tick,
    liquidity,
    reserveBase: reserve0,
    reserveQuote: reserve1,
    poolId,
  };
}
