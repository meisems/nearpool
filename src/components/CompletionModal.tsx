import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { InjectionReceipt } from "../hooks/useNearInjection";
import { explorerTxUrl, refPoolUrl } from "../config/near";
import { fmtAmount, shortHash } from "../lib/format";
import { LP_SHARE_DECIMALS } from "../utils/zapMath";
import { TokenAvatar } from "./TokenAvatar";
import { Button } from "./ui";
import { IconCheck, IconExternal, IconLock, IconStar, IconX } from "./icons";

export interface TokenDisplay {
  symbol: string;
  decimals: number;
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted">{label}</span>
      <span className="text-ink tabular">{children}</span>
    </div>
  );
}

export function CompletionModal({
  receipt,
  tokens,
  tracked,
  onTrack,
  onLock,
  onClose,
}: {
  /** Offer to lock the shares just minted, forever. */
  onLock?: () => void;
  receipt: InjectionReceipt | null;
  /** Display metadata in pool token order. */
  tokens: TokenDisplay[];
  tracked?: boolean;
  onTrack?: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {receipt && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", damping: 24, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Liquidity added"
            className="w-full rounded-t-2xl border border-line bg-card p-5 sm:w-[380px] sm:rounded-2xl"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accentfill text-onaccent">
                <IconCheck size={18} />
              </span>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-faint hover:bg-card2 hover:text-ink">
                <IconX size={16} />
              </button>
            </div>
            <h2 className="mt-3 font-display text-xl font-semibold text-ink">Liquidity added</h2>

            <div className="mt-3 divide-y divide-linesoft">
              {receipt.tokenIds.map((tokenId, i) => (
                <Row key={tokenId} label={<><TokenAvatar tokenId={tokenId} size={20} />{tokens[i]?.symbol ?? tokenId}</>}>
                  {fmtAmount(receipt.usedAmounts[i] ?? 0n, tokens[i]?.decimals ?? 24)}
                </Row>
              ))}
              <Row label="LP shares">{fmtAmount(receipt.sharesMinted, LP_SHARE_DECIMALS)}</Row>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {receipt.txHash && (
                <a href={explorerTxUrl(receipt.txHash)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-muted hover:text-ink">
                  Tx {shortHash(receipt.txHash)} <IconExternal size={11} />
                </a>
              )}
              <a href={refPoolUrl(receipt.poolId)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-muted hover:text-ink">
                Pool #{receipt.poolId} <IconExternal size={11} />
              </a>
            </div>

            {onLock && receipt.sharesMinted > 0n && (
              <button onClick={onLock} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-sm text-muted transition hover:text-ink">
                <IconLock size={13} /> Lock these shares forever
              </button>
            )}

            <div className="mt-3 flex gap-2">
              {onTrack && !tracked && (
                <Button variant="secondary" className="flex-1" onClick={onTrack}>
                  <IconStar size={15} /> Track
                </Button>
              )}
              <Button className="flex-1" onClick={onClose}>
                Done
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
