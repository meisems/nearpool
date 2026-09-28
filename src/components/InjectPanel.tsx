import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNearWallet } from "../context/NearWalletContext";
import { REF_QUERY_ROOT, useAccountSnapshot, useDclPools, useFtMetadata, usePlatformFee, usePoolShares, useSwapRoutes } from "../hooks/useRefData";
import { useQuery } from "@tanstack/react-query";
import { useNearInjection, type InjectionPhase } from "../hooks/useNearInjection";
import {
  explorerTxUrl,
  NEAR_DECIMALS,
  NEAR_GAS_RESERVE,
  SLIPPAGE_DEFAULT_BPS,
  SLIPPAGE_OPTIONS_BPS,
  WRAP_NEAR_CONTRACT_ID,
} from "../config/near";
import {
  bestRoute,
  counterToken,
  displaySymbol,
  PlanError,
  planInjection,
  planZapInjection,
  planZapViaDcl,
  quoteZap,
  quoteZapViaDcl,
  type InjectionPlan,
  type PlatformFee,
  type RefPool,
  type SwapRoute,
  type TokenAccountState,
} from "../lib/refFinance";
import { fmtAmount, parseUnits, rawToInput, shortHash } from "../lib/format";
import { estimateAddLiquidity, LP_SHARE_DECIMALS, maxBig, minBig, mulDiv, quoteCounterAmount } from "../utils/zapMath";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { CompletionModal } from "./CompletionModal";
import { LockModal } from "./LockModal";
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

function spendable(token: TokenAccountState | undefined, native: bigint, useRef: boolean, wrapNative: boolean, fee: bigint): bigint {
  if (!token) return 0n;
  let total = token.walletBalance + (useRef ? token.refDeposit : 0n);
  if (token.tokenId === WRAP_NEAR_CONTRACT_ID && wrapNative) total += maxBig(native - NEAR_GAS_RESERVE - STORAGE_HEADROOM - fee, 0n);
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

const planErrorText = (e: unknown) => (e instanceof PlanError ? e.message : e instanceof Error ? e.message : String(e));

/**
 * NEAR only: one NEAR amount. Part of it buys the other side (through the
 * best Ref route, which may be this pool), the rest goes in as wNEAR, all in
 * one approval. Works for any pool whose tokens can be bought with NEAR.
 */
function NearOnlyForm({
  pool,
  symbols,
  decimals,
  slipBps,
  fee,
  existingShares,
  inj,
  footer,
  onUseTwoTokens,
}: {
  footer: ReactNode;
  onUseTwoTokens: () => void;
  pool: RefPool;
  symbols: string[];
  decimals: number[];
  slipBps: number;
  fee: PlatformFee | null;
  existingShares: bigint | undefined;
  inj: ReturnType<typeof useNearInjection>;
}) {
  const { accountId, signIn } = useNearWallet();
  const W = WRAP_NEAR_CONTRACT_ID;
  const [input, setInput] = useState("");
  const nearIn = parseUnits(input, NEAR_DECIMALS) ?? 0n;
  useEffect(() => {
    if (inj.phase === "success") setInput("");
  }, [inj.phase]);

  const r0 = useSwapRoutes(pool.tokenIds[0] !== W ? W : null, pool.tokenIds[0]);
  const r1 = useSwapRoutes(pool.tokenIds[1] !== W ? W : null, pool.tokenIds[1]);
  const probe = nearIn > 1n ? nearIn / 2n : 10n ** 24n;
  // Best route per side for about half the amount; null = the side is NEAR, undefined = no route.
  const routes = useMemo(
    () =>
      [r0, r1].map((q, i): SwapRoute | null | undefined =>
        pool.tokenIds[i] === W ? null : bestRoute(q.data ?? [], probe)?.route,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r0.data, r1.data, probe, pool.id],
  );
  const routesLoading = r0.isLoading || r1.isLoading;
  const missing = routes.findIndex((r) => r === undefined);

  // No Ref route for the token? Buy it from a Rhea DCL pool (launchpad coins trade only there).
  const nearSide = pool.tokenIds.indexOf(W);
  const buySide = nearSide === 0 ? 1 : nearSide === 1 ? 0 : -1;
  const needsDcl = !routesLoading && missing >= 0 && missing === buySide;
  const dclPoolsQ = useDclPools(needsDcl ? W : null, needsDcl ? pool.tokenIds[buySide] : null);
  const dclPools = useMemo(() => dclPoolsQ.data ?? [], [dclPoolsQ.data]);
  const viaDcl = needsDcl && dclPools.length > 0;
  const dclQuoteQ = useQuery({
    queryKey: [REF_QUERY_ROOT, "dcl-zap", pool.id, pool.sharesTotalSupply.toString(), nearIn.toString(), dclPools.map((p) => p.id)],
    queryFn: () => quoteZapViaDcl(pool, nearIn, dclPools),
    enabled: viaDcl && nearIn > 1n,
    staleTime: 10_000,
    retry: 1,
  });
  const findingRoute = routesLoading || (needsDcl && dclPoolsQ.isLoading);
  const unbuyable = !findingRoute && missing >= 0 && !viaDcl;

  const touched = useMemo(
    () => [...new Set([W, ...pool.tokenIds, ...(viaDcl ? [] : routes.flatMap((r) => r?.path ?? []))])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routes, pool.id, viaDcl],
  );
  const snapshot = useAccountSnapshot(touched);
  const wnear = snapshot.data?.tokens[W];
  const native = snapshot.data?.native.available;
  const max = spendable(wnear, native ?? 0n, false, true, fee?.amount ?? 0n);

  const refQuote = useMemo(
    () => (missing < 0 && nearIn > 1n ? quoteZap(pool, nearIn, routes as (SwapRoute | null)[]) : null),
    [pool, nearIn, routes, missing],
  );
  const quote = viaDcl ? (dclQuoteQ.data ?? null) : refQuote;
  const preview = useMemo((): { plan: InjectionPlan | null; error: string | null } => {
    if (!quote || !snapshot.data || existingShares === undefined) return { plan: null, error: null };
    // The snapshot may not have caught up with a newly chosen route yet.
    if (touched.some((id) => !snapshot.data!.tokens[id])) return { plan: null, error: null };
    try {
      const intent = { pool, quote, slippageBps: slipBps, existingShares, fee };
      return { plan: quote.dcl ? planZapViaDcl(snapshot.data, intent) : planZapInjection(snapshot.data, intent), error: null };
    } catch (e) {
      return { plan: null, error: planErrorText(e) };
    }
  }, [quote, snapshot.data, touched, pool, slipBps, existingShares, fee]);

  const empty = pool.sharesTotalSupply === 0n;
  const cta = ((): { label: string; disabled: boolean; onClick?: () => void } => {
    if (!accountId) return { label: "Connect wallet", disabled: false, onClick: signIn };
    if (inj.busy) return { label: inj.awaitingWallet ? "Confirm in wallet" : "Working…", disabled: true };
    if (findingRoute) return { label: "Finding route…", disabled: true };
    if (unbuyable) return { label: `Can't buy ${symbols[missing]} with NEAR`, disabled: true };
    if (nearIn <= 0n) return { label: "Enter an amount", disabled: true };
    if (viaDcl && dclQuoteQ.isLoading) return { label: "Getting quote…", disabled: true };
    if (!snapshot.data || existingShares === undefined) return { label: "Checking balances…", disabled: true };
    if (nearIn > max) return { label: "Not enough NEAR", disabled: true };
    if (!quote) return { label: "Not enough liquidity", disabled: true };
    if (preview.error) return { label: preview.error, disabled: true };
    if (!preview.plan) return { label: "Checking balances…", disabled: true };
    return {
      label: empty ? "Create position with NEAR" : "Add with NEAR",
      disabled: false,
      onClick: () =>
        void inj.run({
          pool,
          amounts: [0n, 0n],
          slippageBps: slipBps,
          useRefDeposits: false,
          payWithNative: true,
          nearOnly: { nearIn, routes: routes as (SwapRoute | null)[], dclPools: viaDcl ? dclPools : undefined },
        }),
    };
  })();

  const plan = preview.plan;

  // Nothing to buy the token from: no Ref pool with liquidity holds it.
  if (unbuyable) {
    const sym = symbols[missing];
    return (
      <>
        <div className="mt-3 rounded-xl bg-card2 p-4">
          <p className="font-medium text-ink">{sym} can't be bought yet</p>
          <p className="mt-1 text-sm text-muted">
            No Ref or Rhea pool has {sym} liquidity, so there's none to buy. The first deposit needs {sym} itself, usually from its creator. After that, NEAR only works here.
          </p>
        </div>
        <Button size="lg" variant="secondary" className="mt-4 w-full" onClick={onUseTwoTokens}>
          I have {sym}: add both tokens
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="mt-3">
        <Leg
          tokenId={W}
          symbol="NEAR"
          decimals={NEAR_DECIMALS}
          value={input}
          onChange={setInput}
          onMax={() => setInput(max > 0n ? rawToInput(max, NEAR_DECIMALS, 6) : "")}
          state={wnear}
          native={native}
          connected={!!accountId}
          auto={false}
        />
      </div>

      {quote && (
        <dl className="mt-3 space-y-1.5 text-xs">
          {quote.dcl && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Buys</dt>
              <dd className="truncate text-right text-ink tabular">
                ≈{fmtAmount(quote.amounts[quote.dcl.side], decimals[quote.dcl.side])} {symbols[quote.dcl.side]}
                <span className="text-faint"> · {fmtAmount(quote.spend[quote.dcl.side], NEAR_DECIMALS)} NEAR · Rhea {quote.dcl.fee / 10_000}% pool</span>
              </dd>
            </div>
          )}
          {quote.routes.map((route, i) =>
            route ? (
              <div key={i} className="flex justify-between gap-3">
                <dt className="text-muted">Buys</dt>
                <dd className="truncate text-right text-ink tabular">
                  ≈{fmtAmount(quote.amounts[i], decimals[i])} {symbols[i]}
                  <span className="text-faint"> · {fmtAmount(quote.spend[i], NEAR_DECIMALS)} NEAR · {route.pools.map((p) => `#${p.id}`).join(" → ")}</span>
                </dd>
              </div>
            ) : null,
          )}
          {plan && (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Adds</dt>
                <dd className="truncate text-right text-ink tabular">
                  {pool.tokenIds.map((_, i) => `${fmtAmount(plan.usedAmounts[i], decimals[i])} ${symbols[i]}`).join(" + ")}
                </dd>
              </div>
              <div className="flex justify-between"><dt className="text-muted">LP shares</dt><dd className="text-ink tabular">{fmtAmount(plan.expectedShares, LP_SHARE_DECIMALS)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Transactions</dt><dd className="text-ink tabular">{plan.transactions.length} · 1 approval</dd></div>
            </>
          )}
          <p className="pt-1 text-faint">{empty ? "Empty pool: sets the starting price at the market rate. " : ""}{quote.dcl ? `Extra ${symbols[quote.dcl.side]} stays in your wallet.` : "Leftovers stay in your Ref balance."}</p>
        </dl>
      )}

      {footer}
      <NearOnlyCta cta={cta} busy={inj.busy} />
    </>
  );
}

function NearOnlyCta({ cta, busy }: { cta: { label: string; disabled: boolean; onClick?: () => void }; busy: boolean }) {
  return (
    <Button size="lg" className="mt-4 w-full" disabled={cta.disabled} loading={busy} onClick={cta.onClick}>
      <span className="truncate">{cta.label}</span>
    </Button>
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
  const feeQ = usePlatformFee();
  const fee = feeQ.data ?? null;
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
  const [mode, setMode] = useState<"pair" | "near">("pair");
  /** Shares just minted, when the user chose to lock them from the completion screen. */
  const [lockPreset, setLockPreset] = useState<bigint | null>(null);

  // Reset the form only when the pool or token actually changes, not when a
  // refetch (tab focus, polling) hands back a fresh pool object.
  const poolKey = `${pool.id}:${pool.tokenIds.join(",")}:${tokenId}`;
  useEffect(() => {
    setInputs(["", ""]);
    setLastEdited(pool.tokenIds.indexOf(tokenId) as 0 | 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

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
  const spend = states.map((s) => spendable(s, native ?? 0n, useRefDeposits, wrapNative, fee?.amount ?? 0n));
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
        plan: planInjection(snapshot.data, { pool, amounts, slippageBps: slipBps, useRefDeposits, payWithNative: wrapNative, existingShares: shares.data, fee }),
        error: null,
      };
    } catch (e) {
      return { plan: null, error: e instanceof PlanError ? e.message : e instanceof Error ? e.message : String(e) };
    }
  }, [snapshot.data, pool, amounts, slipBps, useRefDeposits, wrapNative, shares.data, fee]);

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
    if (!snapshot.data || shares.data === undefined || feeQ.isLoading) return { label: "Checking balances…", disabled: true };
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

  // Same (cached) route queries as the NEAR-only form: offer it only when every side can be bought.
  const W = WRAP_NEAR_CONTRACT_ID;
  const buy0 = useSwapRoutes(pool.tokenIds[0] !== W ? W : null, pool.tokenIds[0]);
  const buy1 = useSwapRoutes(pool.tokenIds[1] !== W ? W : null, pool.tokenIds[1]);
  const nearIdx = pool.tokenIds.indexOf(W);
  const soleToken = nearIdx === 0 ? pool.tokenIds[1] : nearIdx === 1 ? pool.tokenIds[0] : null;
  const refRoutesMissing = [buy0, buy1].some((q, i) => pool.tokenIds[i] !== W && q.isSuccess && q.data.length === 0);
  const dclForToken = useDclPools(refRoutesMissing && soleToken ? W : null, refRoutesMissing ? soleToken : null);
  const buyable =
    [buy0, buy1].every((q, i) => pool.tokenIds[i] === W || (q.data?.length ?? 0) > 0) || (dclForToken.data?.length ?? 0) > 0;

  const footer = (
    <>
      {fee && (
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-muted">Fee</span>
          <span className="text-ink tabular">{fmtAmount(fee.amount, NEAR_DECIMALS)} NEAR</span>
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
    </>
  );

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

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-card2 p-1 text-sm font-medium" role="tablist" aria-label="Deposit with">
        {(["pair", "near"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            disabled={inj.busy}
            className={`h-8 rounded-lg transition ${mode === m ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {m === "pair" ? "Two tokens" : "NEAR only"}
          </button>
        ))}
      </div>

      {mode === "near" ? (
        <NearOnlyForm pool={pool} symbols={symbols} decimals={decimals} slipBps={slipBps} fee={fee} existingShares={shares.data} inj={inj} footer={footer} onUseTwoTokens={() => setMode("pair")} />
      ) : (
      <>
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

      {footer}
      {short !== undefined && pool.tokenIds[short] !== WRAP_NEAR_CONTRACT_ID && buyable && (
        <button onClick={() => setMode("near")} className="mt-3 w-full text-center text-xs font-semibold text-accent hover:underline">
          No {symbols[short]}? Add with NEAR only
        </button>
      )}
      <Button size="lg" className="mt-4 w-full" disabled={cta.disabled} loading={inj.busy} onClick={cta.onClick}>
        <span className="truncate">{cta.label}</span>
      </Button>
      </>
      )}

      <LockModal
        open={lockPreset !== null}
        onClose={() => setLockPreset(null)}
        pool={pool}
        available={maxBig(shares.data ?? 0n, lockPreset ?? 0n)}
        preset={lockPreset}
        symbols={symbols}
        decimals={decimals}
      />
      <CompletionModal
        receipt={inj.receipt}
        tokens={symbols.map((symbol, i) => ({ symbol, decimals: decimals[i] }))}
        tracked={tracked}
        onTrack={onTrack}
        onLock={() => {
          setLockPreset(inj.receipt?.sharesMinted ?? null);
          inj.reset();
          setInputs(["", ""]);
        }}
        onClose={() => {
          inj.reset();
          setInputs(["", ""]);
        }}
      />
    </Card>
  );
}

