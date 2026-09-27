import { Link } from "react-router-dom";
import { useNearWallet } from "../context/NearWalletContext";
import { useTokenMarket } from "../hooks/useTokenMarket";
import { useWatchlist, type TrackedToken } from "../hooks/useWatchlist";
import { fmtAmount } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import { Delta, fmtPrice, Skeleton } from "./ui";
import { IconX } from "./icons";

function TrackedRow({ entry, detailed, onRemove }: { entry: TrackedToken; detailed: boolean; onRemove: () => void }) {
  const { accountId } = useNearWallet();
  const m = useTokenMarket(entry.tokenId, entry.poolId);
  const change = m.price > 0 && entry.priceAtAdd > 0 ? ((m.price - entry.priceAtAdd) / entry.priceAtAdd) * 100 : null;

  return (
    <li className="group flex items-center gap-3 py-2.5">
      <Link to={`/t/${entry.tokenId}?pool=${entry.poolId}`} className="flex min-w-0 flex-1 items-center gap-3">
        <TokenAvatar tokenId={entry.tokenId} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{m.symbol}</span>
          <span className="block truncate text-xs text-faint">
            {m.loading ? <Skeleton className="h-3 w-16" /> : `#${entry.poolId} · ${m.counterSymbol}`}
          </span>
        </span>
        {detailed && (
          <span className="hidden w-36 text-right text-xs text-muted tabular sm:block">
            {m.pool ? `${fmtAmount(m.counterReserve, m.counterDecimals)} ${m.counterSymbol}` : "—"}
            <span className="block text-faint">liquidity</span>
          </span>
        )}
        {detailed && accountId && (
          <span className="hidden w-28 text-right text-xs text-muted tabular md:block">
            {m.shares > 0n ? `${(m.shareBps / 100).toFixed(2)}%` : "—"}
            <span className="block text-faint">your share</span>
          </span>
        )}
        <span className="w-28 text-right tabular">
          <span className="block text-sm text-ink">{m.loading ? <Skeleton className="h-4 w-14" /> : `${fmtPrice(m.price)} ${m.counterSymbol}`}</span>
          <span className="block text-xs"><Delta value={change} /></span>
        </span>
      </Link>
      <button
        onClick={onRemove}
        aria-label={`Stop tracking ${m.symbol}`}
        title="Remove"
        className="rounded-lg p-1.5 text-faint opacity-60 transition hover:bg-card2 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100"
      >
        <IconX size={14} />
      </button>
    </li>
  );
}

export function TrackedList({ limit, detailed = false, empty }: { limit?: number; detailed?: boolean; empty?: React.ReactNode }) {
  const { list, untrack } = useWatchlist();
  if (list.length === 0) return <>{empty ?? <p className="py-6 text-center text-sm text-faint">Nothing tracked yet</p>}</>;
  return (
    <ul className="divide-y divide-linesoft">
      {list.slice(0, limit).map((entry) => (
        <TrackedRow key={entry.tokenId} entry={entry} detailed={detailed} onRemove={() => untrack(entry.tokenId)} />
      ))}
    </ul>
  );
}
