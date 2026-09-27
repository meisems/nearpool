import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNearWallet } from "../context/NearWalletContext";
import { useAccountSnapshot, useFtMetadata, usePairPools, usePool, usePoolShares } from "../hooks/useRefData";
import { INJECTION_PHASE_LABEL, useNearInjection, type InjectionPhase } from "../hooks/useNearInjection";
import {
  COMMON_PAIRS,
  COMMON_TOKENS,
  explorerTxUrl,
  NEAR_DECIMALS,
  NEAR_GAS_RESERVE,
  refPoolUrl,
  REF_FINANCE_CONTRACT_ID,
  SLIPPAGE_DEFAULT_BPS,
  SLIPPAGE_OPTIONS_BPS,
  WRAP_NEAR_CONTRACT_ID,
} from "../config/near";
import { displaySymbol, PlanError, planInjection, SIMPLE_POOL, type InjectionPlan, type TokenAccountState } from "../lib/refFinance";
import { fmtAmount, parseUnits, rawToInput, shortHash } from "../lib/format";
import { estimateAddLiquidity, LP_SHARE_DECIMALS, maxBig, minBig, mulDiv, quoteCounterAmount, spotPrice } from "../utils/zapMath";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { CompletionModal } from "./CompletionModal";
import { IconAlert, IconCheck, IconExternal, IconLayers, IconLoader, IconSearch, IconShield, IconSwap } from "./icons";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;

/** Native NEAR held back from "max" when wrapping, on top of the gas reserve, for storage registrations. */
const STORAGE_HEADROOM = 150_000_000_000_000_000_000_000n; // 0.15 NEAR

type PoolSource = "pair" | "id";

const PIPELINE: Array<{ phase: InjectionPhase; step: "storage" | "wrap" | "deposit" | "inject" | "done" }> = [
  { phase: "checking-storage", step: "storage" },
  { phase: "wrapping", step: "wrap" },
  { phase: "depositing", step: "deposit" },
  { phase: "injecting", step: "inject" },
  { phase: "success", step: "done" },
];
const PHASE_ORDER: InjectionPhase[] = ["idle", "checking-storage", "wrapping", "depositing", "injecting", "success"];

const symbolFor = (tokenId: string) => COMMON_TOKENS.find((t) => t.id === tokenId)?.symbol ?? displaySymbol(tokenId);

/** Spendable amount for one pool leg: Ref deposit + wallet balance (+ wrappable native NEAR). */
function spendable(token: TokenAccountState | undefined, nativeAvailable: bigint, useRef: boolean, payWithNative: boolean): bigint {
  if (!token) return 0n;
  let total = token.walletBalance + (useRef ? token.refDeposit : 0n);
  if (token.tokenId === WRAP_NEAR_CONTRACT_ID && payWithNative) {
    total += maxBig(nativeAvailable - NEAR_GAS_RESERVE - STORAGE_HEADROOM, 0n);
  }
  return total;
}

function Stepper({ phase, plan }: { phase: InjectionPhase; plan: InjectionPlan | null }) {
  const current = PHASE_ORDER.indexOf(phase);
  return (
    <div className="grid grid-cols-5 gap-1">
      {PIPELINE.map((item) => {
        const idx = PHASE_ORDER.indexOf(item.phase);
        const skipped = plan !== null && item.step !== "done" && item.step !== "storage" && !plan.steps.includes(item.step);
        const done = phase === "success" || (current > idx && phase !== "error");
        const active = phase === item.phase;
        return (
          <div key={item.phase} className="flex flex-col items-center gap-1.5 text-center">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] transition-colors ${
                done
                  ? "border-accent bg-accentsoft text-accentstrong"
                  : active
                    ? "border-accent text-accent"
                    : skipped
                      ? "border-dashed border-linesoft text-faint/50"
                      : "border-line text-faint"
              }`}
            >
              {done ? <IconCheck size={12} /> : active ? <IconLoader size={12} className="animate-spin" /> : idx}
            </span>
            <span className={`font-mono text-[8.5px] leading-tight tracking-wide uppercase ${active ? "text-ink" : skipped ? "text-faint/50 line-through" : "text-faint"}`}>
              {INJECTION_PHASE_LABEL[item.phase]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AmountField({
  tokenId,
  symbol,
  decimals,
  value,
  onChange,
  onMax,
  state,
  nativeAvailable,
  auto,
  connected,
}: {
  tokenId: string;
  symbol: string;
  decimals: number;
  value: string;
  onChange: (v: string) => void;
  onMax: () => void;
  state: TokenAccountState | undefined;
  nativeAvailable: bigint | undefined;
  auto: boolean;
  connected: boolean;
}) {
  const isNear = tokenId === WRAP_NEAR_CONTRACT_ID;
  return (
    <div className="rounded-2xl border border-linesoft bg-card2/40 p-3 transition-colors focus-within:border-accent/40">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase">
          {symbol} {auto && <span className="text-accentstrong normal-case tracking-normal">· auto from reserves</span>}
        </span>
        {connected && (
          <button onClick={onMax} disabled={!state} className="rounded-full bg-card px-2.5 py-0.5 font-mono text-[10px] font-medium text-muted transition-all hover:bg-accentsoft hover:text-accentstrong disabled:opacity-40">
            max
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <TokenAvatar tokenId={tokenId} size={26} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="0.0"
          className="w-full min-w-0 bg-transparent font-mono text-xl font-medium text-ink outline-none placeholder:text-faint"
        />
        <span className="shrink-0 font-mono text-xs text-faint">{symbol}</span>
      </div>
      {connected && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted tabular">
          {state ? (
            <>
              <span>wallet {fmtAmount(state.walletBalance, decimals)}{isNear ? " wNEAR" : ""}</span>
              <span>ref {fmtAmount(state.refDeposit, decimals)}</span>
              {isNear && nativeAvailable !== undefined && <span>native {fmtAmount(nativeAvailable, NEAR_DECIMALS)} NEAR</span>}
            </>
          ) : (
            <span>reading balances…</span>
          )}
        </div>
      )}
    </div>
  );
}

export function CreatorTerminal({ onSwap }: { onSwap: () => void }) {
  const { accountId, signIn } = useNearWallet();
  const toast = useToast();

  /* ------------------------------------------------ pool selection */
  const [source, setSource] = useState<PoolSource>("pair");
  const [pairIndex, setPairIndex] = useState(0);
  const [altIndex, setAltIndex] = useState(0);
  const [poolIdInput, setPoolIdInput] = useState("");

  const [pairA, pairB] = COMMON_PAIRS[pairIndex];
  const pairPools = usePairPools(source === "pair" ? pairA : null, source === "pair" ? pairB : null);
  const typedPoolId = /^\d{1,9}$/.test(poolIdInput.trim()) ? Number(poolIdInput.trim()) : null;
  const poolId = source === "pair" ? pairPools.data?.[altIndex]?.id ?? null : typedPoolId;
  const pool = usePool(poolId);
  const tokenIds = pool.data?.tokenIds ?? [];
  const twoTokens = tokenIds.length === 2;
  const metaA = useFtMetadata(tokenIds[0] ?? null);
  const metaB = useFtMetadata(tokenIds[1] ?? null);
  const metas = [metaA.data, metaB.data];
  const symbols = tokenIds.map((id, i) => displaySymbol(id, metas[i]));
  const decimals = [metaA.data?.decimals ?? 24, metaB.data?.decimals ?? 24];

  useEffect(() => setAltIndex(0), [pairIndex, source]);

  /* ------------------------------------------------ account state */
  const snapshot = useAccountSnapshot(twoTokens ? tokenIds : []);
  const shares = usePoolShares(poolId);
  const nativeAvailable = snapshot.data?.native.available;

  /* ------------------------------------------------ form */
  const [inputs, setInputs] = useState<[string, string]>(["", ""]);
  const [lastEdited, setLastEdited] = useState<0 | 1>(0);
  const [slipBps, setSlipBps] = useState(SLIPPAGE_DEFAULT_BPS);
  const [useRefDeposits, setUseRefDeposits] = useState(true);
  const [payWithNative, setPayWithNative] = useState(true);

  useEffect(() => setInputs(["", ""]), [poolId]);

  const reserves = pool.data?.reserves ?? [];
  const poolEmpty = !!pool.data && pool.data.sharesTotalSupply === 0n;
  const metaReady = twoTokens && !!metaA.data && !!metaB.data;

  /** Exact raw amounts: the edited side is parsed, the other derived from live reserves. */
  const amounts = useMemo((): [bigint, bigint] => {
    if (!metaReady) return [0n, 0n];
    const other = lastEdited === 0 ? 1 : 0;
    const edited = parseUnits(inputs[lastEdited], decimals[lastEdited]) ?? 0n;
    const counter = poolEmpty
      ? parseUnits(inputs[other], decimals[other]) ?? 0n
      : quoteCounterAmount(edited, reserves[lastEdited] ?? 0n, reserves[other] ?? 0n);
    return lastEdited === 0 ? [edited, counter] : [counter, edited];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, lastEdited, metaReady, poolEmpty, reserves[0], reserves[1], decimals[0], decimals[1]]);

  const displayValue = (i: 0 | 1) =>
    i === lastEdited || poolEmpty ? inputs[i] : amounts[i] > 0n ? rawToInput(amounts[i], decimals[i], 8) : "";

  const setSide = (i: 0 | 1, value: string) => {
    setLastEdited(i);
    setInputs((prev) => {
      const next: [string, string] = [...prev];
      next[i] = value;
      return next;
    });
  };

  const states = tokenIds.map((id) => snapshot.data?.tokens[id]);
  const spendables = states.map((s) => spendable(s, nativeAvailable ?? 0n, useRefDeposits, payWithNative));

  const setMax = (i: 0 | 1) => {
    const other = i === 0 ? 1 : 0;
    let max = spendables[i] ?? 0n;
    // Cap by what the counter leg can afford at the current ratio.
    if (!poolEmpty && (reserves[other] ?? 0n) > 0n) {
      max = minBig(max, mulDiv(spendables[other] ?? 0n, reserves[i], reserves[other]));
    }
    setSide(i, max > 0n ? rawToInput(max, decimals[i], 8) : "");
  };

  /* ------------------------------------------------ preview */
  const estimate = useMemo(
    () => (pool.data && twoTokens && amounts[0] > 0n && amounts[1] > 0n
      ? estimateAddLiquidity(amounts, pool.data.reserves, pool.data.sharesTotalSupply)
      : null),
    [pool.data, twoTokens, amounts],
  );

  const preview = useMemo((): { plan: InjectionPlan | null; error: string | null } => {
    if (!snapshot.data || !pool.data || !twoTokens || amounts[0] <= 0n || amounts[1] <= 0n || shares.data === undefined) {
      return { plan: null, error: null };
    }
    try {
      return {
        plan: planInjection(snapshot.data, {
          pool: pool.data,
          amounts,
          slippageBps: slipBps,
          useRefDeposits,
          payWithNative,
          existingShares: shares.data,
        }),
        error: null,
      };
    } catch (e) {
      return { plan: null, error: e instanceof PlanError ? e.message : e instanceof Error ? e.message : String(e) };
    }
  }, [snapshot.data, pool.data, twoTokens, amounts, slipBps, useRefDeposits, payWithNative, shares.data]);

  /* ------------------------------------------------ execution */
  const inj = useNearInjection();

  useEffect(() => {
    if (inj.phase === "error" && inj.error) toast(inj.error, "warn");
    if (inj.phase === "success") toast("liquidity injected. the pool is deeper.", "ok");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inj.phase]);

  const insufficient = twoTokens && snapshot.data ? [0, 1].find((i) => amounts[i] > spendables[i]) : undefined;

  const cta = ((): { label: string; disabled: boolean; onClick: () => void; spinner: boolean } => {
    const noop = () => {};
    if (inj.busy) {
      const label = inj.awaitingWallet ? `approve in wallet · ${INJECTION_PHASE_LABEL[inj.phase]} next` : `${INJECTION_PHASE_LABEL[inj.phase]}…`;
      return { label, disabled: true, onClick: noop, spinner: true };
    }
    if (poolId === null) {
      if (source === "pair" && pairPools.isLoading) return { label: "scanning Ref pools…", disabled: true, onClick: noop, spinner: true };
      if (source === "pair" && pairPools.isError) return { label: "couldn't scan Ref pools — retry", disabled: false, onClick: () => void pairPools.refetch(), spinner: false };
      if (source === "pair") return { label: "no Ref pool for this pair", disabled: true, onClick: noop, spinner: false };
      return { label: poolIdInput ? "pool id must be a number" : "enter a pool id", disabled: true, onClick: noop, spinner: false };
    }
    if (pool.isLoading) return { label: "reading pool…", disabled: true, onClick: noop, spinner: true };
    if (pool.isError || !pool.data) return { label: `pool #${poolId} not found`, disabled: true, onClick: noop, spinner: false };
    if (pool.data.kind !== SIMPLE_POOL) return { label: `${pool.data.kind.toLowerCase().replace(/_/g, " ")} not supported`, disabled: true, onClick: noop, spinner: false };
    if (!twoTokens) return { label: "only two-token pools are supported", disabled: true, onClick: noop, spinner: false };
    if (!metaReady) return { label: "reading token metadata…", disabled: true, onClick: noop, spinner: true };
    // Pool problems surface first; everything below depends on the connected account.
    if (!accountId) return { label: "connect NEAR wallet", disabled: false, onClick: signIn, spinner: false };
    if (amounts[0] <= 0n || amounts[1] <= 0n) return { label: poolEmpty ? "enter both amounts to seed" : "enter an amount", disabled: true, onClick: noop, spinner: false };
    if (!snapshot.data || shares.data === undefined) return { label: "checking balances…", disabled: true, onClick: noop, spinner: true };
    if (insufficient !== undefined) return { label: `insufficient ${symbols[insufficient]}`, disabled: true, onClick: noop, spinner: false };
    if (preview.error) return { label: preview.error, disabled: true, onClick: noop, spinner: false };
    if (!estimate || estimate.shares <= 0n) return { label: "amount too small", disabled: true, onClick: noop, spinner: false };
    const runIt = () =>
      void inj.run({ pool: pool.data!, amounts, slippageBps: slipBps, useRefDeposits, payWithNative });
    return { label: poolEmpty ? "seed pool & inject LP" : "inject liquidity", disabled: false, onClick: runIt, spinner: false };
  })();

  const price = pool.data && twoTokens && metaReady ? spotPrice(reserves[0], decimals[0], reserves[1], decimals[1]) : 0;
  const userShares = shares.data ?? 0n;
  const hasNearLeg = tokenIds.includes(WRAP_NEAR_CONTRACT_ID);
  const showPipeline = inj.phase !== "idle";

  /* ------------------------------------------------ render */
  return (
    <div className="mx-auto w-full max-w-md">
      <motion.div layout className="rounded-3xl border border-line bg-card p-4 shadow-(--shadow-card) sm:p-5">
        {/* header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-display text-base font-semibold tracking-tight text-ink">lp injector</div>
            <div className="mt-0.5 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">{REF_FINANCE_CONTRACT_ID} · simple pools</div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-card2 px-2.5 py-1 font-mono text-[10px] font-medium text-muted uppercase tracking-wide">
            <IconLayers size={11} /> {poolId !== null ? `pool #${poolId}` : "no pool"}
          </span>
        </div>

        {/* pool source */}
        <div className="mt-3 rounded-2xl border border-accent/20 bg-accentsoft/30 p-3">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-card p-1">
            {([
              { id: "pair", label: "common pairs" },
              { id: "id", label: "pool id" },
            ] as Array<{ id: PoolSource; label: string }>).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSource(opt.id)}
                className={`relative flex h-8 items-center justify-center rounded-full text-[11px] font-medium transition-colors ${source === opt.id ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {source === opt.id && <motion.span layoutId="source-pill" transition={spring} className="absolute inset-0 rounded-full bg-card2 shadow-(--shadow-soft)" />}
                <span className="relative z-10">{opt.label}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {source === "pair" ? (
              <motion.div key="pair" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {COMMON_PAIRS.map(([a, b], i) => (
                    <button
                      key={`${a}-${b}`}
                      onClick={() => setPairIndex(i)}
                      className={`flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 font-mono text-[10.5px] font-medium transition-all ${
                        pairIndex === i ? "border-accent bg-card text-ink" : "border-line text-muted hover:border-accent/40 hover:text-ink"
                      }`}
                    >
                      <span className="flex -space-x-1.5">
                        <TokenAvatar tokenId={a} size={18} />
                        <TokenAvatar tokenId={b} size={18} />
                      </span>
                      {symbolFor(a)}/{symbolFor(b)}
                    </button>
                  ))}
                </div>
                {(pairPools.data?.length ?? 0) > 1 && (
                  <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-muted">
                    <span className="text-faint">pool:</span>
                    <select
                      value={altIndex}
                      onChange={(e) => setAltIndex(Number(e.target.value))}
                      className="rounded-full border border-line bg-card px-2 py-1 text-[10px] text-ink outline-none"
                    >
                      {pairPools.data!.slice(0, 8).map((p, i) => (
                        <option key={p.id} value={i}>
                          #{p.id} · fee {(p.totalFeeBps / 100).toFixed(2)}%{i === 0 ? " · deepest" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {pairPools.isLoading && (
                  <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-muted">
                    <IconLoader size={11} className="animate-spin" /> scanning Ref pools on-chain for the deepest match…
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.div key="id" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
                <div className="mt-2 flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 focus-within:border-accent/40">
                  <IconSearch size={13} className="shrink-0 text-faint" />
                  <span className="font-mono text-[12px] text-faint">#</span>
                  <input
                    value={poolIdInput}
                    onChange={(e) => setPoolIdInput(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    placeholder="Ref pool id, e.g. 79"
                    className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* pool telemetry */}
        <AnimatePresence initial={false}>
          {pool.data && twoTokens && metaReady && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-2.5 space-y-1.5 rounded-2xl border border-linesoft bg-[color-mix(in_srgb,var(--card-2)_55%,transparent)] p-3.5 font-mono text-[10.5px]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-ink">
                    <span className="flex -space-x-1.5">
                      <TokenAvatar tokenId={tokenIds[0]} size={18} />
                      <TokenAvatar tokenId={tokenIds[1]} size={18} />
                    </span>
                    {symbols[0]} / {symbols[1]}
                  </span>
                  <a href={refPoolUrl(pool.data.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-faint hover:text-ink">
                    ref #{pool.data.id} <IconExternal size={10} />
                  </a>
                </div>
                <div className="flex justify-between"><span className="text-faint">reserves:</span><span className="text-ink tabular">{fmtAmount(reserves[0], decimals[0])} {symbols[0]} · {fmtAmount(reserves[1], decimals[1])} {symbols[1]}</span></div>
                <div className="flex justify-between"><span className="text-faint">price:</span><span className="text-ink tabular">{poolEmpty ? "unset — you choose it" : `1 ${symbols[1]} ≈ ${price.toPrecision(6)} ${symbols[0]}`}</span></div>
                <div className="flex justify-between"><span className="text-faint">swap fee:</span><span className="text-ink tabular">{(pool.data.totalFeeBps / 100).toFixed(2)}%</span></div>
                {accountId && (
                  <div className="flex justify-between"><span className="text-faint">your LP shares:</span><span className="text-ink tabular">{fmtAmount(userShares, LP_SHARE_DECIMALS)}</span></div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* amounts */}
        {twoTokens && metaReady && (
          <div className="mt-2.5 space-y-2">
            {([0, 1] as const).map((i) => (
              <AmountField
                key={tokenIds[i]}
                tokenId={tokenIds[i]}
                symbol={symbols[i]}
                decimals={decimals[i]}
                value={displayValue(i)}
                onChange={(v) => setSide(i, v)}
                onMax={() => setMax(i)}
                state={states[i]}
                nativeAvailable={nativeAvailable}
                auto={!poolEmpty && lastEdited !== i && amounts[i] > 0n}
                connected={!!accountId}
              />
            ))}
            {poolEmpty && (
              <p className="flex items-start gap-1.5 rounded-xl bg-ambersoft/50 px-3 py-2 font-mono text-[10px] leading-relaxed text-amberish">
                <IconAlert size={12} className="mt-0.5 shrink-0" /> this pool is empty — your two amounts set its initial price. double-check the ratio.
              </p>
            )}
          </div>
        )}

        {/* funding options */}
        {twoTokens && metaReady && (
          <div className="mt-2.5 space-y-1.5 rounded-2xl bg-card2/50 p-3.5 font-mono text-[10.5px]">
            <label className="flex cursor-pointer items-center justify-between">
              <span className="text-faint">use existing Ref deposits first</span>
              <input type="checkbox" checked={useRefDeposits} onChange={(e) => setUseRefDeposits(e.target.checked)} className="accent-[var(--accent)]" />
            </label>
            {hasNearLeg && (
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-faint">wrap native NEAR when wNEAR is short</span>
                <input type="checkbox" checked={payWithNative} onChange={(e) => setPayWithNative(e.target.checked)} className="accent-[var(--accent)]" />
              </label>
            )}
            <div className="flex items-center justify-between pt-1">
              <span className="text-faint">slippage tolerance:</span>
              <span className="flex gap-1">
                {SLIPPAGE_OPTIONS_BPS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSlipBps(s)}
                    className={`rounded-full px-2 py-0.5 text-[10px] transition-all ${slipBps === s ? "bg-accentsoft text-accentstrong" : "text-muted hover:text-ink"}`}
                  >
                    {(s / 100).toFixed(1)}%
                  </button>
                ))}
              </span>
            </div>
            {estimate && estimate.shares > 0n && (
              <>
                <div className="flex justify-between border-t border-linesoft pt-1.5">
                  <span className="text-faint">LP shares minted:</span>
                  <span className="text-ink tabular">~{fmtAmount(estimate.shares, LP_SHARE_DECIMALS)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-faint">pool share after:</span>
                  <span className="text-ink tabular">{(estimate.poolShareBps / 100).toFixed(2)}%</span>
                </div>
              </>
            )}
            {preview.plan && (
              <div className="flex justify-between">
                <span className="text-faint">min accepted:</span>
                <span className="text-ink tabular">
                  {fmtAmount(preview.plan.minAmounts[0], decimals[0])} {symbols[0]} · {fmtAmount(preview.plan.minAmounts[1], decimals[1])} {symbols[1]}
                </span>
              </div>
            )}
          </div>
        )}

        {/* plan review */}
        <AnimatePresence initial={false}>
          {preview.plan && !showPipeline && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-2.5 rounded-2xl border border-linesoft bg-card2/40 p-3">
                <div className="flex items-center justify-between font-mono text-[9.5px] tracking-[0.16em] text-faint uppercase">
                  <span className="flex items-center gap-1.5"><IconShield size={12} /> batch preview</span>
                  <span className="normal-case tracking-normal">{preview.plan.transactions.length} tx · one approval</span>
                </div>
                <ol className="mt-2 space-y-1">
                  {preview.plan.calls.map((call, i) => (
                    <li key={i} className="flex items-start gap-2 font-mono text-[10px] leading-snug text-muted">
                      <span className="mt-[1px] rounded bg-card px-1 text-[8.5px] text-faint uppercase">{call.step}</span>
                      <span className="min-w-0 break-words">{call.label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* live pipeline */}
        <AnimatePresence initial={false}>
          {showPipeline && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-2.5 rounded-2xl border border-linesoft bg-card2/40 p-3">
                <Stepper phase={inj.phase} plan={inj.plan} />
                {inj.phase === "error" && inj.error && (
                  <div className="mt-3 flex items-start gap-1.5 rounded-xl bg-danger/10 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-danger">
                    <IconAlert size={13} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      {inj.error}
                      {inj.failedTxHash && (
                        <a href={explorerTxUrl(inj.failedTxHash)} target="_blank" rel="noreferrer" className="ml-1 underline">
                          tx {shortHash(inj.failedTxHash)}
                        </a>
                      )}
                    </span>
                  </div>
                )}
                {inj.phase === "error" && inj.plan && (
                  <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-faint">
                    anything already wrapped or deposited stays in your wallet / Ref balance — retrying reuses it.
                  </p>
                )}
                {(inj.phase === "error" || inj.phase === "success") && (
                  <button onClick={inj.reset} className="mt-2 w-full text-center font-mono text-[10px] text-faint hover:text-ink">
                    dismiss
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* CTA */}
        <motion.button
          whileTap={cta.disabled ? undefined : { scale: 0.98 }}
          onClick={cta.onClick}
          disabled={cta.disabled}
          className={`mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-all ${
            cta.disabled ? "cursor-not-allowed bg-card2 text-faint" : "bg-accentfill text-onaccent hover:opacity-90"
          }`}
        >
          {cta.spinner && <IconLoader size={15} className="shrink-0 animate-spin" />}
          <span className="truncate">{cta.label}</span>
        </motion.button>

        {insufficient !== undefined && accountId && (
          <button onClick={onSwap} className="mt-2 flex w-full items-center justify-center gap-1.5 font-mono text-[10.5px] text-accent">
            <IconSwap size={12} /> swap for {symbols[insufficient]} on Ref first
          </button>
        )}
      </motion.div>

      <CompletionModal
        receipt={inj.receipt}
        tokens={symbols.map((symbol, i) => ({ symbol, decimals: decimals[i] }))}
        onClose={() => {
          inj.reset();
          setInputs(["", ""]);
        }}
      />
    </div>
  );
}
