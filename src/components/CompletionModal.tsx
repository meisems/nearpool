import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InjectionReceipt } from "../hooks/useNearInjection";
import { explorerTxUrl, NEAR_DECIMALS, refPoolUrl } from "../config/near";
import { fmtAmount, shortHash } from "../lib/format";
import { LP_SHARE_DECIMALS } from "../utils/zapMath";
import { TokenAvatar } from "./TokenAvatar";
import { IconCheck, IconDropletPlus, IconExternal, IconX } from "./icons";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;

function ExplorerLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded-2xl border border-linesoft bg-card2/60 px-3.5 py-2.5 text-xs font-medium text-ink transition-all hover:border-accent/40 hover:bg-card2"
    >
      {children}
      <IconExternal size={13} className="text-faint" />
    </a>
  );
}

export interface TokenDisplay {
  symbol: string;
  decimals: number;
}

export function CompletionModal({
  receipt,
  tokens,
  onClose,
}: {
  receipt: InjectionReceipt | null;
  /** Display metadata in pool token order. */
  tokens: TokenDisplay[];
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {receipt && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/25 backdrop-blur-[4px] sm:items-center sm:p-4 dark:bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 70, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 50, opacity: 0, scale: 0.98 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl border border-line bg-card p-5 shadow-(--shadow-pop) sm:w-[400px] sm:rounded-3xl"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ ...spring, delay: 0.15 }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-accentsoft text-accent"
                >
                  <IconCheck size={17} />
                </motion.span>
                <div>
                  <div className="font-display text-base font-semibold text-ink">liquidity injected.</div>
                  <div className="text-[11px] text-muted">Ref pool #{receipt.poolId} is deeper. you did that.</div>
                </div>
              </div>
              <button onClick={onClose} className="rounded-full p-1.5 text-faint transition-colors hover:bg-card2 hover:text-ink">
                <IconX size={16} />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl bg-accentsoft/70 px-3.5 py-3">
              <span className="flex items-center gap-2 text-xs font-medium text-accentstrong">
                <IconDropletPlus size={14} />
                LP shares minted
              </span>
              <span className="font-mono text-sm font-bold text-accentstrong tabular">
                {fmtAmount(receipt.sharesMinted, LP_SHARE_DECIMALS)}
              </span>
            </div>

            <div className="mt-2 space-y-2">
              {receipt.tokenIds.map((tokenId, i) => (
                <div key={tokenId} className="flex items-center justify-between rounded-2xl bg-card2/60 px-3.5 py-3">
                  <span className="flex items-center gap-2.5 text-xs text-muted">
                    <TokenAvatar tokenId={tokenId} size={26} />
                    {tokens[i]?.symbol ?? tokenId} added
                  </span>
                  <span className="font-mono text-sm font-semibold text-ink tabular">
                    ~{fmtAmount(receipt.usedAmounts[i] ?? 0n, tokens[i]?.decimals ?? 24)} {tokens[i]?.symbol ?? ""}
                  </span>
                </div>
              ))}
              {receipt.wrapped > 0n && (
                <p className="px-1 font-mono text-[9.5px] text-faint">
                  wrapped {fmtAmount(receipt.wrapped, NEAR_DECIMALS)} NEAR → wNEAR on the way in
                </p>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {receipt.txHash && (
                <ExplorerLink href={explorerTxUrl(receipt.txHash)}>add_liquidity tx · {shortHash(receipt.txHash)}</ExplorerLink>
              )}
              {receipt.txHashes
                .filter((hash) => hash !== receipt.txHash)
                .map((hash, i) => (
                  <ExplorerLink key={hash} href={explorerTxUrl(hash)}>
                    setup tx {i + 1} · {shortHash(hash)}
                  </ExplorerLink>
                ))}
              <ExplorerLink href={refPoolUrl(receipt.poolId)}>pool #{receipt.poolId} on Ref Finance</ExplorerLink>
            </div>

            <p className="mt-4 text-center font-mono text-[9.5px] text-faint">
              sealed on NEAR mainnet · LP shares stay in your Ref account · non-custodial
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
