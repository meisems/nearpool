import { useQuery } from "@tanstack/react-query";
import { useNearWallet } from "../context/NearWalletContext";
import { getNativeBalance } from "../lib/near";
import { findDclPools, type DclPool } from "../lib/dcl";
import {
  findPoolsForPair,
  findPoolsForToken,
  findSwapRoutes,
  getPlatformFee,
  getFtMetadata,
  getPool,
  getPoolShares,
  getLockedShares,
  loadAccountSnapshot,
  type AccountSnapshot,
  type FtMetadata,
  type PlatformFee,
  type RefPool,
  type SwapRoute,
} from "../lib/refFinance";

/** Shared query-key roots so a successful transaction can refresh everything at once. */
export const REF_QUERY_ROOT = "ref";

export function usePool(poolId: number | null) {
  return useQuery<RefPool>({
    queryKey: [REF_QUERY_ROOT, "pool", poolId],
    queryFn: () => getPool(poolId as number),
    enabled: poolId !== null && Number.isInteger(poolId) && poolId >= 0,
    refetchInterval: 10_000,
    retry: 1,
  });
}

export function useFtMetadata(tokenId: string | null | undefined) {
  return useQuery<FtMetadata>({
    queryKey: [REF_QUERY_ROOT, "ft-metadata", tokenId],
    queryFn: () => getFtMetadata(tokenId as string),
    enabled: !!tokenId,
    staleTime: Infinity,
    retry: 1,
  });
}

/** Deepest Ref simple pools for a token pair (resolved on-chain). */
export function usePairPools(tokenA: string | null, tokenB: string | null) {
  return useQuery<RefPool[]>({
    queryKey: [REF_QUERY_ROOT, "pair-pools", tokenA, tokenB],
    queryFn: () => findPoolsForPair(tokenA as string, tokenB as string),
    enabled: !!tokenA && !!tokenB && tokenA !== tokenB,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Every Ref simple pool holding a token, NEAR pairs first (resolved on-chain). */
export function useTokenPools(tokenId: string | null) {
  return useQuery<RefPool[]>({
    queryKey: [REF_QUERY_ROOT, "token-pools", tokenId],
    queryFn: () => findPoolsForToken(tokenId as string),
    enabled: !!tokenId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Balances, storage registrations and Ref deposits for the connected account. */
export function useAccountSnapshot(tokenIds: string[]) {
  const { accountId } = useNearWallet();
  const key = [...new Set(tokenIds)].sort();
  return useQuery<AccountSnapshot>({
    queryKey: [REF_QUERY_ROOT, "snapshot", accountId, key],
    queryFn: () => loadAccountSnapshot(accountId as string, key),
    enabled: !!accountId && key.length > 0,
    refetchInterval: 12_000,
    retry: 1,
  });
}

export function usePoolShares(poolId: number | null) {
  const { accountId } = useNearWallet();
  return useQuery<bigint>({
    queryKey: [REF_QUERY_ROOT, "shares", poolId, accountId],
    queryFn: () => getPoolShares(poolId as number, accountId as string),
    enabled: !!accountId && poolId !== null,
    refetchInterval: 15_000,
  });
}

export function useNativeBalance() {
  const { accountId } = useNearWallet();
  return useQuery({
    queryKey: [REF_QUERY_ROOT, "native", accountId],
    queryFn: () => getNativeBalance(accountId as string),
    enabled: !!accountId,
    refetchInterval: 12_000,
  });
}

/** Interface fee that will be added to each injection / swap (null when off). */
export function usePlatformFee() {
  return useQuery<PlatformFee | null>({
    queryKey: [REF_QUERY_ROOT, "platform-fee"],
    queryFn: getPlatformFee,
    staleTime: Infinity,
    retry: 1,
  });
}

/** LP shares of a pool locked forever (held by the unowned lock account). */
export function useLockedShares(poolId: number | null) {
  return useQuery<bigint>({
    queryKey: [REF_QUERY_ROOT, "locked-shares", poolId],
    queryFn: () => getLockedShares(poolId as number),
    enabled: poolId !== null,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Rhea DCL pools between two tokens (where launchpad coins such as NearPaid's trade). */
export function useDclPools(a: string | null, b: string | null) {
  return useQuery<DclPool[]>({
    queryKey: [REF_QUERY_ROOT, "dcl-pools", a, b],
    queryFn: () => findDclPools(a as string, b as string),
    enabled: !!a && !!b && a !== b,
    staleTime: 60_000,
    retry: 1,
  });
}

/** Direct and two-hop swap routes between two tokens (resolved on-chain). */
export function useSwapRoutes(tokenIn: string | null, tokenOut: string | null) {
  return useQuery<SwapRoute[]>({
    queryKey: [REF_QUERY_ROOT, "swap-routes", tokenIn, tokenOut],
    queryFn: () => findSwapRoutes(tokenIn as string, tokenOut as string),
    enabled: !!tokenIn && !!tokenOut && tokenIn !== tokenOut,
    staleTime: 60_000,
    retry: 1,
  });
}
