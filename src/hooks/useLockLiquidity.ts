import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNearWallet } from "../context/NearWalletContext";
import { getNativeBalance, NearTransactionError, outcomeTxHash } from "../lib/near";
import { explainNearError, getPoolShares, isLockAccountRegistered, planLockShares, type LockPlan } from "../lib/refFinance";
import { executePlannedTransactions } from "./useNearInjection";
import { REF_QUERY_ROOT } from "./useRefData";
import { publishActivity } from "../lib/activity";

export type LockPhase = "idle" | "checking" | "signing" | "success" | "error";

/** Lock LP shares forever (see planLockShares). */
export function useLockLiquidity() {
  const { accountId, signAndSendTransactions } = useNearWallet();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<LockPhase>("idle");
  const [plan, setPlan] = useState<LockPlan | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (poolId: number, shares: bigint) => {
      if (running.current || !accountId) return false;
      running.current = true;
      setError(null);
      setTxHash(null);
      setPhase("checking");
      try {
        const [native, available, lockRegistered] = await Promise.all([
          getNativeBalance(accountId),
          getPoolShares(poolId, accountId),
          isLockAccountRegistered(poolId),
        ]);
        const next = planLockShares(native, { poolId, shares, available, lockRegistered });
        setPlan(next);
        setPhase("signing");
        const outcomes = await executePlannedTransactions(signAndSendTransactions, accountId, next.transactions);
        const last = outcomes[outcomes.length - 1];
        const hash = last ? outcomeTxHash(last) : null;
        setTxHash(hash);
        setPhase("success");
        if (hash) {
          void publishActivity(hash, accountId).then(() =>
            queryClient.invalidateQueries({ queryKey: ["activity-feed"] }),
          );
        }
        return true;
      } catch (e) {
        const { message } = explainNearError(e);
        setError(e instanceof NearTransactionError && e.txHash ? `${message} (tx ${e.txHash.slice(0, 8)}…)` : message);
        setPhase("error");
        return false;
      } finally {
        running.current = false;
        void queryClient.invalidateQueries({ queryKey: [REF_QUERY_ROOT] });
      }
    },
    [accountId, signAndSendTransactions, queryClient],
  );

  const reset = useCallback(() => {
    if (running.current) return;
    setPhase("idle");
    setPlan(null);
    setTxHash(null);
    setError(null);
  }, []);

  return { phase, busy: phase === "checking" || phase === "signing", plan, txHash, error, run, reset };
}
