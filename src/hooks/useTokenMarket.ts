import { NEAR_DECIMALS } from "../config/near";
import { counterToken, displaySymbol, type RefPool } from "../lib/refFinance";
import { LP_SHARE_DECIMALS, mulDiv, spotPrice } from "../utils/zapMath";
import { useFtMetadata, usePool, usePoolShares } from "./useRefData";

export interface TokenMarket {
  pool: RefPool | undefined;
  loading: boolean;
  error: boolean;
  tokenId: string;
  counterId: string | null;
  symbol: string;
  counterSymbol: string;
  decimals: number;
  counterDecimals: number;
  /** Token reserve and counter reserve in this pool. */
  tokenReserve: bigint;
  counterReserve: bigint;
  /** 1 token in counter-token units (display only). */
  price: number;
  /** Connected account's LP shares, and what they redeem for right now. */
  shares: bigint;
  shareBps: number;
  positionToken: bigint;
  positionCounter: bigint;
  lpDecimals: number;
}

/** Live price, depth and the user's position for `tokenId` in `poolId`. */
export function useTokenMarket(tokenId: string, poolId: number | null): TokenMarket {
  const pool = usePool(poolId);
  const counterId = pool.data ? counterToken(pool.data, tokenId) : null;
  const meta = useFtMetadata(tokenId);
  const counterMeta = useFtMetadata(counterId);
  const sharesQ = usePoolShares(poolId);

  const decimals = meta.data?.decimals ?? NEAR_DECIMALS;
  const counterDecimals = counterMeta.data?.decimals ?? NEAR_DECIMALS;
  const idx = pool.data ? pool.data.tokenIds.indexOf(tokenId) : -1;
  const tokenReserve = pool.data && idx >= 0 ? pool.data.reserves[idx] : 0n;
  const counterReserve = pool.data && idx >= 0 ? pool.data.reserves[1 - idx] : 0n;
  const total = pool.data?.sharesTotalSupply ?? 0n;
  const shares = sharesQ.data ?? 0n;
  const metaReady = !!meta.data && (!counterId || !!counterMeta.data);

  return {
    pool: pool.data,
    loading: pool.isLoading || (!!pool.data && !metaReady && !meta.isError && !counterMeta.isError),
    error: pool.isError,
    tokenId,
    counterId,
    symbol: displaySymbol(tokenId, meta.data),
    counterSymbol: counterId ? displaySymbol(counterId, counterMeta.data) : "",
    decimals,
    counterDecimals,
    tokenReserve,
    counterReserve,
    price: metaReady ? spotPrice(counterReserve, counterDecimals, tokenReserve, decimals) : 0,
    shares,
    shareBps: total > 0n ? Number(mulDiv(shares, 10_000n, total)) : 0,
    positionToken: total > 0n ? mulDiv(tokenReserve, shares, total) : 0n,
    positionCounter: total > 0n ? mulDiv(counterReserve, shares, total) : 0n,
    lpDecimals: LP_SHARE_DECIMALS,
  };
}
