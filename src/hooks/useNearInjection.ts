import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FinalExecutionOutcome } from "@near-wallet-selector/core";
import { useNearWallet } from "../context/NearWalletContext";
import { REF_FINANCE_CONTRACT_ID, WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { findOutcomeFailure, NearTransactionError, outcomeReturnValue, outcomeTxHash } from "../lib/near";
import {
  explainNearError,
  getDeposits,
  getFtBalance,
  getPlatformFee,
  getPool,
  getPoolShares,
  loadAccountSnapshot,
  planInjection,
  planZapInjection,
  planZapViaDcl,
  PlanError,
  quoteZap,
  quoteZapViaDcl,
  toWalletTransactions,
  type InjectionPlan,
  type PlannedTransaction,
  type RefPool,
  type SwapRoute,
} from "../lib/refFinance";
import { publishActivity } from "../lib/activity";
import { REF_QUERY_ROOT } from "./useRefData";
import type { DclPool } from "../lib/dcl";

/**
 * Pipeline phases, in order. `checking-storage` runs before the wallet
 * prompt; the remaining phases are observed on-chain while the wallet
 * executes the signed batch.
 */
export type InjectionPhase =
  | "idle"
  | "checking-storage"
  | "wrapping"
  | "depositing"
  | "injecting"
  | "success"
  | "error";

export const INJECTION_PHASE_LABEL: Record<InjectionPhase, string> = {
  idle: "ready",
  "checking-storage": "checking storage",
  wrapping: "wrapping NEAR",
  depositing: "depositing to Ref",
  injecting: "injecting LP",
  success: "success",
  error: "failed",
};

export interface InjectionRequest {
  pool: RefPool;
  /** Amounts in pool token order. */
  amounts: bigint[];
  slippageBps: number;
  useRefDeposits: boolean;
  payWithNative: boolean;
  /**
   * NEAR only: put in `nearIn` NEAR; the other side(s) are bought with part
   * of it via `routes` (null for a wNEAR side). `amounts` is ignored.
   */
  nearOnly?: { nearIn: bigint; routes: (SwapRoute | null)[]; dclPools?: DclPool[] };
}

export interface InjectionReceipt {
  poolId: number;
  tokenIds: string[];
  /** Estimated amounts Ref pulled, pool order. */
  usedAmounts: bigint[];
  /** LP shares minted (from the add_liquidity return value when available). */
  sharesMinted: bigint;
  /** Hash of the transaction carrying add_liquidity. */
  txHash: string | null;
  /** Every transaction in the batch, in order. */
  txHashes: string[];
  wrapped: bigint;
}

const POLL_MS = 2_500;

/**
 * Execute planned transactions through the wallet and verify every outcome,
 * including receipts: a refunded `ft_transfer_call` reports an overall
 * success, so each receipt is checked for a failure.
 */
export async function executePlannedTransactions(
  signAndSend: (txs: ReturnType<typeof toWalletTransactions>) => Promise<FinalExecutionOutcome[]>,
  signerId: string,
  transactions: PlannedTransaction[],
): Promise<FinalExecutionOutcome[]> {
  const outcomes = await signAndSend(toWalletTransactions(signerId, transactions));
  for (const outcome of outcomes) {
    const failure = findOutcomeFailure(outcome);
    if (failure) throw new NearTransactionError(explainNearError(failure).message, outcomeTxHash(outcome));
  }
  return outcomes;
}

export function useNearInjection() {
  const { accountId, signAndSendTransactions } = useNearWallet();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<InjectionPhase>("idle");
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const [plan, setPlan] = useState<InjectionPlan | null>(null);
  const [receipt, setReceipt] = useState<InjectionReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedTxHash, setFailedTxHash] = useState<string | null>(null);
  const running = useRef(false);
  const pollTimer = useRef<number | null>(null);
  /** Guards against a poll that was already in flight when the batch settled. */
  const pollLive = useRef(false);

  const stopPolling = () => {
    pollLive.current = false;
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    pollTimer.current = null;
  };
  useEffect(() => stopPolling, []);

  const reset = useCallback(() => {
    if (running.current) return;
    setPhase("idle");
    setAwaitingWallet(false);
    setPlan(null);
    setReceipt(null);
    setError(null);
    setFailedTxHash(null);
  }, []);

  const run = useCallback(
    async (request: InjectionRequest): Promise<InjectionReceipt | null> => {
      if (running.current) return null;
      if (!accountId) {
        setError("connect a NEAR wallet first");
        setPhase("error");
        return null;
      }
      running.current = true;
      setError(null);
      setFailedTxHash(null);
      setReceipt(null);
      setPhase("checking-storage");

      try {
        /* Step A (pre-flight): fresh pool, storage registrations, balances. */
        const zap = request.nearOnly;
        const tokenIds = [
          ...new Set([...request.pool.tokenIds, ...(zap ? [WRAP_NEAR_CONTRACT_ID, ...zap.routes.flatMap((r) => r?.path ?? [])] : [])]),
        ];
        const [pool, snapshot, existingShares, fee] = await Promise.all([
          getPool(request.pool.id),
          loadAccountSnapshot(accountId, tokenIds),
          getPoolShares(request.pool.id, accountId),
          getPlatformFee(),
        ]);
        let nextPlan: InjectionPlan;
        if (zap?.dclPools?.length) {
          // Token bought from a Rhea DCL pool: re-quote now for current prices.
          const quote = await quoteZapViaDcl(pool, zap.nearIn, zap.dclPools);
          if (!quote) throw new PlanError("no-liquidity", "couldn't buy this token with NEAR");
          nextPlan = planZapViaDcl(snapshot, { pool, quote, slippageBps: request.slippageBps, existingShares, fee });
        } else if (zap) {
          // Re-read every pool on the routes so the split and minimums use current reserves.
          const fresh = new Map<number, RefPool>([[pool.id, pool]]);
          const routeIds = [...new Set(zap.routes.flatMap((r) => r?.pools.map((p) => p.id) ?? []))].filter((id) => id !== pool.id);
          (await Promise.all(routeIds.map((id) => getPool(id)))).forEach((p) => fresh.set(p.id, p));
          const routes = zap.routes.map((r) => (r ? { path: r.path, pools: r.pools.map((p) => fresh.get(p.id)!) } : null));
          const quote = quoteZap(pool, zap.nearIn, routes);
          if (!quote) throw new PlanError("no-liquidity", "couldn't buy this token with NEAR");
          nextPlan = planZapInjection(snapshot, { pool, quote, slippageBps: request.slippageBps, existingShares, fee });
        } else {
          nextPlan = planInjection(snapshot, {
            pool,
            amounts: request.amounts,
            slippageBps: request.slippageBps,
            useRefDeposits: request.useRefDeposits,
            payWithNative: request.payWithNative,
            existingShares,
            fee,
          });
        }
        setPlan(nextPlan);

        /* Steps B–D: one wallet approval for the whole ordered batch. */
        const firstPhase: InjectionPhase = nextPlan.steps.includes("wrap")
          ? "wrapping"
          : nextPlan.steps.includes("deposit")
            ? "depositing"
            : "injecting";
        setPhase(firstPhase);
        setAwaitingWallet(true);

        // Observe real on-chain progress while the wallet works through the batch.
        const baselineWNear = snapshot.tokens[WRAP_NEAR_CONTRACT_ID]?.walletBalance ?? 0n;
        const baselineDeposits = pool.tokenIds.map((id) => snapshot.tokens[id]?.refDeposit ?? 0n);
        pollLive.current = true;
        pollTimer.current = window.setInterval(async () => {
          try {
            const [deposits, shares, wNear] = await Promise.all([
              getDeposits(accountId),
              getPoolShares(pool.id, accountId),
              nextPlan.wrapAmount > 0n ? getFtBalance(WRAP_NEAR_CONTRACT_ID, accountId) : Promise.resolve(baselineWNear),
            ]);
            if (!pollLive.current) return;
            const depositsLanded = pool.tokenIds.every(
              (id, i) => (deposits[id] ?? 0n) >= baselineDeposits[i] + nextPlan.walletDeposits[i],
            );
            const anyDepositMoved = pool.tokenIds.some((id, i) => (deposits[id] ?? 0n) > baselineDeposits[i]);
            const wrapped = nextPlan.wrapAmount > 0n && (wNear >= baselineWNear + nextPlan.wrapAmount || anyDepositMoved);
            if (shares > existingShares || depositsLanded) {
              setAwaitingWallet(false);
              setPhase("injecting");
            } else if (anyDepositMoved || wrapped) {
              setAwaitingWallet(false);
              setPhase((current) => (current === "injecting" ? current : "depositing"));
            }
          } catch {
            /* A missed poll only delays the progress indicator. */
          }
        }, POLL_MS);

        const outcomes = await executePlannedTransactions(signAndSendTransactions, accountId, nextPlan.transactions);
        stopPolling();
        setAwaitingWallet(false);

        const injectOutcome = [...outcomes]
          .reverse()
          .find((o) => (o.transaction as { receiver_id?: string } | undefined)?.receiver_id === REF_FINANCE_CONTRACT_ID);
        const minted = injectOutcome ? outcomeReturnValue<string>(injectOutcome) : null;
        const txHash = injectOutcome ? outcomeTxHash(injectOutcome) : null;
        const result: InjectionReceipt = {
          poolId: pool.id,
          tokenIds: pool.tokenIds,
          usedAmounts: nextPlan.usedAmounts,
          sharesMinted: minted && /^\d+$/.test(minted) ? BigInt(minted) : nextPlan.expectedShares,
          txHash,
          txHashes: outcomes.map(outcomeTxHash),
          wrapped: nextPlan.wrapAmount,
        };
        setReceipt(result);
        setPhase("success");
        if (txHash) {
          void publishActivity(txHash, accountId).then(() =>
            queryClient.invalidateQueries({ queryKey: ["activity-feed"] }),
          );
        }
        void queryClient.invalidateQueries({ queryKey: [REF_QUERY_ROOT] });
        return result;
      } catch (e) {
        stopPolling();
        setAwaitingWallet(false);
        const { message } = explainNearError(e);
        setError(message);
        setFailedTxHash(e instanceof NearTransactionError ? e.txHash ?? null : null);
        setPhase("error");
        // Deposits may have landed before a later step failed; refresh balances.
        void queryClient.invalidateQueries({ queryKey: [REF_QUERY_ROOT] });
        return null;
      } finally {
        running.current = false;
      }
    },
    [accountId, signAndSendTransactions, queryClient],
  );

  const busy = phase === "checking-storage" || phase === "wrapping" || phase === "depositing" || phase === "injecting";

  return { phase, busy, awaitingWallet, plan, receipt, error, failedTxHash, run, reset };
}
