import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNearWallet } from "../context/NearWalletContext";
import { REF_FINANCE_CONTRACT_ID } from "../config/near";
import { getNativeBalance, NearTransactionError, outcomeReturnValue, outcomeTxHash } from "../lib/near";
import { explainNearError, getPlatformFee, invalidatePoolIndex, planCreatePool, type CreatePoolPlan } from "../lib/refFinance";
import { executePlannedTransactions } from "./useNearInjection";
import { REF_QUERY_ROOT } from "./useRefData";

export type CreatePoolPhase = "idle" | "checking" | "signing" | "success" | "error";

/** Create a Ref simple pool; resolves with the new pool ID. */
export function useCreatePool() {
  const { accountId, signAndSendTransactions } = useNearWallet();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<CreatePoolPhase>("idle");
  const [plan, setPlan] = useState<CreatePoolPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (tokenIds: [string, string], feeBps: number): Promise<number | null> => {
      if (running.current || !accountId) return null;
      running.current = true;
      setError(null);
      setPhase("checking");
      try {
        const [native, fee] = await Promise.all([getNativeBalance(accountId), getPlatformFee()]);
        const nextPlan = planCreatePool(native, { tokenIds, feeBps, fee });
        setPlan(nextPlan);
        setPhase("signing");
        const outcomes = await executePlannedTransactions(signAndSendTransactions, accountId, nextPlan.transactions);
        const refOutcome = outcomes.find((o) => (o.transaction as { receiver_id?: string } | undefined)?.receiver_id === REF_FINANCE_CONTRACT_ID);
        const value = refOutcome ? outcomeReturnValue<number | string>(refOutcome) : null;
        const poolId = value !== null && /^\d+$/.test(String(value)) ? Number(value) : null;
        if (poolId === null) {
          throw new NearTransactionError("pool created, but its ID couldn't be read — find it on your token page", refOutcome ? outcomeTxHash(refOutcome) : undefined);
        }
        invalidatePoolIndex();
        void queryClient.invalidateQueries({ queryKey: [REF_QUERY_ROOT] });
        setPhase("success");
        return poolId;
      } catch (e) {
        invalidatePoolIndex();
        setError(explainNearError(e).message);
        setPhase("error");
        return null;
      } finally {
        running.current = false;
      }
    },
    [accountId, signAndSendTransactions, queryClient],
  );

  return { phase, busy: phase === "checking" || phase === "signing", plan, error, run };
}
