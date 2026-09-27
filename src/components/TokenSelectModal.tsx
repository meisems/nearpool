import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTokenMeta } from "../hooks/useTokenMeta";
import type { RegistryTokenSummary } from "../lib/tokenRegistry";
import { WETH_ADDRESS } from "../lib/constants";
import { shortAddr } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import { searchPonsLaunches, type PonsLaunchToken } from "../lib/ponsCatalog";
import { IconClose, IconLoader, IconSearch } from "./icons";

const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

function TokenRow({
  token,
  subtitle,
  onSelect,
  logo,
}: {
  token: RegistryTokenSummary;
  subtitle?: string;
  onSelect: (address: string) => void;
  logo?: string;
}) {
  return (
    <button
      onClick={() => onSelect(token.address)}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-card2"
    >
      <TokenAvatar address={token.address} symbol={token.symbol} logo={logo} size={34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{token.name}</div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
          <span className="font-semibold text-muted">{token.symbol}</span>
          <span>{shortAddr(token.address)}</span>
        </div>
      </div>
      {subtitle && <span className="shrink-0 font-mono text-[9.5px] text-faint">{subtitle}</span>}
    </button>
  );
}

/**
 * Uniswap-style token selector. Resolves pasted addresses live against
 * Robinhood Chain, and lists tokens launched through the Pons catalog.
 */
export function TokenSelectModal({
  open,
  onClose,
  onSelect,
  excludeAddress,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (address: string) => void;
  excludeAddress?: string;
}) {
  const [query, setQuery] = useState("");
  const [ponsLaunches, setPonsLaunches] = useState<PonsLaunchToken[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setCatalogLoading(true);
    searchPonsLaunches("", controller.signal)
      .then(setPonsLaunches)
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") setPonsLaunches([]);
      })
      .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [open]);

  const all = useMemo(() => {
    const merged = [...ponsLaunches];
    const seen = new Set<string>();
    return merged.filter((token) => {
      const key = token.address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [ponsLaunches]);
  const q = query.trim().toLowerCase();
  const exclude = excludeAddress?.toLowerCase();

  const filtered = useMemo(
    () =>
      all.filter((t) => {
        if (exclude && t.address.toLowerCase() === exclude) return false;
        if (!q) return true;
        return (
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q)
        );
      }),
    [all, q, exclude],
  );

  const queryIsAddr = isAddr(query.trim());
  const exactHit = queryIsAddr && filtered.some((t) => t.address.toLowerCase() === q);
  const pastedAddress = queryIsAddr && !exactHit ? (query.trim() as `0x${string}`) : undefined;
  const live = useTokenMeta(pastedAddress, WETH_ADDRESS as `0x${string}`);

  // Keep a valid pasted address selectable while metadata is loading or when
  // the token does not expose the standard ERC-20 name/symbol methods. The
  // creator form can still use the address, and selecting a different pasted
  // address simply replaces the current one in the search field.
  const liveRow: RegistryTokenSummary | null = pastedAddress
    ? {
        address: pastedAddress,
        symbol: live.symbol ?? "TOKEN",
        name: live.name ?? "Pasted token",
        decimals: live.decimals ?? 18,
        logo: live.logo,
      }
    : null;

  const nothingFound = !filtered.length && !liveRow && !(pastedAddress && live.isLoading);

  const handleSelect = (address: string) => {
    onSelect(address);
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
                  placeholder="search name, symbol, or paste address"
                  spellCheck={false}
                  className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
                />
              </div>
            </div>

            <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
              <div className="px-3 pt-2 pb-1 font-mono text-[9.5px] tracking-[0.14em] text-faint uppercase">
                {q
                  ? "search results"
                    : catalogLoading
                    ? "loading Pons launches…"
                    : `Pons launches · ${ponsLaunches.length}`}
              </div>

              {catalogLoading && !filtered.length && (
                <div className="flex items-center justify-center gap-2 px-3 py-5 font-mono text-[11px] text-faint">
                  <IconLoader size={13} className="animate-spin" /> loading Pons launches…
                </div>
              )}

              {filtered.map((t) => (
                <TokenRow key={t.address} token={t} onSelect={handleSelect} />
              ))}

              {liveRow && (
                <TokenRow
                  token={liveRow}
                  logo={liveRow.logo}
                  subtitle={live.liveRead ? "live read" : live.isLoading ? "reading…" : "address"}
                  onSelect={handleSelect}
                />
              )}

              {pastedAddress && live.isLoading && (
                <div className="flex items-center justify-center gap-2 px-3 py-5 font-mono text-[11px] text-faint">
                  <IconLoader size={13} className="animate-spin" /> reading contract…
                </div>
              )}

              {nothingFound && !catalogLoading && (
                <div className="px-3 py-6 text-center font-mono text-[11px] text-faint">
                  {q ? "no Pons launch found for that search" : "no Pons launches yet"}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
