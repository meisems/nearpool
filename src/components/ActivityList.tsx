import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { explorerTxUrl, WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { fetchActivity, type ActivityPost } from "../lib/activity";
import { fmtAmount, shortAccount } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import { IconExternal } from "./icons";

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function useActivity() {
  return useQuery({ queryKey: ["activity-feed"], queryFn: ({ signal }) => fetchActivity(signal), refetchInterval: 15_000 });
}

function Row({ post }: { post: ActivityPost }) {
  // Lead with the non-NEAR token — that's the one people track.
  const lead = post.tokenIds.find((id) => id !== WRAP_NEAR_CONTRACT_ID) ?? post.tokenIds[0];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link to={`/t/${lead}?pool=${post.poolId}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex shrink-0 -space-x-2">
          {post.tokenIds.slice(0, 2).map((id) => <TokenAvatar key={id} tokenId={id} size={26} className="ring-2 ring-card" />)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{post.symbols.join(" / ")}</span>
          <span className="block truncate text-xs text-faint tabular">
            {post.amounts.map((a, i) => `${fmtAmount(BigInt(a), post.decimals[i] ?? 24)} ${post.symbols[i] ?? ""}`).join(" + ")}
          </span>
        </span>
      </Link>
      <a
        href={explorerTxUrl(post.hash)}
        target="_blank"
        rel="noreferrer"
        className="flex shrink-0 flex-col items-end text-xs text-faint hover:text-ink"
        title={post.accountId}
      >
        <span className="flex items-center gap-1">{ago(post.timestamp)} <IconExternal size={10} /></span>
        <span className="max-w-[110px] truncate">{shortAccount(post.accountId, 16)}</span>
      </a>
    </li>
  );
}

/** Recent verified injections, optionally for one token only. */
export function ActivityList({ tokenId, limit = 6 }: { tokenId?: string; limit?: number }) {
  const { data = [], isLoading } = useActivity();
  const rows = (tokenId ? data.filter((p) => p.tokenIds.includes(tokenId)) : data).slice(0, limit);
  if (isLoading) return <p className="py-6 text-center text-sm text-faint">Loading…</p>;
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-faint">No activity yet</p>;
  return <ul className="divide-y divide-linesoft">{rows.map((p) => <Row key={p.hash} post={p} />)}</ul>;
}
