import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNearWallet } from "../context/NearWalletContext";
import { useAccountSnapshot, useFtMetadata, usePairPools } from "../hooks/useRefData";
import { useRefSwap } from "../hooks/useRefSwap";
import {
  explorerTxUrl,
  NEAR_DECIMALS,
  NEAR_GAS_RESERVE,
  SLIPPAGE_DEFAULT_BPS,
  SLIPPAGE_MAX_BPS,
  SLIPPAGE_OPTIONS_BPS,
  WRAP_NEAR_CONTRACT_ID,
} from "../config/near";
import { displaySymbol, PlanError, planSwap } from "../lib/refFinance";
import { fmtAmount, parseUnits, rawToInput, shortHash } from "../lib/format";
import { applySlippage, estimateSwapOut, maxBig, swapPriceImpactBps } from "../utils/zapMath";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { TokenSelectModal } from "./TokenSelectModal";
import { IconArrowDown, IconCheck, IconChevronDown, IconExternal, IconLoader, IconSettings, IconZap } from "./icons";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;
const STORAGE_HEADROOM = 50_000_000_000_000_000_000_000n; // 0.05 NEAR for registrations

function TokenButton({ tokenId, onClick, accent }: { tokenId: string; onClick: () => void; accent?: boolean }) {
  const meta = useFtMetadata(tokenId);
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border py-1.5 pr-2.5 pl-1.5 transition-colors ${
        accent ? "border-coin/40 bg-coinsoft/60 hover:border-coin/70" : "border-line bg-card hover:border-accent/40"
      }`}
    >
      <TokenAvatar tokenId={tokenId} size={24} />
      <span className="text-sm font-semibold text-ink">{displaySymbol(tokenId, meta.data)}</span>
      <IconChevronDown size={12} className="text-faint" />
    </button>
  );
}

/**
 * Single-hop Ref Finance swap. Used to source the counter asset before an
 * LP injection; NEAR input is wrapped on the fly, NEAR output arrives as
 * wNEAR (which the injector spends directly).
 */
export function SwapCard({ onInject }: { onInject: () => void }) {
  const { accountId, signIn } = useNearWallet();
  const toast = useToast();

  const [tokenIn, setTokenIn] = useState(WRAP_NEAR_CONTRACT_ID);
  const [tokenOut, setTokenOut] = useState("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
  const [picker, setPicker] = useState<"in" | "out" | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [slipBps, setSlipBps] = useState(SLIPPAGE_DEFAULT_BPS);
  const [customSlip, setCustomSlip] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const metaIn = useFtMetadata(tokenIn);
  const metaOut = useFtMetadata(tokenOut);
  const decIn = metaIn.data?.decimals ?? NEAR_DECIMALS;
  const decOut = metaOut.data?.decimals ?? NEAR_DECIMALS;
  const symIn = displaySymbol(tokenIn, metaIn.data);
  const symOut = tokenOut === WRAP_NEAR_CONTRACT_ID ? "wNEAR" : displaySymbol(tokenOut, metaOut.data);

  const pools = usePairPools(tokenIn, tokenOut);
  const pool = pools.data?.[0] ?? null;
  const snapshot = useAccountSnapshot([tokenIn, tokenOut]);
  const swap = useRefSwap();

  const activeSlip = customSlip
    ? Math.max(1, Math.min(SLIPPAGE_MAX_BPS, Math.round(parseFloat(customSlip) * 100) || 0))
    : slipBps;

  const amountIn = useMemo(() => (metaIn.data ? parseUnits(amountInput, decIn) ?? 0n : 0n), [amountInput, decIn, metaIn.data]);
  const inIdx = pool ? pool.tokenIds.indexOf(tokenIn) : -1;
  const outIdx = pool ? pool.tokenIds.indexOf(tokenOut) : -1;
  const expectedOut = pool && inIdx >= 0 && outIdx >= 0 ? estimateSwapOut(amountIn, pool.reserves[inIdx], pool.reserves[outIdx], pool.totalFeeBps) : 0n;
  const minOut = expectedOut > 0n ? applySlippage(expectedOut, activeSlip) : 0n;
  const impactBps = pool && inIdx >= 0 ? swapPriceImpactBps(amountIn, expectedOut, pool.reserves[inIdx], pool.reserves[outIdx]) : 0;
  const oneUnitOut = pool && inIdx >= 0 && outIdx >= 0 ? estimateSwapOut(10n ** BigInt(decIn), pool.reserves[inIdx], pool.reserves[outIdx], pool.totalFeeBps) : 0n;

  const inState = snapshot.data?.tokens[tokenIn];
  const nativeAvail = snapshot.data?.native.available ?? 0n;
  const spendableIn = inState
    ? inState.walletBalance + (tokenIn === WRAP_NEAR_CONTRACT_ID ? maxBig(nativeAvail - NEAR_GAS_RESERVE - STORAGE_HEADROOM, 0n) : 0n)
    : 0n;

  const planError = useMemo(() => {
    if (!snapshot.data || !pool || amountIn <= 0n) return null;
    try {
      planSwap(snapshot.data, { pool, tokenIn, tokenOut, amountIn, slippageBps: activeSlip, payWithNative: true });
      return null;
    } catch (e) {
      return e instanceof PlanError ? e.message : e instanceof Error ? e.message : String(e);
    }
  }, [snapshot.data, pool, tokenIn, tokenOut, amountIn, activeSlip]);

  useEffect(() => {
    if (swap.phase === "success" && swap.receipt) {
      toast(`swapped. ≥${fmtAmount(swap.receipt.minAmountOut, decOut)} ${symOut} on its way.`, "ok");
      setAmountInput("");
    }
    if (swap.phase === "error" && swap.error) toast(swap.error, "warn");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.phase]);

  const disabledReason = !accountId
    ? null
    : swap.busy
      ? null
      : pools.isLoading
        ? "finding the deepest Ref pool…"
        : !pool
          ? "no Ref simple pool for this pair"
          : amountIn <= 0n
            ? "enter an amount"
            : !snapshot.data
              ? "checking balances…"
              : amountIn > spendableIn
                ? `not enough ${symIn}`
                : expectedOut <= 0n
                  ? "the pool has no depth for this trade"
                  : planError;

  const run = () => {
    if (!pool || disabledReason) return;
    swap.reset();
    void swap.run({ pool, tokenIn, tokenOut, amountIn, slippageBps: activeSlip, payWithNative: true });
  };

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountInput("");
  };

  const setPct = (pct: bigint) => {
    const value = (spendableIn * pct) / 100n;
    setAmountInput(value > 0n ? rawToInput(value, decIn, 6) : "");
  };

  return (
    <div className="mx-auto w-full max-w-[440px]">
      <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-(--shadow-card)">
        {/* header */}
        <div className="flex items-center justify-between border-b border-linesoft px-5 py-4">
          <div>
            <div className="font-display text-[17px] font-semibold tracking-tight text-ink">swap on Ref</div>
            <div className="mt-0.5 font-mono text-[10px] tracking-wide text-faint">
              {pool ? `pool #${pool.id} · ${(pool.totalFeeBps / 100).toFixed(2)}% fee` : "single-hop instant swap"} · {symIn.toLowerCase()} → {symOut.toLowerCase()}
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="slippage settings"
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition-all hover:border-accent/40 hover:text-ink ${settingsOpen ? "border-accent/40 text-ink" : ""}`}
            >
              <IconSettings size={16} />
            </button>
            <AnimatePresence>
              {settingsOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={spring}
                  className="absolute right-0 z-30 mt-2 w-[230px] rounded-2xl border border-line bg-card p-3.5 shadow-(--shadow-pop)"
                >
                  <div className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">slippage tolerance</div>
                  <div className="mt-2 flex gap-1.5">
                    {SLIPPAGE_OPTIONS_BPS.map((b) => (
                      <button
                        key={b}
                        onClick={() => { setSlipBps(b); setCustomSlip(""); }}
                        className={`h-9 flex-1 rounded-full border text-xs font-semibold transition-all ${
                          !customSlip && slipBps === b ? "border-accent bg-accentsoft text-accentstrong" : "border-line text-muted hover:border-accent/40"
                        }`}
                      >
                        {(b / 100).toFixed(1)}%
                      </button>
                    ))}
                    <div className="relative h-9 flex-1">
                      <input
                        inputMode="decimal"
                        placeholder="custom"
                        value={customSlip}
                        onChange={(e) => setCustomSlip(e.target.value.replace(/[^\d.]/g, ""))}
                        className={`h-9 w-full rounded-full border bg-transparent px-3 pr-6 text-xs font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint ${customSlip ? "border-accent" : "border-line"}`}
                      />
                      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[10px] text-faint">%</span>
                    </div>
                  </div>
                  <div className="mt-2 font-mono text-[9.5px] text-faint">min received guards the swap. {(activeSlip / 100).toFixed(2)}% today.</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="p-4">
          {/* in */}
          <div className="rounded-2xl border border-linesoft bg-card2/50 p-3.5 transition-colors focus-within:border-accent/40">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>you pay</span>
              <span className="font-mono tabular">bal {accountId && inState ? fmtAmount(spendableIn, decIn) : "—"}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <input
                inputMode="decimal"
                placeholder="0.0"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value.replace(/[^\d.]/g, ""))}
                className="min-w-0 flex-1 bg-transparent font-display text-[26px] font-semibold tracking-tight text-ink outline-none placeholder:text-faint/60"
              />
              <TokenButton tokenId={tokenIn} onClick={() => setPicker("in")} />
            </div>
            {accountId && (
              <div className="mt-2 flex gap-1.5">
                {[25n, 50n, 100n].map((p) => (
                  <button
                    key={p.toString()}
                    onClick={() => setPct(p)}
                    className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-muted transition-all hover:border-accent/50 hover:text-accent"
                  >
                    {p === 100n ? "max" : `${p}%`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* flip */}
          <div className="relative z-10 -my-2.5 flex justify-center">
            <motion.button
              whileTap={{ rotate: 180 }}
              onClick={flip}
              aria-label="flip direction"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-accent shadow-(--shadow-soft)"
            >
              <IconArrowDown size={15} />
            </motion.button>
          </div>

          {/* out */}
          <div className="rounded-2xl border border-linesoft bg-card2/50 p-3.5">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>you receive · est.</span>
              <span className="font-mono tabular">{pools.isLoading ? "scanning pools…" : pool ? `ref #${pool.id}` : "no pool"}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="min-w-0 flex-1 truncate font-display text-[26px] font-semibold tracking-tight text-ink tabular">
                {expectedOut > 0n ? fmtAmount(expectedOut, decOut) : "0.0"}
              </div>
              <TokenButton tokenId={tokenOut} onClick={() => setPicker("out")} accent />
            </div>
          </div>

          {/* quote */}
          <div className="mt-3 space-y-1.5 px-1 font-mono text-[10.5px] text-muted">
            <div className="flex justify-between">
              <span>rate</span>
              <span className="text-ink tabular">1 {symIn} ≈ {oneUnitOut > 0n ? fmtAmount(oneUnitOut, decOut) : "—"} {symOut}</span>
            </div>
            <div className="flex justify-between">
              <span>min received · {(activeSlip / 100).toFixed(2)}%</span>
              <span className="text-ink tabular">{minOut > 0n ? `${fmtAmount(minOut, decOut)} ${symOut}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>price impact</span>
              <span className={`tabular ${impactBps > 300 ? "text-danger" : "text-ink"}`}>{expectedOut > 0n ? `${(impactBps / 100).toFixed(2)}%` : "—"}</span>
            </div>
          </div>

          {/* receipt */}
          <AnimatePresence>
            {swap.receipt && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-accentsoft/70 px-3.5 py-3">
                  <span className="flex items-center gap-2 text-xs font-semibold text-accentstrong">
                    <IconCheck size={14} /> ≥{fmtAmount(swap.receipt.minAmountOut, decOut)} {symOut}
                  </span>
                  {swap.receipt.txHash && (
                    <a href={explorerTxUrl(swap.receipt.txHash)} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[10.5px] text-accentstrong underline-offset-2 hover:underline">
                      tx {shortHash(swap.receipt.txHash)} <IconExternal size={11} />
                    </a>
                  )}
                </div>
                <button onClick={onInject} className="mt-2 w-full text-center font-mono text-[10.5px] text-accent">
                  now inject it as liquidity →
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* action */}
          <motion.button
            whileTap={disabledReason || swap.busy ? undefined : { scale: 0.98 }}
            onClick={accountId ? run : signIn}
            disabled={(!!disabledReason || swap.busy) && !!accountId}
            className={`mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-all ${
              (disabledReason || swap.busy) && accountId
                ? "cursor-not-allowed bg-card2 text-faint"
                : "bg-coin text-canvas shadow-(--shadow-soft) hover:opacity-90 dark:text-[#241a06]"
            }`}
          >
            {swap.busy ? (
              <>
                <IconLoader size={17} className="animate-spin" /> {swap.phase === "checking-storage" ? "checking storage…" : "approve in wallet…"}
              </>
            ) : !accountId ? (
              <>
                <IconZap size={16} /> connect NEAR wallet
              </>
            ) : (
              <>swap {symIn} → {symOut}</>
            )}
          </motion.button>
          {disabledReason && accountId && !swap.busy && (
            <div className="mt-2 text-center font-mono text-[10.5px] text-faint">{disabledReason}</div>
          )}
        </div>
      </div>

      <p className="mt-3 text-center font-mono text-[9.5px] text-faint">
        quotes read live from Ref pool reserves · NEAR is wrapped automatically · NEAR output arrives as wNEAR
      </p>

      <TokenSelectModal
        open={picker !== null}
        onClose={() => setPicker(null)}
        excludeTokenId={picker === "in" ? tokenOut : tokenIn}
        onSelect={(id) => {
          if (picker === "in") setTokenIn(id);
          else setTokenOut(id);
          setAmountInput("");
        }}
      />
    </div>
  );
}
