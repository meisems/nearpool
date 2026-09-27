import { useAccount, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi } from "viem";
import { factoryAbi } from "../lib/abi";
import { DEX_FACTORY_ADDRESS, ROBINHOOD_CHAIN_ID, ZERO_ADDRESS } from "../lib/constants";
import { liveClient } from "../lib/liveClient";
import { UNCURATED_ASSET_NAME } from "../lib/tokenRegistry";

export interface TokenMetaResult {
  enabled: boolean;
  isLoading: boolean;
  symbol?: string;
  name?: string;
  decimals?: number;
  /** Logo URI published by the token contract, usually an ipfs:// URI from PonsFamily. */
  logo?: string;
  /** Creator's wallet balance of this token. */
  balance?: bigint;
  /** Pair address from factory.getPair(token, base). Undefined when uninitialized. */
  pairAddress?: `0x${string}`;
  /**
   * True when symbol/name/decimals came from a live read against the real
   * Robinhood Chain RPC rather than the generic "Uncurated Asset" fallback.
   * A raw contract read, not a verification signal — surface it as such.
   */
  liveRead?: boolean;
}

interface LiveMeta {
  name?: string;
  symbol?: string;
  decimals?: number;
}

const tokenLogoAbi = [
  {
    type: "function",
    name: "logo",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

async function readLiveMeta(token: `0x${string}`): Promise<LiveMeta | null> {
  const [nameR, symbolR, decimalsR] = await Promise.allSettled([
    liveClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    liveClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    liveClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  const name = nameR.status === "fulfilled" ? nameR.value : undefined;
  const symbol = symbolR.status === "fulfilled" ? symbolR.value : undefined;
  const decimals = decimalsR.status === "fulfilled" ? decimalsR.value : undefined;
  // Nothing resolvable on-chain (no contract there, or it doesn't implement
  // the standard getters) — let the generic placeholder stand.
  if (!name && !symbol) return null;
  return { name, symbol, decimals };
}

/** Resolves symbol / name / decimals / creator balance, and the pair against a base token. */
export function useTokenMeta(
  token: `0x${string}` | undefined,
  base: `0x${string}` | undefined,
): TokenMetaResult {
  const { address } = useAccount();
  const enabled = !!token;

  const symbol = useReadContract({ chainId: ROBINHOOD_CHAIN_ID, address: token, abi: erc20Abi, functionName: "symbol", query: { enabled } });
  const name = useReadContract({ chainId: ROBINHOOD_CHAIN_ID, address: token, abi: erc20Abi, functionName: "name", query: { enabled } });
  const decimals = useReadContract({ chainId: ROBINHOOD_CHAIN_ID, address: token, abi: erc20Abi, functionName: "decimals", query: { enabled } });
  const logo = useReadContract({ chainId: ROBINHOOD_CHAIN_ID, address: token, abi: tokenLogoAbi, functionName: "logo", query: { enabled } });
  const balance = useReadContract({
    chainId: ROBINHOOD_CHAIN_ID,
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? (ZERO_ADDRESS as `0x${string}`)],
    query: { enabled: enabled && !!address, refetchInterval: 8_000 },
  });
  const pair = useReadContract({
    chainId: ROBINHOOD_CHAIN_ID,
    address: DEX_FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getPair",
    args: [token ?? (ZERO_ADDRESS as `0x${string}`), base ?? (ZERO_ADDRESS as `0x${string}`)],
    query: { enabled: enabled && !!base },
  });

  const rawPair = pair.data as `0x${string}` | undefined;
  const readName = name.data as string | undefined;

  // A direct on-chain read can come back empty, or resolve to the generic
  // "Uncurated Asset" placeholder for a contract that doesn't implement the
  // standard getters. Fall back to a second read against Robinhood Chain
  // mainnet so a genuinely deployed token still resolves by whatever
  // name/symbol/decimals it actually reports, the same way a block explorer
  // or a DEX front end would show it. This is a raw contract read, not
  // curation or verification of the token.
  const needsLiveRead = enabled && !name.isLoading && (
    readName === UNCURATED_ASSET_NAME ||
    !readName ||
    !symbol.data ||
    decimals.data === undefined
  );

  const live = useQuery({
    queryKey: ["live-token-meta", token],
    queryFn: () => readLiveMeta(token as `0x${string}`),
    enabled: needsLiveRead,
    staleTime: 60_000,
    retry: 1,
  });

  const usedLive = needsLiveRead && !!live.data;

  return {
    enabled,
    isLoading:
      enabled &&
      (symbol.isLoading || decimals.isLoading || pair.isLoading || balance.isLoading || (needsLiveRead && live.isLoading)),
    symbol: usedLive ? (live.data!.symbol ?? (symbol.data as string | undefined)) : (symbol.data as string | undefined),
    name: usedLive ? (live.data!.name ?? readName) : readName,
    decimals: usedLive && live.data!.decimals !== undefined ? live.data!.decimals : (decimals.data as number | undefined),
    logo: logo.data as string | undefined,
    balance: balance.data as bigint | undefined,
    pairAddress: rawPair && rawPair !== ZERO_ADDRESS ? rawPair : undefined,
    liveRead: usedLive,
  };
}
