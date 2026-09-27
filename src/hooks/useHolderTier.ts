import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import { PLATFORM_TOKEN_ADDRESS, REQUIRED_HOLD_AMOUNT, ROBINHOOD_CHAIN_ID, ZERO_ADDRESS } from "../lib/constants";

export interface HolderTier {
  isConnected: boolean;
  isHolder: boolean;
  userBalance: bigint;
  requiredBalance: bigint;
  isLoading: boolean;
}

/** Reads balanceOf(wallet) on $PONSPOOL and compares against the holder threshold. */
export function useHolderTier(): HolderTier {
  const { address, isConnected } = useAccount();

  const { data, isLoading } = useReadContract({
    chainId: ROBINHOOD_CHAIN_ID,
    address: PLATFORM_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? (ZERO_ADDRESS as `0x${string}`)],
    query: { enabled: !!address, refetchInterval: 12_000 },
  });

  const userBalance = data ?? 0n;

  return {
    isConnected,
    isHolder: userBalance >= REQUIRED_HOLD_AMOUNT,
    userBalance,
    requiredBalance: REQUIRED_HOLD_AMOUNT,
    isLoading: !!address && isLoading,
  };
}
