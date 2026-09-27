import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { COMMON_TOKENS, WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { useFtMetadata } from "../hooks/useRefData";
import { isValidAccountId } from "../lib/near";
import { shortAccount } from "../lib/format";
import { displaySymbol } from "../lib/refFinance";
import { TokenAvatar } from "./TokenAvatar";
import { IconClose, IconLoader, IconSearch } from "./icons";

function TokenRow({ tokenId, subtitle, onSelect }: { tokenId: string; subtitle?: string; onSelect: (tokenId: string) => void }) {
  const meta = useFtMetadata(tokenId);
  const symbol = displaySymbol(tokenId, meta.data);
  const name = tokenId === WRAP_NEAR_CONTRACT_ID ? "NEAR (wrapped on deposit)" : meta.data?.name ?? (meta.isLoading ? "reading…" : "unknown token");
  return (
    <button
      onClick={() => onSelect(tokenId)}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-card2"
    >
      <TokenAvatar tokenId={tokenId} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{name}</div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
          <span className="font-semibold text-muted">{symbol}</span>
          <span className="truncate">{shortAccount(tokenId, 28)}</span>
        </div>
      </div>
      {subtitle && <span className="shrink-0 font-mono text-[9.5px] text-faint">{subtitle}</span>}
    </button>
  );
}

function PastedToken({ tokenId, onSelect }: { tokenId: string; onSelect: (tokenId: string) => void }) {
  const meta = useFtMetadata(tokenId);
  if (meta.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-5 font-mono text-[11px] text-faint">
        <IconLoader size={13} className="animate-spin" /> reading ft_metadata…
      </div>
    );
  }
  if (meta.isError || !meta.data) {
    return <div className="px-3 py-6 text-center font-mono text-[11px] text-faint">{tokenId} doesn't expose NEP-141 metadata</div>;
  }
  return <TokenRow tokenId={tokenId} subtitle="live read" onSelect={onSelect} />;
}

/** Token picker: common NEAR tokens, or paste any NEP-141 contract account ID. */
export function TokenSelectModal({
  open,
  onClose,
  onSelect,
  excludeTokenId,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (tokenId: string) => void;
  excludeTokenId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      COMMON_TOKENS.filter((t) => {
        if (excludeTokenId && t.id === excludeTokenId) return false;
        if (!q) return true;
        return t.symbol.toLowerCase().includes(q) || t.id.includes(q);
      }),
    [q, excludeTokenId],
  );

  const pasted = q && isValidAccountId(q) && !filtered.some((t) => t.id === q) && q !== excludeTokenId ? q : null;

  const handleSelect = (tokenId: string) => {
    onSelect(tokenId);
    setQuery("");
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-20 backdrop-blur-sm sm:items-center sm:pt-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", damping: 20, stiffness: 260 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-[420px] flex-col overflow-hidden rounded-3xl border border-line bg-card shadow-(--shadow-pop)"
          >
            <div className="flex items-center justify-between border-b border-linesoft px-5 py-4">
              <div className="font-display text-[16px] font-semibold text-ink">select a token</div>
              <button onClick={onClose} aria-label="close" className="text-faint transition-colors hover:text-ink">
                <IconClose size={18} />
              </button>
            </div>

            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 rounded-full border border-line bg-card2/60 px-3.5 py-2.5 transition-colors focus-within:border-accent/40">
                <IconSearch size={14} className="shrink-0 text-faint" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="search symbol, or paste token.near"
                  spellCheck={false}
                  autoCapitalize="off"
                  className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
                />
              </div>
            </div>

            <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
              <div className="px-3 pt-2 pb-1 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
                {q ? "search results" : `common tokens · ${filtered.length}`}
              </div>
              {filtered.map((t) => (
                <TokenRow key={t.id} tokenId={t.id} onSelect={handleSelect} />
              ))}
              {pasted && <PastedToken tokenId={pasted} onSelect={handleSelect} />}
              {!filtered.length && !pasted && (
                <div className="px-3 py-6 text-center font-mono text-[11px] text-faint">
                  no match — paste a full NEP-141 contract ID like <span className="text-muted">token.v2.ref-finance.near</span>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
