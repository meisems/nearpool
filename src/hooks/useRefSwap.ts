import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNearWallet } from "../context/NearWalletContext";
import { NearTransactionError, outcomeTxHash } from "../lib/near";
import { explainNearError, getPool, loadAccountSnapshot, planSwap, type RefPool, type SwapPlan } from "../lib/refFinance";
import { executePlannedTransactions } from "./useNearInjection";
import { REF_QUERY_ROOT } from "./useRefData";

export type SwapPhase = "idle" | "checking-storage" | "signing" | "success" | "error";

export interface SwapRequest {
  pool: RefPool;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  slippageBps: number;
  payWithNative: boolean;
}

export interface SwapReceipt {
  txHash: string | null;
  expectedOut: bigint;
  minAmountOut: bigint;
  tokenOut: string;
}

/** Single-hop Ref Finance instant swap, used to source the counter asset for an LP injection. */
export function useRefSwap() {
  const { accountId, signAndSendTransactions } = useNearWallet();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<SwapPhase>("idle");
  const [plan, setPlan] = useState<SwapPlan | null>(null);
  const [receipt, setReceipt] = useState<SwapReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (request: SwapRequest): Promise<SwapReceipt | null> => {
      if (running.current || !accountId) return null;
      running.current = true;
      setError(null);
      setReceipt(null);
      setPhase("checking-storage");
      try {
        const [pool, snapshot] = await Promise.all([
          getPool(request.pool.id),
          loadAccountSnapshot(accountId, [request.tokenIn, request.tokenOut]),
        ]);
        const nextPlan = planSwap(snapshot, { ...request, pool });
        setPlan(nextPlan);
        setPhase("signing");
        const outcomes = await executePlannedTransactions(signAndSendTransactions, accountId, nextPlan.transactions);
        const last = outcomes[outcomes.length - 1];
        const result: SwapReceipt = {
          txHash: last ? outcomeTxHash(last) : null,
          expectedOut: nextPlan.expectedOut,
          minAmountOut: nextPlan.minAmountOut,
          tokenOut: request.tokenOut,
        };
        setReceipt(result);
        setPhase("success");
        void queryClient.invalidateQueries({ queryKey: [REF_QUERY_ROOT] });
        return result;
      } catch (e) {
        const { message } = explainNearError(e);
        setError(e instanceof NearTransactionError && e.txHash ? `${message} (tx ${e.txHash.slice(0, 8)}…)` : message);
        setPhase("error");
        void queryClient.invalidateQueries({ queryKey: [REF_QUERY_ROOT] });
        return null;
      } finally {
        running.current = false;
      }
    },
    [accountId, signAndSendTransactions, queryClient],
  );

  const reset = useCallback(() => {
    if (running.current) return;
    setPhase("idle");
    setPlan(null);
    setReceipt(null);
    setError(null);
  }, []);

  return { phase, busy: phase === "checking-storage" || phase === "signing", plan, receipt, error, run, reset };
}
