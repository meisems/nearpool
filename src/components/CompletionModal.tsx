import { motion, AnimatePresence } from "framer-motion";
import type { InjectionReceipt } from "../hooks/useContractInjection";
import { DEAD_ADDRESS, EXPLORER_URL, PLATFORM_TOKEN_SYMBOL } from "../lib/constants";
import { fmtWei, shortAddr } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import { IconCheck, IconExternal, IconFlame, IconNft, IconX } from "./icons";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;

function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
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

export function CompletionModal({
  receipt,
  tokenSymbol,
  tokenDecimals,
  onClose,
}: {
  receipt: InjectionReceipt | null;
  tokenSymbol: string;
  tokenDecimals: number;
  onClose: () => void;
}) {
  const open = !!receipt;
  const versionLabel = receipt ? receipt.version.toLowerCase() : "";

  return (
    <AnimatePresence>
      {open && receipt && (
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
                  {receipt.mode === "zap" ? <IconFlame size={16} /> : <IconCheck size={17} />}
                </motion.span>
                <div>
                  <div className="font-display text-base font-semibold text-ink">
                    ETH-only liquidity deployed.
                  </div>
                  <div className="text-[11px] text-muted">the pond is thicker. you did that.</div>
                </div>
              </div>
              <button onClick={onClose} className="rounded-full p-1.5 text-faint transition-colors hover:bg-card2 hover:text-ink">
                <IconX size={16} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-coin/25 bg-coinsoft px-3.5 py-3">
              <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-coin uppercase">
                <IconFlame size={13} />
                position burned permanently
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="font-mono text-[9.5px] text-muted">
                  sent to the unrecoverable burn address
                </span>
                <a href={`${EXPLORER_URL}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 font-mono text-[9.5px] font-medium text-ink hover:underline">
                  view tx <IconExternal size={10} />
                </a>
              </div>
            </div>

            {/* position nft chip */}
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-accentsoft/70 px-3.5 py-3">
              <span className="flex items-center gap-2 text-xs font-medium text-accentstrong">
                <IconNft size={14} />
                {versionLabel} position nft
              </span>
              <span className="font-mono text-sm font-bold text-accentstrong tabular">
                #{receipt.positionId?.toString() ?? "—"}
              </span>
            </div>

            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between rounded-2xl bg-card2/60 px-3.5 py-3">
                <span className="text-xs text-muted">eth injected into pool depth</span>
                <span className="font-mono text-sm font-semibold text-ink tabular">+{fmtWei(receipt.ethInjected, 18)} ETH</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-card2/60 px-3.5 py-3">
                <span className="flex items-center gap-2.5 text-xs text-muted">
                  <TokenAvatar address={receipt.token as `0x${string}`} symbol={tokenSymbol} size={26} />
                  single-sided Uniswap liquidity
                </span>
                <span className="font-mono text-sm font-semibold text-ink tabular">
                  0 {tokenSymbol} · ETH only
                </span>
              </div>
            </div>

            {/* on-chain incineration receipt */}
            {receipt.burnedPons > 0n && (
              <div className="mt-2 rounded-2xl border border-coin/25 bg-coinsoft px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-coin uppercase">
                    <IconFlame size={12} /> fee vault burn allocation
                  </span>
                  <span className="font-mono text-xs font-bold text-coin tabular">
                    {fmtWei(receipt.burnedPons, 18)} ETH allocation
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-mono text-[9.5px] text-muted">
                    protocol cut · routed to the fee vault · represented as burned
                  </span>
                  <a
                    href={`${EXPLORER_URL}/tx/${receipt.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-[9.5px] font-medium text-coin hover:underline"
                  >
                    verify <IconExternal size={10} />
                  </a>
                </div>
              </div>
            )}
            {receipt.feeEth === 0n && (
              <p className="mt-2 text-center font-mono text-[9.5px] text-faint">
                holder tier honored · 0.0000 eth cut · verified by the fee vault flow
              </p>
            )}

            <div className="mt-3 space-y-2">
              <ExplorerLink href={`${EXPLORER_URL}/tx/${receipt.txHash}`}>
                {receipt.mode === "zap" ? "atomic zap tx" : "injection tx"} · {shortAddr(receipt.txHash)}
              </ExplorerLink>
              <ExplorerLink href={`${EXPLORER_URL}/address/${receipt.pair}`}>
                pool · position backing · {shortAddr(receipt.pair)}
              </ExplorerLink>
            </div>

            <p className="mt-4 text-center font-mono text-[9.5px] text-faint">
              sealed on robinhood chain · 4663 · non-custodial, as always
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
