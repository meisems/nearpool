import { useAccount, useSendTransaction, useWriteContract } from "wagmi";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi, keccak256, toHex } from "viem";
import { BURN_ADDRESS, FEE_VAULT, LEGACY_V3, V4_APPROVED_HOOKS, V4_POSITION_MANAGER, WETH_ADDRESS, v3MintAbi, v4ModifyLiquiditiesAbi } from "../config/contracts";
import { encodeModifyLiquiditiesPayload } from "../lib/v4pool";
import { TICK_SPACING } from "../lib/config";
import { config } from "../lib/wagmi";
import { publishConfirmedInjection, publishGlobalInjection } from "../lib/confirmedActivity";
import {
  ROBINHOOD_CHAIN_ID,
  ZERO_ADDRESS,
} from "../lib/constants";

export type ContractVersion = "V3" | "V4";
export type InjectionMode = "dual" | "zap";
export type LiquidityDestination = "burn";
export type InjectionPhase = "idle" | "approving" | "submitting" | "confirming" | "success" | "error";

export interface InjectionReceipt {
  txHash: string;
  version: ContractVersion;
  mode: InjectionMode;
  token: string;
  ethInjected: bigint;
  tokenIn: bigint;
  swapIn?: bigint;
  lpMinted?: bigint;
  positionId?: bigint;
  pair: string;
  feeEth: bigint;
  burnedPons: bigint;
  destination: LiquidityDestination;
}

export interface InjectionParams {
  version: ContractVersion;
  mode: InjectionMode;
  token: `0x${string}`;
  ethWei: bigint;
  /** Native ETH sent to the fee vault for buyback and burn. */
  feeEth: bigint;
  /** Retained for receipt compatibility; always zero in the ETH-only flow. */
  tokenWei: bigint;
  slippageBps: number;
  tickLower: number;
  tickUpper: number;
  feeTier: number;
  decimals: number;
  symbol: string;
  liquidityDelta: bigint;
  /** V4 zap-only values calculated from live pool state. */
  zapSwapEth?: bigint;
  zapMinTokenOut?: bigint;
  zapLiquidityDelta?: bigint;
  initializePool?: boolean;
  pair: `0x${string}`;
  destination: LiquidityDestination;
}

export interface ContractInjection {
  phase: InjectionPhase;
  stepNote: string;
  error: string | null;
  receipt: InjectionReceipt | null;
  allowance: bigint;
  approveToken: (token: `0x${string}`) => Promise<void>;
  run: (p: InjectionParams) => Promise<void>;
  reset: () => void;
}

const slip = (v: bigint, bps: number) => (v * BigInt(10_000 - bps)) / 10_000n;
const maxWithSlippage = (v: bigint, bps: number) => (v * BigInt(10_000 + bps) + 9_999n) / 10_000n;
const wethDepositAbi = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const;
const swapRouterAbi = [{ type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" }, { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ name: "amountOut", type: "uint256" }] }] as const;

function humanizeError(e: unknown): string {
  const obj = e as { message?: string; shortMessage?: string };
  const msg = obj?.shortMessage ?? obj?.message ?? "unknown revert";
  if (/INSUFFICIENT_TOKEN/i.test(msg)) return "not enough tokens in the bag.";
  if (/INSUFFICIENT_ETH/i.test(msg)) return "not enough eth. the pond noticed.";
  if (/INSUFFICIENT_OUTPUT|TOO_LITTLE/i.test(msg)) return "output slipped past the minimum. widen slippage.";
  if (/NO_PAIR|UNINITIALIZED|UNINITIALIZED_PAIR/i.test(msg)) return "this v4 pool is not initialized yet.";
  if (/INVALID_POOL_KEY/i.test(msg)) return "the selected v4 pool key is invalid.";
  if (/INVALID_UNLOCK_DATA/i.test(msg)) return "the v4 position payload was rejected.";
  if (/INVALID_LIQUIDITY/i.test(msg)) return "the liquidity amount or range is invalid.";
  if (/user rejected|rejected the request/i.test(msg)) return "signature rejected. no pressure.";
  const concise = msg
    .replace(/^execution reverted:?\s*/i, "")
    .replace(/^contract function .*? reverted with the following reason:\s*/i, "")
    .trim();
  return concise && concise !== "unknown revert"
    ? `transaction rejected: ${concise.slice(0, 96)}`
    : "transaction rejected before the chain returned a reason.";
}

/**
 * Engine-aware execution hook for Uniswap V3 and V4.
 * Sends the protocol cut to the fee vault and invokes the selected Uniswap
 * V3/V4 position manager with native Robinhood ETH only.
 */
export function useContractInjection(
  token?: `0x${string}`,
  neededWei?: bigint,
  engine: ContractVersion = "V4",
): ContractInjection {
  const { address, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const qc = useQueryClient();

  const [phase, setPhase] = useState<InjectionPhase>("idle");
  const [stepNote, setStepNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<InjectionReceipt | null>(null);

  // ETH-only injection never needs an ERC-20 allowance.
  const allowance = 0n;

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["readContract"] });
    await qc.invalidateQueries({ queryKey: ["balance"] });
  };

  const approveToken = useCallback(async (_t: `0x${string}`) => {
    setError(null);
    setPhase("idle");
    setStepNote("ETH-only flow — no token approval required.");
  }, []);

  const run = useCallback(
    async (p: InjectionParams) => {
      if (!address) return;
      if (chainId !== ROBINHOOD_CHAIN_ID) {
        setPhase("error");
        setError("switch your wallet to Robinhood Chain (4663) before deploying.");
        return;
      }
      setError(null);
      setReceipt(null);
      try {
        /* --------------------------- [2] fee vault + direct Uniswap --- */
        const feeEth = p.feeEth ?? 0n;
        const netEth = p.ethWei - feeEth;
        if (netEth <= 0n) throw new Error("ETH amount is too small after the protocol cut.");
        if (feeEth > 0n) {
          setPhase("submitting");
          setStepNote("routing protocol cut to the fee vault…");
          await sendTransactionAsync({ to: FEE_VAULT, value: feeEth, chainId: ROBINHOOD_CHAIN_ID });
        }

        /* --------------------------- [3] direct Uniswap position --- */
        setPhase("submitting");
        let txHash: `0x${string}`;

        // V3 receives only native Robinhood ETH: wrap it locally, then mint
        // a one-sided WETH position directly through Uniswap's position manager.
        if (p.version === "V3") {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
          setPhase("approving");
          setStepNote("wrapping Robinhood ETH for Uniswap V3…");
          let stepHash = await writeContractAsync({ address: WETH_ADDRESS, abi: wethDepositAbi, functionName: "deposit", value: netEth, chainId: ROBINHOOD_CHAIN_ID });
          await waitForTransactionReceipt(config, { hash: stepHash });
          setStepNote("approving the Uniswap V3 position manager…");
          stepHash = await writeContractAsync({ address: WETH_ADDRESS, abi: erc20Abi, functionName: "approve", args: [LEGACY_V3.positionManager, netEth], chainId: ROBINHOOD_CHAIN_ID });
          await waitForTransactionReceipt(config, { hash: stepHash });
          const wethFirst = WETH_ADDRESS.toLowerCase() < p.token.toLowerCase();
          setPhase("submitting");
          setStepNote("minting the ETH-only Uniswap V3 position…");
          txHash = await writeContractAsync({
            address: LEGACY_V3.positionManager,
            abi: v3MintAbi,
            functionName: "mint",
            args: [{
              token0: wethFirst ? WETH_ADDRESS : p.token,
              token1: wethFirst ? p.token : WETH_ADDRESS,
              fee: p.feeTier,
              tickLower: p.tickLower,
              tickUpper: p.tickUpper,
              amount0Desired: wethFirst ? netEth : 0n,
              amount1Desired: wethFirst ? 0n : netEth,
              amount0Min: wethFirst ? slip(netEth, p.slippageBps) : 0n,
              amount1Min: wethFirst ? 0n : slip(netEth, p.slippageBps),
              recipient: BURN_ADDRESS,
              deadline,
            }],
            value: 0n,
            chainId: ROBINHOOD_CHAIN_ID,
          });
        } else {
          // Uniswap V4 singleton: direct PositionManager call with amount1=0.
          // The creator token identifies the pool key; the only asset supplied
          // by the user is Robinhood native ETH (currency0).
          const key = {
            currency0: ZERO_ADDRESS as `0x${string}`,
            currency1: p.token,
            fee: p.feeTier,
            tickSpacing: TICK_SPACING[p.feeTier] ?? 60,
            hooks: V4_APPROVED_HOOKS,
          };
          const salt = keccak256(toHex(`ponspool:eth-only:${p.token}:${Date.now()}`));
          const unlockData = encodeModifyLiquiditiesPayload({
            key,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            liquidityDelta: p.liquidityDelta,
            amount0Max: maxWithSlippage(netEth, p.slippageBps),
            amount1Max: 0n,
            salt,
            recipient: BURN_ADDRESS,
            initializePool: p.initializePool,
            initialSqrtPriceX96: 2n ** 96n,
          });
          setPhase("submitting");
          setStepNote("minting the ETH-only Uniswap V4 position…");
          txHash = await writeContractAsync({
            address: V4_POSITION_MANAGER,
            abi: v4ModifyLiquiditiesAbi,
            functionName: "modifyLiquidities",
            args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 1800)],
            value: netEth,
            chainId: ROBINHOOD_CHAIN_ID,
          });
        }

        setPhase("confirming");
        setStepNote("sealing on robinhood chain…");
        await waitForTransactionReceipt(config, { hash: txHash });

        setReceipt({
          txHash,
          version: p.version,
          mode: p.mode,
          token: p.token,
          ethInjected: p.ethWei - p.feeEth,
          tokenIn: 0n,
          swapIn: p.zapSwapEth,
          lpMinted: undefined,
          positionId: undefined,
          pair: p.pair,
          feeEth: p.feeEth,
          // The fee vault performs the eventual buyback/burn. The frontend
          // represents the routed ETH allocation as burned immediately.
          burnedPons: p.feeEth,
          destination: p.destination,
        });
        publishConfirmedInjection({
          hash: txHash,
          token: p.token,
          symbol: p.symbol,
          version: p.version,
          mode: p.mode,
          ethIn: p.ethWei - p.feeEth,
          destination: p.destination,
        });
        await publishGlobalInjection({
          hash: txHash,
          token: p.token,
          symbol: p.symbol,
          version: p.version,
          mode: p.mode,
          ethIn: p.ethWei - p.feeEth,
          destination: p.destination,
        });
        await invalidate();
        setPhase("success");
        setStepNote("");
      } catch (e) {
        setPhase("error");
        setStepNote("");
        setError(humanizeError(e));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [address, chainId, writeContractAsync, sendTransactionAsync],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setStepNote("");
    setError(null);
    setReceipt(null);
  }, []);

  return { phase, stepNote, error, receipt, allowance, approveToken, run, reset };
}
