import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { explorerTxUrl, LP_LOCK_ACCOUNT_ID } from "../config/near";
import { useLockLiquidity } from "../hooks/useLockLiquidity";
import type { RefPool } from "../lib/refFinance";
import { fmtAmount, shortHash } from "../lib/format";
import { LP_SHARE_DECIMALS, mulDiv } from "../utils/zapMath";
import { Button } from "./ui";
import { IconAlert, IconClose, IconExternal, IconLock } from "./icons";

const PRESETS = [25, 50, 100] as const;

/**
 * Lock LP shares forever. The shares move to an account nobody controls, so
 * neither the owner nor anyone else can ever withdraw them (or their fees).
 */
export function LockModal({
  open,
  onClose,
  pool,
  available,
  preset,
  symbols,
  decimals,
}: {
  open: boolean;
  onClose: () => void;
  pool: RefPool;
  /** The wallet's LP shares in the pool. */
  available: bigint;
  /** Pre-selected amount, e.g. the shares just minted. */
  preset?: bigint | null;
  symbols: string[];
  decimals: number[];
}) {
  const lock = useLockLiquidity();
  const [pct, setPct] = useState<number | "preset">(100);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPct(preset && preset > 0n && preset < available ? "preset" : 100);
    setAgreed(false);
    lock.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shares = useMemo(() => {
    if (pct === "preset") return preset && preset <= available ? preset : available;
    return (available * BigInt(pct)) / 100n;
  }, [pct, preset, available]);
  const supply = pool.sharesTotalSupply;
  const underlying = pool.tokenIds.map((_, i) => (supply > 0n ? mulDiv(pool.reserves[i], shares, supply) : 0n));
  const poolPct = supply > 0n ? Number(mulDiv(shares, 10_000n, supply)) / 100 : 0;

  const done = lock.phase === "success";
  const label = lock.phase === "checking" ? "Checking…" : lock.phase === "signing" ? "Confirm in wallet" : "Lock forever";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={lock.busy ? undefined : onClose}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:px-4"
        >
          <motion.div
            role="dialog"
            aria-label="Lock liquidity forever"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", damping: 24, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[420px] rounded-t-3xl border border-line bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-(--shadow-pop) sm:rounded-3xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-display text-base font-semibold text-ink">
                <IconLock size={17} /> Lock liquidity forever
              </div>
              <button onClick={onClose} disabled={lock.busy} aria-label="Close" className="rounded-lg p-1 text-faint hover:text-ink disabled:opacity-40">
                <IconClose size={18} />
              </button>
            </div>

            {done ? (
              <div className="mt-4 space-y-3 text-sm">
                <p className="text-ink">Locked {fmtAmount(lock.plan?.shares ?? shares, LP_SHARE_DECIMALS)} LP shares of pool #{pool.id} forever.</p>
                {lock.txHash && (
                  <a href={explorerTxUrl(lock.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-ink">
                    Tx {shortHash(lock.txHash)} <IconExternal size={11} />
                  </a>
                )}
                <Button className="w-full" onClick={onClose}>Done</Button>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-4 gap-1 text-xs font-semibold">
                  {!!preset && preset > 0n && preset < available && (
                    <button onClick={() => setPct("preset")} className={`h-8 rounded-lg ${pct === "preset" ? "bg-accentsoft text-accentstrong" : "bg-card2 text-muted hover:text-ink"}`}>
                      Just added
                    </button>
                  )}
                  {PRESETS.map((p) => (
                    <button key={p} onClick={() => setPct(p)} className={`h-8 rounded-lg ${pct === p ? "bg-accentsoft text-accentstrong" : "bg-card2 text-muted hover:text-ink"}`}>
                      {p}%
                    </button>
                  ))}
                </div>

                <dl className="mt-3 space-y-1.5 rounded-xl bg-card2 p-3 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">LP shares</dt><dd className="text-ink tabular">{fmtAmount(shares, LP_SHARE_DECIMALS)}</dd></div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Worth now</dt>
                    <dd className="truncate text-right text-ink tabular">{underlying.map((a, i) => `${fmtAmount(a, decimals[i])} ${symbols[i]}`).join(" + ")}</dd>
                  </div>
                  <div className="flex justify-between"><dt className="text-muted">Of the pool</dt><dd className="text-ink tabular">{poolPct.toFixed(2)}%</dd></div>
                </dl>

                <div className="mt-3 flex gap-2 rounded-xl bg-danger/10 p-3 text-xs text-danger">
                  <IconAlert size={15} className="mt-0.5 shrink-0" />
                  <p>
                    Permanent. The shares go to <span className="font-mono">{LP_LOCK_ACCOUNT_ID.slice(0, 6)}…{LP_LOCK_ACCOUNT_ID.slice(-4)}</span>, an account nobody controls.
                    Neither you nor anyone else can ever withdraw them or the trading fees they earn.
                  </p>
                </div>

                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-4 w-4 accent-[var(--danger)]" />
                  I understand this can't be undone
                </label>

                {lock.error && <p className="mt-2 text-xs break-words text-danger">{lock.error}</p>}

                <Button
                  variant="danger"
                  size="lg"
                  className="mt-4 w-full"
                  disabled={!agreed || shares <= 0n || lock.busy}
                  loading={lock.busy}
                  onClick={() => void lock.run(pool.id, shares)}
                >
                  {label}
                </Button>
                <p className="mt-2 text-center text-[11px] text-faint">No nearpool fee. First lock in a pool: 0.01 NEAR storage, unused part refunded.</p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
