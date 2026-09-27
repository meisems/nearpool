import { useQuery } from "@tanstack/react-query";
import { useNearWallet } from "../context/NearWalletContext";
import { getNativeBalance } from "../lib/near";
import {
  findPoolsForPair,
  findPoolsForToken,
  getPlatformFee,
  getFtMetadata,
  getPool,
  getPoolShares,
  loadAccountSnapshot,
  type AccountSnapshot,
  type FtMetadata,
  type PlatformFee,
  type RefPool,
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
