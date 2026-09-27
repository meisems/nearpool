import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNearWallet } from "../context/NearWalletContext";
import { useAccountSnapshot, useFtMetadata, usePoolShares } from "../hooks/useRefData";
import { useNearInjection, type InjectionPhase } from "../hooks/useNearInjection";
import {
  explorerTxUrl,
  NEAR_DECIMALS,
  NEAR_GAS_RESERVE,
  SLIPPAGE_DEFAULT_BPS,
  SLIPPAGE_OPTIONS_BPS,
  WRAP_NEAR_CONTRACT_ID,
} from "../config/near";
import { counterToken, displaySymbol, PlanError, planInjection, type InjectionPlan, type RefPool, type TokenAccountState } from "../lib/refFinance";
import { fmtAmount, parseUnits, rawToInput, shortHash } from "../lib/format";
import { estimateAddLiquidity, LP_SHARE_DECIMALS, maxBig, minBig, mulDiv, quoteCounterAmount } from "../utils/zapMath";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { CompletionModal } from "./CompletionModal";
import { Button, Card, IconButton } from "./ui";
import { IconAlert, IconChevronDown, IconPlus, IconSettings } from "./icons";

/** Native NEAR held back from "max" when wrapping, beyond the gas reserve, for storage registrations. */
const STORAGE_HEADROOM = 150_000_000_000_000_000_000_000n; // 0.15 NEAR

const STEPS: Array<{ phase: InjectionPhase; label: string; step: "storage" | "wrap" | "deposit" | "inject" }> = [
  { phase: "checking-storage", label: "Storage", step: "storage" },
  { phase: "wrapping", label: "Wrap", step: "wrap" },
  { phase: "depositing", label: "Deposit", step: "deposit" },
  { phase: "injecting", label: "Add", step: "inject" },
];
const ORDER: InjectionPhase[] = ["idle", "checking-storage", "wrapping", "depositing", "injecting", "success"];

function spendable(token: TokenAccountState | undefined, native: bigint, useRef: boolean, wrapNative: boolean): bigint {
  if (!token) return 0n;
  let total = token.walletBalance + (useRef ? token.refDeposit : 0n);
  if (token.tokenId === WRAP_NEAR_CONTRACT_ID && wrapNative) total += maxBig(native - NEAR_GAS_RESERVE - STORAGE_HEADROOM, 0n);
  return total;
}

function Progress({ phase, plan }: { phase: InjectionPhase; plan: InjectionPlan | null }) {
  const current = ORDER.indexOf(phase);
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s) => {
        const idx = ORDER.indexOf(s.phase);
        const skipped = !!plan && s.step !== "storage" && !plan.steps.includes(s.step);
        const done = phase === "success" || (phase !== "error" && current > idx);
        const active = phase === s.phase;
        return (
          <div key={s.phase} className={`flex-1 ${skipped ? "opacity-35" : ""}`}>
            <div className="h-1 overflow-hidden rounded-full bg-card2">
              <motion.div
                className={`h-full ${phase === "error" && active ? "bg-danger" : "bg-accentfill"}`}
                initial={false}
                animate={{ width: done ? "100%" : active ? "60%" : "0%" }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <div className={`mt-1.5 text-[11px] ${active ? "text-ink" : "text-faint"}`}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Leg({
  tokenId,
  symbol,
  decimals,
  value,
  onChange,
  onMax,
  state,
  native,
  connected,
  auto,
}: {
  tokenId: string;
  symbol: string;
  decimals: number;
  value: string;
  onChange: (v: string) => void;
  onMax: () => void;
  state: TokenAccountState | undefined;
  native: bigint | undefined;
  connected: boolean;
  auto: boolean;
}) {
  const isNear = tokenId === WRAP_NEAR_CONTRACT_ID;
  const balance = state ? state.walletBalance + (isNear && native !== undefined ? native : 0n) : undefined;
  return (
    <div className="rounded-xl bg-card2 px-3.5 py-3 ring-1 ring-transparent transition focus-within:ring-accent/50">
      <div className="flex items-center gap-3">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="0"
          aria-label={`${symbol} amount`}
          className={`w-full min-w-0 bg-transparent font-display text-2xl font-semibold outline-none placeholder:text-faint ${auto ? "text-muted" : "text-ink"}`}
        />
        <span className="flex shrink-0 items-center gap-2 rounded-full bg-card py-1 pr-3 pl-1 text-sm font-semibold text-ink">
          <TokenAvatar tokenId={tokenId} size={22} />
          {symbol}
        </span>
      </div>
      {connected && (
        <div className="mt-1.5 flex items-center justify-between text-xs text-faint tabular">
          <span title={state ? `Wallet ${fmtAmount(state.walletBalance, decimals)} · Ref ${fmtAmount(state.refDeposit, decimals)}` : undefined}>
            {balance === undefined ? "…" : `Balance ${fmtAmount(balance, isNear ? NEAR_DECIMALS : decimals)}`}
            {state && state.refDeposit > 0n && ` · Ref ${fmtAmount(state.refDeposit, decimals)}`}
          </span>
          <button onClick={onMax} disabled={!state} className="font-semibold text-accent hover:underline disabled:opacity-40">
            Max
          </button>
        </div>
      )}
    </div>
  );
}

/** Add liquidity to `pool`, with `tokenId` (the pasted token) shown first. */
export function InjectPanel({ pool, tokenId, onTrack, tracked }: { pool: RefPool; tokenId: string; onTrack?: () => void; tracked?: boolean }) {
  const { accountId, signIn } = useNearWallet();
  const toast = useToast();

  const counterId = counterToken(pool, tokenId);
  // Display order: pasted token first, counter token second.
  const view: [number, number] = [pool.tokenIds.indexOf(tokenId), pool.tokenIds.indexOf(counterId)];
  const metaA = useFtMetadata(pool.tokenIds[0]);
  const metaB = useFtMetadata(pool.tokenIds[1]);
  const metas = [metaA.data, metaB.data];
  const decimals = [metaA.data?.decimals ?? 24, metaB.data?.decimals ?? 24];
  const symbols = pool.tokenIds.map((id, i) => displaySymbol(id, metas[i]));
  const metaReady = !!metaA.data && !!metaB.data;

  const snapshot = useAccountSnapshot(pool.tokenIds);
  const shares = usePoolShares(pool.id);
  const native = snapshot.data?.native.available;
  const states = pool.tokenIds.map((id) => snapshot.data?.tokens[id]);

  /* form, in pool order */
  const [inputs, setInputs] = useState<[string, string]>(["", ""]);
  const [lastEdited, setLastEdited] = useState<0 | 1>(view[0] as 0 | 1);
  const [slipBps, setSlipBps] = useState(SLIPPAGE_DEFAULT_BPS);
  const [useRefDeposits, setUseRefDeposits] = useState(true);
  const [wrapNative, setWrapNative] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setInputs(["", ""]);
    setLastEdited(pool.tokenIds.indexOf(tokenId) as 0 | 1);
  }, [pool.id, pool.tokenIds, tokenId]);

  const reserves = pool.reserves;
  const empty = pool.sharesTotalSupply === 0n;

  const amounts = useMemo((): [bigint, bigint] => {
    if (!metaReady) return [0n, 0n];
    const other = lastEdited === 0 ? 1 : 0;
    const edited = parseUnits(inputs[lastEdited], decimals[lastEdited]) ?? 0n;
    const counter = empty ? parseUnits(inputs[other], decimals[other]) ?? 0n : quoteCounterAmount(edited, reserves[lastEdited], reserves[other]);
    return lastEdited === 0 ? [edited, counter] : [counter, edited];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, lastEdited, metaReady, empty, reserves[0], reserves[1], decimals[0], decimals[1]]);

  const shown = (i: 0 | 1) => (i === lastEdited || empty ? inputs[i] : amounts[i] > 0n ? rawToInput(amounts[i], decimals[i], 8) : "");
  const setSide = (i: 0 | 1, v: string) => {
    setLastEdited(i);
    setInputs((prev) => {
      const next: [string, string] = [...prev];
      next[i] = v;
      return next;
    });
  };
  const spend = states.map((s) => spendable(s, native ?? 0n, useRefDeposits, wrapNative));
  const setMax = (i: 0 | 1) => {
    const other = i === 0 ? 1 : 0;
    let max = spend[i];
    if (!empty && reserves[other] > 0n) max = minBig(max, mulDiv(spend[other], reserves[i], reserves[other]));
    setSide(i, max > 0n ? rawToInput(max, decimals[i], 8) : "");
  };

  const estimate = useMemo(
    () => (amounts[0] > 0n && amounts[1] > 0n ? estimateAddLiquidity(amounts, pool.reserves, pool.sharesTotalSupply) : null),
    [amounts, pool.reserves, pool.sharesTotalSupply],
  );

  const preview = useMemo((): { plan: InjectionPlan | null; error: string | null } => {
    if (!snapshot.data || amounts[0] <= 0n || amounts[1] <= 0n || shares.data === undefined) return { plan: null, error: null };
    try {
      return {
        plan: planInjection(snapshot.data, { pool, amounts, slippageBps: slipBps, useRefDeposits, payWithNative: wrapNative, existingShares: shares.data }),
        error: null,
      };
    } catch (e) {
      return { plan: null, error: e instanceof PlanError ? e.message : e instanceof Error ? e.message : String(e) };
    }
  }, [snapshot.data, pool, amounts, slipBps, useRefDeposits, wrapNative, shares.data]);

  const inj = useNearInjection();
  useEffect(() => {
    if (inj.phase === "error" && inj.error) toast(inj.error, "warn");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inj.phase]);

  const short = snapshot.data ? ([0, 1] as const).find((i) => amounts[i] > spend[i]) : undefined;

  const cta = ((): { label: string; disabled: boolean; onClick?: () => void } => {
    if (!accountId) return { label: "Connect wallet", disabled: false, onClick: signIn };
    if (inj.busy) return { label: inj.awaitingWallet ? "Confirm in wallet" : "Working…", disabled: true };
    if (!metaReady) return { label: "Loading…", disabled: true };
    if (amounts[0] <= 0n || amounts[1] <= 0n) return { label: "Enter an amount", disabled: true };
    if (!snapshot.data || shares.data === undefined) return { label: "Checking balances…", disabled: true };
    if (short !== undefined) return { label: `Not enough ${symbols[short]}`, disabled: true };
    if (preview.error) return { label: preview.error, disabled: true };
    if (!estimate || estimate.shares <= 0n) return { label: "Amount too small", disabled: true };
    return {
      label: empty ? "Create position" : "Add liquidity",
      disabled: false,
      onClick: () => void inj.run({ pool, amounts, slippageBps: slipBps, useRefDeposits, payWithNative: wrapNative }),
    };
  })();

  const hasNear = pool.tokenIds.includes(WRAP_NEAR_CONTRACT_ID);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Add liquidity</h2>
        <div className="relative">
          <IconButton label="Settings" onClick={() => setSettingsOpen((v) => !v)} className={settingsOpen ? "bg-card2 text-ink" : ""}>
            <IconSettings size={17} />
          </IconButton>
          <AnimatePresence>
            {settingsOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 z-20 mt-2 w-64 space-y-3 rounded-xl border border-line bg-card p-3.5 shadow-(--shadow-pop)"
              >
                <div>
                  <div className="text-xs text-muted">Max slippage</div>
                  <div className="mt-1.5 grid grid-cols-3 gap-1">
                    {SLIPPAGE_OPTIONS_BPS.map((b) => (
                      <button
                        key={b}
                        onClick={() => setSlipBps(b)}
                        className={`h-8 rounded-lg text-xs font-semibold ${slipBps === b ? "bg-accentsoft text-accentstrong" : "bg-card2 text-muted hover:text-ink"}`}
                      >
                        {b / 100}%
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center justify-between text-sm text-ink">
                  Use Ref balance
                  <input type="checkbox" checked={useRefDeposits} onChange={(e) => setUseRefDeposits(e.target.checked)} className="h-4 w-4 accent-[var(--accent-fill)]" />
                </label>
                {hasNear && (
                  <label className="flex cursor-pointer items-center justify-between text-sm text-ink">
                    Wrap NEAR if needed
                    <input type="checkbox" checked={wrapNative} onChange={(e) => setWrapNative(e.target.checked)} className="h-4 w-4 accent-[var(--accent-fill)]" />
                  </label>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {view.map((poolIdx, n) => {
          const i = poolIdx as 0 | 1;
          return (
            <div key={pool.tokenIds[i]}>
              {n === 1 && (
                <div className="relative z-10 -my-3 flex justify-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border-4 border-card bg-card2 text-muted">
                    <IconPlus size={12} />
                  </span>
                </div>
              )}
              <Leg
                tokenId={pool.tokenIds[i]}
                symbol={symbols[i]}
                decimals={decimals[i]}
                value={shown(i)}
                onChange={(v) => setSide(i, v)}
                onMax={() => setMax(i)}
                state={states[i]}
                native={native}
                connected={!!accountId}
                auto={!empty && lastEdited !== i && amounts[i] > 0n}
              />
            </div>
          );
        })}
      </div>

      {empty && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amberish">
          <IconAlert size={13} /> Empty pool — your amounts set the price.
        </p>
      )}

      {estimate && estimate.shares > 0n && (
        <div className="mt-3 text-sm">
          <button onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center justify-between py-1 text-muted hover:text-ink">
            <span>Pool share</span>
            <span className="flex items-center gap-1.5 text-ink tabular">
              {(estimate.poolShareBps / 100).toFixed(2)}%
              <IconChevronDown size={13} className={`text-faint transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
            </span>
          </button>
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <dl className="space-y-1.5 pt-1 text-xs">
                  <div className="flex justify-between"><dt className="text-muted">LP shares</dt><dd className="text-ink tabular">{fmtAmount(estimate.shares, LP_SHARE_DECIMALS)}</dd></div>
                  {preview.plan && (
                    <>
                      {view.map((i) => (
                        <div key={i} className="flex justify-between">
                          <dt className="text-muted">Min {symbols[i]}</dt>
                          <dd className="text-ink tabular">{fmtAmount(preview.plan!.minAmounts[i], decimals[i])}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between"><dt className="text-muted">Transactions</dt><dd className="text-ink tabular">{preview.plan.transactions.length} · 1 approval</dd></div>
                      <ol className="mt-1 space-y-0.5 border-t border-linesoft pt-1.5 text-faint">
                        {preview.plan.calls.map((c, k) => <li key={k} className="break-words">{c.label}</li>)}
                      </ol>
                    </>
                  )}
                </dl>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {inj.phase !== "idle" && inj.phase !== "success" && (
        <div className="mt-4">
          <Progress phase={inj.phase} plan={inj.plan} />
          {inj.phase === "error" && inj.error && (
            <div className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {inj.error}
              {inj.failedTxHash && (
                <a href={explorerTxUrl(inj.failedTxHash)} target="_blank" rel="noreferrer" className="ml-1 underline">
                  {shortHash(inj.failedTxHash)}
                </a>
              )}
              <button onClick={inj.reset} className="ml-2 font-semibold underline">Dismiss</button>
            </div>
          )}
        </div>
      )}

      <Button size="lg" className="mt-4 w-full" disabled={cta.disabled} loading={inj.busy} onClick={cta.onClick}>
        <span className="truncate">{cta.label}</span>
      </Button>

      <CompletionModal
        receipt={inj.receipt}
        tokens={symbols.map((symbol, i) => ({ symbol, decimals: decimals[i] }))}
        tracked={tracked}
        onTrack={onTrack}
        onClose={() => {
          inj.reset();
          setInputs(["", ""]);
        }}
      />
    </Card>
  );
}

